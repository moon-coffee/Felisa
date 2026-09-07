/* 通知一覧 /notifications */

const listEl = document.getElementById("notif-list");
const statusEl = document.getElementById("notif-status");

const LABEL = {
    like: "さんがあなたのポストをいいねしました",
    repost: "さんがあなたのポストをリポストしました",
    reply: "さんがあなたのポストに返信しました",
    follow: "さんがあなたをフォローしました",
};
const ICON = {
    like: "fa-solid fa-heart notif-icon--like",
    repost: "fa-solid fa-retweet notif-icon--repost",
    reply: "fa-solid fa-comment notif-icon--reply",
    follow: "fa-solid fa-user-plus notif-icon--follow",
};

function renderNotif(n) {
    const a = document.createElement("a");
    a.className = "notif" + (n.read ? "" : " notif--unread");
    if (n.type === "follow") a.href = "/" + encodeURIComponent(n.actor.userId);
    else if (n.post) a.href = "/status/" + encodeURIComponent(n.post.id);
    else a.href = "#";

    const icon = document.createElement("div");
    icon.className = "notif-icon";
    icon.innerHTML = '<i class="' + (ICON[n.type] || "fa-solid fa-bell") + '"></i>';

    const body = document.createElement("div");
    body.className = "notif-body";
    const line = document.createElement("div");
    line.className = "notif-line";
    const strong = document.createElement("b");
    strong.textContent = n.actor.name;
    line.appendChild(strong);
    if (n.actor.isAdmin) line.appendChild(SNS.adminBadge());
    line.appendChild(document.createTextNode(" " + (LABEL[n.type] || "")));
    body.appendChild(line);
    if (n.post && n.post.text) {
        const snip = document.createElement("div");
        snip.className = "notif-snippet";
        snip.textContent = n.post.text;
        body.appendChild(snip);
    }
    const time = document.createElement("div");
    time.className = "notif-time";
    time.textContent = SNS.relativeTime(n.createdAt);
    body.appendChild(time);

    a.append(icon, body);
    return a;
}

async function load() {
    const res = await SNS.api("GET", "/api/notifications");
    if (res.status === 401) {
        location.replace("/login");
        return;
    }
    listEl.innerHTML = "";
    const items = (res.data && res.data.notifications) || [];
    if (items.length === 0) {
        statusEl.textContent = "通知はまだありません。";
    } else {
        statusEl.textContent = "";
        for (const n of items) listEl.appendChild(renderNotif(n));
    }
    await SNS.api("POST", "/api/notifications/read");
    SNS.setBadge(0);
}

SNS.mountShell("notifications");
load();
