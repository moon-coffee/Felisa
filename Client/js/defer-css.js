/* 遅延ロードしたリモートCSS（Google Fonts / Font Awesome）を、取得完了後に有効化する。

   ページ切替時の白い画面は「リモートCSSが描画をブロックしている間」に発生する。
   そのため head 内のリモート link は media="print"（描画ブロックしない）にしておき、
   取得が終わってから media="all" に戻して適用する。

   CSP (script-src 'self') ではインラインの onload ハンドラが使えないため、
   この外部スクリプトから切り替える。切り替えは必ず「読み込み完了後」に行い、
   未完了の link の media を変えて描画ブロックが復活しないようにする。 */
(function () {
    "use strict";

    function activate(link) {
        if (link.media !== "all") link.media = "all";
    }

    function run() {
        const links = document.querySelectorAll('link[data-lazy-css][media="print"]');
        for (const link of links) {
            if (link.sheet) activate(link);
            else link.addEventListener("load", () => activate(link), { once: true });
        }
    }

    if (document.readyState === "loading")
        document.addEventListener("DOMContentLoaded", run, { once: true });
    else run();
})();
