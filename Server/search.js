const express = require("express");
const postStore = require("./postStore");
const userStore = require("./userStore");
const blocks = require("./blockStore");
const session = require("./session");
const present = require("./present");

const router = express.Router();

const USER_SEARCH_MAX = 10; // ユーザー検索の上限件数

router.get("/", (req, res) => {
    const viewer = session.currentUserId(req);
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";

    if (query === "") {
        return res.json({ ok: true, query: "", kind: "text", posts: [], users: [] });
    }

    const hidden = viewer ? blocks.hiddenFor(viewer) : null;
    const { kind, results } = postStore.search(query, hidden);
    // ユーザー検索は # を除いた文字列で userId / displayName を部分一致させる。
    // ブロック関係（自分がブロックした／された）は hidden で除外済み。
    const matched = userStore.searchUsers(query.replace(/#/g, ""), hidden);
    return res.json({
        ok: true,
        query,
        kind,
        posts: results.slice(0, 50).map((p) => present.decoratePost(p, viewer)),
        users: matched
            .slice(0, USER_SEARCH_MAX)
            .map((u) => present.publicProfile(u, viewer)),
    });
});

module.exports = router;
