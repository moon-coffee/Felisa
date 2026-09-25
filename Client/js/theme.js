/* テーマ（ダーク / ライト / 端末に合わせる）の早期適用。

   CSP (script-src 'self') ではインライン script が使えないため、head の
   インライン <style>（白い画面対策の背景色）より後に効く「外部スクリプト」として
   各ページの head から同期読み込みする。ここで data-theme を付けておかないと、
   CSS 読み込み前にダーク背景が一瞬表示される。

   選択内容は localStorage ("felisa-theme") に dark / light / system で保存され、
   settings ページから変更できる（未設定なら system）。 */
(function () {
    "use strict";

    var KEY = "felisa-theme";
    var MODES = ["dark", "light", "system"];
    var current = "system";

    function readStored() {
        try {
            var v = localStorage.getItem(KEY);
            return MODES.indexOf(v) >= 0 ? v : "system";
        } catch (e) {
            return "system";
        }
    }

    function prefersLight() {
        return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches);
    }

    function isLight(mode) {
        return mode === "light" || (mode === "system" && prefersLight());
    }

    // ライトテーマ時は head のインライン <style>（#252525 固定）を上書きする
    function ensureBootStyle() {
        var st = document.getElementById("theme-boot");
        if (st) return;
        st = document.createElement("style");
        st.id = "theme-boot";
        st.textContent =
            'html[data-theme="light"],html[data-theme="light"] body{background:#f5f5f5}';
        document.head.appendChild(st);
    }

    function apply() {
        var light = isLight(current);
        var el = document.documentElement;
        el.setAttribute("data-theme", light ? "light" : "dark");
        el.style.colorScheme = light ? "light" : "dark";
        var meta = document.querySelector('meta[name="color-scheme"]');
        if (meta) meta.setAttribute("content", light ? "light dark" : "dark");
        if (light) ensureBootStyle();
    }

    function set(mode) {
        if (MODES.indexOf(mode) < 0) mode = "system";
        current = mode;
        try {
            if (mode === "system") localStorage.removeItem(KEY);
            else localStorage.setItem(KEY, mode);
        } catch (e) {}
        apply();
    }

    // system のときは OS の設定変更に追随する
    if (window.matchMedia) {
        var mq = window.matchMedia("(prefers-color-scheme: light)");
        var onChange = function () {
            if (current === "system") apply();
        };
        if (mq.addEventListener) mq.addEventListener("change", onChange);
        else if (mq.addListener) mq.addListener(onChange);
    }

    current = readStored();
    apply();

    window.FelisaTheme = {
        get: function () {
            return current;
        },
        set: set,
        isLight: function () {
            return isLight(current);
        },
    };
})();
