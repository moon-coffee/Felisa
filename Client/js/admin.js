/* 管理パネル /admin */
(function () {
    "use strict";

    const statsEl = document.getElementById("admin-stats");
    const chartEl = document.getElementById("admin-chart");
    const updatedEl = document.getElementById("admin-updated");
    const errorEl = document.getElementById("admin-error");
    const refreshButton = document.getElementById("admin-refresh");

    function statCard(label, value, detail, icon) {
        const card = document.createElement("article");
        card.className = "admin-stat";
        const iconEl = document.createElement("i");
        iconEl.className = icon;
        iconEl.setAttribute("aria-hidden", "true");
        const title = document.createElement("p");
        title.className = "admin-stat-label";
        title.textContent = label;
        const number = document.createElement("strong");
        number.className = "admin-stat-value";
        number.textContent = Number(value).toLocaleString("ja-JP");
        const note = document.createElement("span");
        note.className = "admin-stat-detail";
        note.textContent = detail;
        card.append(iconEl, title, number, note);
        return card;
    }

    function render(data) {
        const post = data.posts;
        statsEl.replaceChildren(
            statCard("登録ユーザー", data.users.total, `過去7日 +${data.users.last7Days}`, "fa-solid fa-users"),
            statCard("投稿", post.total, `過去7日 ${post.last7Days} 件`, "fa-solid fa-message"),
            statCard("直近24時間", post.last24Hours, "新しい投稿", "fa-solid fa-clock"),
            statCard("いいね", post.likes, "全投稿の合計", "fa-solid fa-heart"),
            statCard("リポスト", post.reposts, `返信 ${post.replies} 件`, "fa-solid fa-repeat"),
            statCard("審査待ち", post.pendingModeration, "モデレーション", "fa-solid fa-shield-halved")
        );

        const max = Math.max(1, ...data.activity.flatMap((day) => [day.users, day.posts]));
        chartEl.replaceChildren();
        for (const day of data.activity) {
            const column = document.createElement("div");
            column.className = "admin-chart-day";
            const bars = document.createElement("div");
            bars.className = "admin-chart-bars";
            for (const [value, kind, label] of [
                [day.users, "users", "新規ユーザー"],
                [day.posts, "posts", "投稿"],
            ]) {
                const bar = document.createElement("span");
                bar.className = `admin-chart-bar admin-chart-bar--${kind}`;
                bar.style.height = `${Math.max(value ? 4 : 0, (value / max) * 100)}%`;
                bar.title = `${label}: ${value} 件`;
                bar.setAttribute("aria-label", `${label}: ${value} 件`);
                bars.appendChild(bar);
            }
            const label = document.createElement("span");
            label.className = "admin-chart-date";
            label.textContent = new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" })
                .format(new Date(`${day.date}T00:00:00`));
            column.append(bars, label);
            chartEl.appendChild(column);
        }
        updatedEl.textContent = `最終更新: ${new Date(data.generatedAt).toLocaleString("ja-JP")}`;
    }

    async function loadStats() {
        refreshButton.disabled = true;
        errorEl.hidden = true;
        try {
            const res = await SNS.api("GET", "/api/admin/stats");
            if (res.status === 401) return location.replace("/login");
            if (res.status === 403) {
                errorEl.textContent = "この機能を利用する権限がありません。";
                errorEl.hidden = false;
                return;
            }
            if (!res.data.ok) {
                errorEl.textContent = SNS.failMessage(res.data, "統計を取得できませんでした。");
                errorEl.hidden = false;
                return;
            }
            render(res.data);
        } finally {
            refreshButton.disabled = false;
        }
    }

    refreshButton.addEventListener("click", loadStats);
    SNS.mountShell("admin").then((me) => {
        if (me && me.isAdmin) loadStats();
        else if (me) {
            errorEl.textContent = "この機能を利用する権限がありません。";
            errorEl.hidden = false;
        }
    });
})();
