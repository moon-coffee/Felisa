// 初期アイコンを生成・保存する。
// 出力は必ず 256x256 の PNG（RGBA / 8bit）。
// eXIf / tEXt / tIME などの付随チャンクは一切書き込まないため、生成物にメタデータ（Exif 相当）は含まれない。
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "data");
const AVATAR_DIR = path.join(DATA_DIR, "avatars");
const HEADER_DIR = path.join(DATA_DIR, "headers");

const SIZE = 256; // 出力サイズ（px）
const GRID = 8; // ロジカルセル数（左右対称に描画）
const CELL = SIZE / GRID;

// ---- CRC32（PNG チャンク用）----
const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
    const typeBuf = Buffer.from(type, "ascii");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(rgba, width, height) {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // color type: truecolor + alpha
    ihdr[10] = 0; // compression
    ihdr[11] = 0; // filter
    ihdr[12] = 0; // interlace

    // 各スキャンラインの先頭にフィルタバイト(0)を付与
    const stride = width * 4;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (stride + 1)] = 0;
        rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
    }
    const idat = zlib.deflateSync(raw, { level: 9 });

    return Buffer.concat([
        signature,
        pngChunk("IHDR", ihdr),
        pngChunk("IDAT", idat),
        pngChunk("IEND", Buffer.alloc(0)),
    ]);
}

function hslToRgb(h, s, l) {
    const k = (n) => (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) =>
        Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
    return [f(0), f(8), f(4)];
}

function paintCell(rgba, gx, gy, [r, g, b]) {
    const x0 = gx * CELL;
    const y0 = gy * CELL;
    for (let y = y0; y < y0 + CELL; y++) {
        for (let x = x0; x < x0 + CELL; x++) {
            const i = (y * SIZE + x) * 4;
            rgba[i] = r;
            rgba[i + 1] = g;
            rgba[i + 2] = b;
            rgba[i + 3] = 255;
        }
    }
}

// seed から決定的に identicon 風の 256x256 PNG を生成
function generate(seed) {
    const hash = crypto.createHash("sha256").update(String(seed)).digest();
    const hue = hash[0] / 255;

    const fg = hslToRgb(hue, 0.5, 0.62); // 前景（アクセント寄り）
    const bg = hslToRgb(hue, 0.18, 0.16); // 背景（既存 UI に合わせた暗色）

    const rgba = Buffer.alloc(SIZE * SIZE * 4);
    for (let i = 0; i < SIZE * SIZE; i++) {
        rgba[i * 4] = bg[0];
        rgba[i * 4 + 1] = bg[1];
        rgba[i * 4 + 2] = bg[2];
        rgba[i * 4 + 3] = 255;
    }

    const half = GRID / 2;
    for (let gy = 0; gy < GRID; gy++) {
        for (let gx = 0; gx < half; gx++) {
            const bit = hash[(gy * half + gx) % hash.length] & 1;
            if (!bit) {
                continue;
            }
            paintCell(rgba, gx, gy, fg);
            paintCell(rgba, GRID - 1 - gx, gy, fg); // 左右対称
        }
    }

    return encodePng(rgba, SIZE, SIZE);
}

function fileFor(userId) {
    // userId をそのままファイル名にしない（パストラバーサル対策）
    const safe = crypto
        .createHash("sha1")
        .update(String(userId).toLowerCase())
        .digest("hex");
    return path.join(AVATAR_DIR, `${safe}.png`);
}

function ensureDir() {
    if (!fs.existsSync(AVATAR_DIR)) {
        fs.mkdirSync(AVATAR_DIR, { recursive: true });
    }
}

// 登録時に呼ぶ: 初期アイコンを生成してディスクに保存
function createForUser(userId) {
    ensureDir();
    const file = fileFor(userId);
    fs.writeFileSync(file, generate(userId));
    return file;
}

// 保存済みなら読み出し、無ければ生成して保存
function getForUser(userId) {
    const file = fileFor(userId);
    if (!fs.existsSync(file)) {
        return createForUser(userId);
    }
    return file;
}

function safeName(userId) {
    return crypto
        .createHash("sha1")
        .update(String(userId).toLowerCase())
        .digest("hex");
}

function headerFileFor(userId) {
    return path.join(HEADER_DIR, `${safeName(userId)}.png`);
}

// 検証済みの PNG バッファでアイコンを差し替える
function saveAvatar(userId, pngBuffer) {
    ensureDir();
    fs.writeFileSync(fileFor(userId), pngBuffer);
    return fileFor(userId);
}

function saveHeader(userId, pngBuffer) {
    if (!fs.existsSync(HEADER_DIR)) fs.mkdirSync(HEADER_DIR, { recursive: true });
    fs.writeFileSync(headerFileFor(userId), pngBuffer);
    return headerFileFor(userId);
}

function getHeader(userId) {
    const file = headerFileFor(userId);
    return fs.existsSync(file) ? file : null;
}

function removeForUser(userId) {
    fs.rmSync(fileFor(userId), { force: true });
    fs.rmSync(headerFileFor(userId), { force: true });
}

// ユーザー名変更時にファイル名（sha1 ベース）を付け替える
function renameUser(oldId, newId) {
    for (const [oldP, newP] of [
        [fileFor(oldId), fileFor(newId)],
        [headerFileFor(oldId), headerFileFor(newId)],
    ]) {
        if (oldP !== newP && fs.existsSync(oldP)) {
            fs.renameSync(oldP, newP);
        }
    }
}

module.exports = {
    createForUser,
    getForUser,
    saveAvatar,
    saveHeader,
    getHeader,
    removeForUser,
    renameUser,
    generate,
    SIZE,
};
