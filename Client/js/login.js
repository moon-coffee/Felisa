const loginForm = document.getElementById("LoginForm");
const loginUserIdInput = document.getElementById("login-userid");
const loginPasswordInput = document.getElementById("login-password");
const loginUserIdError = document.getElementById("login-userid-error");
const loginPasswordError = document.getElementById("login-password-error");
const loginFormMessage = document.getElementById("login-form-message");
const loginButton = document.getElementById("login-button");

loginForm.addEventListener("submit", async function (event) {
    event.preventDefault();

    loginUserIdError.textContent = "";
    loginPasswordError.textContent = "";
    loginFormMessage.textContent = "";
    loginFormMessage.classList.remove("success");

    const userId = loginUserIdInput.value.trim();
    const password = loginPasswordInput.value;

    let isValid = true;

    if (userId === "") {
        loginUserIdError.textContent = "ユーザーIDを入力してください。";
        isValid = false;
    }

    if (password === "") {
        loginPasswordError.textContent = "パスワードを入力してください。";
        isValid = false;
    }

    if (!isValid) {
        return;
    }

    loginButton.disabled = true;

    try {
        const res = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId, password }),
        });
        const data = await res.json().catch(() => ({}));

        if (res.ok && data.ok) {
            loginFormMessage.classList.add("success");
            loginFormMessage.textContent = `ようこそ、${data.user.userId} さん。ホームへ移動します…`;
            window.location.href = "/home";
            return;
        }

        const errors = data.errors || {};
        if (errors.userId) {
            loginUserIdError.textContent = errors.userId;
        }
        if (errors.password) {
            loginPasswordError.textContent = errors.password;
        }
        loginFormMessage.textContent =
            errors.form || "ログインに失敗しました。時間をおいて再度お試しください。";
    } catch (err) {
        loginFormMessage.textContent =
            "サーバーに接続できませんでした。通信環境を確認してください。";
    } finally {
        loginButton.disabled = false;
    }
});
