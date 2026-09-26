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
        detail: row.detail || null,
        actor: present.author(row.actor),
        post: post
            ? { id: post.id, text: post.text }
            : row.postId
              ? { id: row.postId, text: null }
              : null,
    };
}

// 通知の種別（GET /?filter= の対象）。これ以外の値は all 扱い。
const FILTER_TYPES = new Set(["like", "repost", "reply", "follow"]);

router.get("/", (req, res) => {
    const user = requireAuth(req, res);
    if (!user) return;
    const requested = typeof req.query.filter === "string" ? req.query.filter : "";
    const filter = FILTER_TYPES.has(requested) ? requested : "all";

    // 既読処理は行わない（未読のまま返す）。既読化は POST /read のみで行い、
    // 未読件数は GET /api/me の unreadNotifications と常に一致させる。
    const rows = notificationStore.listFor(user.userId);
    const visible = filter === "all" ? rows : rows.filter((r) => r.type === filter);
    return res.json({
        ok: true,
        filter,
        notifications: visible.map(decorate),
        unreadCount: notificationStore.unreadCount(user.userId),
    });
});

// body.id を指定すればその1件だけ、無ければ（{} / null でも）全件を既読にする
router.post("/read", (req, res) => {
    const user = requireAuth(req, res);
    if (!user) return;
    const body = req.body || {};
    const id = typeof body.id === "string" && body.id !== "" ? body.id : null;
    if (id) {
        notificationStore.markRead(user.userId, id); // 無い/他人の1件は無視される
    } else {
        notificationStore.markAllRead(user.userId);
    }
    return res.json({
        ok: true,
        unreadCount: notificationStore.unreadCount(user.userId),
    });
});

module.exports = router;
