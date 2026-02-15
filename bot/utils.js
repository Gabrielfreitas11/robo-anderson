const crypto = require("crypto");

function nowIso() {
  return new Date().toISOString();
}

function formatDateForFilename(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `${yyyy}-${mm}-${dd}-${hh}-${min}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, label = "Operação") {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} excedeu timeout (${ms}ms)`));
    }, ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

function sha1(input) {
  return crypto.createHash("sha1").update(String(input)).digest("hex");
}

function normalizeMoneyText(text) {
  if (!text) return "";
  return String(text)
    .replace(/[\u200e\u200f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/R\$\s?/gi, "R$ ")
    .trim();
}

function parseMoneyToNumber(valueText) {
  if (!valueText) return null;
  const cleaned = String(valueText)
    .replace(/R\$\s?/gi, "")
    .replace(/\./g, "")
    .replace(/,/g, ".")
    .replace(/[^0-9.\-]/g, "")
    .trim();

  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function safeToString(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

module.exports = {
  nowIso,
  formatDateForFilename,
  sleep,
  withTimeout,
  sha1,
  normalizeMoneyText,
  parseMoneyToNumber,
  safeToString,
};
