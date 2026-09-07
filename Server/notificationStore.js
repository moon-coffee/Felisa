const path = require("path");
const crypto = require("crypto");
const { readArray, writeArray } = require("./jsonStore");

const DATA_DIR = path.join(__dirname, "data");
const FILE = path.join(DATA_DIR, "notifications.json");
// レコード: { id, userId(受信者), type: "like"|"repost"|"follow"|"reply",
//            actor(行為者), postId|null, createdAt, read }

function readAll() {
    return readArray(FILE);
}

function writeAll(rows) {
    writeArray(FILE, rows);
}

function eq(a, b) {
    return String(a).toLowerCase() === String(b).toLowerCase();
}

function add({ userId, type, actor, postId = null }) {
    if (!userId || eq(userId, actor)) {
        return null; // 自分の操作は通知しない
    }
    const rows = readAll();
    const row = {
        id: crypto.randomUUID(),
        userId,
        type,
        actor,
        postId,
        createdAt: Date.now(),
        read: false,
    };
    rows.push(row);
    writeAll(rows);
    return row;
}

function listFor(userId, limit = 50) {
    return readAll()
        .filter((r) => eq(r.userId, userId))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);
}

function unreadCount(userId) {
    return readAll().filter((r) => eq(r.userId, userId) && !r.read).length;
}

function markAllRead(userId) {
    const rows = readAll();
    let changed = false;
    for (const r of rows) {
        if (eq(r.userId, userId) && !r.read) {
            r.read = true;
            changed = true;
        }
    }
    if (changed) {
        writeAll(rows);
    }
}

// 投稿削除時に、その投稿に紐づく通知を除去
function removeForPosts(postIds) {
    const set = new Set(postIds);
    const rows = readAll();
    const next = rows.filter((r) => !r.postId || !set.has(r.postId));
    if (next.length !== rows.length) {
        writeAll(next);
    }
}

// 受信者・行為者どちらでも該当する通知をすべて削除
function removeForUser(userId) {
    const rows = readAll();
    const next = rows.filter(
        (r) => !eq(r.userId, userId) && !eq(r.actor, userId)
    );
    if (next.length !== rows.length) writeAll(next);
}

function renameUser(oldId, newId) {
    const rows = readAll();
    let changed = false;
    for (const r of rows) {
        if (eq(r.userId, oldId)) { r.userId = newId; changed = true; }
        if (eq(r.actor, oldId)) { r.actor = newId; changed = true; }
    }
    if (changed) writeAll(rows);
}

module.exports = {
    add,
    listFor,
    unreadCount,
    markAllRead,
    removeForPosts,
    removeForUser,
    renameUser,
};
