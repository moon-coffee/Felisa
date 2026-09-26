/* 通知一覧 /notifications */

const listEl = document.getElementById("notif-list");
const statusEl = document.getElementById("notif-status");
const unreadEl = document.getElementById("notif-unread");
const readAllBtn = document.getElementById("notif-read-all");

const LABEL = {
    like: "さんがあなたのポストをいいねしました",
    repost: "さんがあなたのポストをリポストしました",
    reply: "さんがあなたのポストに返信しました",
    follow: "さんがあなたをフォローしました",
    moderation: "さんからモデレーション通知があります",
};
const ICON = {
    like: "fa-solid fa-heart notif-icon--like",
    repost: "fa-solid fa-retweet notif-icon--repost",
    reply: "fa-solid fa-comment notif-icon--reply",
    follow: "fa-solid fa-user-plus notif-icon--follow",
    moderation: "fa-solid fa-shield-halved notif-icon--moderation",
};

let filter = "all";
let unreadCount = 0;

function updateUnreadUi() {
    if (unreadCount > 0) {
        unreadEl.hidden = false;
        unreadEl.textContent = "未読 " + unreadCount + "件";
    } else {
        unreadEl.hidden = true;
    }
    readAllBtn.disabled = unreadCount === 0;
    SNS.setBadge(unreadCount);
}

// 1件だけ既読にする（ページ遷移前でも送り切れるよう keepalive）
async function markRead(id) {
    const res = await SNS.api("POST", "/api/notifications/read", { id }, { keepalive: true });
    if (res.data && res.data.ok) {
        if (typeof res.data.unreadCount === "number") unreadCount = res.data.unreadCount;
        updateUnreadUi();
    }
}

function renderNotif(n) {
    const a = document.createElement("a");
    a.className = "notif" + (n.read ? "" : " notif--unread");
    if (n.type === "follow") a.href = "/" + encodeURIComponent(n.actor.userId);
    else if (n.post) a.href = "/status/" + encodeURIComponent(n.post.id);
    else a.href = "#";
    if (!n.read) {
        // 未読の通知を開いたらその1件だけ既読にする（遷移は止めない）
        a.addEventListener("click", () => markRead(n.id));
    }

    const icon = document.createElement("div");
    icon.className = "notif-icon";
    icon.innerHTML = '<i class="' + (ICON[n.type] || "fa-solid fa-bell") + '" aria-hidden="true"></i>';

    const body = document.createElement("div");
    body.className = "notif-body";
    const line = document.createElement("div");
    line.className = "notif-line";
    if (n.detail) {
        // 規約違反の警告など、種別ラベルで表せない文言（発行者は運営／自動モデレーション）
        line.textContent = n.detail;
    } else {
        const strong = document.createElement("b");
        strong.textContent = n.actor.name;
        line.appendChild(strong);
        if (n.actor.isAdmin) line.appendChild(SNS.adminBadge());
        line.appendChild(document.createTextNode(" " + (LABEL[n.type] || "")));
    }
    body.appendChild(line);
    if (n.post && n.post.text) {
        const snip = document.createElement("div");
        snip.className = "notif-snippet";
        snip.textContent = n.post.text;
        body.appendChild(snip);
    }
    const time = document.createElement("div");
    time.className = "notif-time";
    time.textContent = SNS.relativeTime(n.createdAt) + (n.read ? "" : " · 未読");
    body.appendChild(time);

    a.append(icon, body);
    return a;
}

async function load() {
    listEl.innerHTML = '<div class="feed-end">読み込み中…</div>';
    statusEl.textContent = "";
    const res = await SNS.api("GET", "/api/notifications?filter=" + encodeURIComponent(filter));
    if (res.status === 401) {
        location.replace("/login");
        return;
    }
    listEl.innerHTML = "";
    if (!res.data || !res.data.ok) {
        statusEl.textContent = SNS.failMessage(res.data, "通知を読み込めませんでした。");
        return;
    }
    const items = res.data.notifications || [];
    unreadCount = typeof res.data.unreadCount === "number" ? res.data.unreadCount : 0;
    updateUnreadUi();

    if (items.length === 0) {
        statusEl.textContent =
            filter === "all" ? "通知はまだありません。" : "この種類の通知はありません。";
        return;
    }
    for (const n of items) listEl.appendChild(renderNotif(n));
}

/* ---- 種別フィルタ ---- */
document.querySelectorAll("[data-filter]").forEach((tab) => {
    tab.addEventListener("click", () => {
        filter = tab.dataset.filter;
        document.querySelectorAll("[data-filter]").forEach((t) => {
            const on = t === tab;
            t.classList.toggle("active", on);
            t.setAttribute("aria-selected", on ? "true" : "false");
        });
        load();
    });
});

/* ---- すべて既読 ---- */
readAllBtn.addEventListener("click", async () => {
    readAllBtn.disabled = true;
    const res = await SNS.api("POST", "/api/notifications/read", {});
    if (res.data && res.data.ok) {
        unreadCount = typeof res.data.unreadCount === "number" ? res.data.unreadCount : 0;
        updateUnreadUi();
        listEl.querySelectorAll(".notif--unread").forEach((el) => el.classList.remove("notif--unread"));
        listEl.querySelectorAll(".notif-time").forEach((el) => {
            el.textContent = el.textContent.replace(" · 未読", "");
        });
        SNS.notify("すべての通知を既読にしました");
    } else {
        readAllBtn.disabled = false;
        SNS.notify(SNS.failMessage(res.data, "既読にできませんでした"), "error");
    }
});

SNS.mountShell("notifications");
load();
