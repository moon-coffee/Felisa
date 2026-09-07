const path = require("path");
const crypto = require("crypto");
const { readArray, writeArray } = require("./jsonStore");

const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

const DISPLAY_NAME_MAX = 50;
const BIO_MAX = 160;
const LINK_MAX = 100;
const USERID_RE = /^[A-Za-z0-9_]+$/;
const USERID_CHANGE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 1週間

function normalize(u) {
    const displayName =
        typeof u.displayName === "string" && u.displayName.trim() !== ""
            ? u.displayName
            : u.userId;
    return {
        userId: u.userId,
        mail: u.mail,
        password: u.password,
        createdAt: u.createdAt || null,
        displayName,
        bio: typeof u.bio === "string" ? u.bio : "",
        link: typeof u.link === "string" ? u.link : "",
        hasHeader: u.hasHeader === true,
        userIdChangedAt: typeof u.userIdChangedAt === "number" ? u.userIdChangedAt : null,
    };
}

function readUsers() {
    return readArray(USERS_FILE).map(normalize);
}

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

const lc = (v) => String(v).toLowerCase();

function findByUserId(userId) {
    return readUsers().find((u) => lc(u.userId) === lc(userId));
}
function findByMail(mail) {
    return readUsers().find((u) => lc(u.mail) === lc(mail));
}
function findByIdentifier(identifier) {
    const key = lc(identifier);
    return readUsers().find(
        (u) => lc(u.userId) === key || lc(u.mail) === key
    );
}

function createUser({ userId, mail, password }) {
    const users = readUsers();
    const user = {
        userId,
        mail,
        password: hashPassword(password),
        createdAt: new Date().toISOString(),
        displayName: userId,
        bio: "",
        link: "",
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

function setMail(userId, mail) {
    return mutate(userId, (u) => {
        u.mail = mail;
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
    if (!USERID_RE.test(trimmed) || trimmed.length < 3) {
        return { error: "ユーザー名は半角英数字とアンダースコア・3文字以上です。" };
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
    findByMail,
    findByIdentifier,
    createUser,
    updateProfile,
    setMail,
    setPassword,
    setHeader,
    deleteUser,
    renameUser,
    usernameChangeAvailableAt,
    verifyPassword,
    USERID_RE,
    USERID_CHANGE_INTERVAL_MS,
    DISPLAY_NAME_MAX,
    BIO_MAX,
    LINK_MAX,
};
