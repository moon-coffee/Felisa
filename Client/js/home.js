/* ホーム: タイムライン + 新着ポスト通知 + 投稿ボックス */

let feed = "recommended";
let newestSortAt = 0;
let stash = [];

const listEl = document.getElementById("feed-list");
const statusEl = document.getElementById("feed-status");
const newBtn = document.getElementById("new-posts");

function alreadyShown(id) {
    return !!listEl.querySelector('[data-id="' + CSS.escape(id) + '"]');
}

async function loadFeed() {
    listEl.innerHTML = "";
    statusEl.textContent = "読み込み中…";
    stash = [];
    newBtn.hidden = true;

    const res = await SNS.api("GET", "/api/posts?feed=" + feed);
    if (res.status === 401) {
        statusEl.textContent = "「フォロー中」を表示するにはログインしてください。";
        return;
    }
    if (!res.data.ok) {
        statusEl.textContent = "読み込みに失敗しました。";
        return;
    }
    const entries = res.data.entries || [];
    newestSortAt = entries.length ? entries[0].sortAt : Date.now();
    if (entries.length === 0) {
        statusEl.textContent =
            feed === "following"
                ? "フォローしたユーザーの投稿がここに表示されます。"
                : "まだ投稿がありません。最初のポストをどうぞ。";
        return;
    }
    statusEl.textContent = "";
    for (const entry of entries) listEl.appendChild(SNS.renderEntry(entry));
}

async function pollNew() {
    const res = await SNS.api(
        "GET",
        "/api/posts?feed=" + feed + "&since=" + newestSortAt
    );
    if (!res.data || !res.data.ok) return;
    const fresh = (res.data.entries || []).filter(
        (e) => !alreadyShown(e.post.id)
    );
    if (fresh.length === 0) return;
    stash = fresh; // newest-first
    newBtn.textContent = "新しいポストを" + fresh.length + "件表示";
    newBtn.hidden = false;
}

newBtn.addEventListener("click", () => {
    for (let i = stash.length - 1; i >= 0; i--) {
        listEl.prepend(SNS.renderEntry(stash[i]));
    }
    if (stash.length) newestSortAt = stash[0].sortAt;
    stash = [];
    newBtn.hidden = true;
    statusEl.textContent = "";
    window.scrollTo({ top: 0, behavior: "smooth" });
});

document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
        if (tab.classList.contains("active")) return;
        document
            .querySelectorAll(".tab")
            .forEach((t) => t.classList.toggle("active", t === tab));
        feed = tab.dataset.feed;
        loadFeed();
    });
});

SNS.wire(document.querySelector(".feed"));
SNS.mountShell("home");
SNS.setupComposer(document.getElementById("composer"), (post) => {
    listEl.prepend(SNS.renderEntry({ kind: "post", post }));
    newestSortAt = Math.max(newestSortAt, post.createdAt);
    statusEl.textContent = "";
});

loadFeed();
setInterval(pollNew, 60 * 1000);
