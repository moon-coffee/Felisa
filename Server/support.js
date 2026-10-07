const express = require("express");
const postStore = require("./postStore");
const session = require("./session");
const supportStore = require("./supportStore");
const userStore = require("./userStore");
const accessLog = require("./accessLog");

const contactRouter = express.Router();
const reportRouter = express.Router();
const REASONS = new Set(["harassment", "illegal", "child_safety", "spam", "privacy", "other"]);
const CATEGORIES = new Set(["account", "privacy", "safety", "bug", "other"]);
const EMAIL_MAX = 254;
const MESSAGE_MAX = 4000;

function requireAuth(req, res) {
    const userId = session.currentUserId(req);
    const user = userId ? userStore.findByUserId(userId) : null;
    if (!user) {
        res.status(401).json({ ok: false, errors: { form: "ログインが必要です。" } });
        return null;
    }
    return user;
}

contactRouter.post("/", (req, res) => {
    const body = req.body || {};
    const category = typeof body.category === "string" ? body.category : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const errors = {};

    if (!CATEGORIES.has(category)) errors.category = "お問い合わせの種類を選択してください。";
    if (!message) errors.message = "お問い合わせ内容を入力してください。";
    else if (message.length > MESSAGE_MAX)
        errors.message = `お問い合わせ内容は${MESSAGE_MAX}文字以内で入力してください。`;
    if (email.length > EMAIL_MAX || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))
        errors.email = "メールアドレスの形式を確認してください。";
    if (Object.keys(errors).length) {
        return res.status(400).json({ ok: false, errors });
    }

    const currentId = session.currentUserId(req);
    const user = currentId ? userStore.findByUserId(currentId) : null;
    supportStore.createInquiry({
        category,
        message,
        email,
        userId: user ? user.userId : "",
    });
    accessLog.note(req, "お問い合わせ送信");
    return res.status(201).json({ ok: true });
});

reportRouter.post("/", (req, res) => {
    const user = requireAuth(req, res);
    if (!user) return;
    const body = req.body || {};
    const type = body.targetType;
    const targetId = typeof body.targetId === "string" ? body.targetId.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason : "";
    const detail = typeof body.detail === "string" ? body.detail.trim() : "";
    const errors = {};

    if (type !== "post" && type !== "user") errors.targetType = "通報対象が不正です。";
    if (!targetId || targetId.length > 100) errors.targetId = "通報対象が不正です。";
    if (!REASONS.has(reason)) errors.reason = "通報理由を選択してください。";
    if (detail.length > 1000) errors.detail = "補足は1000文字以内で入力してください。";
    if (Object.keys(errors).length) {
        return res.status(400).json({ ok: false, errors });
    }

    let targetUserId;
    if (type === "post") {
        const post = postStore.get(targetId);
        if (!post) {
            return res.status(404).json({ ok: false, errors: { form: "通報対象のポストが見つかりません。" } });
        }
        targetUserId = post.userId;
    } else {
        const target = userStore.findByUserId(targetId.replace(/^@/, ""));
        if (!target) {
            return res.status(404).json({ ok: false, errors: { form: "通報対象のユーザーが見つかりません。" } });
        }
        targetUserId = target.userId;
    }

    if (targetUserId.toLowerCase() === user.userId.toLowerCase()) {
        return res.status(400).json({ ok: false, errors: { form: "自分自身は通報できません。" } });
    }

    const report = supportStore.createReport({
        reporterId: user.userId,
        targetType: type,
        targetId,
        targetUserId,
        reason,
        detail,
    });
    accessLog.note(req, "ユーザー通報");
    return res.status(201).json({ ok: true, reportId: report.id });
});

module.exports = { contactRouter, reportRouter };
