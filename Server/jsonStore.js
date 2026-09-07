// JSON 配列ファイルの読み書き共通処理。
// 書き込みは一時ファイル + rename（同一ファイルシステム上で原子的）にし、
// プロセスクラッシュや複数プロセス配置時の同時書き込みによるファイル破損を防ぐ。
const fs = require("fs");
const path = require("path");

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeFileAtomic(file, content) {
    ensureDir(path.dirname(file));
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, content, "utf8");
    fs.renameSync(tmp, file);
}

function readArray(file) {
    ensureDir(path.dirname(file));
    if (!fs.existsSync(file)) return [];
    try {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function writeArray(file, rows) {
    writeFileAtomic(file, JSON.stringify(rows, null, 2));
}

module.exports = { ensureDir, readArray, writeArray, writeFileAtomic };
