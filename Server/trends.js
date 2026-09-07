const express = require("express");
const postStore = require("./postStore");

const router = express.Router();

// 「いま起きていること」
router.get("/", (req, res) => {
    return res.json({ ok: true, trends: postStore.trends(10) });
});

module.exports = router;
