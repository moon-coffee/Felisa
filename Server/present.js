// ストアの生データを、クライアントに返す形へ整形する層。
const users = require("./userStore");
const postStore = require("./postStore");
const follows = require("./followStore");
const bookmarks = require("./bookmarkStore");
const blocks = require("./blockStore");
const admin = require("./adminStore");

function lc(v) {
    return v ? String(v).toLowerCase() : null;
}

function author(userId) {
    const u = users.findByUserId(userId);
    const id = u ? u.userId : userId;
    return {
        userId: id,
        name: u ? u.displayName : userId,
        handle: `@${id}`,
        avatar: `/api/avatar/${encodeURIComponent(id)}`,
        isAdmin: admin.has(id),
    };
}

function decorateMedia(list) {
    return (list || []).map((m) => ({
        type: m.type,
        id: m.id,
        url: `/api/media/${m.id}`,
        width: m.width || null,
        height: m.height || null,
    }));
}

function decoratePoll(poll, viewerId) {
    if (!poll) return null;
    const votes = poll.votes || {};
    const tally = poll.options.map((_, i) => 0);
    for (const idx of Object.values(votes)) {
        if (tally[idx] !== undefined) tally[idx] += 1;
    }
    const total = Object.keys(votes).length;
    const vid = lc(viewerId);
    return {
        options: poll.options.map((o, i) => ({ text: o.text, votes: tally[i] })),
        totalVotes: total,
        endsAt: poll.endsAt,
        closed: Date.now() >= poll.endsAt,
        myVote: vid && votes[vid] !== undefined ? votes[vid] : null,
    };
}

function decoratePost(post, viewerId) {
    const vid = lc(viewerId);
    const likes = post.likes || [];
    const reposts = post.reposts || [];
    return {
        id: post.id,
        text: post.text,
        createdAt: post.createdAt,
        replyTo: post.replyTo || null,
        author: author(post.userId),
        hashtags: postStore.extractHashtags(post.text),
        media: decorateMedia(post.media),
        poll: decoratePoll(post.poll, viewerId),
        likeCount: likes.length,
        repostCount: reposts.length,
        replyCount: postStore.replyCount(post.id),
        likedByMe: vid ? likes.some((u) => lc(u) === vid) : false,
        repostedByMe: vid ? reposts.some((r) => lc(r.userId) === vid) : false,
        bookmarkedByMe: vid ? bookmarks.has(viewerId, post.id) : false,
        mine: vid ? lc(post.userId) === vid : false,
    };
}

function postEntry(post, viewerId) {
    return {
        kind: "post",
        sortAt: post.createdAt,
        post: decoratePost(post, viewerId),
    };
}

function repostEntry(entry, viewerId) {
    return {
        kind: "repost",
        sortAt: entry.at,
        repostedBy: author(entry.by),
        post: decoratePost(entry.post, viewerId),
    };
}

function publicProfile(user, viewerId) {
    const vid = lc(viewerId);
    return {
        userId: user.userId,
        name: user.displayName,
        handle: `@${user.userId}`,
        avatar: `/api/avatar/${encodeURIComponent(user.userId)}`,
        header: user.hasHeader
            ? `/api/header/${encodeURIComponent(user.userId)}`
            : null,
        bio: user.bio || "",
        link: user.link || "",
        createdAt: user.createdAt || null,
        followerCount: follows.followerIds(user.userId).length,
        followingCount: follows.followingIds(user.userId).length,
        postCount: postStore.listByAuthor(user.userId).length,
        followedByMe: vid ? follows.isFollowing(viewerId, user.userId) : false,
        blockedByMe: vid ? blocks.isBlocked(viewerId, user.userId) : false,
        blocksMe: vid ? blocks.isBlocked(user.userId, viewerId) : false,
        isMe: vid ? lc(user.userId) === vid : false,
        isAdmin: admin.has(user.userId),
    };
}

function selfUser(user) {
    return {
        ...publicProfile(user, user.userId),
        mail: user.mail,
        usernameNextChangeAt: users.usernameChangeAvailableAt(user.userId),
    };
}

module.exports = {
    author,
    decoratePost,
    postEntry,
    repostEntry,
    publicProfile,
    selfUser,
};
