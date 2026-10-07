(function () {
    "use strict";

    const form = document.getElementById("help-contact-form");
    const submit = document.getElementById("help-contact-submit");
    const result = document.getElementById("help-contact-result");

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        submit.disabled = true;
        result.classList.remove("is-error");
        result.textContent = "";
        const data = new FormData(form);
        try {
            const response = await SNS.api("POST", "/api/support/contact", {
                category: data.get("category"),
                email: data.get("email"),
                message: data.get("message"),
            });
            if (response.data && response.data.ok) {
                form.reset();
                result.textContent = "お問い合わせを受け付けました。管理者が内容を確認します。";
            } else {
                result.classList.add("is-error");
                result.textContent = SNS.failMessage(response.data, "送信できませんでした。入力内容をご確認ください。");
            }
        } finally {
            submit.disabled = false;
        }
    });
})();
