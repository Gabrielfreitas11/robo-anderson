const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

async function main() {
  const html = fs.readFileSync(path.join(__dirname, "..", "exemplo.html"), "utf8");
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(`<table><tbody>${html}</tbody></table>`, { waitUntil: "domcontentloaded" });

  const res = await page.evaluate(() => {
    const cleanText = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const extractTopIdFromRow = (rowEl) => {
      if (!rowEl) return "";
      const a = rowEl.querySelector("a");
      const txt = cleanText((a && a.innerText) || rowEl.innerText || "");
      const m = txt.match(/#UP[0-9A-Z]+/i);
      return m ? m[0].toUpperCase() : "";
    };

    const out = [];
    for (const el of Array.from(document.querySelectorAll(".my_table_border"))) {
      let upsellerId = "";
      let prev = el.previousElementSibling;
      for (let i = 0; i < 8 && prev; i++) {
        if (prev.classList && prev.classList.contains("top_row")) {
          upsellerId = extractTopIdFromRow(prev);
          break;
        }
        prev = prev.previousElementSibling;
      }

      const firstTd = el.querySelector("td");
      const codes = firstTd
        ? Array.from(firstTd.querySelectorAll("a[title]"))
            .map((a) => ({ title: (a.getAttribute("title") || "").trim(), text: cleanText(a.innerText || "") }))
            .filter((x) => x.title || x.text)
        : [];

      if (codes.length > 1) out.push({ upsellerId, codes });
    }
    return out;
  });

  console.log(JSON.stringify(res, null, 2));
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
