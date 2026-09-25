// サーバー側セッションストアつき Cookie セッション。
// Cookie にはランダムトークンのみ。ストアには sha256(token) を保存する。
const store = require("./sessionStore");
const { isSecureRequest } = require("./trust");

const COOKIE_NAME = "sid";

// 送信元スキームごとに判定する（TOR_MODE のような全体フラグで一律に決めると、
// 同一プロセスで配信している clearnet（HTTPS）側まで Secure が付かなくなる）。
function baseCookieOptions(req) {
    return {
        httpOnly: true,
        sameSite: "lax",
        // HTTPS で届いたリクエストにだけ Secure を付ける。
        // Tor の .onion は HTTP なので Secure を付けると Cookie が二度と
        // 送信されずログインできなくなる。逆に clearnet（HTTPS）で Secure を
        // 付けないままにすると平文の http:// 経由で Cookie が盗聴される。
        secure: process.env.NODE_ENV === "production" && isSecureRequest(req),
        path: "/",
    };
}

function cookieOptions(req) {
    return { ...baseCookieOptions(req), maxAge: store.MAX_AGE_MS };
}

// 消去用（maxAge を付けない。maxAge 付きで消すと逆に有効期限が延びてしまう）
function clearOptions(req) {
    return baseCookieOptions(req);
}

function parseCookies(header) {
    const out = {};
    if (!header) return out;
    for (const part of header.split(";")) {
        const idx = part.indexOf("=");
        if (idx === -1) continue;
        const key = part.slice(0, idx).trim();
        if (!key) continue;
        try {
            out[key] = decodeURIComponent(part.slice(idx + 1).trim());
        } catch {
            // 不正な %エンコーディングは無視（クラッシュさせず未ログイン扱いにする）
        }
    }
    return out;
}

function tokenOf(req) {
    return parseCookies(req.headers.cookie)[COOKIE_NAME] || null;
}

function issue(res, userId, req) {
    const { token } = store.create({
        userId,
        ip: (req && req.ip) || "",
        ua: (req && req.headers["user-agent"]) || "",
    });
    res.cookie(COOKIE_NAME, token, cookieOptions(req));
}

// 現在のセッションレコード（無ければ null）
function currentSession(req) {
    if (req._session !== undefined) return req._session;
    const row = store.findByToken(tokenOf(req));
    if (row) store.touch(row.id);
    if (req) req._session = row || null;
    return row || null;
}

function currentUserId(req) {
    const row = currentSession(req);
    return row ? row.userId : null;
}

function clear(req, res) {
    const row = currentSession(req);
    if (row) store.removeById(row.id);
    res.clearCookie(COOKIE_NAME, clearOptions(req));
}

function listFor(userId, req) {
    const current = currentSession(req);
    return store.listFor(userId).map((r) => ({
        id: r.id,
        ip: r.ip || "不明",
        ua: r.ua || "",
        createdAt: r.createdAt,
        lastSeenAt: r.lastSeenAt,
        current: current ? r.id === current.id : false,
    }));
}

function revoke(userId, sessionId, req) {
    const list = store.listFor(userId);
    if (!list.some((r) => r.id === sessionId)) return false;
    store.removeById(sessionId);
    return true;
}

function revokeOthers(userId, req) {
    const current = currentSession(req);
    store.removeForUserExcept(userId, current ? current.id : null);
}

function revokeAll(userId) {
    store.removeAllForUser(userId);
}

function renameUser(oldId, newId) {
    store.renameUser(oldId, newId);
}

module.exports = {
    COOKIE_NAME,
    issue,
    currentSession,
    currentUserId,
    clear,
    clearOptions,
    listFor,
    revoke,
    revokeOthers,
    revokeAll,
    renameUser,
};
