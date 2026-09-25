const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const rateLimit = require("express-rate-limit");

const authRouter = require("./auth");
const postsRouter = require("./posts");
const notificationsRouter = require("./notifications");
const searchRouter = require("./search");
const trendsRouter = require("./trends");
const mediaRouter = require("./media");
const mediaStore = require("./mediaStore");
const session = require("./session");
const { isSecureRequest, setClientIp } = require("./trust");

const app = express();
const PORT = process.env.PORT || 80;
const isProd = process.env.NODE_ENV === "production";
const isTor = process.env.TOR_MODE === "true";
// 本番は既定でループバックのみ待受（Caddy 等のリバースプロキシ経由を前提。
// 直接インターネットに公開すると trust proxy の X-Forwarded-For 偽装が可能になるため）。
const HOST = process.env.HOST || (isProd ? "127.0.0.1" : undefined);
// Tor 隠しサービスモード: Tor がローカルで作成するソケット/ポートに転送する。
// Tor は HTTP プロキシではなく透過的な TCP 転送なので、リモート IP は
// 実際には区別できず（かつヘッダは接続者が偽装できる）、IP ベースのレート制限は
// IP 単位ではなく「全体共有」の枠として機能する（下記 trust proxy の節を参照）。
// クラウド側 Gateway（Cloudflare Tunnel の先）から届いたリクエストだけを信頼するための共有秘密。
// 未設定なら旧来どおり（Caddy 等のリバースプロキシに直接ぶら下げる単体構成）として振る舞う。
const GATEWAY_SECRET = process.env.GATEWAY_SECRET

const CLIENT_DIR = path.join(__dirname, "..", "Client");
const DIST_DIR = path.join(__dirname, "..", "dist");
const STATIC_DIR = isProd && fs.existsSync(DIST_DIR) ? DIST_DIR : CLIENT_DIR;

if (isProd && STATIC_DIR === CLIENT_DIR) {
    console.warn(
        "[warn] NODE_ENV=production ですが dist/ がありません。`npm run build` を実行してください。"
    );
}
if (!mediaStore.HAS_FFMPEG) {
    console.warn("[warn] ffmpeg が見つかりません。動画投稿は無効になります。");
}

// 参照されていない古いアップロード（投稿に紐付かない画像/動画）を掃除する。
// 「アップロードして投稿しない」だけでディスクを无限に消費されないようにする。
const sweep = mediaStore.sweepOrphans();
if (sweep.removed > 0) {
    console.log(`[info] 未参照の古いメディアを ${sweep.removed} 件削除しました。`);
}
setInterval(() => mediaStore.sweepOrphans(), 12 * 60 * 60 * 1000).unref();

app.disable("x-powered-by");

// クラウド Gateway 経由の構成（GATEWAY_SECRET 設定時）:
// Cloudflare Tunnel の先にいる Node には理論上誰でも到達しうるため、
// 共有秘密ヘッダを持たないリクエストはここで遮断する。
// 実クライアントIPは Gateway が計算済みの値（X-Origin-Client-Ip）を
// req.ip として引き継ぐ（X-Forwarded-For の解釈には頼らない）。
if (GATEWAY_SECRET) {
    const secretBuf = Buffer.from(GATEWAY_SECRET);
    app.use((req, res, next) => {
        const provided = Buffer.from(String(req.headers["x-gateway-secret"] || ""));
        const ok =
            provided.length === secretBuf.length && crypto.timingSafeEqual(provided, secretBuf);
        if (!ok) {
            return res.status(403).type("txt").send("Forbidden");
        }
        // Gateway が計算した実クライアントIPを req.ip として確定させる。
        // X-Forwarded-For を書き換えて trust proxy に解釈させる方式から変更したのは、
        // Tor モードで trust proxy を切っているため（下記）。
        setClientIp(req, req.headers["x-origin-client-ip"]);
        next();
    });
}

// Tor は HTTP プロキシではなく「クライアントの HTTP をそのまま届ける透過的な TCP
// 転送」であり、HTTP ヘッダは送信者が書いたまま届く。つまり Tor 経由の
// X-Forwarded-For は送信者が任意の IP を名乗れるため、信用すると
//   - express-rate-limit のキー（req.ip）が無限に偽造でき、レート制限が完全に無効化
//     （認証20/分・画像60/10分・動画6/15分がすべて回避され、登録スパム・
//       ディスク/メモリ枯渇・総当たりが放題になる）
//   - セッション一覧に表示される接続元 IP が偽装される
// という問題が起きる。Tor モードでは X-Forwarded-For を一切信用しない。
// （req.ip は接続元＝Tor のローカルアドレスになり、IP 単位の制限は全体共有に
//  なる。これは docs の Tor モードの仕様どおりの挙動。）
// clearnet（Cloudflare 等の TLS 終端）と Tor を同時に受ける構成では、
// 経路ごとに Gateway を別ポートで起動して trust proxy の方針を分けることを推奨する。
//
// GATEWAY_SECRET 設定時: Gateway が計算した X-Origin-Client-Ip を req.ip に使う。
// 未設定時（従来構成）: Caddy 等のリバースプロキシを1ホップ信頼する。
const trustedProxies = isTor ? false : isProd ? 1 : false;
app.set("trust proxy", trustedProxies);

/* ---------- セキュリティヘッダ ---------- */
const CSP = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
    "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
].join("; ");

app.use((req, res, next) => {
    res.setHeader("Content-Security-Policy", CSP);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (isProd && isSecureRequest(req)) {
        res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    // API 応答（個人情報・セッション一覧など）を中間キャッシュ／ブラウザに残さない。
    // 画像配信など個別に Cache-Control を設定するルートはそちらが優先される。
    if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
    next();
});

// クロスサイトからの書き込みを拒否（対応ブラウザのみ・CSRF 対策の多層防御）
app.use("/api", (req, res, next) => {
    if (["POST", "PUT", "DELETE", "PATCH"].includes(req.method)) {
        const site = req.headers["sec-fetch-site"];
        if (site && site === "cross-site") {
            return res
                .status(403)
                .json({ ok: false, errors: { form: "不正なリクエストです。" } });
        }
    }
    next();
});

/* ---------- レート制限 ---------- */
// ボディパーサより先に登録する（特に画像/動画は後述の理由で制限が先に走る必要がある）。
//
// Tor モードでは trust proxy = false（＝X-Forwarded-For を信用しない）にしてあるが、
// express-rate-limit の組み込み検証 ERR_ERL_UNEXPECTED_X_FORWARDED_FOR は
// 「trust proxy が false のまま XFF が付いてくる」ことを見なして毎リクエスト
// エラーをログに出す。Tor 経由なら XFF を付け放題なので、ログが洪水に
// なってしまう。この構成では意図的な設定なので明示的に無効化する。
const rateLimitValidate = isTor ? { xForwardedForHeader: false } : true;
const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 500,
    standardHeaders: true,
    legacyHeaders: false,
    validate: rateLimitValidate,
    message: {
        ok: false,
        errors: { form: "リクエストが多すぎます。しばらく待ってから再度お試しください。" },
    },
});
const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    validate: rateLimitValidate,
    message: {
        ok: false,
        errors: { form: "試行回数が多すぎます。1分ほど待ってから再度お試しください。" },
    },
});
// 動画は ffmpeg 再エンコードが重い（CPU・数十秒〜）ため、全体レート制限とは別に
// 専用の低い上限をかける。
const videoLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 6,
    standardHeaders: true,
    legacyHeaders: false,
    validate: rateLimitValidate,
    message: {
        ok: false,
        errors: { form: "動画のアップロードが多すぎます。しばらく待ってから再度お試しください。" },
    },
});
// 画像アップロードはディスクを消費するため、全体制限とは別に上限を設ける
const imageLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    validate: rateLimitValidate,
    message: {
        ok: false,
        errors: { form: "画像のアップロードが多すぎます。しばらく待ってから再度お試しください。" },
    },
});
for (const p of [
    "/api/login",
    "/api/register",
    "/api/me/password",
    "/api/me/username",
]) {
    app.use(p, authLimiter);
}
// アカウント削除もパスワード再確認を伴うため、総当たり対策として同じ制限を掛ける
app.delete("/api/me", authLimiter);

/* ---------- ボディパーサ ---------- */
// 画像・動画は生バイトで受け取る（パスごとに先に登録）。最大85MBをメモリに溜めるため、
// ボディを読む前に必ず次の順で絞る。レート制限をボディ受信の後に置くと、
// 上限超過のリクエストも全部受信してから拒否されるため、ここでは必ず先に掛ける。
//   1. 認証（未ログインの大量リクエストで共有カウンタを消費させない）
//   2. レート制限（時間あたりの回数）
//   3. 同時実行数の上限（同一瞬間の同時アップロードによるメモリ枯渇）
const RAW_PATHS = ["/api/media/image", "/api/media/video", "/api/me/avatar", "/api/me/header"];
const requireSession = (req, res, next) => {
    if (["POST", "PUT"].includes(req.method) && !session.currentUserId(req)) {
        return res
            .status(401)
            .json({ ok: false, errors: { form: "ログインが必要です。" } });
    }
    next();
};
// 生ボディ（最大85MB）をメモリに抱えるリクエスト数に上限を置く。
// レート制限だけでは「同じ瞬間に何十本も送る」メモリ枯渇（OOM）を防げない。
const MAX_RAW_IN_FLIGHT = 4;
let rawInFlight = 0;
function rawConcurrency(req, res, next) {
    if (req.method !== "POST" && req.method !== "PUT") return next();
    if (rawInFlight >= MAX_RAW_IN_FLIGHT) {
        return res.status(429).json({
            ok: false,
            errors: {
                form: "アップロードが混み合っています。しばらく待ってから再度お試しください。",
            },
        });
    }
    rawInFlight += 1;
    let released = false;
    const release = () => {
        if (released) return;
        released = true;
        rawInFlight -= 1;
    };
    res.on("finish", release);
    res.on("close", release);
    next();
}
const writeOnly = (mw) => (req, res, next) =>
    ["POST", "PUT"].includes(req.method) ? mw(req, res, next) : next();

for (const p of RAW_PATHS) app.use(p, requireSession);
app.use("/api/media/image", writeOnly(imageLimiter));
app.use("/api/media/video", writeOnly(videoLimiter));
for (const p of RAW_PATHS) app.use(p, rawConcurrency);

app.use("/api/media/image", express.raw({ type: "image/png", limit: "9mb" }));
app.use(
    "/api/media/video",
    express.raw({ type: ["video/*", "application/octet-stream"], limit: "85mb" })
);
app.use("/api/me/avatar", express.raw({ type: "image/png", limit: "9mb" }));
app.use("/api/me/header", express.raw({ type: "image/png", limit: "9mb" }));
app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: false, limit: "32kb" }));

/* ---------- API ---------- */
app.get("/api/capabilities", (req, res) => {
    res.json({ ok: true, video: mediaStore.HAS_FFMPEG });
});
app.use("/api/posts", apiLimiter, postsRouter);
app.use("/api/notifications", apiLimiter, notificationsRouter);
app.use("/api/search", apiLimiter, searchRouter);
app.use("/api/trends", apiLimiter, trendsRouter);
app.use("/api/media", apiLimiter, mediaRouter);
app.use("/api", apiLimiter, authRouter);

/* ---------- HTML シェル ---------- */
function sendPage(res, file) {
    return res.sendFile(path.join(STATIC_DIR, file), {
        headers: { "Cache-Control": "no-store, must-revalidate" },
        cacheControl: false,
    });
}
function gate(file) {
    return (req, res) => {
        if (!session.currentUserId(req)) return res.redirect("/login");
        sendPage(res, file);
    };
}

// .html を含む URL は拡張子なしへ 301
const CLEAN = {
    "/login.html": "/login",
    "/signin.html": "/signin",
    "/home.html": "/home",
    "/settings.html": "/settings",
    "/bookmarks.html": "/bookmarks",
    "/notifications.html": "/notifications",
};
app.get(Object.keys(CLEAN), (req, res) => res.redirect(301, CLEAN[req.path]));

app.get("/login", (req, res) => sendPage(res, "login.html"));
app.get("/signin", (req, res) => sendPage(res, "signin.html"));
app.get("/home", gate("home.html"));
app.get("/settings", gate("settings.html"));
app.get("/bookmarks", gate("bookmarks.html"));
app.get("/notifications", gate("notifications.html"));

app.use(express.static(STATIC_DIR));

app.get("/", (req, res) => {
    res.redirect(session.currentUserId(req) ? "/home" : "/login");
});

app.get("/search", (req, res) => sendPage(res, "search.html"));
app.get("/status/:id", (req, res) => sendPage(res, "status.html"));

const RESERVED = new Set([
    "api",
    "js",
    "images",
    "status",
    "search",
    "settings",
    "bookmarks",
    "notifications",
    "login",
    "signin",
    "home",
    "media",
    "favicon.ico",
]);
app.get("/:username", (req, res, next) => {
    const seg = req.params.username;
    if (seg.includes(".") || RESERVED.has(seg.toLowerCase())) return next();
    return sendPage(res, "profile.html");
});

/* ---------- 404 / エラー ---------- */
app.use((req, res) => {
    if (req.path.startsWith("/api/")) {
        return res
            .status(404)
            .json({ ok: false, errors: { form: "リソースが見つかりません。" } });
    }
    res.status(404).type("txt").send("Not Found");
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    if (err.type === "entity.parse.failed") {
        return res
            .status(400)
            .json({ ok: false, errors: { form: "リクエストの形式が不正です。" } });
    }
    if (err.type === "entity.too.large" || err.status === 413) {
        return res
            .status(413)
            .json({ ok: false, errors: { form: "アップロードサイズが大きすぎます。" } });
    }
    console.error(err);
    res.status(500).json({
        ok: false,
        errors: { form: "サーバーでエラーが発生しました。" },
    });
});

const listenArgs = HOST ? [PORT, HOST] : [PORT];
app.listen(...listenArgs, () => {
    console.log(
        `Server running (${isProd ? "production" : "development"}): http://${HOST || "localhost"}:${PORT}`
    );
});
