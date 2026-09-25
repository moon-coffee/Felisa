/* プロフィール /<username> */

const segment = decodeURIComponent(
    window.location.pathname.replace(/^\/+/, "").split("/")[0] || ""
).replace(/^@/, "");

const listEl = document.getElementById("profile-list");
const statusEl = document.getElementById("profile-status");
const modal = document.getElementById("edit-modal");
let currentTab = "posts";
let me = null;

const setAll = (sel, v) =>
    document.querySelectorAll(sel).forEach((el) => (el.textContent = v));

/* ---- 画像エンコード（PNG 再変換 / メタデータ除去は canvas が担保）---- */
async function encodeSquarePng(file, size) {
    const bmp = await createImageBitmap(file);
    const s = Math.min(bmp.width, bmp.height);
    const c = document.createElement("canvas");
    c.width = c.height = size;
    c
        .getContext("2d")
        .drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
    return new Promise((r) => c.toBlob(r, "image/png"));
}
async function encodeCoverPng(file, W, H) {
    const bmp = await createImageBitmap(file);
    const scale = Math.max(W / bmp.width, H / bmp.height);
    const dw = bmp.width * scale;
    const dh = bmp.height * scale;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    c.getContext("2d").drawImage(bmp, (W - dw) / 2, (H - dh) / 2, dw, dh);
    return new Promise((r) => c.toBlob(r, "image/png"));
}

/* ---- アクション（フォロー / ブロック / 編集）---- */
function makeButton(label, cls) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn " + cls;
    b.textContent = label;
    return b;
}

function renderActions(user) {
    const box = document.getElementById("profile-actions");
    box.innerHTML = "";

    if (user.isMe) {
        const edit = makeButton("プロフィールを編集", "btn-outline");
        edit.addEventListener("click", () => openEdit(user));
        box.appendChild(edit);
        return;
    }
    if (user.blockedByMe) {
        const un = makeButton("ブロック中", "btn-outline follow-toggle");
        un.addEventListener("click", async () => {
            const yes = await SNS.confirm({
                title: "ブロック解除",
                message: "@" + user.userId + " のブロックを解除しますか？",
                okText: "解除",
            });
            if (!yes) return;
            const res = await SNS.api("DELETE", "/api/users/" + encodeURIComponent(segment) + "/block");
            if (res.data && res.data.ok) SNS.notify("ブロックを解除しました");
            else SNS.notify(SNS.failMessage(res.data, "ブロックを解除できませんでした"), "error");
            loadProfile();
        });
        box.appendChild(un);
        return;
    }

    const follow = makeButton(
        user.followedByMe ? "フォロー中" : "フォロー",
        user.followedByMe ? "btn-outline follow-toggle" : "btn-solid follow-toggle"
    );
    follow.dataset.following = user.followedByMe ? "1" : "0";
    follow.setAttribute("aria-pressed", user.followedByMe ? "true" : "false");
    follow.setAttribute("aria-label", (user.followedByMe ? "フォロー中（解除）: " : "フォロー: ") + user.name);
    follow.addEventListener("click", () => toggleFollow(follow));
    box.appendChild(follow);

    const menu = document.createElement("button");
    menu.type = "button";
    menu.className = "icon-btn";
    menu.title = "その他";
    menu.innerHTML = '<i class="fa-solid fa-ellipsis"></i>';
    menu.addEventListener("click", async () => {
        const yes = await SNS.confirm({
            title: "ブロック",
            message:
                "@" +
                user.userId +
                " をブロックしますか？相互のフォローは解除され、相手の投稿は表示されなくなります。",
            okText: "ブロック",
            danger: true,
        });
        if (!yes) return;
        const res = await SNS.api("POST", "/api/users/" + encodeURIComponent(segment) + "/block");
        if (res.data && res.data.ok) SNS.notify("ブロックしました");
        else SNS.notify(SNS.failMessage(res.data, "ブロックできませんでした"), "error");
        loadProfile();
    });
    box.appendChild(menu);
}

async function toggleFollow(btn) {
    const on = btn.dataset.following === "1";
    const res = await SNS.api(
        on ? "DELETE" : "POST",
        "/api/users/" + encodeURIComponent(segment) + "/follow"
    );
    if (res.status === 401) return (location.href = "/login");
    if (!res.data.ok) {
        SNS.notify(SNS.failMessage(res.data, "操作できませんでした"), "error");
        return;
    }
    btn.dataset.following = res.data.following ? "1" : "0";
    btn.textContent = res.data.following ? "フォロー中" : "フォロー";
    btn.className =
        "btn follow-toggle " + (res.data.following ? "btn-outline" : "btn-solid");
    btn.setAttribute("aria-pressed", res.data.following ? "true" : "false");
    document.querySelector("[data-stat-followers]").textContent = res.data.followerCount;
}

/* ---- 描画 ---- */
function renderProfile(user) {
    document.title = user.name + "（" + user.handle + "）";
    setAll("[data-profile-name]", user.name);
    setAll("[data-profile-handle]", user.handle);
    setAll("[data-profile-count]", user.postCount + " 件のポスト");

    const bio = document.querySelector("[data-profile-bio]");
    bio.textContent = user.bio || "";
    bio.hidden = !user.bio;

    const link = document.querySelector("[data-profile-link]");
    if (user.link && /^https?:\/\//i.test(user.link)) {
        link.href = user.link;
        try {
            link.textContent = new URL(user.link).host;
        } catch (e) {
            link.textContent = user.link;
        }
        link.hidden = false;
    } else {
        link.hidden = true;
    }

    const joined = document.querySelector("[data-profile-joined]");
    if (user.createdAt) {
        const d = new Date(user.createdAt);
        joined.textContent =
            d.getFullYear() + "年" + (d.getMonth() + 1) + "月から利用しています";
    }

    document.getElementById("profile-admin").hidden = !user.isAdmin;

    document.querySelectorAll("[data-profile-avatar]").forEach((el) => {
        el.innerHTML = "";
        el.appendChild(SNS.imgFor(user));
    });
    const bigAvatar = document.querySelector(".avatar--xl");
    if (bigAvatar) {
        bigAvatar.classList.add("is-clickable");
        bigAvatar.onclick = () => SNS.preview(user.avatar, "image");
    }

    const banner = document.querySelector("[data-profile-banner]");
    banner.style.backgroundImage = user.header ? "url(" + user.header + ")" : "";
    banner.classList.toggle("has-image", !!user.header);
    banner.onclick = user.header ? () => SNS.preview(user.header, "image") : null;

    document.querySelector("[data-stat-following]").textContent = user.followingCount;
    document.querySelector("[data-stat-followers]").textContent = user.followerCount;

    renderActions(user);
}

function renderMissing(msg) {
    document.title = "ユーザーが見つかりません";
    setAll("[data-profile-name]", msg || "ユーザーが見つかりません");
    setAll("[data-profile-handle]", segment ? "@" + segment : "");
    setAll("[data-profile-count]", "");
    document.getElementById("profile-tabs").hidden = true;
    listEl.innerHTML = "";
    statusEl.textContent = msg ? "" : "このユーザーは存在しません。";
    document.getElementById("profile-actions").innerHTML = "";
}

async function loadList() {
    const path =
        currentTab === "likes"
            ? "/api/users/" + encodeURIComponent(segment) + "/likes"
            : "/api/users/" + encodeURIComponent(segment) + "/posts";
    listEl.innerHTML = '<div class="feed-end">読み込み中…</div>';
    statusEl.textContent = "";
    const res = await SNS.api("GET", path);
    listEl.innerHTML = "";
    if (!res.data || !res.data.ok) {
        statusEl.textContent = SNS.failMessage(res.data, "一覧を読み込めませんでした。");
        return;
    }
    const entries = res.data.entries || [];
    if (entries.length === 0) {
        statusEl.textContent =
            currentTab === "likes" ? "いいねしたポストはありません。" : "まだポストがありません。";
        return;
    }
    statusEl.textContent = "";
    for (const e of entries) listEl.appendChild(SNS.renderEntry(e));
}

async function loadProfile() {
    listEl.innerHTML = '<div class="feed-end">読み込み中…</div>';
    const res = await SNS.api("GET", "/api/users/" + encodeURIComponent(segment));
    if (!res.data || !res.data.ok || !res.data.user) {
        renderMissing();
        if (res.status === 0)
            statusEl.textContent = "サーバーに接続できませんでした。通信環境を確認してください。";
        return;
    }
    const user = res.data.user;
    if (user.blocksMe) {
        renderProfile(user);
        document.getElementById("profile-tabs").hidden = true;
        listEl.innerHTML = "";
        statusEl.textContent = "このユーザーはあなたをブロックしています。";
        return;
    }
    document.getElementById("profile-tabs").hidden = false;
    renderProfile(user);
    loadList();
}

document.querySelectorAll("#profile-tabs .tab").forEach((tab) => {
    tab.addEventListener("click", () => {
        if (tab.classList.contains("active")) return;
        document.querySelectorAll("#profile-tabs .tab").forEach((t) => {
            const on = t === tab;
            t.classList.toggle("active", on);
            t.setAttribute("aria-selected", on ? "true" : "false");
        });
        currentTab = tab.dataset.tab;
        loadList();
    });
});

/* ---- 編集モーダル（画像は保存前にプレビュー） ---- */
let pendingAvatar = null; // { blob, url }
let pendingHeader = null;
const avatarPrev = document.getElementById("edit-avatar-preview");
const headerPrev = document.getElementById("edit-header-preview");

function openEdit(user) {
    document.getElementById("edit-name").value = user.name;
    document.getElementById("edit-bio").value = user.bio || "";
    document.getElementById("edit-link").value = user.link || "";
    pendingAvatar = null;
    pendingHeader = null;
    avatarPrev.style.backgroundImage = "url(" + user.avatar + ")";
    headerPrev.style.backgroundImage = user.header ? "url(" + user.header + ")" : "";
    modal.hidden = false;
    // role / Escape / フォーカストラップ / 開く前へのフォーカス復帰
    editRestore = SNS.dialogize(modal, closeEdit);
    document.getElementById("edit-name").focus();
}

let editRestore = null;

function closeEdit() {
    if (editRestore) {
        editRestore();
        editRestore = null;
    }
    modal.hidden = true;
}

document.getElementById("edit-cancel").addEventListener("click", closeEdit);
modal.addEventListener("click", (e) => {
    if (e.target === modal) closeEdit();
});
document
    .getElementById("edit-avatar-btn")
    .addEventListener("click", () => document.getElementById("edit-avatar-file").click());
document
    .getElementById("edit-header-btn")
    .addEventListener("click", () => document.getElementById("edit-header-file").click());
avatarPrev.addEventListener("click", () => {
    if (pendingAvatar) SNS.preview(pendingAvatar.url, "image");
});
headerPrev.addEventListener("click", () => {
    if (pendingHeader) SNS.preview(pendingHeader.url, "image");
});

document.getElementById("edit-avatar-file").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    const blob = await encodeSquarePng(f, 256);
    if (pendingAvatar) URL.revokeObjectURL(pendingAvatar.url);
    pendingAvatar = { blob, url: URL.createObjectURL(blob) };
    avatarPrev.style.backgroundImage = "url(" + pendingAvatar.url + ")";
});
document.getElementById("edit-header-file").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    const blob = await encodeCoverPng(f, 1200, 400);
    if (pendingHeader) URL.revokeObjectURL(pendingHeader.url);
    pendingHeader = { blob, url: URL.createObjectURL(blob) };
    headerPrev.style.backgroundImage = "url(" + pendingHeader.url + ")";
});

document.getElementById("edit-save").addEventListener("click", async () => {
    const btn = document.getElementById("edit-save");
    const idleLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "保存中…";
    let imageChanged = false;

    try {
        const res = await SNS.api("PUT", "/api/me", {
            displayName: document.getElementById("edit-name").value,
            bio: document.getElementById("edit-bio").value,
            link: document.getElementById("edit-link").value,
        });
        if (res.status === 401) return (location.href = "/login");

        if (pendingAvatar) {
            const a = await SNS.api("PUT", "/api/me/avatar", pendingAvatar.blob, {
                raw: true,
                contentType: "image/png",
            });
            if (a.data.ok) imageChanged = true;
            else SNS.notify(SNS.failMessage(a.data, "アイコンを更新できませんでした"), "error");
        }
        if (pendingHeader) {
            const hres = await SNS.api("PUT", "/api/me/header", pendingHeader.blob, {
                raw: true,
                contentType: "image/png",
            });
            if (hres.data.ok) imageChanged = true;
            else SNS.notify(SNS.failMessage(hres.data, "ヘッダを更新できませんでした"), "error");
        }

        if (res.data.ok || imageChanged) {
            closeEdit();
            SNS.notify("プロフィールを更新しました");
            if (imageChanged) {
                location.reload();
            } else {
                SNS.applyShellUser(await SNS.loadMe());
                loadProfile();
            }
        } else {
            SNS.notify(SNS.failMessage(res.data, "プロフィールを保存できませんでした"), "error");
        }
    } finally {
        btn.textContent = idleLabel;
        btn.disabled = false;
    }
});

SNS.wire(document.querySelector(".feed"));

if (!segment || segment === "profile.html") {
    renderMissing();
    SNS.mountShell(null);
} else {
    SNS.mountShell("profile").then((u) => {
        me = u;
    });
    loadProfile();
}
