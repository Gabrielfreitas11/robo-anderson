const fs = require("fs");
const path = require("path");

const SALES_FILE = path.join(__dirname, "vendas.json");
const STATE_FILE = path.join(__dirname, "state.json");

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, filePath);
}

function extractFirstLongNumber(text) {
  const m = String(text || "").match(/\b\d{10,}\b/);
  return m?.[0] || "";
}

function makeDedupeKey(sale) {
  // Preferência: número de pedido (mais estável)
  const fromId = extractFirstLongNumber(sale?.id);
  if (fromId) return fromId;

  const fromProduto = extractFirstLongNumber(sale?.produto);
  if (fromProduto) return fromProduto;

  // Fallback: usa id literal
  if (sale?.id !== undefined && sale?.id !== null) return String(sale.id);

  // Último fallback: produto + cliente + dataHora
  return [sale?.produto, sale?.cliente, sale?.dataHora].map((v) => String(v || "").trim()).join("|");
}

function main() {
  const args = new Set(process.argv.slice(2));
  const rewriteState = args.has("--rewrite-state");
  const keep = args.has("--keep=last") ? "last" : "first";

  const sales = readJson(SALES_FILE, []);
  if (!Array.isArray(sales)) {
    console.error("vendas.json não é um array válido.");
    process.exitCode = 1;
    return;
  }

  const seen = new Set();
  const out = [];

  const iter = keep === "last" ? [...sales].reverse() : sales;
  for (const s of iter) {
    const key = makeDedupeKey(s);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }

  const finalOut = keep === "last" ? out.reverse() : out;

  const removed = sales.length - finalOut.length;
  writeJson(SALES_FILE, finalOut);
  console.log(`[cleanup] vendas.json: removidos ${removed}, total agora ${finalOut.length}`);

  if (rewriteState) {
    const state = readJson(STATE_FILE, { knownIds: [], lastRunAt: null, lastPdfAt: null });
    state.knownIds = finalOut.map((s) => String(s.id)).filter(Boolean).slice(-50_000);
    writeJson(STATE_FILE, state);
    console.log("[cleanup] state.json atualizado com knownIds do arquivo deduplicado.");
  }
}

main();
