const express = require("express");
const rateLimit = require("express-rate-limit");
const mediaStore = require("./mediaStore");
const userStore = require("./userStore");
const session = require("./session");

const router = express.Router();

// 動画は ffmpeg 再エンコードが重い（CPU・数十秒〜）ため、全体レート制限とは別に
// 専用の低い上限をかけ、同時実行数も制限してリソース枯渇（DoS）を防ぐ。
const videoLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 6,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        ok: false,
        errors: { form: "動画のアップロードが多すぎます。しばらく待ってから再度お試しください。" },
    },
});

const MAX_CONCURRENT_TRANSCODES = 2;
let activeTranscodes = 0;

function requireAuth(req, res) {
    const userId = session.currentUserId(req);
    const user = userId ? userStore.findByUserId(userId) : null;
    if (!user) {
        res.status(401).json({ ok: false, errors: { form: "ログインが必要です。" } });
        return null;
    }
    return user;
}

// クライアントが canvas で PNG 化した画像を受け取る（body は express.raw で Buffer）
router.post("/image", (req, res) => {
    if (!requireAuth(req, res)) return;
    const result = mediaStore.saveImagePng(req.body);
    if (result.error) {
        return res.status(400).json({ ok: false, errors: { form: result.error } });
    }
    return res.status(201).json({ ok: true, media: result.media });
});

// 動画: サーバー側で MP4 / 480p / メタデータ削除に再エンコード
router.post("/video", videoLimiter, async (req, res) => {
    if (!requireAuth(req, res)) return;
    if (!mediaStore.HAS_FFMPEG) {
        return res.status(501).json({
            ok: false,
            errors: { form: "動画のアップロードは現在利用できません。" },
        });
    }
    if (activeTranscodes >= MAX_CONCURRENT_TRANSCODES) {
        return res.status(429).json({
            ok: false,
            errors: { form: "動画の変換が混み合っています。しばらく待ってから再度お試しください。" },
        });
    }
    activeTranscodes++;
    try {
        const result = await mediaStore.saveVideo(req.body);
        if (result.error) {
            const code = result.code === "no_ffmpeg" ? 501 : 400;
            return res.status(code).json({ ok: false, errors: { form: result.error } });
        }
        return res.status(201).json({ ok: true, media: result.media });
    } finally {
        activeTranscodes--;
    }
});

// 配信（パストラバーサル対策は mediaStore.resolve 側）
router.get("/:file", (req, res) => {
    const p = mediaStore.resolve(req.params.file);
    if (!p) {
        return res.status(404).json({ ok: false, errors: { form: "見つかりません。" } });
    }
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    return res.sendFile(p);
});

module.exports = router;
