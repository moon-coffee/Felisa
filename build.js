// 本番用ビルド: Client/ を minify して dist/ に出力する。
// 生成物は Server/server.js が NODE_ENV=production のとき配信する。
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { minify: minifyJs } = require("terser");
const { minify: minifyHtml } = require("html-minifier-terser");
const csso = require("csso");

const SRC = path.join(__dirname, "Client");
const OUT = path.join(__dirname, "dist");

async function processFile(srcPath, outPath) {
    const ext = path.extname(srcPath).toLowerCase();

    if (ext === ".js") {
        const code = await fsp.readFile(srcPath, "utf8");
        const result = await minifyJs(code, {
            compress: true,
            mangle: true,
            format: { comments: false },
        });
        await fsp.writeFile(outPath, result.code, "utf8");
        return;
    }

    if (ext === ".css") {
        const code = await fsp.readFile(srcPath, "utf8");
        await fsp.writeFile(outPath, csso.minify(code).css, "utf8");
        return;
    }

    if (ext === ".html") {
        const code = await fsp.readFile(srcPath, "utf8");
        const result = await minifyHtml(code, {
            collapseWhitespace: true,
            removeComments: true,
            minifyCSS: true,
            minifyJS: true,
        });
        await fsp.writeFile(outPath, result, "utf8");
        return;
    }

    // 画像などはそのままコピー
    await fsp.copyFile(srcPath, outPath);
}

async function copyDir(src, out) {
    await fsp.mkdir(out, { recursive: true });
    const entries = await fsp.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const outPath = path.join(out, entry.name);
        if (entry.isDirectory()) {
            await copyDir(srcPath, outPath);
        } else {
            await processFile(srcPath, outPath);
        }
    }
}

async function main() {
    await fsp.rm(OUT, { recursive: true, force: true });
    await copyDir(SRC, OUT);
    console.log(`Build complete -> ${path.relative(process.cwd(), OUT)}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
