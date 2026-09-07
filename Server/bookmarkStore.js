const path = require("path");
const { readArray, writeArray } = require("./jsonStore");

const DATA_DIR = path.join(__dirname, "data");
const FILE = path.join(DATA_DIR, "bookmarks.json");
// レコード: { userId, postId, createdAt }

function readAll() {
    return readArray(FILE);
}
function writeAll(rows) {
    writeArray(FILE, rows);
}
const eq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

function has(userId, postId) {
    return readAll().some((r) => eq(r.userId, userId) && r.postId === postId);
}
function set(userId, postId, on) {
    const rows = readAll();
    const idx = rows.findIndex(
        (r) => eq(r.userId, userId) && r.postId === postId
    );
    if (on && idx === -1) {
        rows.push({ userId, postId, createdAt: Date.now() });
        writeAll(rows);
    } else if (!on && idx !== -1) {
        rows.splice(idx, 1);
        writeAll(rows);
    }
    return on;
}
function listPostIds(userId) {
    return readAll()
        .filter((r) => eq(r.userId, userId))
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((r) => r.postId);
}
function removeForPosts(postIds) {
    const s = new Set(postIds);
    const rows = readAll();
    const next = rows.filter((r) => !s.has(r.postId));
    if (next.length !== rows.length) writeAll(next);
}
function removeAllForUser(userId) {
    const rows = readAll();
    const next = rows.filter((r) => !eq(r.userId, userId));
    if (next.length !== rows.length) writeAll(next);
}

function renameUser(oldId, newId) {
    const rows = readAll();
    let changed = false;
    for (const r of rows) {
        if (eq(r.userId, oldId)) { r.userId = newId; changed = true; }
    }
    if (changed) writeAll(rows);
}

module.exports = {
    has,
    set,
    listPostIds,
    removeForPosts,
    removeAllForUser,
    renameUser,
};
