const fs = require("fs");
const express = require("express");
const store = require("./userStore");
const postStore = require("./postStore");
const follows = require("./followStore");
const blocks = require("./blockStore");
const bookmarks = require("./bookmarkStore");
const notifications = require("./notificationStore");
const session = require("./session");
const avatar = require("./avatar");
const mediaStore = require("./mediaStore");
const pngUtil = require("./pngUtil");
const admin = require("./adminStore");
const present = require("./present");

const router = express.Router();

const MAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERID_RE = /^[A-Za-z0-9_]+$/;

const asString = (v) => (typeof v === "string" ? v : "");

function requireAuth(req, res) {
    const userId = session.currentUserId(req);
    const user = userId ? store.findByUserId(userId) : null;
    if (!user) {
        res.status(401).json({ ok: false, errors: { form: "ログインが必要です。" } });
        return null;
    }
    return user;
}

function findTarget(req) {
    return store.findByUserId(String(req.params.username).replace(/^@/, ""));
}

/* ==================== 認証 ==================== */

router.post("/register", (req, res) => {
    const body = req.body || {};
    const userId = asString(body.userId).trim();
    const mail = asString(body.mail).trim();
    const password = asString(body.password);

    const errors = {};
    if (userId === "") errors.userId = "ユーザーIDを入力してください。";
    else if (userId.length < 3)
        errors.userId = "ユーザーIDは3文字以上で入力してください。";
    else if (!USERID_RE.test(userId))
        errors.userId = "ユーザーIDは半角英数字とアンダースコアのみ使用できます。";
    if (mail === "") errors.mail = "メールアドレスを入力してください。";
    else if (!MAIL_RE.test(mail)) errors.mail = "メールアドレスの形式が正しくありません。";
    if (password === "") errors.password = "パスワードを入力してください。";
    else if (password.length < 8)
        errors.password = "パスワードは8文字以上で入力してください。";

    if (Object.keys(errors).length > 0) {
        return res.status(400).json({ ok: false, errors });
    }
    // ユーザーID・メールのどちらが衝突したかを区別しない
    // （メールアドレスの登録有無が第三者に判別できてしまうのを防ぐため）
    if (store.findByUserId(userId) || store.findByMail(mail)) {
        return res.status(409).json({
            ok: false,
            errors: { form: "このユーザーIDまたはメールアドレスは既に使用されています。" },
        });
    }

    const user = store.createUser({ userId, mail, password });
    avatar.createForUser(user.userId);
    session.issue(res, user.userId, req);
    return res.status(201).json({ ok: true, user: present.selfUser(user) });
});

router.post("/login", (req, res) => {
    const body = req.body || {};
    const identifier = asString(body.identifier).trim();
    const password = asString(body.password);

    const errors = {};
    if (identifier === "")
        errors.identifier = "メールアドレスまたはユーザーIDを入力してください。";
    if (password === "") errors.password = "パスワードを入力してください。";
    if (Object.keys(errors).length > 0) {
        return res.status(400).json({ ok: false, errors });
    }

    const user = store.findByIdentifier(identifier);
    if (!user || !store.verifyPassword(password, user.password)) {
        return res.status(401).json({
            ok: false,
            errors: {
                form: "メールアドレス（またはユーザーID）かパスワードが正しくありません。",
            },
        });
    }

    session.issue(res, user.userId, req);
    return res.json({ ok: true, user: present.selfUser(user) });
});

router.post("/logout", (req, res) => {
    session.clear(req, res);
    return res.json({ ok: true });
});

/* ==================== 自分 ==================== */

router.get("/me", (req, res) => {
    const userId = session.currentUserId(req);
    const user = userId ? store.findByUserId(userId) : null;
    if (!user) {
        session.clear(req, res);
        return res
            .status(401)
            .json({ ok: false, errors: { form: "ログインしていません。" } });
    }
    return res.json({
        ok: true,
        user: present.selfUser(user),
        unreadNotifications: notifications.unreadCount(user.userId),
    });
});

router.put("/me", (req, res) => {
    const user = requireAuth(req, res);
    if (!user) return;
    const body = req.body || {};
    const patch = {};
    if (typeof body.displayName === "string") patch.displayName = body.displayName;
    if (typeof body.bio === "string") patch.bio = body.bio;
    if (typeof body.link === "string") patch.link = body.link;
    const updated = store.updateProfile(user.userId, patch);
    return res.json({ ok: true, user: present.selfUser(updated) });
});

router.put("/me/email", (req, res) => {
    const user = requireAuth(req, res);
    if (!user) return;
    const body = req.body || {};
    const email = asString(body.email).trim();
    const password = asString(body.password);

    if (!store.verifyPassword(password, user.password)) {
        return res
            .status(403)
            .json({ ok: false, errors: { password: "パスワードが正しくありません。" } });
    }
    if (!MAIL_RE.test(email)) {
        return res
            .status(400)
            .json({ ok: false, errors: { email: "メールアドレスの形式が正しくありません。" } });
    }
    const existing = store.findByMail(email);
    if (existing && existing.userId.toLowerCase() !== user.userId.toLowerCase()) {
        return res.status(409).json({
            ok: false,
            errors: { email: "このメールアドレスは既に使用されています。" },
        });
    }
    const updated = store.setMail(user.userId, email);
    return res.json({ ok: true, user: present.selfUser(updated) });
});

router.put("/me/password", (req, res) => {
    const user = requireAuth(req, res);
    if (!user) return;
    const body = req.body || {};
    const current = asString(body.currentPassword);
    const next = asString(body.newPassword);

    if (!store.verifyPassword(current, user.password)) {
        return res.status(403).json({
            ok: false,
            errors: { currentPassword: "現在のパスワードが正しくありません。" },
        });
    }
    if (next.length < 8) {
        return res.status(400).json({
            ok: false,
            errors: { newPassword: "新しいパスワードは8文字以上で入力してください。" },
        });
    }
    if (next === current) {
        return res.status(400).json({
            ok: false,
            errors: { newPassword: "現在と同じパスワードは使用できません。" },
        });
    }
    store.setPassword(user.userId, next);
    session.revokeOthers(user.userId, req); // 他端末を強制ログアウト
    return res.json({ ok: true });
});

// ユーザー名（ハンドル）の変更 — 1週間に1回まで
router.put("/me/username", (req, res) => {
    const user = requireAuth(req, res);
    if (!user) return;
    const body = req.body || {};
    const newId = asString(body.userId).trim();
    const password = asString(body.password);

    if (!store.verifyPassword(password, user.password)) {
        return res
            .status(403)
            .json({ ok: false, errors: { password: "パスワードが正しくありません。" } });
    }

    const result = store.renameUser(user.userId, newId);
    if (result.error) {
        return res.status(result.availableAt ? 429 : 400).json({
            ok: false,
            errors: { userId: result.error },
            availableAt: result.availableAt || null,
        });
    }

    const oldId = user.userId;
    postStore.renameUser(oldId, newId);
    follows.renameUser(oldId, newId);
    blocks.renameUser(oldId, newId);
    bookmarks.renameUser(oldId, newId);
    notifications.renameUser(oldId, newId);
    session.renameUser(oldId, newId);
    avatar.renameUser(oldId, newId);
    admin.rename(oldId, newId);

    return res.json({ ok: true, user: present.selfUser(result.user) });
});

// アカウント削除の要求（パスワード再確認が必須）
router.delete("/me", (req, res) => {
    const user = requireAuth(req, res);
    if (!user) return;
    const password = asString((req.body || {}).password);
    if (!store.verifyPassword(password, user.password)) {
        return res
            .status(403)
            .json({ ok: false, errors: { password: "パスワードが正しくありません。" } });
    }

    const uid = user.userId;
    // 本人の投稿（返信ツリーごと）を削除し、メディアも消す
    const mediaIds = [];
    for (const p of postStore.listByAuthor(uid)) {
        const r = postStore.remove(p.id);
        mediaIds.push(...r.mediaIds);
        bookmarks.removeForPosts(r.removed);
        notifications.removeForPosts(r.removed);
    }
    mediaStore.removeFiles(mediaIds);
    postStore.purgeUser(uid); // 他人の投稿へのいいね/リポスト/投票
    follows.removeAllFor(uid);
    blocks.removeAllFor(uid);
    bookmarks.removeAllForUser(uid);
    notifications.removeForUser(uid);
    avatar.removeForUser(uid);
    session.revokeAll(uid);
    store.deleteUser(uid);

    res.clearCookie(session.COOKIE_NAME, { path: "/" });
    return res.json({ ok: true });
});

/* ---- ログイン端末 / セッション ---- */

router.get("/me/sessions", (req, res) => {
    const user = requireAuth(req, res);
    if (!user) return;
    return res.json({ ok: true, sessions: session.listFor(user.userId, req) });
});

router.delete("/me/sessions", (req, res) => {
    const user = requireAuth(req, res);
    if (!user) return;
    session.revokeOthers(user.userId, req);
    return res.json({ ok: true });
});

router.delete("/me/sessions/:id", (req, res) => {
    const user = requireAuth(req, res);
    if (!user) return;
    const okRevoke = session.revoke(user.userId, req.params.id, req);
    if (!okRevoke) {
        return res
            .status(404)
            .json({ ok: false, errors: { form: "セッションが見つかりません。" } });
    }
    return res.json({ ok: true });
});

/* ---- プロフィール画像 / ヘッダ画像（クライアントで PNG 化済みを受け取る）---- */

router.put("/me/avatar", (req, res) => {
    const user = requireAuth(req, res);
    if (!user) return;
    const buf = req.body;
    const info = Buffer.isBuffer(buf) ? pngUtil.inspect(buf) : null;
    if (!info || info.width !== info.height || info.width < 64 || info.width > 1024) {
        return res.status(400).json({
            ok: false,
            errors: { form: "正方形（64〜1024px）の PNG 画像を指定してください。" },
        });
    }
    if (buf.length > mediaStore.IMAGE_MAX_BYTES) {
        return res
            .status(400)
            .json({ ok: false, errors: { form: "画像サイズが大きすぎます。" } });
    }
    avatar.saveAvatar(user.userId, buf);
    return res.json({ ok: true });
});

router.put("/me/header", (req, res) => {
    const user = requireAuth(req, res);
    if (!user) return;
    const buf = req.body;
    const info = Buffer.isBuffer(buf) ? pngUtil.inspect(buf) : null;
    if (!info || buf.length > mediaStore.IMAGE_MAX_BYTES) {
        return res
            .status(400)
            .json({ ok: false, errors: { form: "PNG 画像（3MB まで）を指定してください。" } });
    }
    avatar.saveHeader(user.userId, buf);
    store.setHeader(user.userId, true);
    return res.json({ ok: true });
});

router.delete("/me/header", (req, res) => {
    const user = requireAuth(req, res);
    if (!user) return;
    store.setHeader(user.userId, false);
    const p = avatar.getHeader(user.userId);
    if (p) fs.rmSync(p, { force: true });
    return res.json({ ok: true });
});

router.get("/me/bookmarks", (req, res) => {
    const user = requireAuth(req, res);
    if (!user) return;
    const hidden = blocks.hiddenFor(user.userId);
    const posts = postStore.listByIds(bookmarks.listPostIds(user.userId), hidden);
    return res.json({
        ok: true,
        entries: posts.map((p) => present.postEntry(p, user.userId)),
    });
});

/* ==================== 公開プロフィール ==================== */

router.get("/users/:username", (req, res) => {
    const target = findTarget(req);
    if (!target) {
        return res
            .status(404)
            .json({ ok: false, errors: { form: "ユーザーが見つかりません。" } });
    }
    const viewer = session.currentUserId(req);
    return res.json({
        ok: true,
        user: present.publicProfile(target, viewer),
    });
});

router.get("/users/:username/posts", (req, res) => {
    const target = findTarget(req);
    if (!target) {
        return res
            .status(404)
            .json({ ok: false, errors: { form: "ユーザーが見つかりません。" } });
    }
    const viewer = session.currentUserId(req);
    if (viewer && blocks.between(viewer, target.userId)) {
        return res.json({ ok: true, entries: [] });
    }
    const hidden = viewer ? blocks.hiddenFor(viewer) : null;
    const own = postStore
        .listByAuthor(target.userId)
        .map((p) => present.postEntry(p, viewer));
    const reposted = postStore
        .repostEntriesByAuthors([target.userId], 50, hidden)
        .map((e) => present.repostEntry(e, viewer));
    const entries = [...own, ...reposted]
        .sort((a, b) => b.sortAt - a.sortAt)
        .slice(0, 50);
    return res.json({ ok: true, entries });
});

router.get("/users/:username/likes", (req, res) => {
    const target = findTarget(req);
    if (!target) {
        return res
            .status(404)
            .json({ ok: false, errors: { form: "ユーザーが見つかりません。" } });
    }
    const viewer = session.currentUserId(req);
    if (viewer && blocks.between(viewer, target.userId)) {
        return res.json({ ok: true, entries: [] });
    }
    const hidden = viewer ? blocks.hiddenFor(viewer) : null;
    const entries = postStore
        .listLikedBy(target.userId, hidden)
        .map((p) => present.postEntry(p, viewer));
    return res.json({ ok: true, entries });
});

router.post("/users/:username/follow", (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    const target = findTarget(req);
    if (!target) {
        return res
            .status(404)
            .json({ ok: false, errors: { form: "ユーザーが見つかりません。" } });
    }
    if (target.userId.toLowerCase() === me.userId.toLowerCase()) {
        return res
            .status(400)
            .json({ ok: false, errors: { form: "自分はフォローできません。" } });
    }
    if (blocks.between(me.userId, target.userId)) {
        return res
            .status(403)
            .json({ ok: false, errors: { form: "ブロック中のユーザーはフォローできません。" } });
    }
    if (follows.follow(me.userId, target.userId)) {
        notifications.add({
            userId: target.userId,
            type: "follow",
            actor: me.userId,
        });
    }
    return res.json({
        ok: true,
        following: true,
        followerCount: follows.followerIds(target.userId).length,
    });
});

router.delete("/users/:username/follow", (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    const target = findTarget(req);
    if (!target) {
        return res
            .status(404)
            .json({ ok: false, errors: { form: "ユーザーが見つかりません。" } });
    }
    follows.unfollow(me.userId, target.userId);
    return res.json({
        ok: true,
        following: false,
        followerCount: follows.followerIds(target.userId).length,
    });
});

router.post("/users/:username/block", (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    const target = findTarget(req);
    if (!target) {
        return res
            .status(404)
            .json({ ok: false, errors: { form: "ユーザーが見つかりません。" } });
    }
    if (target.userId.toLowerCase() === me.userId.toLowerCase()) {
        return res
            .status(400)
            .json({ ok: false, errors: { form: "自分はブロックできません。" } });
    }
    blocks.block(me.userId, target.userId);
    follows.removePair(me.userId, target.userId); // 相互フォローを解除
    return res.json({ ok: true, blocked: true });
});

router.delete("/users/:username/block", (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    const target = findTarget(req);
    if (!target) {
        return res
            .status(404)
            .json({ ok: false, errors: { form: "ユーザーが見つかりません。" } });
    }
    blocks.unblock(me.userId, target.userId);
    return res.json({ ok: true, blocked: false });
});

/* ==================== 画像配信 ==================== */

router.get("/avatar/:userId", (req, res) => {
    const user = store.findByUserId(req.params.userId);
    if (!user) {
        return res.status(404).json({ ok: false, errors: { form: "見つかりません。" } });
    }
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "no-cache");
    return res.sendFile(avatar.getForUser(user.userId));
});

router.get("/header/:userId", (req, res) => {
    const user = store.findByUserId(req.params.userId);
    const file = user ? avatar.getHeader(user.userId) : null;
    if (!file) {
        return res.status(404).json({ ok: false, errors: { form: "見つかりません。" } });
    }
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "no-cache");
    return res.sendFile(file);
});

module.exports = router;
