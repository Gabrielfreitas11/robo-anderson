const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const { extractSalesFromDom } = require("./scraper");

async function main() {
  const html = fs.readFileSync(path.join(__dirname, "..", "exemplo.html"), "utf8");

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(`<table><tbody>${html}</tbody></table>`, { waitUntil: "domcontentloaded" });

  const sales = await extractSalesFromDom(page);

  const withProdutos = sales.filter((s) => Array.isArray(s.produtos) && s.produtos.length > 0);
  const multi = sales.filter((s) => Array.isArray(s.produtos) && s.produtos.length > 1);
  const maxLen = Math.max(0, ...withProdutos.map((s) => s.produtos.length));

  console.log({ total: sales.length, withProdutos: withProdutos.length, multi: multi.length, maxLen });

  for (const s of multi.slice(0, 10)) {
    console.log("multi:", { id: s.id, produtos: s.produtos });
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
