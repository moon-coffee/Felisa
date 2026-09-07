const path = require("path");
const { readArray, writeArray } = require("./jsonStore");

const DATA_DIR = path.join(__dirname, "data");
const FOLLOWS_FILE = path.join(DATA_DIR, "follows.json");
// レコード: { follower, following, createdAt }

function readAll() {
    return readArray(FOLLOWS_FILE);
}

function writeAll(rows) {
    writeArray(FOLLOWS_FILE, rows);
}

function eq(a, b) {
    return String(a).toLowerCase() === String(b).toLowerCase();
}

function isFollowing(follower, following) {
    return readAll().some(
        (r) => eq(r.follower, follower) && eq(r.following, following)
    );
}

function follow(follower, following) {
    if (eq(follower, following)) {
        return false;
    }
    if (isFollowing(follower, following)) {
        return false;
    }
    const rows = readAll();
    rows.push({ follower, following, createdAt: Date.now() });
    writeAll(rows);
    return true;
}

function unfollow(follower, following) {
    const rows = readAll();
    const next = rows.filter(
        (r) => !(eq(r.follower, follower) && eq(r.following, following))
    );
    if (next.length === rows.length) {
        return false;
    }
    writeAll(next);
    return true;
}

// userId がフォローしている相手
function followingIds(userId) {
    return readAll()
        .filter((r) => eq(r.follower, userId))
        .map((r) => r.following);
}

// userId をフォローしている相手
function followerIds(userId) {
    return readAll()
        .filter((r) => eq(r.following, userId))
        .map((r) => r.follower);
}

// 双方向の関係を削除（ブロック時・アカウント削除時）
function removePair(a, b) {
    const rows = readAll();
    const next = rows.filter(
        (r) =>
            !(eq(r.follower, a) && eq(r.following, b)) &&
            !(eq(r.follower, b) && eq(r.following, a))
    );
    if (next.length !== rows.length) writeAll(next);
}

function removeAllFor(userId) {
    const rows = readAll();
    const next = rows.filter(
        (r) => !eq(r.follower, userId) && !eq(r.following, userId)
    );
    if (next.length !== rows.length) writeAll(next);
}

function renameUser(oldId, newId) {
    const rows = readAll();
    let changed = false;
    for (const r of rows) {
        if (eq(r.follower, oldId)) { r.follower = newId; changed = true; }
        if (eq(r.following, oldId)) { r.following = newId; changed = true; }
    }
    if (changed) writeAll(rows);
}

module.exports = {
    isFollowing,
    follow,
    unfollow,
    followingIds,
    followerIds,
    removePair,
    removeAllFor,
    renameUser,
};
