// 監査ログ: すべてのリクエストについて「IP / User-Agent / 時刻 / ページ / 操作」を残す。
//
// 保存先は Server/data/logs/access-YYYY-MM-DD.jsonl（1行 = 1リクエスト）。
// 日次でファイルを分け、ACCESS_LOG_DAYS 日より古いファイルは自動削除する
// （無制限に増え続けないようにするため。ディスク容量の暴走を防ぐ）。
//
// 書き込みは逐次キュー化した非同期 append（リクエスト処理はブロックしない）。
// パス・UA などの文字列は長さを切り詰め、メモリを消費しすぎないようにする。
//
// ログにはボディ（本文・パスワード・画像）は一切含めない。
const fs = require("fs");
const path = require("path");
const { ensureDir } = require("./jsonStore");
const session = require("./session");

const LOG_DIR = path.join(__dirname, "data", "logs");
const FILE_RE = /^access-(\d{4}-\d{2}-\d{2})\.jsonl$/;

const MAX_DAYS = 3650;
const MIN_DAYS = 1;
function daysFromEnv(v) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return 90;
    return Math.min(MAX_DAYS, Math.max(MIN_DAYS, n));
}
const RETENTION_DAYS = daysFromEnv(process.env.ACCESS_LOG_DAYS);
// ACCESS_LOG=false で無効化（テスト用途。既定は有効）
const DISABLED = String(process.env.ACCESS_LOG || "").toLowerCase() === "false";

const LIMITS = { ip: 64, ua: 400, path: 300, query: 300, ref: 300, action: 100 };
const clip = (v, n) => String(v === undefined || v === null ? "" : v).slice(0, n);

function dayKey(ts) {
    const d = new Date(ts);
    const p = (x) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ---------- 追記キュー（同一ファイルへの書き込み順を保つ） ---------- */
let chain = Promise.resolve();
function append(file, line) {
    chain = chain
        .then(() => fs.promises.appendFile(file, line, "utf8"))
        .catch((err) => console.error("[accessLog] 書き込み失敗:", err.message));
}

/* ---------- 保持期間の切れ ----------
 * access-YYYY-MM-DD.jsonl の日付部分が RETENTION_DAYS より古ければ削除する。 */
function prune() {
    try {
        ensureDir(LOG_DIR);
        const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
        for (const name of fs.readdirSync(LOG_DIR)) {
            const m = name.match(FILE_RE);
            if (!m) continue;
            const ts = Date.parse(`${m[1]}T00:00:00`);
            if (Number.isFinite(ts) && ts < cutoff) {
                fs.promises.unlink(path.join(LOG_DIR, name)).catch(() => {});
            }
        }
    } catch (err) {
        console.error("[accessLog] 保持期間の整理に失敗:", err.message);
    }
}

/* ---------- ルートごとの操作名 ----------
 * 明示的に操作名を付けたいルートは accessLog.note(req, "投稿") のように指定する。
 * 指定が無いものはここで機械的に推定する。 */
const ACTION_MAP = new Map([
    ["POST /api/login", "ログイン"],
    ["POST /api/register", "新規登録"],
    ["POST /api/logout", "ログアウト"],
    ["POST /api/posts", "投稿"],
    ["DELETE /api/posts", "投稿削除"],
    ["POST /api/media/image", "画像アップロード"],
    ["POST /api/media/video", "動画アップロード"],
    ["PUT /api/me/profile", "プロフィール更新"],
    ["PUT /api/me/password", "パスワード変更"],
    ["PUT /api/me/username", "ユーザー名変更"],
    ["DELETE /api/me", "アカウント削除"],
]);

function typeOf(p) {
    if (
        p.startsWith("/api/media/") ||
        p.startsWith("/api/avatar/") ||
        p.startsWith("/api/header/")
    )
        return "media";
    if (p.startsWith("/api/")) return "api";
    const last = p.slice(p.lastIndexOf("/") + 1);
    if (last.includes(".")) return "asset";
    return "page";
}

// API 呼び出しは「どのページから呼ばれたか」を Referer から拾う
function pageOf(p, ref, type) {
    if (type !== "api") return p;
    if (!ref) return "-";
    try {
        return new URL(ref).pathname || "-";
    } catch {
        return "-";
    }
}

function defaultAction(method, p, type) {
    const exact = ACTION_MAP.get(`${method} ${p}`);
    if (exact) return exact;
    if (p.startsWith("/api/")) return `API ${method}`;
    if (type === "media") return "メディア取得";
    if (type === "asset") return "静的ファイル取得";
    return "ページ表示";
}

// ルート側から操作名を上書きする（例: accessLog.note(req, "引用リポスト")）
function note(req, action) {
    if (req && action) req._logAction = clip(action, LIMITS.action);
}

function buildRow(req, res, started) {
    const now = Date.now();
    const rawUrl = String(req.originalUrl || req.url || "");
    const qIdx = rawUrl.indexOf("?");
    const p = clip(qIdx === -1 ? rawUrl : rawUrl.slice(0, qIdx), LIMITS.path);
    const query = clip(qIdx === -1 ? "" : rawUrl.slice(qIdx + 1), LIMITS.query);
    const type = typeOf(p);
    const ref = clip(req.headers.referer || "", LIMITS.ref);
    let user = null;
    try {
        user = session.currentUserId(req);
    } catch {
        user = null;
    }
    return {
        t: now,
        time: new Date(now).toISOString(),
        ip: clip(req.ip || (req.socket && req.socket.remoteAddress) || "", LIMITS.ip),
        ua: clip(req.headers["user-agent"] || "", LIMITS.ua),
        method: req.method,
        path: p,
        query,
        page: clip(pageOf(p, req.headers.referer, type), LIMITS.path),
        ref,
        type,
        user,
        action: req._logAction || defaultAction(req.method, p, type),
        status: res.statusCode,
        ms: now - started,
    };
}

function write(row) {
    if (DISABLED) return;
    ensureDir(LOG_DIR);
    append(path.join(LOG_DIR, `access-${dayKey(row.t)}.jsonl`), JSON.stringify(row) + "\n");
}

// 通信の成否に関わらず記録するため、res.finish で収集する
function middleware(req, res, next) {
    const started = Date.now();
    res.on("finish", () => {
        try {
            write(buildRow(req, res, started));
        } catch (err) {
            console.error("[accessLog] 記録に失敗:", err.message);
        }
    });
    next();
}

prune();
if (!DISABLED) {
    setInterval(prune, 6 * 60 * 60 * 1000).unref();
}

module.exports = { middleware, note, write, prune, LOG_DIR, RETENTION_DAYS };
