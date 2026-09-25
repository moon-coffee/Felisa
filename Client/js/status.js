/* 投稿詳細 / スレッド /status/:id */

const postId = decodeURIComponent(
    window.location.pathname.split("/").filter(Boolean)[1] || ""
);

const parentsEl = document.getElementById("thread-parents");
const mainEl = document.getElementById("thread-main");
const repliesEl = document.getElementById("thread-replies");
const statusEl = document.getElementById("thread-status");
const replyBox = document.getElementById("reply-box");
replyBox.dataset.replyTo = postId;

async function load() {
    statusEl.textContent = "読み込み中…";
    const res = await SNS.api("GET", "/api/posts/" + encodeURIComponent(postId));
    if (!res.data || !res.data.ok) {
        parentsEl.innerHTML = "";
        mainEl.innerHTML = "";
        repliesEl.innerHTML = "";
        statusEl.textContent =
            res.status === 0
                ? "サーバーに接続できませんでした。通信環境を確認してください。"
                : "投稿が見つかりません。";
        return;
    }
    statusEl.textContent = "";

    parentsEl.innerHTML = "";
    for (const parent of res.data.parents || []) {
        parentsEl.appendChild(SNS.renderEntry({ kind: "post", post: parent }));
    }

    mainEl.innerHTML = "";
    mainEl.appendChild(
        SNS.renderEntry({ kind: "post", post: res.data.post }, { detail: true })
    );
    document.title = res.data.post.author.name + "さんのポスト";

    repliesEl.innerHTML = "";
    for (const reply of res.data.replies || []) {
        repliesEl.appendChild(SNS.renderEntry({ kind: "post", post: reply }));
    }
    statusEl.textContent = (res.data.replies || []).length ? "" : "まだ返信がありません。";
}

SNS.wire(document.querySelector(".feed"));

(async function () {
    const me = await SNS.mountShell(null);
    if (me) {
        replyBox.hidden = false;
        SNS.setupComposer(replyBox, () => load());
    }
    load();
})();
