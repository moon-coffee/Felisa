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

const app = express();
const PORT = process.env.PORT || 80;
const isProd = process.env.NODE_ENV === "production";
// 本番は既定でループバックのみ待受（Caddy 等のリバースプロキシ経由を前提。
// 直接インターネットに公開すると trust proxy の X-Forwarded-For 偽装が可能になるため）。
const HOST = process.env.HOST || (isProd ? "127.0.0.1" : undefined);
// クラウド側 Gateway（Cloudflare Tunnel の先）から届いたリクエストだけを信頼するための共有秘密。
// 未設定なら旧来どおり（Caddy 等のリバースプロキシに直接ぶら下げる単体構成）として振る舞う。
const GATEWAY_SECRET = process.env.GATEWAY_SECRET || "secret";

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

app.disable("x-powered-by");

// クラウド Gateway 経由の構成（GATEWAY_SECRET 設定時）:
// Cloudflare Tunnel の先にいる Node には理論上誰でも到達しうるため、
// 共有秘密ヘッダを持たないリクエストはここで遮断する。
// 実クライアントIPは Gateway が計算済みの値（X-Origin-Client-Ip）を
// X-Forwarded-For に採用し直すことで、なりすまし不可能な形で引き継ぐ。
if (GATEWAY_SECRET) {
    const secretBuf = Buffer.from(GATEWAY_SECRET);
    app.use((req, res, next) => {
        const provided = Buffer.from(String(req.headers["x-gateway-secret"] || ""));
        const ok =
            provided.length === secretBuf.length && crypto.timingSafeEqual(provided, secretBuf);
        if (!ok) {
            return res.status(403).type("txt").send("Forbidden");
        }
        const clientIp = req.headers["x-origin-client-ip"];
        if (clientIp) req.headers["x-forwarded-for"] = clientIp;
        next();
    });
}

// GATEWAY_SECRET 設定時: Gateway（Cloudflare Tunnel の直前のループバック）を1ホップ信頼。
// 未設定時（従来構成）: Caddy 等のリバースプロキシを1ホップ信頼。
// いずれも Node が直接インターネットに公開されないことが前提。
app.set("trust proxy", isProd ? 1 : false);

/* ---------- セキュリティヘッダ ---------- */
const CSP = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
    "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "connect-src 'self'",
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

/* ---------- ボディパーサ ---------- */
// 画像・動画は生バイトで受け取る（パスごとに先に登録）
app.use("/api/media/image", express.raw({ type: "image/png", limit: "9mb" }));
app.use(
    "/api/media/video",
    express.raw({ type: ["video/*", "application/octet-stream"], limit: "85mb" })
);
app.use("/api/me/avatar", express.raw({ type: "image/png", limit: "9mb" }));
app.use("/api/me/header", express.raw({ type: "image/png", limit: "9mb" }));
app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: false, limit: "32kb" }));

/* ---------- レート制限 ---------- */
const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 500,
    standardHeaders: true,
    legacyHeaders: false,
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
    message: {
        ok: false,
        errors: { form: "試行回数が多すぎます。1分ほど待ってから再度お試しください。" },
    },
});
for (const p of [
    "/api/login",
    "/api/register",
    "/api/me/password",
    "/api/me/email",
    "/api/me/username",
]) {
    app.use(p, authLimiter);
}

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
