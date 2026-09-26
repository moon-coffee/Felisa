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

// 1件の描画失敗でタイムライン全体が消えないようにする。
// renderEntry が例外を投げると loadFeed のループが止まり、
// 「サーバーには存在するのに画面に一切出ない」状態になるため、
// 失敗した1件だけを落としてコンソールに残す。
function renderSafely(entry) {
    try {
        return SNS.renderEntry(entry);
    } catch (e) {
        console.error("ポストの描画に失敗しました", entry, e);
        return null;
    }
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
        statusEl.textContent = SNS.failMessage(res.data, "読み込みに失敗しました。");
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
    for (const entry of entries) {
        const el = renderSafely(entry);
        if (el) listEl.appendChild(el);
    }
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
    // 先に状態を更新してから描画する（描画が失敗しても
    // ボタンが残り続けて押しても反応しない、という現象を防ぐ）
    const shown = stash;
    stash = [];
    if (shown.length) newestSortAt = shown[0].sortAt;
    newBtn.hidden = true;
    statusEl.textContent = "";
    for (let i = shown.length - 1; i >= 0; i--) {
        const el = renderSafely(shown[i]);
        if (el) listEl.prepend(el);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
});

document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
        if (tab.classList.contains("active")) return;
        document.querySelectorAll(".tab").forEach((t) => {
            const on = t === tab;
            t.classList.toggle("active", on);
            t.setAttribute("aria-selected", on ? "true" : "false");
        });
        feed = tab.dataset.feed;
        loadFeed();
    });
});

// 通知バッジを最新に保つ（60秒ごと）
async function refreshBadge() {
    const res = await SNS.api("GET", "/api/me");
    if (res.data && res.data.ok) SNS.setBadge(res.data.unreadNotifications || 0);
}

SNS.wire(document.querySelector(".feed"));
SNS.mountShell("home");
SNS.setupComposer(document.getElementById("composer"), (post) => {
    newestSortAt = Math.max(newestSortAt, (post && post.createdAt) || 0);
    statusEl.textContent = "";
    const el = renderSafely({ kind: "post", post });
    if (el) listEl.prepend(el);
});

loadFeed();
setInterval(() => {
    pollNew();
    refreshBadge();
}, 60 * 1000);
