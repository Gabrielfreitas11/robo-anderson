const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const { extractSalesFromDom } = require("./scraper");

function readExampleHtml() {
  const p = path.join(__dirname, "..", "exemplo.html");
  let html = fs.readFileSync(p, "utf8");

  // Se o arquivo estiver dentro de um bloco markdown ```html ... ```
  html = html.replace(/^\s*```html\s*/i, "").replace(/\s*```\s*$/i, "");
  return html;
}

async function main() {
  const html = readExampleHtml();

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();

  // O exemplo.html é basicamente uma sequência de <tr>...</tr>.
  // Colocamos dentro de <table><tbody> para o DOM ficar válido.
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"></head><body><table><tbody>${html}</tbody></table></body></html>`,
    { waitUntil: "domcontentloaded" }
  );

  const counts = await page.evaluate(() => {
    return {
      top: document.querySelectorAll(".top_row").length,
      bordered: document.querySelectorAll(".my_table_border").length,
      trs: document.querySelectorAll("tr").length,
    };
  });

  const sales = await extractSalesFromDom(page);

  const ids = sales.map((s) => s && s.id).filter(Boolean);
  const uniqueIds = new Set(ids);

  console.log("DOM counts:", counts);
  console.log("sales:", { count: sales.length, uniqueIds: uniqueIds.size });

  const targetPlatformOrder = "2602181WJE8H5G";
  const platformHit = sales.find((s) => String(s?.pedidoNumero || "").trim() === targetPlatformOrder);
  const missingPedidoNumero = sales.filter((s) => !String(s?.pedidoNumero || "").trim()).length;
  console.log("platform order target", targetPlatformOrder, "found?", Boolean(platformHit), platformHit ? { id: platformHit.id, upsellerId: platformHit.upsellerId } : null);
  console.log("missing pedidoNumero:", missingPedidoNumero);

  const targetSku = "00001480E";
  let skuHit = null;
  for (const s of sales) {
    const itens = Array.isArray(s?.itens) ? s.itens : [];
    for (const item of itens) {
      if (String(item?.sku || "").trim() === targetSku) {
        skuHit = { id: s.id, upsellerId: s.upsellerId, pedidoNumero: s.pedidoNumero };
        break;
      }
    }
    if (skuHit) break;
  }
  console.log("SKU target", targetSku, "found?", Boolean(skuHit), skuHit);

  const missingTargets = [
    "#UP5HGF014291",
    "#UP5HGF014305",
    "#UP5HGF014318",
    "#UP5HGF014322",
    "#UP5HGF014324",
    "#UP5HGF014327",
    "#UP5HGF014339",
  ];

  for (const t of missingTargets) {
    const found = sales.find((s) => s && (s.id === t || s.upsellerId === t));
    console.log("target", t, "found?", Boolean(found), found ? { id: found.id, pedidoNumero: found.pedidoNumero, valor: found.valor } : null);
  }

  // Mostra possíveis colisões de pedidoNumero (sinal de dedupe arriscado)
  const byPedido = new Map();
  for (const s of sales) {
    const k = String(s?.pedidoNumero || "").trim();
    if (!k) continue;
    const arr = byPedido.get(k) || [];
    arr.push(s.id);
    byPedido.set(k, arr);
  }
  const duplicates = [...byPedido.entries()].filter(([, arr]) => arr.length > 1);
  console.log("pedidoNumero duplicates:", duplicates.slice(0, 20));

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
