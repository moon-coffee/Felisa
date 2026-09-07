/* ブックマーク一覧 /bookmarks */

const listEl = document.getElementById("bm-list");
const statusEl = document.getElementById("bm-status");

async function load() {
    const res = await SNS.api("GET", "/api/me/bookmarks");
    if (res.status === 401) {
        location.replace("/login");
        return;
    }
    listEl.innerHTML = "";
    const entries = (res.data && res.data.entries) || [];
    if (entries.length === 0) {
        statusEl.textContent = "ブックマークしたポストはまだありません。";
        return;
    }
    statusEl.textContent = "";
    for (const e of entries) listEl.appendChild(SNS.renderEntry(e));
}

SNS.wire(document.querySelector(".feed"));
SNS.mountShell("bookmarks");
load();
