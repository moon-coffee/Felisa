const path = require("path");
const { readArray, writeArray } = require("./jsonStore");

const DATA_DIR = path.join(__dirname, "data");
const FILE = path.join(DATA_DIR, "blocks.json");
// レコード: { blocker, blocked, createdAt }

function readAll() {
    return readArray(FILE);
}
function writeAll(rows) {
    writeArray(FILE, rows);
}
const eq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

function isBlocked(blocker, blocked) {
    return readAll().some((r) => eq(r.blocker, blocker) && eq(r.blocked, blocked));
}
// a と b の間にどちらの方向でもブロックがあるか
function between(a, b) {
    return readAll().some(
        (r) =>
            (eq(r.blocker, a) && eq(r.blocked, b)) ||
            (eq(r.blocker, b) && eq(r.blocked, a))
    );
}
function block(blocker, blocked) {
    if (eq(blocker, blocked) || isBlocked(blocker, blocked)) return false;
    const rows = readAll();
    rows.push({ blocker, blocked, createdAt: Date.now() });
    writeAll(rows);
    return true;
}
function unblock(blocker, blocked) {
    const rows = readAll();
    const next = rows.filter(
        (r) => !(eq(r.blocker, blocker) && eq(r.blocked, blocked))
    );
    if (next.length === rows.length) return false;
    writeAll(next);
    return true;
}
// viewer から見て不可視なユーザー ID の集合（自分がブロック / 自分をブロック）
function hiddenFor(viewer) {
    const key = String(viewer).toLowerCase();
    const set = new Set();
    for (const r of readAll()) {
        if (eq(r.blocker, key)) set.add(r.blocked.toLowerCase());
        if (eq(r.blocked, key)) set.add(r.blocker.toLowerCase());
    }
    return set;
}
function removeAllFor(userId) {
    const key = String(userId).toLowerCase();
    const rows = readAll();
    const next = rows.filter(
        (r) => !eq(r.blocker, key) && !eq(r.blocked, key)
    );
    if (next.length !== rows.length) writeAll(next);
}

function renameUser(oldId, newId) {
    const rows = readAll();
    let changed = false;
    for (const r of rows) {
        if (eq(r.blocker, oldId)) { r.blocker = newId; changed = true; }
        if (eq(r.blocked, oldId)) { r.blocked = newId; changed = true; }
    }
    if (changed) writeAll(rows);
}

module.exports = {
    isBlocked,
    between,
    block,
    unblock,
    hiddenFor,
    removeAllFor,
    renameUser,
};
