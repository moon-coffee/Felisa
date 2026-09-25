/* ブックマーク一覧 /bookmarks */

const listEl = document.getElementById("bm-list");
const statusEl = document.getElementById("bm-status");

async function load() {
    listEl.innerHTML = '<div class="feed-end">読み込み中…</div>';
    statusEl.textContent = "";
    const res = await SNS.api("GET", "/api/me/bookmarks");
    if (res.status === 401) {
        location.replace("/login");
        return;
    }
    listEl.innerHTML = "";
    if (!res.data || !res.data.ok) {
        statusEl.textContent = SNS.failMessage(res.data, "ブックマークを読み込めませんでした。");
        return;
    }
    const entries = res.data.entries || [];
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
