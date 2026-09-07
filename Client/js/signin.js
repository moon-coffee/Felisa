const regForm = document.getElementById("RegForm");
const regUserIdInput = document.getElementById("reg-userid");
const regMailInput = document.getElementById("reg-mail");
const regPasswordInput = document.getElementById("reg-password");
const regUserIdError = document.getElementById("reg-userid-error");
const regMailError = document.getElementById("reg-mail-error");
const regPasswordError = document.getElementById("reg-password-error");
const regFormMessage = document.getElementById("reg-form-message");
const regButton = document.getElementById("reg-button");

regForm.addEventListener("submit", async function (event) {
    event.preventDefault();

    regUserIdError.textContent = "";
    regMailError.textContent = "";
    regPasswordError.textContent = "";
    regFormMessage.textContent = "";
    regFormMessage.classList.remove("success");

    const userId = regUserIdInput.value.trim();
    const mail = regMailInput.value.trim();
    const password = regPasswordInput.value.trim();

    let isValid = true;

    if (userId === "") {
        regUserIdError.textContent = "ユーザーIDを入力してください。";
        isValid = false;
    }

    if (mail === "") {
        regMailError.textContent = "メールアドレスを入力してください。";
        isValid = false;
    }

    if (password === "") {
        regPasswordError.textContent = "パスワードを入力してください。";
        isValid = false;
    }

    if (!isValid) {
        return;
    }

    regButton.disabled = true;

    try {
        const res = await fetch("/api/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId, mail, password }),
        });
        const data = await res.json().catch(() => ({}));

        if (res.ok && data.ok) {
            // サーバー側でセッション Cookie が発行済み（自動ログイン）
            regFormMessage.classList.add("success");
            regFormMessage.textContent =
                "登録が完了しました。ホームへ移動します…";
            regForm.reset();
            window.location.href = "/home";
            return;
        }

        const errors = data.errors || {};
        if (errors.userId) {
            regUserIdError.textContent = errors.userId;
        }
        if (errors.mail) {
            regMailError.textContent = errors.mail;
        }
        if (errors.password) {
            regPasswordError.textContent = errors.password;
        }
        if (errors.form) {
            regFormMessage.textContent = errors.form;
        }
    } catch (err) {
        regFormMessage.textContent =
            "サーバーに接続できませんでした。通信環境を確認してください。";
    } finally {
        regButton.disabled = false;
    }
});
