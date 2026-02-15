const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

async function main() {
  const html = fs.readFileSync(path.join(__dirname, "..", "exemplo.html"), "utf8");

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  // O exemplo.html é um documento completo; para evitar DOM inválida dentro de <table>,
  // seguimos a mesma técnica do dev_example_check.
  await page.setContent(`<table><tbody>${html}</tbody></table>`, { waitUntil: "domcontentloaded" });

  const stats = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll(".my_table_border"));
    const counts = rows.map((r) => {
      const firstTd = r.querySelector("td");
      const codes = firstTd
        ? Array.from(firstTd.querySelectorAll("a[title]"))
            .map((a) => (a.getAttribute("title") || a.innerText || "").trim())
            .filter(Boolean)
        : [];
      return codes.length;
    });

    const max = counts.length ? Math.max(...counts) : 0;
    const multi = counts.filter((c) => c > 1).length;
    const hist = {};
    for (const c of counts) hist[c] = (hist[c] || 0) + 1;

    return {
      totalOrdersInDom: rows.length,
      maxCodesPerOrder: max,
      ordersWithMultiProducts: multi,
      histogram: hist,
    };
  });

  console.log(JSON.stringify(stats, null, 2));
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
