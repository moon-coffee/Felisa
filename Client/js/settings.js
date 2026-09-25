/* 設定 /settings */

const pwErr = document.getElementById("pw-err");
const delErr = document.getElementById("del-err");
const sessionsEl = document.getElementById("sessions");

function showErrors(box, errors, fallback) {
    if (errors && Object.keys(errors).length) {
        box.textContent = Object.values(errors).join(" ");
        return;
    }
    // errors が無い＝通信断またはサーバー側の想定外エラー。無言にしない。
    box.textContent = fallback || "処理に失敗しました。時間をおいて再度お試しください。";
}

function clearErrors(boxes) {
    boxes.forEach((b) => (b.textContent = ""));
}

// 送信ボタンの進行表示（ラベルを一時的に変える）
function withBusy(btn, label, fn) {
    const idle = btn.textContent;
    btn.disabled = true;
    btn.textContent = label;
    return Promise.resolve()
        .then(fn)
        .finally(() => {
            btn.textContent = idle;
            btn.disabled = false;
        });
}

/* ---- 外観（テーマ） ---- */
const themeInputs = document.querySelectorAll('input[name="theme"]');
function applyThemeUi(mode) {
    themeInputs.forEach((r) => (r.checked = r.value === mode));
}
themeInputs.forEach((r) =>
    r.addEventListener("change", () => {
        if (!r.checked) return;
        window.FelisaTheme.set(r.value);
        applyThemeUi(r.value);
        SNS.notify("テーマを切り替えました");
    })
);
applyThemeUi(window.FelisaTheme.get());

/* ---- プロフィール ---- */
const pfForm = document.getElementById("profile-form");
const pfErr = document.getElementById("pf-err");

pfForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearErrors([pfErr]);
    const btn = pfForm.querySelector("button[type=submit]");
    await withBusy(btn, "保存中…", async () => {
        const res = await SNS.api("PUT", "/api/me", {
            displayName: document.getElementById("pf-name").value.trim(),
            bio: document.getElementById("pf-bio").value,
            link: document.getElementById("pf-link").value.trim(),
        });
        if (res.status === 401) return location.replace("/login");
        if (res.data.ok) {
            SNS.notify("プロフィールを保存しました");
            SNS.applyShellUser(await SNS.loadMe());
        } else {
            showErrors(pfErr, res.data.errors, SNS.failMessage(res.data, "保存できませんでした"));
        }
    });
});

/* ---- メールアドレス（任意・あとから登録） ---- */
const emailForm = document.getElementById("email-form");
const emailInput = document.getElementById("email-input");
const emailErr = document.getElementById("email-err");
const emailClear = document.getElementById("email-clear");

function syncEmailUi(value) {
    const has = !!(value && value.trim());
    emailClear.hidden = !has;
    emailInput.placeholder = has ? value : "you@example.com";
}

emailForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearErrors([emailErr]);
    const btn = emailForm.querySelector("button[type=submit]");
    const value = emailInput.value.trim();
    if (value === "") {
        emailErr.textContent = "メールアドレスを入力してください。解除する場合は「登録を解除」を押してください。";
        return;
    }
    await withBusy(btn, "保存中…", async () => {
        const res = await SNS.api("PUT", "/api/me/email", { email: value });
        if (res.status === 401) return location.replace("/login");
        if (res.data.ok) {
            emailInput.value = res.data.email || value;
            syncEmailUi(emailInput.value);
            SNS.notify("メールアドレスを保存しました");
        } else {
            showErrors(emailErr, res.data.errors, SNS.failMessage(res.data, "保存できませんでした"));
        }
    });
});

emailClear.addEventListener("click", async () => {
    clearErrors([emailErr]);
    await withBusy(emailClear, "解除中…", async () => {
        const res = await SNS.api("PUT", "/api/me/email", { email: "" });
        if (res.status === 401) return location.replace("/login");
        if (res.data.ok) {
            emailInput.value = "";
            syncEmailUi("");
            SNS.notify("メールアドレスの登録を解除しました");
        } else {
            showErrors(emailErr, res.data.errors, SNS.failMessage(res.data, "解除できませんでした"));
        }
    });
});

/* ---- パスワード変更 ---- */
document.getElementById("pw-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    clearErrors([pwErr]);
    const btn = e.target.querySelector("button[type=submit]");
    await withBusy(btn, "変更中…", async () => {
        const res = await SNS.api("PUT", "/api/me/password", {
            currentPassword: document.getElementById("pw-cur").value,
            newPassword: document.getElementById("pw-new").value,
        });
        if (res.status === 401) return location.replace("/login");
        if (res.data.ok) {
            e.target.reset();
            SNS.notify("パスワードを変更しました。他の端末はログアウトされました。");
            loadSessions();
        } else {
            showErrors(pwErr, res.data.errors, SNS.failMessage(res.data, "変更できませんでした"));
        }
    });
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
    clearErrors([unameErr]);
    const res = await SNS.api("PUT", "/api/me/username", {
        userId: document.getElementById("uname-new").value.trim(),
        password: document.getElementById("uname-pass").value,
    });
    if (res.status === 401) return location.replace("/login");
    if (res.data.ok) {
        unameForm.reset();
        SNS.notify("ユーザー名を @" + res.data.user.userId + " に変更しました");
        applyUnameLock(res.data.user.usernameNextChangeAt);
        SNS.applyShellUser(await SNS.loadMe());
        loadSessions();
    } else {
        showErrors(unameErr, res.data.errors, SNS.failMessage(res.data, "変更できませんでした"));
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
            const res = await SNS.api("DELETE", "/api/me/sessions/" + encodeURIComponent(s.id));
            if (res.data && res.data.ok) SNS.notify("この端末をログアウトしました");
            else SNS.notify(SNS.failMessage(res.data, "ログアウトできませんでした"), "error");
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
    const list = (res.data && res.data.sessions) || [];
    if (!list.length) {
        sessionsEl.innerHTML = '<p class="settings-note">セッション情報を取得できませんでした。</p>';
        return;
    }
    for (const s of list) sessionsEl.appendChild(renderSession(s));
}

document.getElementById("logout-others").addEventListener("click", async () => {
    const yes = await SNS.confirm({
        title: "他の端末をログアウト",
        message: "この端末以外のすべてのセッションを終了します。よろしいですか？",
        okText: "ログアウト",
    });
    if (!yes) return;
    const res = await SNS.api("DELETE", "/api/me/sessions");
    if (res.data && res.data.ok) SNS.notify("他の端末をログアウトしました");
    else SNS.notify(SNS.failMessage(res.data, "ログアウトできませんでした"), "error");
    loadSessions();
});

/* ---- アカウント削除 ---- */
const delModal = document.getElementById("del-modal");
const delConfirm = document.getElementById("del-confirm");
const delPass = document.getElementById("del-pass");
const delGo = document.getElementById("del-go");
let delRestore = null;

function syncDel() {
    delGo.disabled = delConfirm.value.trim() !== "削除" || delPass.value === "";
}
delConfirm.addEventListener("input", syncDel);
delPass.addEventListener("input", syncDel);

function closeDel() {
    if (delRestore) {
        delRestore();
        delRestore = null;
    }
    delModal.hidden = true;
}

document.getElementById("del-open").addEventListener("click", () => {
    clearErrors([delErr]);
    delConfirm.value = "";
    delPass.value = "";
    syncDel();
    delModal.hidden = false;
    // role / Escape / フォーカストラップ
    delRestore = SNS.dialogize(delModal, closeDel);
    delConfirm.focus();
});
document.getElementById("del-cancel").addEventListener("click", closeDel);
document.getElementById("del-cancel2").addEventListener("click", closeDel);
delModal.addEventListener("click", (e) => {
    if (e.target === delModal) closeDel();
});

delGo.addEventListener("click", async () => {
    delGo.disabled = true;
    const res = await SNS.api("DELETE", "/api/me", { password: delPass.value });
    if (res.data.ok) {
        location.replace("/login");
    } else {
        showErrors(delErr, res.data.errors, SNS.failMessage(res.data, "削除できませんでした"));
        syncDel();
    }
});

/* ---- 初期化 ---- */
SNS.mountShell("settings").then((me) => {
    if (me) {
        applyUnameLock(me.usernameNextChangeAt);
        document.getElementById("pf-name").value = me.name || "";
        document.getElementById("pf-bio").value = me.bio || "";
        document.getElementById("pf-link").value = me.link || "";
        emailInput.value = me.email || "";
        syncEmailUi(emailInput.value);
    }
});
loadSessions();
