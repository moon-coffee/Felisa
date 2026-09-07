/* 検索 /search?q=... （キーワード または #タグ） */

const query = (new URLSearchParams(window.location.search).get("q") || "").trim();
const input = document.getElementById("search-input");
const listEl = document.getElementById("search-list");
const statusEl = document.getElementById("search-status");
if (input) input.value = query;

async function showTrends() {
    const res = await SNS.api("GET", "/api/trends");
    const list = (res.data && res.data.trends) || [];
    if (!list.length) {
        statusEl.textContent = "キーワード、または #タグ で検索できます。";
        return;
    }
    statusEl.textContent = "";
    const card = document.createElement("section");
    card.className = "card";
    const h = document.createElement("h2");
    h.textContent = "いま起きていること";
    card.appendChild(h);
    list.forEach((t, i) => card.appendChild(SNS.trendLink(t, i)));
    listEl.appendChild(card);
}

async function run() {
    if (!query) {
        showTrends();
        return;
    }
    document.title = "「" + query + "」の検索結果";
    statusEl.textContent = "検索中…";
    const res = await SNS.api("GET", "/api/search?q=" + encodeURIComponent(query));
    listEl.innerHTML = "";
    const posts = (res.data && res.data.posts) || [];
    if (!res.data || !res.data.ok || posts.length === 0) {
        statusEl.textContent = "「" + query + "」に一致する投稿はありません。";
        return;
    }
    statusEl.textContent =
        res.data.kind === "tag" ? "#" + query.replace(/^#/, "") + " の投稿" : "";
    for (const post of posts) listEl.appendChild(SNS.renderEntry({ kind: "post", post }));
}

SNS.wire(document.querySelector(".feed"));
SNS.mountShell("search");
run();
