/* 全ページ共通: API / 描画 / 操作 / 投稿ボックス / サイドバー / ダイアログ */
(function () {
    "use strict";
    const SNS = {};
    SNS.currentUser = null;

    /* ================= API ================= */
    SNS.api = async function (method, url, body, opts) {
        opts = opts || {};
        const init = { method, credentials: "same-origin", headers: {} };
        if (body !== undefined) {
            if (opts.raw) {
                init.headers["Content-Type"] = opts.contentType || "application/octet-stream";
                init.body = body;
            } else {
                init.headers["Content-Type"] = "application/json";
                init.body = JSON.stringify(body);
            }
        }
        let res;
        try {
            res = await fetch(url, init);
        } catch (e) {
            return { ok: false, status: 0, data: {} };
        }
        let data = {};
        try {
            data = await res.json();
        } catch (e) {}
        return { ok: res.ok, status: res.status, data };
    };

    /* ================= 汎用 ================= */
    SNS.relativeTime = function (ts) {
        const min = Math.floor((Date.now() - ts) / 60000);
        if (min < 1) return "たった今";
        if (min < 60) return min + "分";
        const h = Math.floor(min / 60);
        if (h < 24) return h + "時間";
        const d = Math.floor(h / 24);
        if (d < 7) return d + "日";
        const dt = new Date(ts);
        return dt.getMonth() + 1 + "月" + dt.getDate() + "日";
    };
    SNS.formatDate = function (ts) {
        const d = new Date(ts);
        return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日";
    };
    SNS.untilTime = function (ts) {
        const min = Math.floor((ts - Date.now()) / 60000);
        if (min <= 0) return "まもなく終了";
        if (min < 60) return "残り" + min + "分";
        const h = Math.floor(min / 60);
        if (h < 24) return "残り" + h + "時間";
        return "残り" + Math.floor(h / 24) + "日";
    };
    SNS.imgFor = function (user) {
        const img = document.createElement("img");
        img.src = user.avatar;
        img.alt = user.name || "";
        img.decoding = "async";
        return img;
    };
    SNS.linkify = function (target, text) {
        target.textContent = "";
        const re = /#([\p{L}\p{N}_]+)/gu;
        let last = 0, m;
        while ((m = re.exec(text)) !== null) {
            if (m.index > last)
                target.appendChild(document.createTextNode(text.slice(last, m.index)));
            const a = document.createElement("a");
            a.className = "hashtag";
            a.href = "/search?q=" + encodeURIComponent("#" + m[1]);
            a.textContent = "#" + m[1];
            target.appendChild(a);
            last = m.index + m[0].length;
        }
        if (last < text.length)
            target.appendChild(document.createTextNode(text.slice(last)));
    };
    SNS.describeUA = function (ua) {
        ua = ua || "";
        let os = "不明な端末";
        if (/Windows/i.test(ua)) os = "Windows";
        else if (/iPhone|iPad|iOS/i.test(ua)) os = "iOS";
        else if (/Android/i.test(ua)) os = "Android";
        else if (/Mac OS X/i.test(ua)) os = "macOS";
        else if (/Linux/i.test(ua)) os = "Linux";
        let br = "";
        if (/Edg\//i.test(ua)) br = "Edge";
        else if (/OPR\//i.test(ua)) br = "Opera";
        else if (/Chrome\//i.test(ua)) br = "Chrome";
        else if (/Firefox\//i.test(ua)) br = "Firefox";
        else if (/Safari\//i.test(ua)) br = "Safari";
        return br ? os + " · " + br : os;
    };

    /* ================= トースト / ダイアログ ================= */
    SNS.notify = function (msg, type) {
        let el = document.querySelector(".toast");
        if (!el) {
            el = document.createElement("div");
            el.className = "toast";
            document.body.appendChild(el);
        }
        el.textContent = msg;
        el.classList.remove("toast--error", "toast--ok");
        el.classList.add(type === "error" ? "toast--error" : "toast--ok", "is-shown");
        clearTimeout(SNS._toast);
        SNS._toast = setTimeout(() => el.classList.remove("is-shown"), 2600);
    };

    SNS.confirm = function (opts) {
        opts = opts || {};
        return new Promise((resolve) => {
            const back = document.createElement("div");
            back.className = "modal";
            const card = document.createElement("div");
            card.className = "modal-card modal-card--sm";
            const h = document.createElement("h2");
            h.textContent = opts.title || "確認";
            const p = document.createElement("p");
            p.className = "modal-msg";
            p.textContent = opts.message || "";
            const row = document.createElement("div");
            row.className = "modal-actions";
            const cancel = document.createElement("button");
            cancel.type = "button";
            cancel.className = "btn btn-outline";
            cancel.textContent = opts.cancelText || "キャンセル";
            const okBtn = document.createElement("button");
            okBtn.type = "button";
            okBtn.className = "btn " + (opts.danger ? "btn-danger" : "btn-solid");
            okBtn.textContent = opts.okText || "OK";
            row.append(cancel, okBtn);
            card.append(h, p, row);
            back.appendChild(card);
            document.body.appendChild(back);
            const close = (v) => {
                back.remove();
                resolve(v);
            };
            cancel.addEventListener("click", () => close(false));
            okBtn.addEventListener("click", () => close(true));
            back.addEventListener("click", (e) => {
                if (e.target === back) close(false);
            });
            okBtn.focus();
        });
    };

    /* ================= 投稿描画 ================= */
    function actionButton(act, iconClass, count, active) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "pa pa--" + act + (active ? " is-active" : "");
        b.dataset.act = act;
        const i = document.createElement("i");
        i.className = iconClass;
        b.appendChild(i);
        if (count !== null && count !== undefined) {
            const s = document.createElement("span");
            s.textContent = count > 0 ? String(count) : "";
            b.appendChild(s);
        }
        return b;
    }

    function renderMedia(media) {
        if (!media || !media.length) return null;
        if (media[0].type === "video") {
            const v = document.createElement("video");
            v.className = "post-video";
            v.src = media[0].url;
            v.controls = true;
            v.playsInline = true;
            v.preload = "metadata";
            return v;
        }
        const grid = document.createElement("div");
        grid.className = "post-media media-" + Math.min(media.length, 4);
        for (const m of media.slice(0, 4)) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "media-thumb";
            btn.dataset.preview = m.url;
            btn.dataset.previewType = "image";
            const img = document.createElement("img");
            img.src = m.url;
            img.loading = "lazy";
            img.alt = "画像";
            btn.appendChild(img);
            grid.appendChild(btn);
        }
        return grid;
    }

    /* ================= 画像プレビュー（ライトボックス） ================= */
    SNS.preview = function (url, type) {
        const box = document.createElement("div");
        box.className = "lightbox";
        let media;
        if (type === "video") {
            media = document.createElement("video");
            media.src = url;
            media.controls = true;
            media.autoplay = true;
            media.playsInline = true;
        } else {
            media = document.createElement("img");
            media.src = url;
            media.alt = "";
        }
        media.className = "lightbox-media";
        const close = document.createElement("button");
        close.type = "button";
        close.className = "lightbox-close";
        close.setAttribute("aria-label", "閉じる");
        close.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        box.append(media, close);
        document.body.appendChild(box);
        document.body.style.overflow = "hidden";
        const dispose = () => {
            box.remove();
            document.body.style.overflow = "";
            document.removeEventListener("keydown", onKey);
        };
        const onKey = (e) => {
            if (e.key === "Escape") dispose();
        };
        box.addEventListener("click", (e) => {
            if (e.target === box || e.target === close || close.contains(e.target))
                dispose();
        });
        document.addEventListener("keydown", onKey);
    };

    SNS.adminBadge = function () {
        const b = document.createElement("span");
        b.className = "admin-badge";
        b.textContent = "Admin";
        return b;
    };

    function renderPoll(post) {
        const poll = post.poll;
        const wrap = document.createElement("div");
        wrap.className = "poll";
        const total = poll.totalVotes;
        const done = poll.closed || poll.myVote !== null;

        poll.options.forEach((opt, i) => {
            if (done) {
                const pct = total ? Math.round((opt.votes / total) * 100) : 0;
                const row = document.createElement("div");
                row.className = "poll-result" + (poll.myVote === i ? " is-mine" : "");
                const bar = document.createElement("div");
                bar.className = "poll-bar";
                bar.style.width = pct + "%";
                const label = document.createElement("div");
                label.className = "poll-label";
                label.textContent = opt.text;
                const val = document.createElement("div");
                val.className = "poll-pct";
                val.textContent = pct + "%";
                row.append(bar, label, val);
                wrap.appendChild(row);
            } else {
                const b = document.createElement("button");
                b.type = "button";
                b.className = "poll-choice";
                b.dataset.vote = String(i);
                b.textContent = opt.text;
                wrap.appendChild(b);
            }
        });

        const foot = document.createElement("div");
        foot.className = "poll-foot";
        const left = poll.closed ? "終了" : SNS.untilTime(poll.endsAt);
        foot.textContent = total + "票 · " + left;
        wrap.appendChild(foot);
        return wrap;
    }
    SNS.renderPoll = renderPoll;

    SNS.renderEntry = function (entry, opts) {
        opts = opts || {};
        const post = entry.post || entry;
        const repostedBy = entry.kind === "repost" ? entry.repostedBy : null;

        const article = document.createElement("article");
        article.className = "post" + (opts.detail ? " post--detail" : "");
        article.dataset.id = post.id;

        if (repostedBy) {
            const ctx = document.createElement("div");
            ctx.className = "post-context";
            const ci = document.createElement("i");
            ci.className = "fa-solid fa-retweet";
            ctx.append(ci, document.createTextNode(" " + repostedBy.name + " さんがリポスト"));
            article.appendChild(ctx);
        }

        const row = document.createElement("div");
        row.className = "post-row";
        const avatarLink = document.createElement("a");
        avatarLink.className = "post-avatar";
        avatarLink.href = "/" + encodeURIComponent(post.author.userId);
        const avatar = document.createElement("span");
        avatar.className = "avatar";
        avatar.appendChild(SNS.imgFor(post.author));
        avatarLink.appendChild(avatar);
        row.appendChild(avatarLink);

        const body = document.createElement("div");
        body.className = "post-body";

        const head = document.createElement("div");
        head.className = "post-head";
        const nameLink = document.createElement("a");
        nameLink.className = "post-name";
        nameLink.href = "/" + encodeURIComponent(post.author.userId);
        nameLink.textContent = post.author.name;
        head.appendChild(nameLink);
        if (post.author.isAdmin) head.appendChild(SNS.adminBadge());
        const handle = document.createElement("span");
        handle.className = "post-handle";
        handle.textContent = post.author.handle;
        head.appendChild(handle);
        if (!opts.detail) {
            const dot = document.createElement("span");
            dot.className = "post-dot";
            dot.textContent = "·";
            const time = document.createElement("span");
            time.className = "post-time";
            time.textContent = SNS.relativeTime(post.createdAt);
            head.append(dot, time);
        }
        if (post.mine) {
            const del = document.createElement("button");
            del.type = "button";
            del.className = "post-del";
            del.dataset.act = "delete";
            del.title = "削除";
            del.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
            head.appendChild(del);
        }
        body.appendChild(head);

        if (post.text) {
            const textEl = document.createElement("p");
            textEl.className = "post-text";
            SNS.linkify(textEl, post.text);
            body.appendChild(textEl);
        }

        const mediaEl = renderMedia(post.media);
        if (mediaEl) body.appendChild(mediaEl);
        if (post.poll) body.appendChild(renderPoll(post));

        if (opts.detail) {
            const t = document.createElement("div");
            t.className = "post-detail-time";
            t.textContent = new Date(post.createdAt).toLocaleString("ja-JP");
            body.appendChild(t);
        }

        const actions = document.createElement("div");
        actions.className = "post-actions";
        actions.appendChild(actionButton("reply", "fa-regular fa-comment", post.replyCount));
        actions.appendChild(
            actionButton("repost", "fa-solid fa-retweet", post.repostCount, post.repostedByMe)
        );
        actions.appendChild(
            actionButton(
                "like",
                post.likedByMe ? "fa-solid fa-heart" : "fa-regular fa-heart",
                post.likeCount,
                post.likedByMe
            )
        );
        actions.appendChild(
            actionButton(
                "bookmark",
                post.bookmarkedByMe ? "fa-solid fa-bookmark" : "fa-regular fa-bookmark",
                null,
                post.bookmarkedByMe
            )
        );
        actions.appendChild(
            actionButton("share", "fa-solid fa-arrow-up-from-bracket", null)
        );
        body.appendChild(actions);

        row.appendChild(body);
        article.appendChild(row);
        return article;
    };

    /* ================= 操作（委譲） ================= */
    async function toggle(btn, id, kind) {
        const active = btn.classList.contains("is-active");
        const res = await SNS.api(
            active ? "DELETE" : "POST",
            "/api/posts/" + encodeURIComponent(id) + "/" + kind
        );
        if (res.status === 401) return (location.href = "/login");
        if (!res.data.ok) return;
        let on, count;
        if (kind === "like") { on = res.data.liked; count = res.data.likeCount; }
        else if (kind === "repost") { on = res.data.reposted; count = res.data.repostCount; }
        else { on = res.data.bookmarked; }
        btn.classList.toggle("is-active", on);
        const span = btn.querySelector("span");
        if (span && count !== undefined) span.textContent = count > 0 ? String(count) : "";
        const icon = btn.querySelector("i");
        if (kind === "like") icon.className = on ? "fa-solid fa-heart" : "fa-regular fa-heart";
        if (kind === "bookmark") {
            icon.className = on ? "fa-solid fa-bookmark" : "fa-regular fa-bookmark";
            SNS.notify(on ? "ブックマークに追加しました" : "ブックマークを削除しました");
        }
    }

    async function doDelete(id, article) {
        const yes = await SNS.confirm({
            title: "ポストを削除",
            message: "このポストを削除しますか？この操作は取り消せません。",
            okText: "削除",
            danger: true,
        });
        if (!yes) return;
        const res = await SNS.api("DELETE", "/api/posts/" + encodeURIComponent(id));
        if (res.status === 401) return (location.href = "/login");
        if (res.data && res.data.ok) {
            SNS.notify("ポストを削除しました");
            if (article.classList.contains("post--detail")) location.href = "/home";
            else article.remove();
        }
    }

    async function vote(article, id, option) {
        const res = await SNS.api("POST", "/api/posts/" + encodeURIComponent(id) + "/vote", {
            option,
        });
        if (res.status === 401) return (location.href = "/login");
        if (!res.data.ok) {
            SNS.notify((res.data.errors && res.data.errors.form) || "投票できませんでした", "error");
            return;
        }
        const old = article.querySelector(".poll");
        if (old) old.replaceWith(renderPoll({ poll: res.data.poll }));
    }

    function share(id) {
        const url = location.origin + "/status/" + id;
        if (navigator.clipboard) {
            navigator.clipboard.writeText(url).then(
                () => SNS.notify("リンクをコピーしました"),
                () => SNS.notify(url)
            );
        } else SNS.notify(url);
    }

    SNS.wire = function (root) {
        if (!root) return;
        root.addEventListener("click", async function (ev) {
            const previewEl = ev.target.closest("[data-preview]");
            if (previewEl) {
                ev.preventDefault();
                SNS.preview(previewEl.dataset.preview, previewEl.dataset.previewType);
                return;
            }
            const voteEl = ev.target.closest("[data-vote]");
            const article = ev.target.closest(".post");
            if (voteEl && article) {
                ev.preventDefault();
                await vote(article, article.dataset.id, parseInt(voteEl.dataset.vote, 10));
                return;
            }
            if (ev.target.closest("a")) return;
            if (!article) return;
            const id = article.dataset.id;
            const actEl = ev.target.closest("[data-act]");
            if (actEl) {
                ev.preventDefault();
                const act = actEl.dataset.act;
                if (act === "reply") location.href = "/status/" + encodeURIComponent(id);
                else if (act === "share") share(id);
                else if (act === "delete") await doDelete(id, article);
                else if (act === "like" || act === "repost" || act === "bookmark")
                    await toggle(actEl, id, act);
                return;
            }
            if (ev.target.closest("video")) return;
            if (!article.classList.contains("post--detail"))
                location.href = "/status/" + encodeURIComponent(id);
        });
    };

    /* ================= 絵文字 ================= */
    const EMOJI = [
        "😀","😃","😄","😁","😆","😅","😂","🤣","🙂","🙃","😉","😊","😇","🥰","😍",
        "🤩","😘","😋","😛","😜","🤪","🤗","🤔","🤨","😐","😑","😶","😏","😒","🙄",
        "😬","😌","😔","😪","😴","😷","🤒","🤕","🤢","🥳","🥺","😎","🤓","🧐","😕",
        "🙁","😮","😯","😲","😳","😥","😢","😭","😱","😖","😞","😩","😫","😤","😡",
        "🤬","😈","👍","👎","👏","🙌","🙏","✌️","🤞","🤟","🤘","👌","👈","👉","👆",
        "👇","✋","🖐️","👋","💪","🔥","✨","🎉","🎊","💯","✅","❌","⭐","🌟","💫",
        "⚡","☀️","🌈","☁️","❤️","🧡","💛","💚","💙","💜","🖤","🤍","💔","💕","💖",
        "👀","💬","💭","🎵","🎶","🚀","🐱","🐶","🍀","🌸","☕","🍵","🍜","🍺","🎂",
    ];

    SNS.attachEmoji = function (button, textarea) {
        button.addEventListener("click", (e) => {
            e.preventDefault();
            let panel = document.querySelector(".emoji-panel");
            if (panel) {
                panel.remove();
                return;
            }
            panel = document.createElement("div");
            panel.className = "emoji-panel";
            for (const em of EMOJI) {
                const b = document.createElement("button");
                b.type = "button";
                b.textContent = em;
                b.addEventListener("click", (ev) => {
                    ev.preventDefault();
                    const s = textarea.selectionStart || textarea.value.length;
                    const eN = textarea.selectionEnd || s;
                    textarea.value =
                        textarea.value.slice(0, s) + em + textarea.value.slice(eN);
                    textarea.dispatchEvent(new Event("input"));
                    textarea.focus();
                    textarea.selectionStart = textarea.selectionEnd = s + em.length;
                });
                panel.appendChild(b);
            }
            const rect = button.getBoundingClientRect();
            panel.style.left = Math.max(8, rect.left) + "px";
            panel.style.top = rect.bottom + window.scrollY + 6 + "px";
            document.body.appendChild(panel);
            setTimeout(() => {
                document.addEventListener(
                    "click",
                    function h(ev) {
                        if (!panel.contains(ev.target) && ev.target !== button) {
                            panel.remove();
                            document.removeEventListener("click", h);
                        }
                    },
                    { capture: true }
                );
            });
        });
    };

    /* ================= 投稿ボックス ================= */
    let capsCache = null;
    SNS.capabilities = async function () {
        if (capsCache) return capsCache;
        const res = await SNS.api("GET", "/api/capabilities");
        capsCache = res.data && res.data.ok ? res.data : { video: false };
        return capsCache;
    };

    async function encodeImage(file) {
        const bmp = await createImageBitmap(file).catch(() => null);
        if (!bmp) throw new Error("画像を読み込めませんでした");
        const max = 1600;
        let { width, height } = bmp;
        if (Math.max(width, height) > max) {
            const r = max / Math.max(width, height);
            width = Math.round(width * r);
            height = Math.round(height * r);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(bmp, 0, 0, width, height);
        const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
        return { blob, width, height };
    }

    // root: .composer 要素。onPosted(post) を呼ぶ。
    SNS.setupComposer = function (root, onPosted) {
        const textarea = root.querySelector(".composer-input");
        const submit = root.querySelector(".post-btn");
        const tools = root.querySelector(".composer-tools");
        const replyTo = root.dataset.replyTo || null;

        const mediaWrap = document.createElement("div");
        mediaWrap.className = "composer-media";
        const pollWrap = document.createElement("div");
        pollWrap.className = "composer-poll";
        pollWrap.hidden = true;
        textarea.insertAdjacentElement("afterend", pollWrap);
        pollWrap.insertAdjacentElement("afterend", mediaWrap);

        let pending = []; // { id, type, width, height }
        let pollActive = false;

        // ツールボタン
        const imgInput = document.createElement("input");
        imgInput.type = "file";
        imgInput.accept = "image/*";
        imgInput.multiple = true;
        imgInput.hidden = true;
        const vidInput = document.createElement("input");
        vidInput.type = "file";
        vidInput.accept = "video/*";
        vidInput.hidden = true;
        root.appendChild(imgInput);
        root.appendChild(vidInput);

        const mkTool = (icon, title, cb) => {
            const b = document.createElement("button");
            b.type = "button";
            b.title = title;
            b.innerHTML = '<i class="' + icon + '"></i>';
            b.addEventListener("click", cb);
            tools.appendChild(b);
            return b;
        };
        tools.innerHTML = "";
        const imgBtn = mkTool("fa-regular fa-image", "画像", () => imgInput.click());
        const vidBtn = mkTool("fa-solid fa-film", "動画", () => vidInput.click());
        const pollBtn = mkTool("fa-solid fa-square-poll-horizontal", "投票", togglePoll);
        const emojiBtn = mkTool("fa-regular fa-face-smile", "絵文字", () => {});
        SNS.attachEmoji(emojiBtn, textarea);

        SNS.capabilities().then((c) => {
            if (!c.video) {
                vidBtn.disabled = true;
                vidBtn.title = "動画は現在利用できません";
            }
        });

        function renderPending() {
            mediaWrap.innerHTML = "";
            pending.forEach((m, i) => {
                const cell = document.createElement("div");
                cell.className = "composer-media-cell";
                const url = "/api/media/" + m.id;
                if (m.type === "video") {
                    const v = document.createElement("video");
                    v.src = url;
                    v.muted = true;
                    cell.appendChild(v);
                } else {
                    const img = document.createElement("img");
                    img.src = url;
                    cell.appendChild(img);
                }
                cell.title = "クリックでプレビュー";
                cell.addEventListener("click", () => SNS.preview(url, m.type));
                const rm = document.createElement("button");
                rm.type = "button";
                rm.className = "composer-media-rm";
                rm.innerHTML = '<i class="fa-solid fa-xmark"></i>';
                rm.addEventListener("click", (e) => {
                    e.stopPropagation();
                    pending.splice(i, 1);
                    renderPending();
                    sync();
                });
                cell.appendChild(rm);
                mediaWrap.appendChild(cell);
            });
            const hasVideo = pending.some((m) => m.type === "video");
            imgBtn.disabled = pollActive || hasVideo || pending.length >= 4;
            vidBtn.disabled =
                pollActive || pending.length > 0 || vidBtn.dataset.unsupported === "1";
        }

        imgInput.addEventListener("change", async () => {
            const files = [...imgInput.files].slice(0, 4 - pending.length);
            imgInput.value = "";
            for (const f of files) {
                try {
                    const { blob, width, height } = await encodeImage(f);
                    const res = await SNS.api("POST", "/api/media/image", blob, {
                        raw: true,
                        contentType: "image/png",
                    });
                    if (res.data.ok) {
                        pending.push({
                            id: res.data.media.id,
                            type: "image",
                            width,
                            height,
                        });
                        renderPending();
                        sync();
                    } else {
                        SNS.notify(
                            (res.data.errors && res.data.errors.form) || "画像をアップロードできませんでした",
                            "error"
                        );
                    }
                } catch (e) {
                    SNS.notify("画像を処理できませんでした", "error");
                }
            }
        });

        vidInput.addEventListener("change", async () => {
            const f = vidInput.files[0];
            vidInput.value = "";
            if (!f) return;
            SNS.notify("動画をアップロード中…（変換に時間がかかります）");
            vidBtn.disabled = true;
            const res = await SNS.api("POST", "/api/media/video", f, {
                raw: true,
                contentType: f.type || "application/octet-stream",
            });
            if (res.data.ok) {
                pending = [{ id: res.data.media.id, type: "video" }];
                renderPending();
                sync();
                SNS.notify("動画を追加しました");
            } else {
                SNS.notify(
                    (res.data.errors && res.data.errors.form) || "動画をアップロードできませんでした",
                    "error"
                );
                renderPending();
            }
        });

        function togglePoll(e) {
            e.preventDefault();
            pollActive = !pollActive;
            pollWrap.hidden = !pollActive;
            if (pollActive && !pollWrap.dataset.built) buildPoll();
            renderPending();
            sync();
        }
        function buildPoll() {
            pollWrap.dataset.built = "1";
            pollWrap.innerHTML =
                '<div class="poll-inputs"></div>' +
                '<div class="poll-config">' +
                '<button type="button" class="poll-add">選択肢を追加</button>' +
                '<select class="poll-dur">' +
                '<option value="1440">1日</option><option value="4320">3日</option>' +
                '<option value="10080">7日</option><option value="60">1時間</option>' +
                "</select>" +
                '<button type="button" class="poll-remove">投票をやめる</button>' +
                "</div>";
            const inputs = pollWrap.querySelector(".poll-inputs");
            const addOpt = () => {
                if (inputs.children.length >= 4) return;
                const i = document.createElement("input");
                i.type = "text";
                i.maxLength = 25;
                i.placeholder = "選択肢" + (inputs.children.length + 1);
                i.addEventListener("input", sync);
                inputs.appendChild(i);
                pollWrap.querySelector(".poll-add").disabled = inputs.children.length >= 4;
            };
            addOpt();
            addOpt();
            pollWrap.querySelector(".poll-add").addEventListener("click", addOpt);
            pollWrap.querySelector(".poll-remove").addEventListener("click", (e) => {
                e.preventDefault();
                pollActive = false;
                pollWrap.hidden = true;
                renderPending();
                sync();
            });
        }
        function getPoll() {
            if (!pollActive) return null;
            const opts = [...pollWrap.querySelectorAll(".poll-inputs input")]
                .map((i) => i.value.trim())
                .filter(Boolean);
            if (opts.length < 2) return null;
            return {
                options: opts,
                durationMinutes: parseInt(pollWrap.querySelector(".poll-dur").value, 10),
            };
        }

        function sync() {
            const hasText = textarea.value.trim().length > 0;
            const okLen = textarea.value.trim().length <= 280;
            const poll = getPoll();
            submit.disabled =
                !okLen || (!hasText && pending.length === 0 && !poll) || (pollActive && !poll);
        }
        function autosize() {
            textarea.style.height = "auto";
            textarea.style.height = textarea.scrollHeight + "px";
        }
        textarea.addEventListener("input", () => {
            autosize();
            sync();
        });
        sync();

        submit.addEventListener("click", async () => {
            const payload = { text: textarea.value.trim() };
            if (replyTo) payload.replyTo = replyTo;
            if (pending.length) payload.media = pending.map((m) => ({ id: m.id }));
            const poll = getPoll();
            if (poll) payload.poll = poll;
            submit.disabled = true;
            const res = await SNS.api("POST", "/api/posts", payload);
            if (res.status === 401) return (location.href = "/login");
            if (res.data.ok) {
                textarea.value = "";
                autosize();
                pending = [];
                pollActive = false;
                pollWrap.hidden = true;
                delete pollWrap.dataset.built;
                pollWrap.innerHTML = "";
                renderPending();
                sync();
                if (onPosted) onPosted(res.data.post);
            } else {
                const err = res.data.errors || {};
                SNS.notify(err.text || err.form || "投稿に失敗しました", "error");
                sync();
            }
        });

        renderPending();
    };

    /* ================= シェル ================= */
    const NAV = [
        { key: "home", href: "/home", icon: "fa-solid fa-house", label: "ホーム" },
        { key: "search", href: "/search", icon: "fa-solid fa-magnifying-glass", label: "話題を検索" },
        { key: "notifications", href: "/notifications", icon: "fa-regular fa-bell", label: "通知", badge: true },
        { key: "bookmarks", href: "/bookmarks", icon: "fa-regular fa-bookmark", label: "ブックマーク" },
        { key: "profile", href: "#", icon: "fa-regular fa-user", label: "プロフィール", nav: "profile" },
        { key: "settings", href: "/settings", icon: "fa-solid fa-gear", label: "設定" },
    ];

    function sidebarHtml(activeKey) {
        const items = NAV.map((n) => {
            const active = n.key === activeKey ? " active" : "";
            const badge = n.badge ? '<span class="nav-badge" hidden>0</span>' : "";
            const navAttr = n.nav ? ' data-nav="' + n.nav + '"' : "";
            return (
                '<a href="' + n.href + '" class="nav-item' + active + '"' + navAttr +
                '><i class="' + n.icon + '"></i><span>' + n.label + "</span>" + badge + "</a>"
            );
        }).join("");
        return (
            '<div class="sidebar-inner">' +
            '<a href="/home" class="logo" aria-label="ホーム"><img src="Images/logo.png" alt="Logo"></a>' +
            '<nav class="nav">' + items + "</nav>" +
            '<button type="button" class="post-btn" id="go-compose">ポストする</button>' +
            '<button type="button" class="account" id="logout" title="ログアウト">' +
            '<span class="avatar avatar--sm" data-user-avatar aria-hidden="true"><i class="fa-solid fa-user"></i></span>' +
            '<span class="account-meta"><span class="account-name" data-user-name>ゲスト</span>' +
            '<span class="account-handle" data-user-handle>@guest</span></span>' +
            '<i class="fa-solid fa-arrow-right-from-bracket"></i></button>' +
            "</div>"
        );
    }
    function asideHtml() {
        return (
            '<div class="aside-inner">' +
            '<form class="search" data-search-form><i class="fa-solid fa-magnifying-glass"></i>' +
            '<input type="search" placeholder="検索" aria-label="検索"></form>' +
            '<section class="card"><h2>いま起きていること</h2>' +
            '<div class="trends" data-trends><div class="trend-empty">読み込み中…</div></div></section>' +
            '<footer class="aside-footer"><a href="#">利用規約</a><a href="#">プライバシー</a>' +
            '<a href="#">Cookie</a><span>© 2026 Felisa</span></footer></div>'
        );
    }

    function trendLink(t, i) {
        const a = document.createElement("a");
        a.className = "trend";
        a.href = "/search?q=" + encodeURIComponent("#" + t.tag);
        const cat = document.createElement("span");
        cat.className = "trend-cat";
        cat.textContent = i + 1 + " · トレンド";
        const title = document.createElement("span");
        title.className = "trend-title";
        title.textContent = "#" + t.tag;
        const count = document.createElement("span");
        count.className = "trend-count";
        count.textContent = t.count + " 件のポスト";
        a.append(cat, title, count);
        return a;
    }
    SNS.trendLink = trendLink;

    async function loadTrends() {
        const box = document.querySelector("[data-trends]");
        if (!box) return;
        const res = await SNS.api("GET", "/api/trends");
        const list = (res.data && res.data.trends) || [];
        box.innerHTML = "";
        if (!list.length) {
            box.innerHTML = '<div class="trend-empty">まだトレンドはありません</div>';
            return;
        }
        list.forEach((t, i) => {
            box.appendChild(trendLink(t, i));
        });
    }

    SNS.setBadge = function (n) {
        const badge = document.querySelector(".nav-badge");
        if (!badge) return;
        badge.textContent = n > 99 ? "99+" : String(n);
        badge.hidden = !n;
    };
    SNS.applyShellUser = function (me) {
        if (!me) return;
        document.querySelectorAll("[data-user-name]").forEach((el) => {
            el.textContent = me.name;
            if (me.isAdmin) el.appendChild(SNS.adminBadge());
        });
        document.querySelectorAll("[data-user-handle]").forEach((el) => (el.textContent = me.handle));
        document.querySelectorAll("[data-user-avatar]").forEach((el) => {
            el.innerHTML = "";
            el.appendChild(SNS.imgFor(me));
        });
        const pnav = document.querySelector('[data-nav="profile"]');
        if (pnav) pnav.href = "/" + encodeURIComponent(me.userId);
        SNS.setBadge(me.unreadNotifications || 0);
    };
    SNS.loadMe = async function (opts) {
        opts = opts || {};
        const res = await SNS.api("GET", "/api/me");
        if (res.status === 401 || !res.data.ok) {
            SNS.currentUser = null;
            if (opts.redirect) location.replace("/login");
            return null;
        }
        SNS.currentUser = Object.assign({}, res.data.user, {
            unreadNotifications: res.data.unreadNotifications || 0,
        });
        return SNS.currentUser;
    };

    SNS.mountShell = async function (activeKey) {
        const sidebar = document.querySelector("[data-shell-sidebar]");
        const aside = document.querySelector("[data-shell-aside]");
        if (sidebar) sidebar.innerHTML = sidebarHtml(activeKey);
        if (aside) aside.innerHTML = asideHtml();

        document.querySelectorAll("[data-search-form]").forEach((form) => {
            form.addEventListener("submit", (e) => {
                e.preventDefault();
                const v = form.querySelector("input").value.trim();
                if (v) location.href = "/search?q=" + encodeURIComponent(v);
            });
        });
        const compose = document.getElementById("go-compose");
        if (compose)
            compose.addEventListener("click", () => {
                const t = document.getElementById("composer-text");
                if (t && location.pathname === "/home") t.focus();
                else location.href = "/home";
            });
        const logout = document.getElementById("logout");
        if (logout)
            logout.addEventListener("click", async () => {
                await SNS.api("POST", "/api/logout");
                location.replace("/login");
            });

        loadTrends();
        const me = await SNS.loadMe({ redirect: false });
        SNS.applyShellUser(me);
        return me;
    };

    window.SNS = SNS;
})();
