// クラウド側ゲートウェイ。
//
// 公開ドメインはここ（クラウド VPS 等）で受ける。
//   - 実ファイルとして存在する静的資産（/js, /Images, /style.css, /home.css）はここで直接配信する。
//   - それ以外（HTML シェル・/api/* すべて）は Cloudflare Tunnel 経由で自宅サーバー（Server/server.js）へ
//     そのまま転送する。ログイン要否の判定・投稿データの読み書きは常に自宅サーバー側が正本。
//
// クライアント（ブラウザ）から見れば単一オリジンの SNS だが、実体は
//   ブラウザ → (Cloudflare) → ここ（Gateway） → Cloudflare Tunnel → 自宅サーバー（Server）
// という経路になる。新規の npm 依存は増やさず、Node 標準の http/https でストリーミング転送する
// （画像・動画アップロードをメモリに溜め込まない）。
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { URL } = require("url");
const express = require("express");

const app = express();
const PORT = process.env.PORT || 80;
const HOST = process.env.HOST || "127.0.0.1";
const isProd = process.env.NODE_ENV === "production";

const ORIGIN_URL = process.env.ORIGIN_URL || "http://felisa.f5.si";
const GATEWAY_SECRET = process.env.GATEWAY_SECRET || "secret";

if (!ORIGIN_URL) {
    console.error(
        "[fatal] ORIGIN_URL が未設定です。自宅サーバーの Cloudflare Tunnel ホスト名を指定してください（例: https://origin.your-domain.com）。"
    );
    process.exit(1);
}
if (isProd && !GATEWAY_SECRET) {
    console.error(
        "[fatal] 本番では GATEWAY_SECRET が必須です（Server 側の環境変数と同じ値を設定すること）。"
    );
    process.exit(1);
}

const origin = new URL(ORIGIN_URL);
const originClient = origin.protocol === "https:" ? https : http;

// このプロセスの手前（Cloudflare / Caddy）1ホップのみ信頼して実クライアントIPを採用する。
app.set("trust proxy", isProd ? 1 : false);
app.disable("x-powered-by");

const CLIENT_DIR = path.join(__dirname, "..", "Client");
const DIST_DIR = path.join(__dirname, "..", "dist");
const STATIC_DIR = isProd && fs.existsSync(DIST_DIR) ? DIST_DIR : CLIENT_DIR;

if (isProd && STATIC_DIR === CLIENT_DIR) {
    console.warn(
        "[warn] NODE_ENV=production ですが dist/ がありません。`npm run build` を実行してください。"
    );
}

/* ---------- 静的資産（実ファイルのみ・HTML シェルは含めない） ---------- */
app.use("/js", express.static(path.join(STATIC_DIR, "js")));
app.use("/Images", express.static(path.join(STATIC_DIR, "Images")));
app.get("/style.css", (req, res) => res.sendFile(path.join(STATIC_DIR, "style.css")));
app.get("/home.css", (req, res) => res.sendFile(path.join(STATIC_DIR, "home.css")));

/* ---------- それ以外は自宅サーバーへ転送 ---------- */
const HOP_BY_HOP = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "host",
]);

app.use((req, res) => {
    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
        if (HOP_BY_HOP.has(key.toLowerCase())) continue;
        headers[key] = value;
    }
    headers["host"] = origin.host;
    headers["x-forwarded-proto"] = "https";
    // Server 側はこの2つのヘッダでのみ Gateway 経由のリクエストを信頼する。
    // どちらもクライアントから来た値は上で除去済みの `headers` には含めていないため上書きになる。
    headers["x-gateway-secret"] = GATEWAY_SECRET || "";
    headers["x-origin-client-ip"] = req.ip || req.socket.remoteAddress || "";

    const upstreamReq = originClient.request(
        {
            protocol: origin.protocol,
            hostname: origin.hostname,
            port: origin.port || (origin.protocol === "https:" ? 443 : 80),
            method: req.method,
            path: req.originalUrl,
            headers,
        },
        (upstreamRes) => {
            const resHeaders = { ...upstreamRes.headers };
            delete resHeaders.connection;
            delete resHeaders["transfer-encoding"];
            res.writeHead(upstreamRes.statusCode, resHeaders);
            upstreamRes.pipe(res);
        }
    );

    upstreamReq.on("error", (err) => {
        console.error("[gateway] 自宅サーバーへの転送に失敗:", err.message);
        if (!res.headersSent) {
            res.status(502).json({
                ok: false,
                errors: { form: "自宅サーバーに接続できません。しばらく待ってから再度お試しください。" },
            });
        } else {
            res.destroy();
        }
    });

    req.pipe(upstreamReq);
});

app.listen(PORT, HOST, () => {
    console.log(
        `Gateway running (${isProd ? "production" : "development"}): http://${HOST}:${PORT} -> ${ORIGIN_URL}`
    );
});
