// Llama Guard 3 1B（Ollama 経由）による投稿の自動モデレーション。
//
// - 投稿時に同期チェックし、規約違反と判定された投稿は保存せずに拒否（＝削除相当）し、
//   ユーザーへ警告（トースト + アプリ内通知）を出す。
// - 起動直後と MODERATION_RESCAN_MIN 分ごとに全投稿を再スキャンし、
//   違反していた投稿を削除して作者に通知する（モデレーション結果が無効化された投稿を
//   後から拾うため。画像・動画は OCR しないので本文テキストのみが対象）。
// - Ollama が落ちている場合は「判定不能」として投稿を通し、moderation.state を
//   "pending" にして次回の再スキャンに回す（＝無断で投稿を消さない／見逃さない）。
//
// モデルは Ollama のライブラリモデル `llama-guard3:1b`（既定）。
//   ollama pull llama-guard3:1b
// 環境変数:
//   OLLAMA_URL          既定 http://127.0.0.1:11434
//   MODERATION_MODEL    既定 llama-guard3:1b（8B は llama-guard3:8b）
//   MODERATION=false    モデレーション全体を無効化
//   MODERATION_TIMEOUT_MS   1回の判定のタイムアウト（既定 20000）
//   MODERATION_RESCAN_MIN   全件再スキャン間隔（既定 30 分）
//   MODERATION_RECHECK_MIN  safe 判定の有効期間（既定 60 分）
//
// 注意: Llama Guard 3 1B が扱う言語は英・仏・独・伊・ヒンディー・ポルトガル・西・タイの
// 8 言語で、日本語は含まれない。日本語本文の判定精度は英語ほど安定しない
// （必要なら MODERATION_MODEL=llama-guard3:8b に上げるか、投稿に英語の要約を添える）。
const path = require("path");
const crypto = require("crypto");
const { readArray, writeArray, ensureDir } = require("./jsonStore");

const OLLAMA_URL = String(process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
const MODEL = process.env.MODERATION_MODEL || "llama-guard3:1b";
const DISABLED = String(process.env.MODERATION || "").toLowerCase() === "false";
function intEnv(name, def, min, max) {
    const n = parseInt(process.env[name], 10);
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, n));
}
const TIMEOUT_MS = intEnv("MODERATION_TIMEOUT_MS", 20000, 1000, 120000);
const RESCAN_MS = intEnv("MODERATION_RESCAN_MIN", 30, 1, 24 * 60) * 60 * 1000;
const RECHECK_MS = intEnv("MODERATION_RECHECK_MIN", 60, 1, 24 * 60) * 60 * 1000;

// MLCommons / Llama Guard 3 の 13 項目（S1〜S13）
const HAZARDS = {
    S1: "暴力的犯罪",
    S2: "非暴力的犯罪",
    S3: "性関連犯罪",
    S4: "子どもの性的搾取",
    S5: "名誉毀損",
    S6: "専門的助言",
    S7: "プライバシー侵害",
    S8: "知的財産権",
    S9: "無差別兵器",
    S10: "ヘイト",
    S11: "自傷・自殺",
    S12: "性的コンテンツ",
    S13: "選挙・選挙制度",
};

const MOD_FILE = path.join(__dirname, "data", "moderation.json");
const NOTIFY = require("./notificationStore");

const clip = (v, n) => String(v === undefined || v === null ? "" : v).slice(0, n);

function hazardLabel(codes) {
    if (!codes || !codes.length) return "";
    return codes.map((c) => `${c}（${HAZARDS[c] || "不明な分類"}）`).join("・");
}

/* ================= 判定本体 ================= */

function parseVerdict(raw) {
    const text = String(raw || "").trim();
    if (!text) return { ok: false, reason: "empty-response" };
    // 1行目は "safe" / "unsafe"。unsafe の後に分類コード（S1, S12 …）が並ぶ。
    if (/\bunsafe\b/i.test(text)) {
        const codes = [];
        for (const line of text.split(/\r?\n/)) {
            const m = line.trim().match(/^(S(?:1[0-3]|[1-9]))\b/i);
            if (m) {
                const code = "S" + m[1].slice(1);
                if (!codes.includes(code)) codes.push(code);
            }
        }
        return { ok: true, safe: false, categories: codes, raw: clip(text, 500) };
    }
    if (/\bsafe\b/i.test(text)) {
        return { ok: true, safe: true, categories: [], raw: clip(text, 200) };
    }
    return { ok: false, reason: "unknown-output", raw: clip(text, 200) };
}

// テキストを Llama Guard に通す。
// 戻り値: { ok:true, safe, categories } / { ok:false, reason }（判定不能）
async function classify(text) {
    if (DISABLED) return { ok: true, safe: true, skipped: true };
    const content = clip(text, 8000);
    if (!content.trim()) return { ok: true, safe: true, empty: true };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(`${OLLAMA_URL}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
                model: MODEL,
                stream: false,
                keep_alive: "10m",
                messages: [{ role: "user", content }],
                options: { temperature: 0 },
            }),
        });
        if (!res.ok) return { ok: false, reason: `http-${res.status}` };
        const data = await res.json();
        const out = data && data.message ? data.message.content : "";
        return parseVerdict(out);
    } catch (err) {
        return { ok: false, reason: err && err.name === "AbortError" ? "timeout" : "unreachable" };
    } finally {
        clearTimeout(timer);
    }
}

async function ping() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
        const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: controller.signal });
        if (!res.ok) return { ok: false, reason: `http-${res.status}` };
        const data = await res.json();
        const names = (data.models || []).map((m) => String(m.name || m.model || ""));
        const has = names.some(
            (n) => n === MODEL || n.split(":")[0] === MODEL.split(":")[0]
        );
        return { ok: true, hasModel: has, models: names.slice(0, 20) };
    } catch {
        return { ok: false, reason: "unreachable" };
    } finally {
        clearTimeout(timer);
    }
}

/* ================= 違反記録 / 警告 ================= */

function recordViolation(row) {
    try {
        ensureDir(path.dirname(MOD_FILE));
        const rows = readArray(MOD_FILE);
        rows.push({
            id: crypto.randomUUID(),
            at: Date.now(),
            model: MODEL,
            postId: row.postId || null,
            userId: row.userId || null,
            source: row.source || "unknown",
            categories: row.categories || [],
            label: hazardLabel(row.categories),
            text: clip(row.text, 280),
        });
        // 無限に増えないように直近 2000 件のみ保持
        if (rows.length > 2000) rows.splice(0, rows.length - 2000);
        writeArray(MOD_FILE, rows);
    } catch (err) {
        console.error("[moderation] 違反記録に失敗:", err.message);
    }
}

// ユーザーへの警告（アプリ内通知）。トーストは呼び出し側（HTTP 応答）が出す。
function warn(userId, detail) {
    if (!userId) return;
    NOTIFY.add({
        userId,
        type: "moderation",
        actor: "system",
        postId: null,
        detail: clip(detail, 300),
        dedupe: false,
    });
}

function buildContent(text, poll) {
    const parts = [String(text || "")];
    if (poll && Array.isArray(poll.options)) {
        parts.push(poll.options.map((o) => String(o && o.text !== undefined ? o.text : o)).join(" / "));
    }
    return parts.join("\n").trim();
}

/* ================= 投稿時の同期チェック ================= */

// 戻り値:
//   { verdict: "pass" }                       … 通過
//   { verdict: "reject", categories, label }  … 違反（保存せず警告する）
//   { verdict: "pending", reason }            … 判定不能（保存はする・後で再スキャン）
async function checkAtCreate({ userId, text, poll = null, postId = null, source = "create" }) {
    const content = buildContent(text, poll);
    const v = await classify(content);
    if (v.ok && v.safe) return { verdict: "pass" };
    if (v.ok && !v.safe) {
        const label = hazardLabel(v.categories);
        recordViolation({
            postId,
            userId,
            source,
            categories: v.categories,
            text: content,
        });
        warn(
            userId,
            `自動モデレーション（Llama Guard）があなたの投稿を規約違反と判定しました。` +
                (label ? ` 分類: ${label}。` : "") +
                ` 同種の投稿を続けるとアカウントが制限される可能性があります。`
        );
        return { verdict: "reject", categories: v.categories, label };
    }
    return { verdict: "pending", reason: v.reason || "unknown" };
}

/* ================= 全投稿の再スキャン ================= */

let rescanning = false;

function removePostAndCleanup(post) {
    // posts.js の削除処理と同じ後始末（返信ツリー・メディア・通知・ブックマーク）
    const postStore = require("./postStore");
    const mediaStore = require("./mediaStore");
    const bookmarks = require("./bookmarkStore");
    const notifications = require("./notificationStore");

    const { removed, mediaIds } = postStore.remove(post.id);
    mediaStore.removeFiles(mediaIds);
    notifications.removeForPosts(removed);
    bookmarks.removeForPosts(removed);
    return removed;
}

async function rescan() {
    if (rescanning || DISABLED) return { scanned: 0, removed: 0, pending: 0, skipped: 0 };
    rescanning = true;
    const stats = { scanned: 0, removed: 0, pending: 0, skipped: 0 };
    try {
        const postStore = require("./postStore");
        const now = Date.now();
        for (const p of postStore.listAll()) {
            const m = p.moderation;
            // 最近 safe と判定済みのものは一定時間再判定しない（無駄な推論を避ける）
            if (m && m.state === "safe" && now - (m.at || 0) < RECHECK_MS) {
                stats.skipped += 1;
                continue;
            }
            const content = buildContent(p.text, p.poll);
            if (!content) {
                // 本文が無い（画像・動画のみ）投稿は判定対象外
                postStore.setModeration(p.id, { state: "safe", at: now, categories: [] });
                stats.skipped += 1;
                continue;
            }
            const v = await classify(content);
            if (!v.ok) {
                // 判定不能 → 状態を pending のまま次回に委ねる
                stats.pending += 1;
                continue;
            }
            stats.scanned += 1;
            if (v.safe) {
                postStore.setModeration(p.id, { state: "safe", at: Date.now(), categories: [] });
                continue;
            }
            const label = hazardLabel(v.categories);
            recordViolation({
                postId: p.id,
                userId: p.userId,
                source: "rescan",
                categories: v.categories,
                text: content,
            });
            removePostAndCleanup(p);
            warn(
                p.userId,
                `自動モデレーション（Llama Guard）の再チェックで、あなたの投稿を規約違反と判定し削除しました。` +
                    (label ? ` 分類: ${label}。` : "")
            );
            stats.removed += 1;
        }
    } catch (err) {
        console.error("[moderation] 再スキャンに失敗:", err.message);
    } finally {
        rescanning = false;
    }
    if (stats.scanned || stats.removed || stats.pending) {
        console.log(
            `[moderation] 再スキャン: 判定 ${stats.scanned} 件 / 削除 ${stats.removed} 件 / 判定不能 ${stats.pending} 件 / 対象外 ${stats.skipped} 件`
        );
    }
    return stats;
}

function start() {
    if (DISABLED) {
        console.log("[moderation] MODERATION=false のため無効です。");
        return;
    }
    ping().then((p) => {
        if (!p.ok) {
            console.warn(
                `[warn] Ollama（${OLLAMA_URL}）に接続できません（${p.reason}）。` +
                    `モデレーションは判定不能として投稿を通し、接続が回復するまで再スキャンを続けます。`
            );
        } else if (!p.hasModel) {
            console.warn(
                `[warn] モデレーションモデル ${MODEL} が見つかりません。 \`ollama pull ${MODEL}\` を実行してください。`
            );
        } else {
            console.log(`[moderation] Llama Guard 利用可: ${MODEL} @ ${OLLAMA_URL}`);
        }
    });
    setTimeout(() => rescan(), 5000).unref();
    setInterval(() => rescan(), RESCAN_MS).unref();
}

module.exports = {
    classify,
    ping,
    checkAtCreate,
    rescan,
    start,
    hazardLabel,
    HAZARDS,
    MODEL,
    OLLAMA_URL,
    DISABLED,
};
