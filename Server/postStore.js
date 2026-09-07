const path = require("path");
const crypto = require("crypto");
const { readArray, writeArray } = require("./jsonStore");

const DATA_DIR = path.join(__dirname, "data");
const POSTS_FILE = path.join(DATA_DIR, "posts.json");

const TEXT_MAX = 280;
// 文字・数字・アンダースコアのみ（<>"' などを許さない）
const HASHTAG_RE = /#([\p{L}\p{N}_]+)/gu;
const POLL_OPTION_MAX = 25;
const TRENDS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function normalize(p) {
    return {
        id: p.id,
        userId: p.userId,
        text: p.text,
        createdAt: p.createdAt,
        replyTo: p.replyTo || null,
        likes: Array.isArray(p.likes) ? p.likes : [],
        reposts: Array.isArray(p.reposts) ? p.reposts : [],
        media: Array.isArray(p.media) ? p.media : [],
        poll:
            p.poll && Array.isArray(p.poll.options)
                ? {
                      options: p.poll.options,
                      endsAt: p.poll.endsAt,
                      votes: p.poll.votes || {},
                  }
                : null,
    };
}

function readPosts() {
    return readArray(POSTS_FILE).map(normalize);
}

function writePosts(posts) {
    writeArray(POSTS_FILE, posts);
}

const byNewest = (a, b) => b.createdAt - a.createdAt;
const notHidden = (hidden) => (p) =>
    !hidden || !hidden.has(String(p.userId).toLowerCase());

function get(id) {
    return readPosts().find((p) => p.id === id) || null;
}

function extractHashtags(text) {
    const out = [];
    for (const m of String(text).matchAll(HASHTAG_RE)) {
        const tag = m[1].toLowerCase();
        if (!out.includes(tag)) out.push(tag);
    }
    return out;
}

function buildPoll(poll) {
    if (!poll || !Array.isArray(poll.options)) return null;
    const options = poll.options
        .map((o) => String(o || "").trim().slice(0, POLL_OPTION_MAX))
        .filter((o) => o !== "");
    if (options.length < 2 || options.length > 4) return null;
    const minutes = Math.min(
        Math.max(parseInt(poll.durationMinutes, 10) || 1440, 5),
        7 * 24 * 60
    );
    return {
        options: options.map((text) => ({ text })),
        endsAt: Date.now() + minutes * 60 * 1000,
        votes: {},
    };
}

function create({ userId, text, replyTo = null, media = [], poll = null }) {
    const posts = readPosts();
    const post = {
        id: crypto.randomUUID(),
        userId,
        text,
        createdAt: Date.now(),
        replyTo: replyTo || null,
        likes: [],
        reposts: [],
        media: Array.isArray(media) ? media.slice(0, 4) : [],
        poll: buildPoll(poll),
    };
    posts.push(post);
    writePosts(posts);
    return post;
}

function collectMediaIds(posts) {
    const ids = [];
    for (const p of posts) {
        for (const m of p.media || []) {
            if (m && m.id) ids.push(m.id);
        }
    }
    return ids;
}

// id とその子孫をまとめて削除。{ removed:[id...], mediaIds:[...] } を返す。
function remove(id) {
    const posts = readPosts();
    const removed = new Set();
    const queue = [id];
    while (queue.length > 0) {
        const current = queue.shift();
        if (removed.has(current)) continue;
        removed.add(current);
        for (const p of posts) {
            if (p.replyTo === current) queue.push(p.id);
        }
    }
    const gone = posts.filter((p) => removed.has(p.id));
    writePosts(posts.filter((p) => !removed.has(p.id)));
    return { removed: [...removed], mediaIds: collectMediaIds(gone) };
}

function listTimeline({ limit = 50, since = 0, hidden = null } = {}) {
    return readPosts()
        .filter((p) => !p.replyTo)
        .filter(notHidden(hidden))
        .filter((p) => p.createdAt > since)
        .sort(byNewest)
        .slice(0, limit);
}

function listByAuthor(userId) {
    const key = String(userId).toLowerCase();
    return readPosts()
        .filter((p) => p.userId.toLowerCase() === key)
        .sort(byNewest);
}

function listByAuthors(
    userIds,
    { includeReplies = false, limit = 50, since = 0, hidden = null } = {}
) {
    const set = new Set(userIds.map((u) => String(u).toLowerCase()));
    return readPosts()
        .filter((p) => set.has(p.userId.toLowerCase()))
        .filter((p) => includeReplies || !p.replyTo)
        .filter(notHidden(hidden))
        .filter((p) => p.createdAt > since)
        .sort(byNewest)
        .slice(0, limit);
}

function listLikedBy(userId, hidden = null) {
    const key = String(userId).toLowerCase();
    return readPosts()
        .filter((p) => p.likes.some((u) => String(u).toLowerCase() === key))
        .filter(notHidden(hidden))
        .sort(byNewest);
}

function listByIds(ids, hidden = null) {
    const all = readPosts();
    const map = new Map(all.map((p) => [p.id, p]));
    return ids
        .map((id) => map.get(id))
        .filter(Boolean)
        .filter(notHidden(hidden));
}

function listReplies(id, hidden = null) {
    return readPosts()
        .filter((p) => p.replyTo === id)
        .filter(notHidden(hidden))
        .sort((a, b) => a.createdAt - b.createdAt);
}

function ancestors(id) {
    const all = readPosts();
    const chain = [];
    let node = all.find((p) => p.id === id);
    const seen = new Set();
    while (node && node.replyTo && !seen.has(node.replyTo)) {
        seen.add(node.replyTo);
        const parent = all.find((p) => p.id === node.replyTo);
        if (!parent) break;
        chain.unshift(parent);
        node = parent;
    }
    return chain;
}

function replyCount(id) {
    return readPosts().filter((p) => p.replyTo === id).length;
}

function setLike(id, userId, on) {
    const posts = readPosts();
    const post = posts.find((p) => p.id === id);
    if (!post) return null;
    const key = String(userId).toLowerCase();
    const has = post.likes.some((u) => String(u).toLowerCase() === key);
    if (on && !has) post.likes.push(userId);
    else if (!on && has)
        post.likes = post.likes.filter((u) => String(u).toLowerCase() !== key);
    writePosts(posts);
    return { liked: on, likeCount: post.likes.length };
}

function setRepost(id, userId, on) {
    const posts = readPosts();
    const post = posts.find((p) => p.id === id);
    if (!post) return null;
    const key = String(userId).toLowerCase();
    const has = post.reposts.some((r) => String(r.userId).toLowerCase() === key);
    if (on && !has) post.reposts.push({ userId, createdAt: Date.now() });
    else if (!on && has)
        post.reposts = post.reposts.filter(
            (r) => String(r.userId).toLowerCase() !== key
        );
    writePosts(posts);
    return { reposted: on, repostCount: post.reposts.length };
}

function vote(id, userId, optionIndex) {
    const posts = readPosts();
    const post = posts.find((p) => p.id === id);
    if (!post || !post.poll) return { error: "投票が見つかりません。" };
    if (Date.now() >= post.poll.endsAt) return { error: "この投票は終了しました。" };
    const key = String(userId).toLowerCase();
    if (post.poll.votes[key] !== undefined)
        return { error: "すでに投票済みです。" };
    const idx = parseInt(optionIndex, 10);
    if (!(idx >= 0 && idx < post.poll.options.length))
        return { error: "選択肢が不正です。" };
    post.poll.votes[key] = idx;
    writePosts(posts);
    return { ok: true };
}

function repostEntriesByAuthors(userIds, limit = 50, hidden = null) {
    const set = new Set(userIds.map((u) => String(u).toLowerCase()));
    const entries = [];
    for (const post of readPosts()) {
        if (hidden && hidden.has(String(post.userId).toLowerCase())) continue;
        for (const r of post.reposts) {
            if (set.has(String(r.userId).toLowerCase())) {
                entries.push({ post, at: r.createdAt, by: r.userId });
            }
        }
    }
    return entries.sort((a, b) => b.at - a.at).slice(0, limit);
}

function search(query, hidden = null) {
    const q = String(query).trim();
    if (q === "") return { kind: "text", results: [] };
    const visible = readPosts().filter(notHidden(hidden));
    if (q.startsWith("#")) {
        const tag = q.slice(1).toLowerCase();
        return {
            kind: "tag",
            results: visible
                .filter((p) => extractHashtags(p.text).includes(tag))
                .sort(byNewest),
        };
    }
    const needle = q.toLowerCase();
    return {
        kind: "text",
        results: visible
            .filter((p) => p.text.toLowerCase().includes(needle))
            .sort(byNewest),
    };
}

// ユーザー名変更を全投稿へ反映（作者・いいね・リポスト・投票キー）
function renameUser(oldId, newId) {
    const key = String(oldId).toLowerCase();
    const posts = readPosts();
    let changed = false;
    for (const p of posts) {
        if (p.userId.toLowerCase() === key) { p.userId = newId; changed = true; }
        for (let i = 0; i < p.likes.length; i++) {
            if (String(p.likes[i]).toLowerCase() === key) { p.likes[i] = newId; changed = true; }
        }
        for (const r of p.reposts) {
            if (String(r.userId).toLowerCase() === key) { r.userId = newId; changed = true; }
        }
        if (p.poll && p.poll.votes && p.poll.votes[key] !== undefined) {
            p.poll.votes[newId.toLowerCase()] = p.poll.votes[key];
            if (newId.toLowerCase() !== key) delete p.poll.votes[key];
            changed = true;
        }
    }
    if (changed) writePosts(posts);
}

// あるユーザーのいいね・リポスト・投票を全投稿から取り除く（アカウント削除時）
function purgeUser(userId) {
    const key = String(userId).toLowerCase();
    const posts = readPosts();
    let changed = false;
    for (const p of posts) {
        const likes = p.likes.filter((u) => String(u).toLowerCase() !== key);
        const reposts = p.reposts.filter(
            (r) => String(r.userId).toLowerCase() !== key
        );
        if (likes.length !== p.likes.length || reposts.length !== p.reposts.length) {
            p.likes = likes;
            p.reposts = reposts;
            changed = true;
        }
        if (p.poll && p.poll.votes && p.poll.votes[key] !== undefined) {
            delete p.poll.votes[key];
            changed = true;
        }
    }
    if (changed) writePosts(posts);
}

// 「いま起きていること」: 直近7日のハッシュタグ集計（無ければ全期間）
function trends(limit = 10) {
    const now = Date.now();
    const all = readPosts();
    let scope = all.filter((p) => now - p.createdAt <= TRENDS_WINDOW_MS);
    if (scope.length === 0) scope = all;

    const counts = new Map();
    for (const p of scope) {
        for (const tag of extractHashtags(p.text)) {
            counts.set(tag, (counts.get(tag) || 0) + 1);
        }
    }
    return [...counts.entries()]
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
        .slice(0, limit);
}

module.exports = {
    TEXT_MAX,
    get,
    create,
    remove,
    listTimeline,
    listByAuthor,
    listByAuthors,
    listLikedBy,
    listByIds,
    listReplies,
    ancestors,
    replyCount,
    setLike,
    setRepost,
    vote,
    repostEntriesByAuthors,
    extractHashtags,
    search,
    trends,
    purgeUser,
    renameUser,
};
