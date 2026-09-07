const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync, spawn } = require("child_process");
const pngUtil = require("./pngUtil");

const DATA_DIR = path.join(__dirname, "data");
const MEDIA_DIR = path.join(DATA_DIR, "media");

const IMAGE_MAX_BYTES = 8 * 1024 * 1024; // 8MB（クライアントで PNG 化済み・可逆なので大きめ）
const VIDEO_MAX_BYTES = 80 * 1024 * 1024;
const VIDEO_MAX_SECONDS = 140;
const TRANSCODE_TIMEOUT_MS = 180 * 1000;

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

// 起動時に一度だけ ffmpeg の有無を確認
const HAS_FFMPEG = (() => {
    try {
        const r = spawnSync(FFMPEG, ["-version"], { timeout: 5000 });
        return r.status === 0;
    } catch {
        return false;
    }
})();

function ensureDir() {
    if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

const NAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|mp4)$/;

function exists(id) {
    return NAME_RE.test(id) && fs.existsSync(path.join(MEDIA_DIR, id));
}

// パストラバーサル防止つきで実ファイルパスを返す
function resolve(id) {
    if (!NAME_RE.test(id)) return null;
    const p = path.join(MEDIA_DIR, id);
    if (path.dirname(p) !== MEDIA_DIR || !fs.existsSync(p)) return null;
    return p;
}

// クライアントが canvas で再エンコードした PNG を検証して保存
function saveImagePng(buf) {
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
        return { error: "画像データが空です。" };
    }
    if (buf.length > IMAGE_MAX_BYTES) {
        return { error: "画像サイズが大きすぎます（3MB まで）。" };
    }
    const info = pngUtil.inspect(buf);
    if (!info) {
        return { error: "PNG 画像として認識できませんでした。" };
    }
    ensureDir();
    const id = crypto.randomUUID() + ".png";
    fs.writeFileSync(path.join(MEDIA_DIR, id), buf);
    return { media: { type: "image", id, width: info.width, height: info.height } };
}

// 動画を MP4 / 480p 上限 / メタデータ削除で再エンコードして保存
function saveVideo(buf) {
    return new Promise((resolvePromise) => {
        if (!HAS_FFMPEG) {
            return resolvePromise({
                error: "動画のアップロードは現在利用できません。",
                code: "no_ffmpeg",
            });
        }
        if (!Buffer.isBuffer(buf) || buf.length === 0) {
            return resolvePromise({ error: "動画データが空です。" });
        }
        if (buf.length > VIDEO_MAX_BYTES) {
            return resolvePromise({ error: "動画サイズが大きすぎます（80MB まで）。" });
        }

        ensureDir();
        const inPath = path.join(
            os.tmpdir(),
            "up_" + crypto.randomBytes(8).toString("hex")
        );
        const id = crypto.randomUUID() + ".mp4";
        const outPath = path.join(MEDIA_DIR, id);
        fs.writeFileSync(inPath, buf);

        const args = [
            "-y",
            "-i",
            inPath,
            "-t",
            String(VIDEO_MAX_SECONDS),
            "-vf",
            "scale=-2:'min(480,ih)'",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "28",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-map_metadata",
            "-1", // すべてのメタデータを削除
            "-movflags",
            "+faststart",
            outPath,
        ];

        const proc = spawn(FFMPEG, args, { stdio: "ignore" });
        const timer = setTimeout(() => proc.kill("SIGKILL"), TRANSCODE_TIMEOUT_MS);

        proc.on("error", () => {
            clearTimeout(timer);
            fs.rmSync(inPath, { force: true });
            resolvePromise({ error: "動画の変換に失敗しました。" });
        });
        proc.on("close", (code) => {
            clearTimeout(timer);
            fs.rmSync(inPath, { force: true });
            if (code === 0 && fs.existsSync(outPath)) {
                resolvePromise({ media: { type: "video", id } });
            } else {
                fs.rmSync(outPath, { force: true });
                resolvePromise({ error: "動画の変換に失敗しました。" });
            }
        });
    });
}

function removeFiles(ids) {
    for (const id of ids) {
        if (NAME_RE.test(id)) {
            fs.rmSync(path.join(MEDIA_DIR, id), { force: true });
        }
    }
}

module.exports = {
    HAS_FFMPEG,
    IMAGE_MAX_BYTES,
    VIDEO_MAX_BYTES,
    exists,
    resolve,
    saveImagePng,
    saveVideo,
    removeFiles,
};
