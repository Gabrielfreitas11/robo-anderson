const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const { extractSalesFromDom } = require("./scraper");

async function main() {
  const exemploPath = path.join(__dirname, "..", "exemplo.html");
  const outPath = path.join(__dirname, "vendas.json");

  if (!fs.existsSync(exemploPath)) {
    throw new Error(`Arquivo não encontrado: ${exemploPath}`);
  }

  const html = fs.readFileSync(exemploPath, "utf8");

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  // O exemplo.html é um documento completo; para evitar DOM inválida dentro de <table>,
  // seguimos o padrão dos checks: embute o HTML inteiro dentro de <tbody>.
  await page.setContent(`<table><tbody>${html}</tbody></table>`, { waitUntil: "domcontentloaded" });

  const sales = await extractSalesFromDom(page);
  await browser.close();

  const byId = new Map();
  for (const s of sales) {
    const id = String(s?.id || "").trim();
    if (!id) continue;
    if (!byId.has(id)) byId.set(id, s);
  }

  const list = Array.from(byId.values());

  // Escrita atômica
  const tmp = `${outPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, outPath);

  console.log(`Recriado: ${outPath}`);
  console.log(`Itens: ${list.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
