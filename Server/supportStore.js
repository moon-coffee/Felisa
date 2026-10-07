const crypto = require("crypto");
const path = require("path");
const { readArray, writeArray } = require("./jsonStore");

const DATA_DIR = path.join(__dirname, "data");
const REPORTS_FILE = path.join(DATA_DIR, "reports.json");
const INQUIRIES_FILE = path.join(DATA_DIR, "inquiries.json");
const MAX_RECORDS = 5000;

function read(file) {
    return readArray(file).filter((row) => row && typeof row === "object");
}

function append(file, row) {
    const rows = read(file);
    rows.unshift(row);
    writeArray(file, rows.slice(0, MAX_RECORDS));
    return row;
}

function createReport(report) {
    return append(REPORTS_FILE, {
        id: crypto.randomUUID(),
        ...report,
        status: "open",
        createdAt: Date.now(),
    });
}

function listReports() {
    return read(REPORTS_FILE).sort((a, b) => b.createdAt - a.createdAt);
}

function reviewReport(id) {
    const rows = read(REPORTS_FILE);
    const report = rows.find((row) => row.id === id);
    if (!report) return null;
    report.status = "reviewed";
    report.reviewedAt = Date.now();
    writeArray(REPORTS_FILE, rows);
    return report;
}

function createInquiry(inquiry) {
    return append(INQUIRIES_FILE, {
        id: crypto.randomUUID(),
        ...inquiry,
        status: "open",
        createdAt: Date.now(),
    });
}

function listInquiries() {
    return read(INQUIRIES_FILE).sort((a, b) => b.createdAt - a.createdAt);
}

function reviewInquiry(id) {
    const rows = read(INQUIRIES_FILE);
    const inquiry = rows.find((row) => row.id === id);
    if (!inquiry) return null;
    inquiry.status = "reviewed";
    inquiry.reviewedAt = Date.now();
    writeArray(INQUIRIES_FILE, rows);
    return inquiry;
}

module.exports = {
    createReport,
    listReports,
    reviewReport,
    createInquiry,
    listInquiries,
    reviewInquiry,
};
