const express = require("express");
const postStore = require("./postStore");
const blocks = require("./blockStore");
const session = require("./session");
const present = require("./present");

const router = express.Router();

router.get("/", (req, res) => {
    const viewer = session.currentUserId(req);
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";

    if (query === "") {
        return res.json({ ok: true, query: "", kind: "text", posts: [] });
    }

    const hidden = viewer ? blocks.hiddenFor(viewer) : null;
    const { kind, results } = postStore.search(query, hidden);
    return res.json({
        ok: true,
        query,
        kind,
        posts: results.slice(0, 50).map((p) => present.decoratePost(p, viewer)),
    });
});

module.exports = router;
