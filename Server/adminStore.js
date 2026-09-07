// data/admin.json に列挙された UserID のアカウントに「Admin」ラベルを付ける。
// ファイルは手動で編集する想定。毎回読み直す（頻度は低い）。
const fs = require("fs");
const path = require("path");
const { writeFileAtomic } = require("./jsonStore");

const FILE = path.join(__dirname, "data", "admin.json");
const BOM = /^﻿/;

function readIds() {
    try {
        const raw = fs.readFileSync(FILE, "utf8").replace(BOM, ""); // Windows のエディタ対策
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed)
            ? parsed.filter((x) => typeof x === "string").map((x) => x.toLowerCase())
            : [];
    } catch {
        return [];
    }
}

function has(userId) {
    if (!userId) return false;
    return readIds().includes(String(userId).toLowerCase());
}

// ユーザー名変更に追従
function rename(oldId, newId) {
    let ids;
    try {
        ids = JSON.parse(fs.readFileSync(FILE, "utf8").replace(BOM, ""));
    } catch {
        return;
    }
    if (!Array.isArray(ids)) return;
    let changed = false;
    const next = ids.map((x) => {
        if (typeof x === "string" && x.toLowerCase() === String(oldId).toLowerCase()) {
            changed = true;
            return newId;
        }
        return x;
    });
    if (changed) writeFileAtomic(FILE, JSON.stringify(next, null, 2) + "\n");
}

module.exports = { has, rename };
