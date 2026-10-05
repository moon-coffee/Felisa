// 送信者が任意に偽造できる可能性がある X-Forwarded-* ヘッダの扱いを一箇所に集める。
//
// 単一サーバー構成（Caddy 等のリバースプロキシを1ホップ信頼）での方針:
//   X-Forwarded-For  … req.ip（＝レート制限のキー）。
//                      本番では trust proxy = 1 で直前のプロキシからの値のみを信用する。
//                      Tor モードでは一切信用しない（透過転送のため接続者が偽装できる）。
//   X-Forwarded-Proto … HTTPS 判定にだけ使う。偽装された場合の影響は「自分宛の
//                      Cookie に Secure が付く/付かない」「自分への応答に HSTS が
//                      付く/付かない」だけで、他ユーザーへの影響はない。

// リクエストが HTTPS で届いたか
function isSecureRequest(req) {
    if (!req) return false;
    if (req.socket && req.socket.encrypted) return true;
    const proto = String(req.headers["x-forwarded-proto"] || "")
        .split(",")[0]
        .trim()
        .toLowerCase();
    return proto === "https";
}

module.exports = { isSecureRequest };
