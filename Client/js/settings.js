/* 設定 /settings */

const emailErr = document.getElementById("email-err");
const pwErr = document.getElementById("pw-err");
const delErr = document.getElementById("del-err");
const sessionsEl = document.getElementById("sessions");

function showErrors(box, errors) {
    box.textContent = errors
        ? Object.values(errors).join(" ")
        : "";
}

/* ---- メールアドレス変更 ---- */
document.getElementById("email-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    showErrors(emailErr, null);
    const res = await SNS.api("PUT", "/api/me/email", {
        email: document.getElementById("email-new").value.trim(),
        password: document.getElementById("email-pass").value,
    });
    if (res.data.ok) {
        document.getElementById("cur-email").textContent = res.data.user.mail;
        document.getElementById("email-form").reset();
        SNS.notify("メールアドレスを変更しました");
    } else {
        showErrors(emailErr, res.data.errors);
    }
});

/* ---- パスワード変更 ---- */
document.getElementById("pw-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    showErrors(pwErr, null);
    const res = await SNS.api("PUT", "/api/me/password", {
        currentPassword: document.getElementById("pw-cur").value,
        newPassword: document.getElementById("pw-new").value,
    });
    if (res.data.ok) {
        document.getElementById("pw-form").reset();
        SNS.notify("パスワードを変更しました。他の端末はログアウトされました。");
        loadSessions();
    } else {
        showErrors(pwErr, res.data.errors);
    }
});

/* ---- ユーザー名の変更 ---- */
const unameForm = document.getElementById("uname-form");
const unameNote = document.getElementById("uname-note");
const unameErr = document.getElementById("uname-err");

function applyUnameLock(nextAt) {
    const locked = nextAt && Date.now() < nextAt;
    unameForm.querySelectorAll("input,button").forEach((el) => (el.disabled = !!locked));
    if (locked) {
        unameNote.textContent =
            "次にユーザー名を変更できるのは " +
            new Date(nextAt).toLocaleString("ja-JP") +
            " 以降です。";
    } else {
        unameNote.textContent = "ユーザー名（@ハンドル）の変更は1週間に1回までです。";
    }
}

unameForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    showErrors(unameErr, null);
    const res = await SNS.api("PUT", "/api/me/username", {
        userId: document.getElementById("uname-new").value.trim(),
        password: document.getElementById("uname-pass").value,
    });
    if (res.data.ok) {
        unameForm.reset();
        SNS.notify("ユーザー名を @" + res.data.user.userId + " に変更しました");
        applyUnameLock(res.data.user.usernameNextChangeAt);
        SNS.applyShellUser(await SNS.loadMe());
        loadSessions();
    } else {
        showErrors(unameErr, res.data.errors);
        if (res.data.availableAt) applyUnameLock(res.data.availableAt);
    }
});

/* ---- ログイン端末 ---- */
function renderSession(s) {
    const row = document.createElement("div");
    row.className = "session" + (s.current ? " session--current" : "");

    const info = document.createElement("div");
    info.className = "session-info";
    const title = document.createElement("b");
    title.textContent = SNS.describeUA(s.ua);
    const sub = document.createElement("div");
    sub.className = "session-sub";
    sub.textContent =
        "IP " + s.ip + " · 最終アクセス " + SNS.relativeTime(s.lastSeenAt);
    const ua = document.createElement("div");
    ua.className = "session-ua";
    ua.textContent = s.ua || "(User-Agent 不明)";
    info.append(title, sub, ua);
    row.appendChild(info);

    if (s.current) {
        const tag = document.createElement("span");
        tag.className = "session-tag";
        tag.textContent = "この端末";
        row.appendChild(tag);
    } else {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn btn-outline btn-sm";
        btn.textContent = "ログアウト";
        btn.addEventListener("click", async () => {
            await SNS.api("DELETE", "/api/me/sessions/" + encodeURIComponent(s.id));
            loadSessions();
        });
        row.appendChild(btn);
    }
    return row;
}

async function loadSessions() {
    const res = await SNS.api("GET", "/api/me/sessions");
    if (res.status === 401) {
        location.replace("/login");
        return;
    }
    sessionsEl.innerHTML = "";
    for (const s of (res.data && res.data.sessions) || []) {
        sessionsEl.appendChild(renderSession(s));
    }
}

document.getElementById("logout-others").addEventListener("click", async () => {
    const yes = await SNS.confirm({
        title: "他の端末をログアウト",
        message: "この端末以外のすべてのセッションを終了します。よろしいですか？",
        okText: "ログアウト",
    });
    if (!yes) return;
    await SNS.api("DELETE", "/api/me/sessions");
    SNS.notify("他の端末をログアウトしました");
    loadSessions();
});

/* ---- アカウント削除 ---- */
const delModal = document.getElementById("del-modal");
const delConfirm = document.getElementById("del-confirm");
const delPass = document.getElementById("del-pass");
const delGo = document.getElementById("del-go");

function syncDel() {
    delGo.disabled = delConfirm.value.trim() !== "削除" || delPass.value === "";
}
delConfirm.addEventListener("input", syncDel);
delPass.addEventListener("input", syncDel);

document.getElementById("del-open").addEventListener("click", () => {
    showErrors(delErr, null);
    delConfirm.value = "";
    delPass.value = "";
    syncDel();
    delModal.hidden = false;
});
document.getElementById("del-cancel").addEventListener("click", () => (delModal.hidden = true));
document.getElementById("del-cancel2").addEventListener("click", () => (delModal.hidden = true));
delModal.addEventListener("click", (e) => {
    if (e.target === delModal) delModal.hidden = true;
});

delGo.addEventListener("click", async () => {
    delGo.disabled = true;
    const res = await SNS.api("DELETE", "/api/me", { password: delPass.value });
    if (res.data.ok) {
        location.replace("/login");
    } else {
        showErrors(delErr, res.data.errors);
        syncDel();
    }
});

/* ---- 初期化 ---- */
SNS.mountShell("settings").then((me) => {
    if (me) {
        document.getElementById("cur-email").textContent = me.mail || "—";
        applyUnameLock(me.usernameNextChangeAt);
    }
});
loadSessions();
