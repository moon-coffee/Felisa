const express = require("express");
const notificationStore = require("./notificationStore");
const postStore = require("./postStore");
const userStore = require("./userStore");
const session = require("./session");
const present = require("./present");

const router = express.Router();

function requireAuth(req, res) {
    const userId = session.currentUserId(req);
    const user = userId ? userStore.findByUserId(userId) : null;
    if (!user) {
        res.status(401).json({ ok: false, errors: { form: "ログインが必要です。" } });
        return null;
    }
    return user;
}

function decorate(row) {
    const post = row.postId ? postStore.get(row.postId) : null;
    return {
        id: row.id,
        type: row.type,
        createdAt: row.createdAt,
        read: row.read,
        actor: present.author(row.actor),
        post: post
            ? { id: post.id, text: post.text }
            : row.postId
              ? { id: row.postId, text: null }
              : null,
    };
}

router.get("/", (req, res) => {
    const user = requireAuth(req, res);
    if (!user) return;
    return res.json({
        ok: true,
        notifications: notificationStore.listFor(user.userId).map(decorate),
        unreadCount: notificationStore.unreadCount(user.userId),
    });
});

router.post("/read", (req, res) => {
    const user = requireAuth(req, res);
    if (!user) return;
    notificationStore.markAllRead(user.userId);
    return res.json({ ok: true });
});

module.exports = router;
