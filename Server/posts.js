const express = require("express");
const postStore = require("./postStore");
const userStore = require("./userStore");
const follows = require("./followStore");
const blocks = require("./blockStore");
const bookmarks = require("./bookmarkStore");
const notifications = require("./notificationStore");
const mediaStore = require("./mediaStore");
const session = require("./session");
const present = require("./present");
const admin = require("./adminStore");
const moderation = require("./moderation");
const accessLog = require("./accessLog");

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

/* ---------- タイムライン ---------- */

router.get("/", (req, res) => {
    accessLog.note(req, "タイムライン取得");
    const viewer = session.currentUserId(req);
    const feed = req.query.feed === "following" ? "following" : "recommended";
    const since = Math.max(0, parseInt(req.query.since, 10) || 0);
    const hidden = viewer ? blocks.hiddenFor(viewer) : null;

    let entries;
    if (feed === "following") {
        if (!viewer) {
            return res
                .status(401)
                .json({ ok: false, errors: { form: "ログインが必要です。" } });
        }
        const authorIds = [...follows.followingIds(viewer), viewer];
        const posts = postStore
            .listByAuthors(authorIds, { limit: 100, since, hidden })
            .map((p) => present.postEntry(p, viewer));
        const reposts = postStore
            .repostEntriesByAuthors(authorIds, 100, hidden)
            .filter((e) => e.at > since)
            .map((e) => present.repostEntry(e, viewer));
        entries = [...posts, ...reposts];
    } else {
        entries = postStore
            .listTimeline({ limit: 100, since, hidden })
            .map((p) => present.postEntry(p, viewer));
    }

    entries.sort((a, b) => b.sortAt - a.sortAt);
    entries = entries.slice(0, 50);
    return res.json({ ok: true, feed, entries, newCount: entries.length });
});

/* ---------- 投稿 / 返信 ---------- */

router.post("/", async (req, res) => {
    const user = requireAuth(req, res);
    if (!user) return;

    const body = req.body || {};
    const text = (typeof body.text === "string" ? body.text : "").trim();
    const replyTo = typeof body.replyTo === "string" ? body.replyTo : null;
    const mediaInput = Array.isArray(body.media) ? body.media : [];
    const pollInput =
        body.poll && Array.isArray(body.poll.options) ? body.poll : null;

    if (pollInput) {
        const opts = pollInput.options
            .map((o) => String(o || "").trim())
            .filter(Boolean);
        if (opts.length < 2 || opts.length > 4) {
            return res.status(400).json({
                ok: false,
                errors: { form: "投票の選択肢は2〜4個にしてください。" },
            });
        }
    }

    // メディアの検証（サーバーが払い出した ID のみ許可）
    const media = [];
    for (const m of mediaInput.slice(0, 4)) {
        // 他人（または別投稿）に添付済みのメディアは再利用させない
        // （自分の投稿を削除して他人の画像ファイルまで消せてしまうのを防ぐ）
        if (
            m &&
            typeof m.id === "string" &&
            mediaStore.exists(m.id) &&
            !postStore.mediaInUse(m.id) &&
            !media.some((x) => x.id === m.id)
        ) {
            const type = m.id.endsWith(".mp4") ? "video" : "image";
            media.push({
                type,
                id: m.id,
                width: Number(m.width) || null,
                height: Number(m.height) || null,
            });
        }
    }
    const hasVideo = media.some((m) => m.type === "video");
    if (hasVideo && media.length > 1) {
        return res
            .status(400)
            .json({ ok: false, errors: { form: "動画は1本のみ投稿できます。" } });
    }
    if (media.length > 0 && pollInput) {
        return res.status(400).json({
            ok: false,
            errors: { form: "メディアと投票は同時に投稿できません。" },
        });
    }

    if (text === "" && media.length === 0 && !pollInput) {
        return res
            .status(400)
            .json({ ok: false, errors: { text: "本文を入力してください。" } });
    }
    if (text.length > postStore.TEXT_MAX) {
        return res.status(400).json({
            ok: false,
            errors: { text: `本文は${postStore.TEXT_MAX}文字以内で入力してください。` },
        });
    }

    let parent = null;
    if (replyTo) {
        parent = postStore.get(replyTo);
        if (!parent) {
            return res
                .status(404)
                .json({ ok: false, errors: { form: "返信先が見つかりません。" } });
        }
        if (blocks.between(user.userId, parent.userId)) {
            return res
                .status(403)
                .json({ ok: false, errors: { form: "このユーザーには返信できません。" } });
        }
    }

    // Llama Guard 3 による規約チェック（投稿する前に同期で判定）。
    // 違反と判定されたら保存せず（＝削除相当）、警告を出して拒否する。
    // Ollama が使えない場合は "pending" として保存し、後続の再スキャンに委ねる。
    const verdict = await moderation.checkAtCreate({
        userId: user.userId,
        text,
        poll: pollInput,
    });
    if (verdict.verdict === "reject") {
        accessLog.note(req, "投稿（規約違反のため拒否）");
        return res.status(400).json({
            ok: false,
            errors: {
                form:
                    "この投稿は利用規約に違反している可能性があるため投稿できませんでした。" +
                    (verdict.label ? `（判定: ${verdict.label}）` : "") +
                    " 同じ内容の投稿を続けるとアカウントが制限されることがあります。",
            },
            moderation: { rejected: true, categories: verdict.categories || [] },
        });
    }

    const post = postStore.create({
        userId: user.userId,
        text,
        replyTo,
        media,
        poll: pollInput,
        moderation: {
            state: verdict.verdict === "pass" ? "safe" : "pending",
            at: Date.now(),
            categories: [],
        },
    });

    if (parent) {
        notifications.add({
            userId: parent.userId,
            type: "reply",
            actor: user.userId,
            postId: post.id,
        });
    }

    return res
        .status(201)
        .json({ ok: true, post: present.decoratePost(post, user.userId) });
});

/* ---------- 引用リポスト ---------- */

// 本文を付けて元ポストを引用する。元ポスト側には「この引用によるリポスト」として
// 記録されるため、リポスト件数・通知は素のリポストと同じように動く。
// 引用ポストを削除すると、元ポスト側のその記録も自動的に外れる（postStore.remove）。
router.post("/:id/quote", async (req, res) => {
    const user = requireAuth(req, res);
    if (!user) return;

    const target = postStore.get(req.params.id);
    if (!target) {
        return res
            .status(404)
            .json({ ok: false, errors: { form: "ポストが見つかりません。" } });
    }
    if (blocks.between(user.userId, target.userId)) {
        return res
            .status(403)
            .json({ ok: false, errors: { form: "このポストには操作できません。" } });
    }
    if (target.quoteOf) {
        return res
            .status(400)
            .json({ ok: false, errors: { form: "引用の引用はできません。" } });
    }

    const text = (typeof (req.body || {}).text === "string" ? req.body.text : "").trim();
    if (text === "") {
        return res
            .status(400)
            .json({ ok: false, errors: { text: "引用のコメントを入力してください。" } });
    }
    if (text.length > postStore.TEXT_MAX) {
        return res.status(400).json({
            ok: false,
            errors: { text: `本文は${postStore.TEXT_MAX}文字以内で入力してください。` },
        });
    }

    const verdict = await moderation.checkAtCreate({
        userId: user.userId,
        text,
        source: "quote",
    });
    if (verdict.verdict === "reject") {
        accessLog.note(req, "引用リポスト（規約違反のため拒否）");
        return res.status(400).json({
            ok: false,
            errors: {
                form:
                    "この引用は利用規約に違反している可能性があるため投稿できませんでした。" +
                    (verdict.label ? `（判定: ${verdict.label}）` : ""),
            },
            moderation: { rejected: true, categories: verdict.categories || [] },
        });
    }

    const post = postStore.create({
        userId: user.userId,
        text,
        quoteOf: target.id,
        moderation: {
            state: verdict.verdict === "pass" ? "safe" : "pending",
            at: Date.now(),
            categories: [],
        },
    });
    postStore.setRepost(target.id, user.userId, true, post.id);
    notifications.add({
        userId: target.userId,
        type: "repost",
        actor: user.userId,
        postId: target.id,
    });
    accessLog.note(req, "引用リポスト");

    return res
        .status(201)
        .json({ ok: true, post: present.decoratePost(post, user.userId) });
});

/* ---------- 単一投稿（スレッド） ---------- */

router.get("/:id", (req, res) => {
    accessLog.note(req, "投稿（スレッド）取得");
    const viewer = session.currentUserId(req);
    const post = postStore.get(req.params.id);
    if (!post) {
        return res
            .status(404)
            .json({ ok: false, errors: { form: "投稿が見つかりません。" } });
    }
    if (viewer && blocks.between(viewer, post.userId)) {
        return res
            .status(404)
            .json({ ok: false, errors: { form: "投稿が見つかりません。" } });
    }
    const hidden = viewer ? blocks.hiddenFor(viewer) : null;
    return res.json({
        ok: true,
        parents: postStore
            .ancestors(post.id)
            .filter((p) => !hidden || !hidden.has(p.userId.toLowerCase()))
            .map((p) => present.decoratePost(p, viewer)),
        post: present.decoratePost(post, viewer),
        replies: postStore
            .listReplies(post.id, hidden)
            .map((p) => present.decoratePost(p, viewer)),
    });
});

router.delete("/:id", (req, res) => {
    const user = requireAuth(req, res);
    if (!user) return;
    const post = postStore.get(req.params.id);
    if (!post) {
        return res
            .status(404)
            .json({ ok: false, errors: { form: "投稿が見つかりません。" } });
    }
    const isOwner = post.userId.toLowerCase() === user.userId.toLowerCase();
    const isMod = admin.has(user.userId); // Server/data/admin.json に列挙された Admin
    if (!isOwner && !isMod) {
        return res
            .status(403)
            .json({ ok: false, errors: { form: "自分の投稿のみ削除できます。" } });
    }
    accessLog.note(req, isOwner ? "ポスト削除" : "ポスト削除（管理者）");

    const { removed, mediaIds } = postStore.remove(post.id);
    mediaStore.removeFiles(mediaIds);
    notifications.removeForPosts(removed);
    bookmarks.removeForPosts(removed);

    // 管理者によって削除された場合は本人へ通知する
    if (!isOwner) {
        notifications.add({
            userId: post.userId,
            type: "moderation",
            actor: "system",
            postId: null,
            detail: "管理者があなたのポストを削除しました。削除理由は利用規約の違反です。",
            dedupe: false,
        });
    }
    return res.json({ ok: true, removed });
});

/* ---------- いいね / リポスト / ブックマーク ---------- */

function toggleHandler(kind, on) {
    return (req, res) => {
        const user = requireAuth(req, res);
        if (!user) return;
        const post = postStore.get(req.params.id);
        if (!post) {
            return res
                .status(404)
                .json({ ok: false, errors: { form: "投稿が見つかりません。" } });
        }

        // ブロック関係にある相手の投稿へは通知を発生させる操作をさせない
        if (kind !== "bookmark" && blocks.between(user.userId, post.userId)) {
            return res
                .status(403)
                .json({ ok: false, errors: { form: "この投稿には操作できません。" } });
        }
        accessLog.note(
            req,
            kind === "like"
                ? on
                    ? "いいね"
                    : "いいね解除"
                : kind === "repost"
                  ? on
                      ? "リポスト"
                      : "リポスト解除"
                  : on
                    ? "ブックマーク追加"
                    : "ブックマーク解除"
        );

        if (kind === "like") {
            const result = postStore.setLike(post.id, user.userId, on);
            if (on)
                notifications.add({
                    userId: post.userId,
                    type: "like",
                    actor: user.userId,
                    postId: post.id,
                });
            return res.json({ ok: true, ...result });
        }
        if (kind === "repost") {
            const result = postStore.setRepost(post.id, user.userId, on);
            if (on)
                notifications.add({
                    userId: post.userId,
                    type: "repost",
                    actor: user.userId,
                    postId: post.id,
                });
            return res.json({ ok: true, ...result });
        }
        // bookmark
        bookmarks.set(user.userId, post.id, on);
        return res.json({ ok: true, bookmarked: on });
    };
}

router.post("/:id/like", toggleHandler("like", true));
router.delete("/:id/like", toggleHandler("like", false));
router.post("/:id/repost", toggleHandler("repost", true));
router.delete("/:id/repost", toggleHandler("repost", false));
router.post("/:id/bookmark", toggleHandler("bookmark", true));
router.delete("/:id/bookmark", toggleHandler("bookmark", false));

/* ---------- 投票 ---------- */

router.post("/:id/vote", (req, res) => {
    const user = requireAuth(req, res);
    if (!user) return;
    const post = postStore.get(req.params.id);
    if (!post || !post.poll) {
        return res
            .status(404)
            .json({ ok: false, errors: { form: "投票が見つかりません。" } });
    }
    if (blocks.between(user.userId, post.userId)) {
        return res
            .status(403)
            .json({ ok: false, errors: { form: "この投稿には操作できません。" } });
    }
    const result = postStore.vote(
        post.id,
        user.userId,
        (req.body || {}).option
    );
    accessLog.note(req, result.error ? "投票（失敗）" : "投票");
    if (result.error) {
        return res.status(400).json({ ok: false, errors: { form: result.error } });
    }
    const updated = postStore.get(post.id);
    return res.json({
        ok: true,
        poll: present.decoratePost(updated, user.userId).poll,
    });
});

module.exports = router;
