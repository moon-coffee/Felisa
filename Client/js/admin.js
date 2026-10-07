/* 管理パネル /admin */
(function () {
    "use strict";

    const statsEl = document.getElementById("admin-stats");
    const chartEl = document.getElementById("admin-chart");
    const updatedEl = document.getElementById("admin-updated");
    const errorEl = document.getElementById("admin-error");
    const refreshButton = document.getElementById("admin-refresh");
    const reportsEl = document.getElementById("admin-reports");
    const inquiriesEl = document.getElementById("admin-inquiries");
    const supportErrorEl = document.getElementById("admin-support-error");
    const supportRefreshButton = document.getElementById("admin-support-refresh");
    const REPORT_LABELS = {
        harassment: "嫌がらせ・脅迫",
        illegal: "違法または危険な内容",
        child_safety: "児童の安全",
        spam: "スパム・なりすまし",
        privacy: "個人情報・権利侵害",
        other: "その他",
    };
    const INQUIRY_LABELS = {
        account: "アカウント・利用方法",
        privacy: "プライバシー",
        safety: "安全・権利侵害",
        bug: "不具合",
        other: "その他",
    };

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

    function supportCard(titleText, metaText, detailText, status, onReview, href) {
        const card = document.createElement("article");
        card.className = "admin-support-card";
        const head = document.createElement("div");
        head.className = "admin-support-card-head";
        const title = document.createElement(href ? "a" : "strong");
        title.textContent = titleText;
        if (href) title.href = href;
        const state = document.createElement("span");
        state.className = "admin-support-status";
        state.textContent = status === "reviewed" ? "確認済み" : "未確認";
        head.append(title, state);
        const meta = document.createElement("p");
        meta.className = "admin-support-meta";
        meta.textContent = metaText;
        const detail = document.createElement("p");
        detail.className = "admin-support-detail";
        detail.textContent = detailText;
        card.append(head, meta, detail);
        if (status !== "reviewed") {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "btn btn-outline btn-sm";
            button.textContent = "確認済みにする";
            button.addEventListener("click", onReview);
            card.appendChild(button);
        }
        return card;
    }

    function renderReports(reports) {
        reportsEl.replaceChildren();
        if (!reports.length) {
            reportsEl.textContent = "通報はありません。";
            return;
        }
        for (const report of reports) {
            const targetLabel = report.targetType === "post" ? "ポスト" : "ユーザー";
            const href =
                report.targetType === "post"
                    ? "/status/" + encodeURIComponent(report.targetId)
                    : "/" + encodeURIComponent(report.targetUserId);
            const meta = [
                new Date(report.createdAt).toLocaleString("ja-JP"),
                "理由: " + (REPORT_LABELS[report.reason] || report.reason),
                "通報者: @" + report.reporterId,
                "対象: @" + report.targetUserId,
            ].join(" · ");
            const detail = (report.detail || "補足なし") + `（${targetLabel} ID: ${report.targetId}）`;
            reportsEl.appendChild(
                supportCard(
                    targetLabel + "を開く",
                    meta,
                    detail,
                    report.status,
                    () => reviewItem("reports", report.id),
                    href
                )
            );
        }
    }

    function renderInquiries(inquiries) {
        inquiriesEl.replaceChildren();
        if (!inquiries.length) {
            inquiriesEl.textContent = "お問い合わせはありません。";
            return;
        }
        for (const inquiry of inquiries) {
            const meta = [
                new Date(inquiry.createdAt).toLocaleString("ja-JP"),
                INQUIRY_LABELS[inquiry.category] || inquiry.category,
                inquiry.userId ? "ユーザー: @" + inquiry.userId : "未ログイン",
                inquiry.email ? "返信先: " + inquiry.email : "返信先なし",
            ].join(" · ");
            inquiriesEl.appendChild(
                supportCard(
                    "お問い合わせ",
                    meta,
                    inquiry.message,
                    inquiry.status,
                    () => reviewItem("inquiries", inquiry.id)
                )
            );
        }
    }

    async function reviewItem(kind, id) {
        const result = await SNS.api(
            "PUT",
            "/api/admin/" + kind + "/" + encodeURIComponent(id) + "/review"
        );
        if (result.status === 401) return location.replace("/login");
        if (!result.data.ok) {
            supportErrorEl.textContent = SNS.failMessage(result.data, "状態を更新できませんでした。");
            supportErrorEl.hidden = false;
            return;
        }
        loadSupport();
    }

    async function loadSupport() {
        supportRefreshButton.disabled = true;
        supportErrorEl.hidden = true;
        try {
            const [reports, inquiries] = await Promise.all([
                SNS.api("GET", "/api/admin/reports"),
                SNS.api("GET", "/api/admin/inquiries"),
            ]);
            if (reports.status === 401 || inquiries.status === 401) {
                location.replace("/login");
                return;
            }
            if (!reports.data.ok || !inquiries.data.ok) {
                supportErrorEl.textContent = SNS.failMessage(
                    !reports.data.ok ? reports.data : inquiries.data,
                    "通報・お問い合わせを取得できませんでした。"
                );
                supportErrorEl.hidden = false;
                return;
            }
            renderReports(reports.data.reports || []);
            renderInquiries(inquiries.data.inquiries || []);
        } finally {
            supportRefreshButton.disabled = false;
        }
    }

    refreshButton.addEventListener("click", loadStats);
    supportRefreshButton.addEventListener("click", loadSupport);
    SNS.mountShell("admin").then((me) => {
        if (me && me.isAdmin) {
            loadStats();
            loadSupport();
        }
        else if (me) {
            errorEl.textContent = "この機能を利用する権限がありません。";
            errorEl.hidden = false;
        }
    });
})();
