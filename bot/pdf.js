const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

const { formatDateForFilename, parseMoneyToNumber, safeToString } = require("./utils");

const REPORTS_DIR = path.join(__dirname, "reports");

function ensureReportsDir() {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

function sumSales(sales) {
  return sales.reduce((acc, s) => {
    const n = parseMoneyToNumber(s.valor);
    return acc + (Number.isFinite(n) ? n : 0);
  }, 0);
}

function formatCurrencyBRLFromNumber(n) {
  if (!Number.isFinite(n)) return "R$ 0,00";
  return `R$ ${n.toFixed(2).replace(".", ",")}`;
}

function getTextHeight(doc, text, { width, font = "Helvetica", fontSize = 9, lineGap = 2, height } = {}) {
  doc.font(font).fontSize(fontSize);
  // `heightOfString` considera wrap; usamos lineGap pra evitar linhas coladas.
  // Se `height` vier definido, ele não muda o cálculo (é só para renderização), então ignoramos aqui.
  return doc.heightOfString(safeToString(text), { width, lineGap });
}

function drawTableHeader(doc, y, columns) {
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#111111");
  columns.forEach((c) => {
    doc.text(c.label, c.x, y, { width: c.width, height: 14, ellipsis: true });
  });

  const leftX = columns[0]?.x ?? doc.page.margins.left;
  const rightX = columns.reduce((acc, c) => Math.max(acc, c.x + c.width), leftX);
  doc
    .moveTo(leftX, y + 16)
    .lineTo(rightX, y + 16)
    .lineWidth(1)
    .strokeColor("#999999")
    .stroke();
}

function drawRow(doc, y, columns, row, { zebra = false, zebraColor = "#f5f7fa", fontSize = 9, lineGap = 2 } = {}) {
  // Calcula a altura máxima necessária para não sobrepor linhas.
  const cellHeights = columns.map((c) =>
    getTextHeight(doc, safeToString(row[c.key]), { width: c.width, font: "Helvetica", fontSize, lineGap })
  );
  const maxHeight = Math.max(14, ...cellHeights);
  const paddingY = 3;
  const rowHeight = Math.ceil(maxHeight + paddingY * 2);

  const leftX = columns[0]?.x ?? doc.page.margins.left;
  const rightX = columns.reduce((acc, c) => Math.max(acc, c.x + c.width), leftX);
  const tableWidth = rightX - leftX;

  if (zebra) {
    doc.save();
    doc.rect(leftX, y - 1, tableWidth, rowHeight + 2).fill(zebraColor);
    doc.restore();
  }

  doc.font("Helvetica").fontSize(fontSize).fillColor("#111111");
  columns.forEach((c) => {
    doc.text(safeToString(row[c.key]), c.x, y + paddingY, {
      width: c.width,
      height: rowHeight,
      lineGap,
      ellipsis: true,
    });
  });

  // Separador leve entre linhas
  doc
    .moveTo(leftX, y + rowHeight + 1)
    .lineTo(rightX, y + rowHeight + 1)
    .lineWidth(0.5)
    .strokeColor("#e3e6ea")
    .stroke();

  return { rowHeight };
}

function estimateRowHeight(doc, columns, row, { fontSize = 9, lineGap = 2 } = {}) {
  const cellHeights = columns.map((c) =>
    getTextHeight(doc, safeToString(row[c.key]), { width: c.width, font: "Helvetica", fontSize, lineGap })
  );
  const maxHeight = Math.max(14, ...cellHeights);
  const paddingY = 3;
  return Math.ceil(maxHeight + paddingY * 2);
}

function drawFooter(doc, { leftText = "", rightText = "" } = {}) {
  const prevY = doc.y;
  const y = doc.page.height - doc.page.margins.bottom + 8;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.save();
  doc.font("Helvetica").fontSize(8).fillColor("#666666");
  if (leftText) doc.text(leftText, doc.page.margins.left, y, { width });
  if (rightText) doc.text(rightText, doc.page.margins.left, y, { width, align: "right" });
  doc.restore();

  // Importante: não deixe o rodapé mexer no cursor principal
  doc.y = prevY;
}

function generateSalesPdf(sales, { title = "Relatório de Vendas", date = new Date() } = {}) {
  ensureReportsDir();

  const filename = `vendas-${formatDateForFilename(date)}.pdf`;
  const outPath = path.join(REPORTS_DIR, filename);

  return new Promise((resolve, reject) => {
    try {
      // Evita páginas “grandes demais” na impressão: por padrão usa A4 retrato.
      // Você pode forçar via env: UPSELLER_PDF_LAYOUT=landscape
      const envLayout = String(process.env.UPSELLER_PDF_LAYOUT || "portrait").trim().toLowerCase();
      const layout = envLayout === "landscape" ? "landscape" : "portrait";
      const doc = new PDFDocument({ size: "A4", layout, margin: 36 });
      const stream = fs.createWriteStream(outPath);
      doc.pipe(stream);

      doc.font("Helvetica-Bold").fontSize(18).text(title);
      doc.moveDown(0.5);
      doc.font("Helvetica").fontSize(11).fillColor("#333333").text(`Gerado em: ${date.toLocaleString("pt-BR")}`);
      doc.moveDown(1);

      const total = sumSales(sales);
      doc
        .font("Helvetica-Bold")
        .fontSize(12)
        .fillColor("#111111")
        .text(`Total vendido (estimado): ${formatCurrencyBRLFromNumber(total)}    •    Itens no relatório: ${sales.length}`);
      doc.moveDown(1);

      // Tabela: colunas proporcionais para caber em qualquer layout sem “estourar” a página.
      const left = doc.page.margins.left;
      const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const spec = [
        { key: "id", label: "ID", frac: 0.16 },
        { key: "pedidoNumero", label: "Pedido", frac: 0.14 },
        { key: "dataHora", label: "Data/Hora", frac: 0.14 },
        { key: "itens", label: "Itens", frac: 0.06 },
        { key: "cliente", label: "Cliente", frac: 0.22 },
        { key: "produto", label: "Produto", frac: 0.20 },
        { key: "valor", label: "Valor", frac: 0.08 },
      ];
      const columns = [];
      let cursorX = left;
      for (let i = 0; i < spec.length; i++) {
        const s = spec[i];
        // Última coluna leva qualquer resto por arredondamento
        const width = i === spec.length - 1 ? left + usableWidth - cursorX : Math.floor(usableWidth * s.frac);
        columns.push({ key: s.key, label: s.label, x: cursorX, width });
        cursorX += width;
      }

      let pageNo = 1;
      const HEADER_HEIGHT = 22; // título + separador + respiro
      const renderHeader = (atY) => {
        drawTableHeader(doc, atY, columns);
        return atY + HEADER_HEIGHT;
      };

      let y = renderHeader(doc.y);
      doc.y = y;

      const bottomLimit = () => doc.page.height - doc.page.margins.bottom - 18; // espaço para rodapé
      let rowIndex = 0;


      for (const s of sales) {
        const produtosList = Array.isArray(s?.produtos) ? s.produtos.filter(Boolean) : [];
        const itensCount = produtosList.length || (s?.produto ? 1 : 0);

        // Normaliza alguns campos para a tabela
        const row = {
          ...s,
          id: safeToString(s.upsellerId || s.id),
          pedidoNumero: safeToString(s.pedidoNumero || ""),
          dataHora: safeToString(s.dataHora || ""),
          itens: itensCount ? String(itensCount) : "",
          cliente: safeToString(s.cliente || ""),
          // Se houver múltiplos itens, lista em linhas separadas (mais legível no PDF)
          produto: produtosList.length ? produtosList.join("\n") : safeToString(s.produto || ""),
          valor: safeToString(s.valor || ""),
        };

        const rowHeightEstimate = estimateRowHeight(doc, columns, row, { fontSize: 9, lineGap: 2 });
        if (y + rowHeightEstimate + 6 > bottomLimit()) {
          drawFooter(doc, { leftText: `Gerado em ${date.toLocaleString("pt-BR")}`, rightText: `Página ${pageNo}` });
          doc.addPage();
          pageNo += 1;
          // Garante cursor no topo da nova página
          y = doc.page.margins.top;
          doc.font("Helvetica").fontSize(9).fillColor("#111111");
          y = renderHeader(y);
          doc.y = y;
        }

        const zebra = rowIndex % 2 === 1;
        const { rowHeight } = drawRow(doc, y, columns, row, { zebra, fontSize: 9, lineGap: 2 });
        y += rowHeight + 2;
        rowIndex += 1;

        // Força doc.y a acompanhar nosso cursor manual
        doc.y = y;
      }

      drawFooter(doc, { leftText: `Gerado em ${date.toLocaleString("pt-BR")}`, rightText: `Página ${pageNo}` });

      doc.end();

      stream.on("finish", () => resolve({ outPath }));
      stream.on("error", (err) => reject(err));
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  generateSalesPdf,
};
