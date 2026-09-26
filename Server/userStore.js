const path = require("path");
const crypto = require("crypto");
const { readArray, writeArray } = require("./jsonStore");

const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

const DISPLAY_NAME_MAX = 50;
const BIO_MAX = 160;
const LINK_MAX = 100;
const USERID_RE = /^[A-Za-z0-9_]+$/;
const USERID_MAX = 30;
const USERID_CHANGE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 1週間

function normalize(u) {
    const displayName =
        typeof u.displayName === "string" && u.displayName.trim() !== ""
            ? u.displayName
            : u.userId;
    return {
        userId: u.userId,
        password: u.password,
        createdAt: u.createdAt || null,
        displayName,
        bio: typeof u.bio === "string" ? u.bio : "",
        link: typeof u.link === "string" ? u.link : "",
        // メールアドレスは任意（未登録は空文字）。purgeLegacyMail は旧 mail 専用なので
        // こちらは保持して渡す。
        email: typeof u.email === "string" ? u.email : "",
        hasHeader: u.hasHeader === true,
        userIdChangedAt: typeof u.userIdChangedAt === "number" ? u.userIdChangedAt : null,
    };
}

function readUsers() {
    return readArray(USERS_FILE).map(normalize);
}

// ルーティング・Object プロトタイプと衝突するため、ユーザーIDとして使えない名前。
// "system" は自動モデレーション通知の発行者として使うため予約する
// （本人になりすまして規約警告を送れないようにする）。
const RESERVED_IDS = new Set([
    "api", "js", "images", "status", "search", "settings", "bookmarks",
    "notifications", "login", "signin", "home", "media", "favicon.ico", "out",
    "system",
    "__proto__", "constructor", "prototype", "hasownproperty", "tostring", "valueof",
]);
const isReservedId = (id) => RESERVED_IDS.has(String(id).toLowerCase());

function writeUsers(users) {
    writeArray(USERS_FILE, users);
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const derived = crypto.scryptSync(password, salt, 64).toString("hex");
    return `${salt}:${derived}`;
}

function verifyPassword(password, stored) {
    const [salt, derivedHex] = String(stored).split(":");
    if (!salt || !derivedHex) return false;
    const derived = crypto.scryptSync(password, salt, 64);
    const storedBuf = Buffer.from(derivedHex, "hex");
    if (storedBuf.length !== derived.length) return false;
    return crypto.timingSafeEqual(storedBuf, derived);
}

// 旧 mail フィールド（現在の email とは別物）は起動時に消去する。
// 新しい email は任意項目として保持する。
(function purgeLegacyMail() {
    const raw = readArray(USERS_FILE);
    if (raw.some((u) => u && "mail" in u)) writeUsers(raw.map(normalize));
})();

// 存在しないユーザーへのログインでも scrypt を1回実行し、応答時間でユーザーの有無を判別させない
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString("hex"));
function verifyPasswordOrDummy(password, user) {
    const ok = verifyPassword(password, user ? user.password : DUMMY_HASH);
    return !!user && ok;
}

const lc = (v) => String(v).toLowerCase();

function findByUserId(userId) {
    return readUsers().find((u) => lc(u.userId) === lc(userId));
}

// userId / displayName の部分一致でユーザーを検索する（大文字小文字は無視）。
// hidden（blocks.hiddenFor の集合）に入っている ID は、自分がブロックした／
// ブロックされた双方の方向で対象外になる。表示上限は呼び出し側で切る。
function searchUsers(query, hidden = null) {
    const q = String(query).trim();
    if (q === "") return [];
    const needle = lc(q);
    return readUsers().filter(
        (u) =>
            !(hidden && hidden.has(lc(u.userId))) &&
            (lc(u.userId).includes(needle) || lc(u.displayName).includes(needle))
    );
}

function createUser({ userId, password }) {
    const users = readUsers();
    const user = {
        userId,
        password: hashPassword(password),
        createdAt: new Date().toISOString(),
        displayName: userId,
        bio: "",
        link: "",
        email: "",
        hasHeader: false,
        userIdChangedAt: null,
    };
    users.push(user);
    writeUsers(users);
    return normalize(user);
}

function mutate(userId, fn) {
    const users = readUsers();
    const idx = users.findIndex((u) => lc(u.userId) === lc(userId));
    if (idx === -1) return null;
    fn(users[idx]);
    writeUsers(users);
    return normalize(users[idx]);
}

function updateProfile(userId, patch) {
    return mutate(userId, (u) => {
        if (typeof patch.displayName === "string") {
            const dn = patch.displayName.trim().slice(0, DISPLAY_NAME_MAX);
            u.displayName = dn === "" ? u.userId : dn;
        }
        if (typeof patch.bio === "string") {
            u.bio = patch.bio.replace(/\r\n/g, "\n").trim().slice(0, BIO_MAX);
        }
        if (typeof patch.link === "string") {
            const link = patch.link.trim().slice(0, LINK_MAX);
            u.link = /^https?:\/\/[^\s]+$/i.test(link) ? link : "";
        }
    });
}

// メールアドレスの登録・変更・解除（空文字なら解除）。送信は行わない保存のみ。
function setEmail(userId, email) {
    return mutate(userId, (u) => {
        u.email = email;
    });
}

function setPassword(userId, newPassword) {
    return mutate(userId, (u) => {
        u.password = hashPassword(newPassword);
    });
}

function setHeader(userId, has) {
    return mutate(userId, (u) => {
        u.hasHeader = !!has;
    });
}

function deleteUser(userId) {
    const users = readUsers();
    const next = users.filter((u) => lc(u.userId) !== lc(userId));
    if (next.length === users.length) return false;
    writeUsers(next);
    return true;
}

// 次にユーザー名を変更できる時刻（null なら今すぐ可）
function usernameChangeAvailableAt(userId) {
    const u = findByUserId(userId);
    if (!u || !u.userIdChangedAt) return null;
    return u.userIdChangedAt + USERID_CHANGE_INTERVAL_MS;
}

// { user } または { error } を返す
function renameUser(oldId, newId) {
    const trimmed = String(newId).trim();
    if (!USERID_RE.test(trimmed) || trimmed.length < 3 || trimmed.length > USERID_MAX) {
        return {
            error: `ユーザー名は半角英数字とアンダースコア・3〜${USERID_MAX}文字です。`,
        };
    }
    if (isReservedId(trimmed)) {
        return { error: "このユーザー名は使用できません。" };
    }
    const users = readUsers();
    const idx = users.findIndex((u) => lc(u.userId) === lc(oldId));
    if (idx === -1) return { error: "ユーザーが見つかりません。" };

    // 大文字小文字だけの変更は自分自身なので許可
    if (
        lc(trimmed) !== lc(oldId) &&
        users.some((u) => lc(u.userId) === lc(trimmed))
    ) {
        return { error: "このユーザー名は既に使用されています。" };
    }
    const availableAt = usernameChangeAvailableAt(oldId);
    if (availableAt && Date.now() < availableAt) {
        return { error: "ユーザー名の変更は1週間に1回までです。", availableAt };
    }

    users[idx].userId = trimmed;
    users[idx].userIdChangedAt = Date.now();
    writeUsers(users);
    return { user: normalize(users[idx]) };
}

module.exports = {
    findByUserId,
    searchUsers,
    createUser,
    updateProfile,
    setEmail,
    setPassword,
    setHeader,
    deleteUser,
    renameUser,
    usernameChangeAvailableAt,
    verifyPassword,
    verifyPasswordOrDummy,
    USERID_RE,
    USERID_MAX,
    isReservedId,
    USERID_CHANGE_INTERVAL_MS,
    DISPLAY_NAME_MAX,
    BIO_MAX,
    LINK_MAX,
};
