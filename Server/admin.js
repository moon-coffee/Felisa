const express = require("express");
const admin = require("./adminStore");
const accessLog = require("./accessLog");
const postStore = require("./postStore");
const session = require("./session");
const userStore = require("./userStore");
const supportStore = require("./supportStore");

const router = express.Router();
const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(timestamp) {
    return new Date(timestamp).toISOString().slice(0, 10);
}

function requireAdmin(req, res, next) {
    const userId = session.currentUserId(req);
    if (!userId || !userStore.findByUserId(userId)) {
        return res.status(401).json({
            ok: false,
            errors: { form: "ログインが必要です。" },
        });
    }
    if (!admin.has(userId)) {
        return res.status(403).json({
            ok: false,
            errors: { form: "管理者専用の機能です。" },
        });
    }
    next();
}

router.get("/stats", requireAdmin, (req, res) => {
    accessLog.note(req, "管理統計表示");
    const now = Date.now();
    const weekAgo = now - 7 * DAY_MS;
    const users = userStore.statistics();
    const posts = postStore.listAll();
    const series = [];

    const today = new Date(now);
    const utcToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    for (let offset = 6; offset >= 0; offset -= 1) {
        const start = utcToday - offset * DAY_MS;
        const end = start + DAY_MS;
        const key = dayKey(start);
        series.push({
            date: key,
            users: users.createdAt.filter((createdAt) => createdAt >= start && createdAt < end).length,
            posts: posts.filter((post) => post.createdAt >= start && post.createdAt < end).length,
        });
    }

    const recentPosts = posts.filter((post) => post.createdAt >= weekAgo);
    res.json({
        ok: true,
        generatedAt: now,
        users: {
            total: users.total,
            last7Days: users.createdAt.filter((createdAt) => createdAt >= weekAgo).length,
        },
        posts: {
            total: posts.length,
            last24Hours: posts.filter((post) => post.createdAt >= now - DAY_MS).length,
            last7Days: recentPosts.length,
            replies: posts.filter((post) => post.replyTo).length,
            likes: posts.reduce((total, post) => total + post.likes.length, 0),
            reposts: posts.reduce((total, post) => total + post.reposts.length, 0),
            pendingModeration: posts.filter((post) => post.moderation?.state === "pending").length,
        },
        activity: series,
    });
});

router.get("/reports", requireAdmin, (req, res) => {
    accessLog.note(req, "通報一覧表示");
    res.json({ ok: true, reports: supportStore.listReports() });
});

router.put("/reports/:id/review", requireAdmin, (req, res) => {
    const report = supportStore.reviewReport(req.params.id);
    if (!report) {
        return res.status(404).json({ ok: false, errors: { form: "通報が見つかりません。" } });
    }
    accessLog.note(req, "通報を確認済みに変更");
    return res.json({ ok: true, report });
});

router.get("/inquiries", requireAdmin, (req, res) => {
    accessLog.note(req, "お問い合わせ一覧表示");
    res.json({ ok: true, inquiries: supportStore.listInquiries() });
});

router.put("/inquiries/:id/review", requireAdmin, (req, res) => {
    const inquiry = supportStore.reviewInquiry(req.params.id);
    if (!inquiry) {
        return res.status(404).json({ ok: false, errors: { form: "お問い合わせが見つかりません。" } });
    }
    accessLog.note(req, "お問い合わせを確認済みに変更");
    return res.json({ ok: true, inquiry });
});

module.exports = router;
