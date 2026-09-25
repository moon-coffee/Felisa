// 送信者が任意に偽造できる可能性がある X-Forwarded-* ヘッダの扱いを一箇所に集める。
//
// 方針:
//   X-Forwarded-For  … req.ip（＝レート制限のキー）になるため信用してはいけない。
//                      Tor は HTTP プロキシではなく「クライアントの HTTP をそのまま
//                      届ける透過転送」なので、送信者は任意の IP を名乗れる。
//                      Tor モードでは無視し、実 IP は Gateway が計算した値
//                      （GATEWAY_SECRET 検証済みの X-Origin-Client-Ip）だけを使う。
//   X-Forwarded-Proto … HTTPS 判定にだけ使う。偽装された場合の影響は「自分宛の
//                      Cookie に Secure が付く/付かない」「自分への応答に HSTS が
//                      付く/付かない」だけで、他ユーザーへの影響はない
//                      （HSTS は HTTPS 応答でしかブラウザが採用しないため）。
//                      一方 Tor モードで全体を一律「非 HTTPS」としてしまうと、
//                      同一プロセスで配信している clearnet（HTTPS）向けに
//                      HSTS / Secure Cookie が付かなくなるため、こちらは信用する。

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

// Gateway が計算した実クライアントIPで req.ip を確定させる。
// trust proxy の X-Forwarded-For 解釈に頼らない（Tor 経由では偽装可能）ため、
// 共有シークレットの検証を通過したリクエストにだけ適用する。
function setClientIp(req, ip) {
    if (!req) return;
    const raw = Array.isArray(ip) ? ip[0] : ip;
    const value = String(raw === undefined || raw === null ? "" : raw)
        .split(",")[0]
        .trim()
        .slice(0, 64);
    if (!value) return;
    Object.defineProperty(req, "ip", {
        value,
        configurable: true,
        enumerable: true,
    });
}

module.exports = { isSecureRequest, setClientIp };
