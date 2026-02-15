const fs = require("fs");
const path = require("path");

const BASE_DIR = __dirname;

const SALES_FILE = path.join(BASE_DIR, "vendas.json");
const STATE_FILE = path.join(BASE_DIR, "state.json");

function ensureFileExists(filePath, defaultContent) {
  if (fs.existsSync(filePath)) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, defaultContent, "utf8");
}

function readJsonFile(filePath, fallbackValue) {
  try {
    if (!fs.existsSync(filePath)) return fallbackValue;
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return fallbackValue;
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[storage] Falha ao ler JSON ${filePath}:`, err.message);
    return fallbackValue;
  }
}

function atomicWriteJson(filePath, data) {
  const tmpPath = `${filePath}.tmp`;
  const json = JSON.stringify(data, null, 2);
  fs.writeFileSync(tmpPath, json, "utf8");
  fs.renameSync(tmpPath, filePath);
}

function loadSales() {
  ensureFileExists(SALES_FILE, "[]\n");
  const sales = readJsonFile(SALES_FILE, []);
  return Array.isArray(sales) ? sales : [];
}

function getSaleStrongDedupeKeys(sale) {
  if (!sale || typeof sale !== "object") return [];

  const keys = [];
  const pushKey = (v) => {
    if (v === undefined || v === null) return;
    const s = String(v).trim();
    if (!s) return;
    keys.push(s);
  };

  // Chaves fortes/estáveis
  pushKey(sale.id);
  pushKey(sale.upsellerId);
  pushKey(sale.orderId);
  pushKey(sale.pedidoId);

  return Array.from(new Set(keys));
}

function appendSales(newSales) {
  if (!Array.isArray(newSales) || newSales.length === 0) return { appended: 0 };

  const existing = loadSales();
  const existingStrongKeys = new Set();
  const existingPrimaryIds = new Set();
  for (const s of existing) {
    for (const k of getSaleStrongDedupeKeys(s)) existingStrongKeys.add(k);
    if (s?.id) existingPrimaryIds.add(String(s.id).trim());
    if (s?.upsellerId) existingPrimaryIds.add(String(s.upsellerId).trim());
  }

  const filtered = newSales.filter((s) => {
    const keys = getSaleStrongDedupeKeys(s);
    if (keys.length === 0) return false;

    // Dedupe por chaves fortes
    for (const k of keys) {
      if (existingStrongKeys.has(k)) return false;
    }

    // Compat: `legacyId` só deve impedir duplicação quando ele bater com um `id` antigo já salvo.
    const legacy = s && typeof s === "object" && s.legacyId ? String(s.legacyId).trim() : "";
    if (legacy && existingPrimaryIds.has(legacy)) return false;

    // Marca como conhecido
    for (const k of keys) existingStrongKeys.add(k);
    if (s?.id) existingPrimaryIds.add(String(s.id).trim());
    if (s?.upsellerId) existingPrimaryIds.add(String(s.upsellerId).trim());
    return true;
  });

  if (filtered.length === 0) return { appended: 0, appendedSales: [] };

  const merged = existing.concat(filtered);
  atomicWriteJson(SALES_FILE, merged);
  return { appended: filtered.length, appendedSales: filtered };
}

function loadState() {
  ensureFileExists(STATE_FILE, JSON.stringify({ knownIds: [], lastRunAt: null, lastPdfAt: null }, null, 2) + "\n");
  const st = readJsonFile(STATE_FILE, { knownIds: [], lastRunAt: null, lastPdfAt: null });

  if (!st || typeof st !== "object") {
    return { knownIds: [], lastRunAt: null, lastPdfAt: null };
  }

  if (!Array.isArray(st.knownIds)) st.knownIds = [];
  if (typeof st.lastRunAt !== "string" && st.lastRunAt !== null) st.lastRunAt = null;
  if (typeof st.lastPdfAt !== "string" && st.lastPdfAt !== null) st.lastPdfAt = null;

  return st;
}

function saveState(state) {
  atomicWriteJson(STATE_FILE, state);
}

module.exports = {
  SALES_FILE,
  STATE_FILE,
  loadSales,
  appendSales,
  loadState,
  saveState,
};
