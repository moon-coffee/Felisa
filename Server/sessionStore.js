const path = require("path");
const crypto = require("crypto");
const { readArray, writeArray } = require("./jsonStore");

const DATA_DIR = path.join(__dirname, "data");
const FILE = path.join(DATA_DIR, "sessions.json");
// レコード: { id, userId, tokenHash, ip, ua, createdAt, lastSeenAt }

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30日

function readAll() {
    return readArray(FILE);
}

function writeAll(rows) {
    writeArray(FILE, rows);
}

function hashToken(token) {
    return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function prune(rows) {
    const now = Date.now();
    return rows.filter((r) => now - r.createdAt < MAX_AGE_MS);
}

function create({ userId, ip, ua }) {
    const token = crypto.randomBytes(32).toString("base64url");
    const now = Date.now();
    const row = {
        id: crypto.randomUUID(),
        userId,
        tokenHash: hashToken(token),
        ip: ip || "",
        ua: (ua || "").slice(0, 400),
        createdAt: now,
        lastSeenAt: now,
    };
    const rows = prune(readAll());
    rows.push(row);
    writeAll(rows);
    return { token, row };
}

function findByToken(token) {
    if (!token) return null;
    const wanted = hashToken(token);
    const row = readAll().find((r) => r.tokenHash === wanted);
    if (!row) return null;
    if (Date.now() - row.createdAt >= MAX_AGE_MS) return null;
    return row;
}

// 直近アクセス時刻の更新（60秒より新しければ書き込まない）
function touch(id) {
    const rows = readAll();
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    if (Date.now() - row.lastSeenAt < 60 * 1000) return;
    row.lastSeenAt = Date.now();
    writeAll(rows);
}

function listFor(userId) {
    return prune(readAll())
        .filter((r) => r.userId.toLowerCase() === String(userId).toLowerCase())
        .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

function removeById(id) {
    const rows = readAll();
    const next = rows.filter((r) => r.id !== id);
    if (next.length !== rows.length) writeAll(next);
}

function removeForUserExcept(userId, keepId) {
    const key = String(userId).toLowerCase();
    const rows = readAll();
    const next = rows.filter(
        (r) => r.userId.toLowerCase() !== key || r.id === keepId
    );
    if (next.length !== rows.length) writeAll(next);
}

function removeAllForUser(userId) {
    const key = String(userId).toLowerCase();
    const rows = readAll();
    const next = rows.filter((r) => r.userId.toLowerCase() !== key);
    if (next.length !== rows.length) writeAll(next);
}

function renameUser(oldId, newId) {
    const key = String(oldId).toLowerCase();
    const rows = readAll();
    let changed = false;
    for (const r of rows) {
        if (r.userId.toLowerCase() === key) { r.userId = newId; changed = true; }
    }
    if (changed) writeAll(rows);
}

module.exports = {
    create,
    findByToken,
    touch,
    listFor,
    removeById,
    removeForUserExcept,
    removeAllForUser,
    renameUser,
    MAX_AGE_MS,
};
