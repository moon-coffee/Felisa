// 投稿中の URL へのアクセス「チェック」。
//
// 投稿本文の URL はいきなり開かせず、必ずこのサーバーを経由して
//   1. URL 形式・プロトコル・ポート・認証情報の検査
//   2. 内部ネットワーク（ループバック / プライベート / リンクローカル / メタデータ）への
//      ポインタでないかの検査（IP リテラル直接指定）
//   3. ドメインの DNS 解決結果がすべて外部のグローバルアドレスかの検査
//   4. Llama Guard 3 による URL 文字列自体の規約チェック
// を通したうえで、確認ページ（インターナシシャル）を挟んでから移動する。
//
// 画面は「確認してから進む」ページと「ブロックされた」ページの 2 種類。
// 移動の実行（/out/go）でもう一度検査し直すため、URL を書き換えて
// 検査をすり抜けることはできない。
//
// 注意: 検査はブラウザが実際に接続する時点の DNS を見るものではないため
// （＝リバインディング攻撃には完全には防げない）ベストエフォートである。
const express = require("express");
const dns = require("dns");
const moderation = require("./moderation");
const accessLog = require("./accessLog");

const router = express.Router();

const MAX_URL = 2048;
const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);
const INTERNAL_TLD = /\.(local|localhost|internal|intranet|lan|home|corp|test|example)$/i;
const DNS_TIMEOUT_MS = 5000;

/* ---------- IP アドレスが外部（グローバル）か ---------- */

function ipv4IsPublic(ip) {
    const parts = ip.split(".").map((x) => parseInt(x, 10));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255))
        return false;
    const [a, b, c] = parts;
    if (a === 0) return false; // 0.0.0.0/8
    if (a === 10) return false; // 10.0.0.0/8
    if (a === 100 && b >= 64 && b <= 127) return false; // 100.64.0.0/10 CGNAT
    if (a === 127) return false; // loopback
    if (a === 169 && b === 254) return false; // link-local（169.254.169.254 のクラウドメタデータ含む）
    if (a === 172 && b >= 16 && b <= 31) return false; // 172.16.0.0/12
    if (a === 192 && b === 168) return false; // 192.168.0.0/16
    if (a === 192 && b === 0 && c === 0) return false; // 192.0.0.0/24
    if (a === 192 && b === 0 && c === 2) return false; // TEST-NET-1
    if (a === 198 && (b === 18 || b === 19)) return false; // 198.18.0.0/15
    if (a === 198 && b === 51 && c === 100) return false; // TEST-NET-2
    if (a === 203 && b === 0 && c === 113) return false; // TEST-NET-3
    if (a >= 224) return false; // multicast / reserved / broadcast
    return true;
}

function ipv6IsPublic(ip) {
    const v = String(ip).toLowerCase().split("%")[0];
    if (v === "::" || v === "::1") return false;
    // IPv4 映射（::ffff:192.168.0.1 など）は IPv4 判定に回す
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return ipv4IsPublic(mapped[1]);
    // グローバルユニキャストは 2000::/3 のみ。それ以外
    // （fc00::/7 ULA・fe80::/10 リンクローカル・ff00::/8 マルチキャスト・
    //   64:ff9b::/96 NAT64・2001:db8::/32 ドキュメント用 …）は拒否する。
    const first = parseInt(v.slice(0, 2), 16);
    if (!Number.isFinite(first) || first < 0x20 || first > 0x3f) return false;
    return true;
}

function ipIsPublic(ip) {
    return ip.includes(":") ? ipv6IsPublic(ip) : ipv4IsPublic(ip);
}

/* ---------- ホスト名の静的検査 ---------- */

function hostProblem(host) {
    const h = String(host).toLowerCase().replace(/\.$/, "");
    if (!h) return "ホスト名がありません。";
    if (h === "localhost" || h.endsWith(".localhost")) return "ローカルホストへのリンクは開けません。";
    if (INTERNAL_TLD.test(h)) return "社内・ローカル向けドメインへのリンクは開けません。";
    // IP リテラル直接指定（ホスト名としてドットが無い単一ラベルも内部解決しがち）
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":")) {
        if (!ipIsPublic(h)) return "プライベート／内部ネットワークのアドレスを指しています。";
        return null;
    }
    if (!h.includes(".")) return "ドメインとして解決できないホスト名です。";
    return null;
}

/* ---------- DNS 解決 ---------- */

async function dnsProblem(hostname) {
    let addrs;
    try {
        addrs = await Promise.race([
            dns.promises.lookup(hostname, { all: true, verbatim: true }),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error("dns-timeout")), DNS_TIMEOUT_MS)
            ),
        ]);
    } catch (err) {
        // 解決できない = 開けない（存在しないドメインへの誘導を止める）
        return "このドメインを解決できませんでした。";
    }
    if (!addrs || !addrs.length) return "このドメインを解決できませんでした。";
    const bad = addrs.find((a) => !ipIsPublic(a.address));
    if (bad) return `内部ネットワークを指すアドレス（${bad.address}）を含んでいます。`;
    return null;
}

/* ---------- チェック本体 ---------- */

async function check(raw) {
    const url = typeof raw === "string" ? raw.trim() : "";
    const steps = [];
    const result = { url, host: "", checks: steps, ok: false, reason: "", moderation: null };
    const fail = (name, note) => {
        steps.push({ name, ok: false, note });
        result.reason = note;
        return result;
    };

    if (!url) return fail("URL 形式", "URL が指定されていません。");
    if (url.length > MAX_URL) return fail("URL 彺式", "URL が長すぎます。");

    let u;
    try {
        u = new URL(url);
        steps.push({ name: "URL 形式", ok: true, note: "解釈できました" });
    } catch {
        return fail("URL 形式", "URL として解釈できません。");
    }

    if (u.protocol !== "http:" && u.protocol !== "https:") {
        return fail("プロトコル", "http / https 以外のリンクは開けません。");
    }
    steps.push({ name: "プロトコル", ok: true, note: u.protocol.replace(":", "") });

    if (u.username || u.password) {
        return fail("認証情報", "ユーザーIDを埋め込んだ URL は開けません。");
    }
    if (!ALLOWED_PORTS.has(u.port)) {
        return fail("ポート", `ポート ${u.port} へのリンクは開けません。`);
    }

    const hostProblemNote = hostProblem(u.hostname);
    if (hostProblemNote) return fail("アドレス", hostProblemNote);
    steps.push({ name: "アドレス", ok: true, note: "内部アドレスではありません" });
    result.host = u.hostname;

    // IP リテラルは DNS 解決不要
    const isIpLiteral = u.hostname.includes(":") || /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname);
    if (!isIpLiteral) {
        const dnsNote = await dnsProblem(u.hostname);
        if (dnsNote) return fail("DNS 解決", dnsNote);
        steps.push({ name: "DNS 解決", ok: true, note: "すべて外部アドレスです" });
    } else {
        steps.push({ name: "DNS 解決", ok: true, note: "IP 指定のため省略" });
    }

    // Llama Guard による URL 文字列自体のチェック（Ollama が無いときは判定不可扱い）
    const v = await moderation.classify(url);
    if (v.ok && v.safe) {
        result.moderation = { state: "safe" };
        steps.push({ name: "Llama Guard 判定", ok: true, note: "違反なし" });
    } else if (v.ok && !v.safe) {
        result.moderation = { state: "unsafe", categories: v.categories };
        return fail(
            "Llama Guard 判定",
            `利用規約に違反する可能性があるリンクです（${moderation.hazardLabel(v.categories) || "分類なし"}）。`
        );
    } else {
        result.moderation = { state: "unavailable" };
        steps.push({
            name: "Llama Guard 判定",
            ok: null,
            note: "判定できません（モデレーション未接続）",
        });
    }

    result.ok = true;
    return result;
}

/* ---------- 画面 ---------- */

function esc(v) {
    return String(v === undefined || v === null ? "" : v)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function checkList(steps) {
    return steps
        .map((s) => {
            const cls = s.ok === true ? "ok" : s.ok === false ? "bad" : "unknown";
            const icon =
                s.ok === true
                    ? "fa-solid fa-circle-check"
                    : s.ok === false
                      ? "fa-solid fa-circle-xmark"
                      : "fa-solid fa-circle-question";
            return `<li class="out-check out-check--${cls}"><i class="${icon}" aria-hidden="true"></i>` +
                `<span><b>${esc(s.name)}</b> — ${esc(s.note)}</span></li>`;
        })
        .join("");
}

function page({ kind, result, goHref }) {
    const blocked = kind === "blocked";
    const title = blocked ? "このリンクは開けません" : "外部サイトへ移動します";
    const icon = blocked
        ? "fa-solid fa-shield-halved"
        : "fa-solid fa-triangle-exclamation";
    const url = result.url || "";
    const host = result.host || "";
    const actions = blocked
        ? `<a class="btn btn-outline" href="/home">Felisa に戻る</a>`
        : `<a class="btn btn-solid" href="${esc(goHref)}" target="_blank" rel="noopener noreferrer nofollow">このサイトへ移動</a>` +
          `<a class="btn btn-outline" href="/home">キャンセル</a>`;

    return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="dark light">
<base href="/">
<title>${esc(title)} | Felisa</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/7.3.1/css/all.css">
<link rel="stylesheet" href="home.css">
<script src="js/theme.js" defer></script>
<style>
.out-body { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px 16px; }
.out-card { width: 100%; max-width: 560px; background: var(--panel); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 28px 24px; }
.out-icon { font-size: 34px; color: var(--accent); margin-bottom: 8px; }
.out-card--blocked .out-icon { color: var(--like); }
.out-card h1 { font-size: 20px; font-weight: 800; margin-bottom: 12px; }
.out-host { font-size: 17px; font-weight: 700; word-break: break-all; }
.out-url { display: block; font-size: 13px; color: var(--text-dim); word-break: break-all; margin-top: 4px; }
.out-reason { margin-top: 14px; padding: 12px; border-radius: 10px; background: rgba(var(--like-rgb), 0.12);
    color: var(--like); font-size: 14px; font-weight: 700; }
.out-checks { list-style: none; margin-top: 18px; display: grid; gap: 8px; }
.out-check { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; color: var(--text-dim); }
.out-check i { margin-top: 2px; }
.out-check--ok i { color: var(--repost); }
.out-check--bad i { color: var(--like); }
.out-check--unknown i { color: var(--text-dim); }
.out-check--bad span { color: var(--like); }
.out-note { margin-top: 18px; font-size: 12px; line-height: 1.7; color: var(--text-dim); }
.out-actions { display: flex; gap: 10px; margin-top: 20px; flex-wrap: wrap; }
.out-actions .btn { flex: 1; justify-content: center; text-align: center; min-width: 150px; }
</style>
</head>
<body class="out-body">
<main class="out-card${blocked ? " out-card--blocked" : ""}">
    <div class="out-icon"><i class="${icon}" aria-hidden="true"></i></div>
    <h1>${esc(title)}</h1>
    ${host ? `<div class="out-host">${esc(host)}</div>` : ""}
    ${url ? `<div class="out-url">${esc(url)}</div>` : ""}
    ${blocked && result.reason ? `<p class="out-reason">${esc(result.reason)}</p>` : ""}
    <ul class="out-checks">${checkList(result.checks)}</ul>
    <p class="out-note">
        Felisa は投稿中のリンクを開く前にこのサーバーで安全性を検査しています。
        検査を通過してもリンク先の内容・安全性を保証するものではありません。
        個人情報や決済情報は、移動先のドメインをよく確認してから入力してください。
    </p>
    <div class="out-actions">${actions}</div>
</main>
</body>
</html>`;
}

function sendHtml(res, html, status = 200) {
    res.status(status)
        .type("html")
        .set("Cache-Control", "no-store")
        .send(html);
}

/* ---------- ルート ---------- */

function targetOf(req) {
    const v = req.query.to;
    return typeof v === "string" ? v : "";
}

// 確認ページ（ここが「間に入るチェック」）
router.get(["/", ""], async (req, res) => {
    const result = await check(targetOf(req));
    accessLog.note(
        req,
        result.ok ? "外部リンクチェック（確認画面）" : "外部リンクチェック（ブロック）"
    );
    const goHref =
        "/out/go?to=" + encodeURIComponent(result.url || targetOf(req));
    sendHtml(res, page({ kind: result.ok ? "warn" : "blocked", result, goHref }));
});

// 実際の遷移。ここでもう一度検査してからリダイレクトする。
router.get("/go", async (req, res) => {
    const result = await check(targetOf(req));
    accessLog.note(req, result.ok ? "外部リンクへ遷移" : "外部リンク遷移を拒否");
    if (!result.ok) {
        return res.redirect(302, "/out?to=" + encodeURIComponent(result.url || targetOf(req)));
    }
    res.set("Cache-Control", "no-store");
    return res.redirect(302, result.url);
});

module.exports = { router, check, ipIsPublic, hostProblem };
