/* 検索 /search?q=... （キーワード または #タグ） */

const query = (new URLSearchParams(window.location.search).get("q") || "").trim();
const input = document.getElementById("search-input");
const listEl = document.getElementById("search-list");
const statusEl = document.getElementById("search-status");
const tabsEl = document.getElementById("search-tabs");
if (input) input.value = query;

let kind = "posts"; // posts | users
let result = { posts: [], users: [] };

async function showTrends() {
    listEl.innerHTML = '<div class="feed-end">読み込み中…</div>';
    const res = await SNS.api("GET", "/api/trends");
    const list = (res.data && res.data.trends) || [];
    if (!list.length) {
        listEl.innerHTML = "";
        statusEl.textContent = "キーワード、または #タグ で検索できます。";
        return;
    }
    statusEl.textContent = "";
    listEl.innerHTML = "";
    const card = document.createElement("section");
    card.className = "card";
    const h = document.createElement("h2");
    h.textContent = "いま起きていること";
    card.appendChild(h);
    list.forEach((t, i) => card.appendChild(SNS.trendLink(t, i)));
    listEl.appendChild(card);
}

/* ---- ユーザー結果 ---- */
function followButton(u) {
    const b = document.createElement("button");
    b.type = "button";
    const apply = (on) => {
        b.className =
            "follow-btn" + (on ? " btn-outline follow-toggle" : " btn-solid");
        b.textContent = on ? "フォロー中" : "フォロー";
        b.setAttribute("aria-pressed", on ? "true" : "false");
        b.setAttribute("aria-label", (on ? "フォロー中（解除）: " : "フォロー: ") + u.name);
    };
    apply(!!u.followedByMe);
    b.addEventListener("click", async () => {
        const on = b.getAttribute("aria-pressed") === "true";
        b.disabled = true;
        const res = await SNS.api(
            on ? "DELETE" : "POST",
            "/api/users/" + encodeURIComponent(u.userId) + "/follow"
        );
        b.disabled = false;
        if (res.status === 401) return (location.href = "/login");
        if (res.data && res.data.ok) {
            apply(!!res.data.following);
            SNS.notify(res.data.following ? "フォローしました" : "フォローを解除しました");
        } else {
            SNS.notify(SNS.failMessage(res.data, "フォロー状態を更新できませんでした"), "error");
        }
    });
    return b;
}

function userRow(u) {
    const row = document.createElement("div");
    row.className = "who";

    const link = document.createElement("a");
    link.className = "who-link";
    link.href = "/" + encodeURIComponent(u.userId);

    const av = document.createElement("span");
    av.className = "avatar";
    const img = document.createElement("img");
    img.src = u.avatar;
    img.alt = "";
    img.decoding = "async";
    av.appendChild(img);

    const meta = document.createElement("span");
    meta.className = "who-meta";
    const name = document.createElement("span");
    name.className = "who-name";
    name.textContent = u.name;
    if (u.isAdmin) name.appendChild(SNS.adminBadge());
    const handle = document.createElement("span");
    handle.className = "who-handle";
    handle.textContent = u.handle;
    meta.appendChild(name);
    meta.appendChild(handle);
    if (u.bio) {
        const bio = document.createElement("span");
        bio.className = "who-handle";
        bio.textContent = u.bio;
        meta.appendChild(bio);
    }

    link.append(av, meta);
    row.appendChild(link);
    if (!u.isMe) row.appendChild(followButton(u));
    return row;
}

function render() {
    listEl.innerHTML = "";
    if (kind === "users") {
        if (!result.users.length) {
            statusEl.textContent = "「" + query + "」に一致するユーザーはいません。";
            return;
        }
        statusEl.textContent = "";
        const card = document.createElement("section");
        card.className = "card";
        const h = document.createElement("h2");
        h.textContent = "ユーザー";
        card.appendChild(h);
        result.users.forEach((u) => card.appendChild(userRow(u)));
        listEl.appendChild(card);
        return;
    }

    if (!result.posts.length) {
        statusEl.textContent = "「" + query + "」に一致する投稿はありません。";
        return;
    }
    statusEl.textContent = "";
    for (const post of result.posts)
        listEl.appendChild(SNS.renderEntry({ kind: "post", post }));
}

async function run() {
    if (!query) {
        showTrends();
        return;
    }
    document.title = "「" + query + "」の検索結果";
    listEl.innerHTML = '<div class="feed-end">検索中…</div>';
    const res = await SNS.api("GET", "/api/search?q=" + encodeURIComponent(query));
    if (!res.data || !res.data.ok) {
        listEl.innerHTML = "";
        statusEl.textContent = SNS.failMessage(res.data, "検索に失敗しました。");
        return;
    }
    result = {
        posts: res.data.posts || [],
        users: res.data.users || [],
    };
    tabsEl.hidden = false;
    const hasUsers = result.users.length > 0;
    document.querySelector('[data-kind="users"]').hidden = !hasUsers;
    if (!hasUsers && kind === "users") kind = "posts";
    syncTabs();
    render();
}

function syncTabs() {
    document.querySelectorAll("[data-kind]").forEach((t) => {
        const on = t.dataset.kind === kind;
        t.classList.toggle("active", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
    });
}

document.querySelectorAll("[data-kind]").forEach((tab) => {
    tab.addEventListener("click", () => {
        kind = tab.dataset.kind;
        syncTabs();
        render();
    });
});

SNS.wire(document.querySelector(".feed"));
SNS.mountShell("search");
run();
