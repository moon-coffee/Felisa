// アップロードされた PNG の最低限の検証（マジックバイト + IHDR）。
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// buf が PNG なら { width, height }、違えば null
function inspect(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 33) return null;
    if (!buf.subarray(0, 8).equals(SIG)) return null;
    // 最初のチャンクは必ず IHDR
    if (buf.toString("ascii", 12, 16) !== "IHDR") return null;
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    if (width < 1 || height < 1 || width > 4096 || height > 4096) return null;
    return { width, height };
}

module.exports = { inspect };
