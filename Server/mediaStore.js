const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync, spawn } = require("child_process");
const pngUtil = require("./pngUtil");
const { writeFileAtomic } = require("./jsonStore");

const DATA_DIR = path.join(__dirname, "data");
const MEDIA_DIR = path.join(DATA_DIR, "media");
// アップロード元（誰がどのファイルをいつ作ったか）の記録。
// 投稿への添付時に本人確認に使い、他人のアップロードを勝手に自分の投稿へ
// 紐付けたり、未投稿ファイルを消させたりしないようにする。
const INDEX_FILE = path.join(DATA_DIR, "mediaIndex.json");

const IMAGE_MAX_BYTES = 8 * 1024 * 1024; // 8MB（クライアントで PNG 化済み・可逆なので大きめ）
const VIDEO_MAX_BYTES = 80 * 1024 * 1024;
const VIDEO_MAX_SECONDS = 140;
const TRANSCODE_TIMEOUT_MS = 180 * 1000;
const INDEX_MAX = 50000; // 索引の上限（異常な肥大化の防止）

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

function readIndex() {
    try {
        const parsed = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function writeIndex(index) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const keys = Object.keys(index);
    if (keys.length > INDEX_MAX) {
        // 古いエントリから捨てる（uploadedAt の昇順）
        keys
            .sort((a, b) => (index[a].uploadedAt || 0) - (index[b].uploadedAt || 0))
            .slice(0, keys.length - INDEX_MAX)
            .forEach((k) => delete index[k]);
    }
    writeFileAtomic(INDEX_FILE, JSON.stringify(index));
}

function recordUpload(id, uploader, type) {
    const index = readIndex();
    index[id] = {
        uploader: String(uploader || ""),
        uploadedAt: Date.now(),
        type: type || (id.endsWith(".mp4") ? "video" : "image"),
    };
    writeIndex(index);
}

function forgetIds(ids) {
    const index = readIndex();
    let changed = false;
    for (const id of ids) {
        if (index[id]) {
            delete index[id];
            changed = true;
        }
    }
    if (changed) writeIndex(index);
}

// 添付してよいか（アップロード本人、または索引に無い旧データ）
function belongsTo(id, userId) {
    const entry = readIndex()[id];
    if (!entry || !entry.uploader) return true;
    return entry.uploader.toLowerCase() === String(userId || "").toLowerCase();
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
function saveImagePng(buf, uploader) {
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
        return { error: "画像データが空です。" };
    }
    if (buf.length > IMAGE_MAX_BYTES) {
        return { error: "画像サイズが大きすぎます（8MB まで）。" };
    }
    const info = pngUtil.inspect(buf);
    if (!info) {
        return { error: "PNG 画像として認識できませんでした。" };
    }
    ensureDir();
    const id = crypto.randomUUID() + ".png";
    fs.writeFileSync(path.join(MEDIA_DIR, id), buf);
    recordUpload(id, uploader, "image");
    return { media: { type: "image", id, width: info.width, height: info.height } };
}

// コンテナのマジックバイト検証（MP4/MOV 系の ftyp、WebM/Matroska の EBML のみ許可）。
// ffmpeg は HLS/concat プレイリスト等も自動判別し、ローカルファイル読み出しや外部通信に
// 悪用され得るため、想定外の形式は変換前に拒否する。
function looksLikeVideo(buf) {
    if (buf.length < 12) return false;
    if (buf.toString("latin1", 4, 8) === "ftyp") return true;
    return buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
}

// 動画を MP4 / 480p 上限 / メタデータ削除で再エンコードして保存
function saveVideo(buf, uploader) {
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

        if (!looksLikeVideo(buf)) {
            return resolvePromise({ error: "対応していない動画形式です。" });
        }

        ensureDir();
        const inPath = path.join(
            os.tmpdir(),
            "up_" + crypto.randomBytes(8).toString("hex")
        );
        const id = crypto.randomUUID() + ".mp4";
        const outPath = path.join(MEDIA_DIR, id);
        fs.writeFileSync(inPath, buf, { mode: 0o600 });

        const args = [
            "-y",
            "-nostdin",
            "-protocol_whitelist",
            "file", // 入力ファイル以外（http/tcp 等）への参照を禁止
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
                recordUpload(id, uploader, "video");
                resolvePromise({ media: { type: "video", id } });
            } else {
                fs.rmSync(outPath, { force: true });
                resolvePromise({ error: "動画の変換に失敗しました。" });
            }
        });
    });
}

function removeFiles(ids) {
    const valid = [];
    for (const id of ids) {
        if (NAME_RE.test(id)) {
            fs.rmSync(path.join(MEDIA_DIR, id), { force: true });
            valid.push(id);
        }
    }
    if (valid.length) forgetIds(valid);
}

// 投稿から参照されていない古いメディアを削除する（ディスク枯渇対策）。
// 「アップロードだけして投稿しない」を繰り返されると、レート制限を守っていても
// ファイルが無限に増えるため。
// 参照元の posts.json は直接パースし、読み込み/パースに失敗したら何もしない
// （壊れていると全ファイルを「未参照」と誤判定して消してしまうため）。
const POSTS_FILE = path.join(DATA_DIR, "posts.json");
const ORPHAN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7日（長めに残して誤削除を防ぐ）

function sweepOrphans(maxAgeMs = ORPHAN_MAX_AGE_MS) {
    const result = { scanned: 0, removed: 0 };
    let posts;
    try {
        posts = JSON.parse(fs.readFileSync(POSTS_FILE, "utf8"));
    } catch {
        return result;
    }
    if (!Array.isArray(posts)) return result;

    const used = new Set();
    for (const p of posts) {
        if (!p || !Array.isArray(p.media)) continue;
        for (const m of p.media) if (m && typeof m.id === "string") used.add(m.id);
    }

    let names;
    try {
        names = fs.readdirSync(MEDIA_DIR);
    } catch {
        return result;
    }
    const cutoff = Date.now() - maxAgeMs;
    for (const name of names) {
        if (!NAME_RE.test(name) || used.has(name)) continue;
        const file = path.join(MEDIA_DIR, name);
        try {
            const st = fs.statSync(file);
            if (st.mtimeMs >= cutoff) continue;
            fs.rmSync(file, { force: true });
            forgetIds([name]);
            result.removed += 1;
        } catch {
            // 他のプロセスが触っている等は無視
        }
    }
    return result;
}

module.exports = {
    HAS_FFMPEG,
    IMAGE_MAX_BYTES,
    VIDEO_MAX_BYTES,
    exists,
    resolve,
    belongsTo,
    saveImagePng,
    saveVideo,
    removeFiles,
    sweepOrphans,
};
