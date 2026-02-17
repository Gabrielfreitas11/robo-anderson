const { sha1, normalizeMoneyText, safeToString, withTimeout, sleep } = require("./utils");

const DEFAULT_URL = "https://app.upseller.com/login";

function buildSaleId({ produto, valor, cliente, dataHora }) {
  // Hash simples e estável; evita duplicação mesmo sem ID do painel.
  const key = [produto, valor, cliente, dataHora].map((v) => safeToString(v).trim()).join("|");
  return sha1(key);
}

function extractOrderIdFromText(text) {
  if (!text) return "";
  const t = String(text);

  // Exemplos que tentamos capturar:
  // "Pedido #123456", "Pedido: 123456", "Order 123456", "#123456"
  const m1 = t.match(/\b(?:pedido|order)\b\s*[#:·-]?\s*([A-Za-z0-9-]{4,})/i);
  if (m1?.[1]) return m1[1];

  const m2 = t.match(/#\s*([0-9]{4,})/);
  if (m2?.[1]) return m2[1];

  return "";
}

function pickLabeledValue(segments, labelRegex) {
  for (const s of segments) {
    const m = String(s).match(new RegExp(`${labelRegex.source}\\s*[:#-]?\\s*(.+)$`, labelRegex.flags));
    if (m?.[1]) return m[1].trim();
  }
  return "";
}

function splitLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function extractFirstMatch(text, regex) {
  const m = String(text || "").match(regex);
  return m ? m[0] : "";
}

function extractFirstMoney(text) {
  // Captura formatos tipo "R$ 29,99" (com ou sem espaço)
  const m = String(text || "").match(/R\$\s*[\u200e\u200f]*\s*\d{1,3}(?:\.\d{3})*,\d{2}/i);
  return m ? normalizeMoneyText(m[0]) : "";
}

function pickDateTime(text, preferredLabels = ["ordenado", "pago", "pagado", "pago em", "paid"]) {
  const t = String(text || "");
  const lower = t.toLowerCase();

  const pickFirstDateTime = (chunk) => {
    const m = String(chunk || "").match(/(\d{2}\/\d{2}\/\d{4})\s*(\d{1,2}:\d{2})/);
    if (!m) return "";
    return `${m[1]} ${m[2]}`;
  };

  for (const label of preferredLabels) {
    const idx = lower.indexOf(label);
    if (idx >= 0) {
      const chunk = t.slice(idx, Math.min(t.length, idx + 120));
      const dt = pickFirstDateTime(chunk);
      if (dt) return dt;
    }
  }

  return pickFirstDateTime(t);
}

function coerceSaleFromMyTableBorderColumns(columns) {
  const cols = (columns || []).map((c) => String(c || "")).filter((c) => c.trim().length > 0);
  if (cols.length === 0) return null;

  const isProductCol = (t) => /^\s*[A-Za-z0-9]{4,}\b/.test(t) && (/R\$/i.test(t) || /\b(?:x|×)\s*\d+\b/i.test(t));
  const looksLikeDateOrTime = (t) => /(\d{2}\/\d{2}\/\d{4})/.test(t) || /(\d{1,2}:\d{2})/.test(t);
  const looksLikeMoney = (t) => /R\$\s*\d/i.test(t);
  const looksLikeLongNumeric = (t) => /\b\d{10,}\b/.test(t);
  const looksLikeLongAlphaNum = (t) => /\b[A-Z0-9]{10,}\b/i.test(t) && /\d/.test(t) && /[A-Z]/i.test(t);
  const isOrderCol = (t) => {
    if (looksLikeMoney(t) || looksLikeDateOrTime(t)) return false;
    return /\bsubpedido\b/i.test(t) || looksLikeLongNumeric(t) || looksLikeLongAlphaNum(t);
  };
  const isStatusCol = (t) => /(\d{2}\/\d{2}\/\d{4})\s*(\d{1,2}:\d{2})/.test(t) || /\b(ordenado|pago|pagado|expira)\b/i.test(t);
  const isClientCol = (t) => {
    if (isProductCol(t) || isOrderCol(t) || isStatusCol(t)) return false;
    return /[A-Za-zÀ-ÿ]{2,}/.test(t);
  };

  const productText = cols.find(isProductCol) || cols[0];
  // Evita cair em "qualquer número" porque isso pega ano (2026) e códigos de produto.
  const orderText = cols.find(isOrderCol) || "";
  const statusText = cols.find(isStatusCol) || cols.join("\n");
  const clientText = cols.find(isClientCol) || cols.find((t) => /,/.test(t)) || "";

  const productLines = splitLines(productText);
  const clientLines = splitLines(clientText);

  // Produto: primeiro token tipo 19936CPA
  const firstLine = productLines[0] || productText;
  const productCodeMatch = String(firstLine).match(/^\s*([A-Za-z0-9]{4,})\b/);
  const productCode = productCodeMatch?.[1] || "";

  // Valor: primeiro valor em R$
  const valor = extractFirstMoney(productText);

  // Cliente: nome + localização (tenta manter 2-3 linhas)
  const cliente = clientLines.slice(0, 3).join(" ").trim();

  // Nº do pedido: preferimos tokens longos (numéricos ou alfanuméricos), evita ano de data.
  const orderLongNumeric = extractFirstMatch(orderText, /\b\d{10,}\b/);
  const orderLongAlphaNum = extractFirstMatch(orderText, /\b[A-Z0-9]{10,}\b/i);
  const pedidoNumero = orderLongNumeric || orderLongAlphaNum || "";

  // Data/hora: apenas a primeira data/hora relevante (evita variar com "Expira em")
  const dataHora = pickDateTime(statusText) || "";

  // Nome do produto: linhas que não são código/quantidade/preço
  const nameParts = productLines
    .filter((l) => l !== productCode)
    .filter((l) => !/^x\s*\d+/i.test(l) && !/^×\s*\d+/i.test(l))
    .filter((l) => !/R\$/i.test(l));
  const productName = nameParts.join(" ").trim();

  const produto = [productCode, productName].filter(Boolean).join(" ").trim() || productCode || productName || "";

  // ID estável: prioriza nº do pedido.
  // Observação: o ID "real" do Upseller pode vir de uma linha `top_row` separada; isso é anexado fora daqui.
  const id = pedidoNumero ? String(pedidoNumero) : productCode ? String(productCode) : buildSaleId({ produto, valor, cliente, dataHora });

  const hasSomething = Boolean(id || produto || valor || cliente || dataHora);
  if (!hasSomething) return null;

  return { id, pedidoNumero, productCode, produto, valor, cliente, dataHora };
}

function coerceSaleFromSegments(segments) {
  // Quando vem do `.my_table_border` com `td`s, normalmente é um array de colunas.
  // Mantemos o texto bruto (com quebras de linha) e fazemos parsing por coluna.
  if (Array.isArray(segments) && segments.length >= 3) {
    const colSale = coerceSaleFromMyTableBorderColumns(segments);
    if (colSale) return colSale;
  }

  const trimmed = (segments || []).map((t) => (t || "").replace(/\s+/g, " ").trim()).filter(Boolean);
  if (trimmed.length === 0) return null;

  const joined = trimmed.join(" | ");

  // ID do pedido (preferencial): se existir, usamos como id estável
  const orderId =
    pickLabeledValue(trimmed, /\bpedido\b/i) ||
    pickLabeledValue(trimmed, /\border\b/i) ||
    extractOrderIdFromText(joined);

  const valorCandidate = trimmed.find((t) => /R\$\s?\d/i.test(t));
  const valor = normalizeMoneyText(valorCandidate || pickLabeledValue(trimmed, /\bvalor\b/i) || "");

  const dateCandidate = trimmed.find((t) => /(\d{2}\/\d{2}\/\d{4})/.test(t)) || pickLabeledValue(trimmed, /\bdata\b/i) || "";
  const timeCandidate = trimmed.find((t) => /(\d{1,2}:\d{2})/.test(t)) || "";
  const dataHora = [dateCandidate, timeCandidate].filter(Boolean).join(" ").trim() || "";

  let cliente = pickLabeledValue(trimmed, /\bcliente\b/i) || "";
  let produto = pickLabeledValue(trimmed, /\bproduto\b/i) || "";

  // Fallback de cliente/produto por posição (se não houver labels)
  const looksDate = (t) => /(\d{2}\/\d{2}\/\d{4})/.test(t) || /(\d{1,2}:\d{2})/.test(t);
  const looksMoney = (t) => /R\$/i.test(t);
  const looksId = (t) => /\b(?:pedido|order)\b/i.test(t) || /#\s*\d{4,}/.test(t);
  const noisy = (t) => looksDate(t) || looksMoney(t) || looksId(t);
  const candidates = trimmed.filter((t) => !noisy(t));

  if (!cliente && candidates[0]) cliente = candidates[0];
  if (!produto && candidates[1]) produto = candidates[1];

  const hasSomething = Boolean(produto || valor || cliente || dataHora || orderId);
  if (!hasSomething) return null;

  const id = orderId ? String(orderId).trim() : buildSaleId({ produto, valor, cliente, dataHora });
  return { id, pedidoNumero: orderId ? String(orderId).trim() : "", produto, valor, cliente, dataHora };
}

async function gotoWithRetries(page, url, { retries = 3, timeoutMs = 60_000 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await withTimeout(page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs }), timeoutMs + 5_000, `Navegação (${url})`);
      return;
    } catch (err) {
      lastErr = err;
      console.warn(`[scraper] Falha no goto (tentativa ${attempt}/${retries}):`, err.message);
      try {
        await sleep(1000 * attempt);
      } catch {
        // ignore
      }
    }
  }
  throw lastErr;
}

async function installSalesObserver(page) {
  // Instala um MutationObserver no browser para reduzir custo de scraping.
  // Observação: como não conhecemos a DOM do Upseller, o observer é "genérico".
  // Ele tenta capturar mudanças em tabelas/listas e guarda snapshots em memória.
  await page.evaluateOnNewDocument(() => {
    window.__upsellerBot = window.__upsellerBot || {};
    window.__upsellerBot.salesSnapshots = [];
    window.__upsellerBot.lastMutationAt = Date.now();

    const pushSnapshot = () => {
      try {
        // Snapshot leve: textos de linhas visíveis em possíveis tabelas.
        const candidates = [];
        const tables = Array.from(document.querySelectorAll("table"));
        for (const t of tables.slice(0, 5)) {
          const rows = Array.from(t.querySelectorAll("tbody tr")).slice(0, 80);
          for (const r of rows) {
            const text = (r.innerText || "").replace(/\s+/g, " ").trim();
            if (text) candidates.push(text);
          }
        }
        if (candidates.length) {
          window.__upsellerBot.salesSnapshots.push({ at: Date.now(), rowsText: candidates });
          window.__upsellerBot.salesSnapshots = window.__upsellerBot.salesSnapshots.slice(-10);
        }
      } catch {
        // ignore
      }
    };

    const observer = new MutationObserver(() => {
      window.__upsellerBot.lastMutationAt = Date.now();
      // Debounce
      clearTimeout(window.__upsellerBot.__debounceId);
      window.__upsellerBot.__debounceId = setTimeout(pushSnapshot, 500);
    });

    const start = () => {
      observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
      // Snapshot inicial
      setTimeout(pushSnapshot, 1000);
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
      start();
    }
  });
}

async function isLoggedIn(page, { loggedInSelector, loggedOutSelector } = {}) {
  // Heurísticas configuráveis por env var.
  // - loggedOutSelector: se existir, consideramos deslogado.
  // - loggedInSelector: se existir, consideramos logado.
  // - fallback: URL e ausência de inputs de login comuns.
  try {
    return await page.evaluate(
      ({ loggedInSelector, loggedOutSelector }) => {
        const has = (sel) => {
          if (!sel) return false;
          try {
            return Boolean(document.querySelector(sel));
          } catch {
            return false;
          }
        };

        if (loggedOutSelector && has(loggedOutSelector)) return false;
        if (loggedInSelector && has(loggedInSelector)) return true;

        const url = location.href || "";

        // Heurística simples: se estiver em /login ou tiver formulário com input password, provavelmente deslogado.
        if (/\/login/i.test(url)) return false;

        const passwordInput = document.querySelector('input[type="password"], input[name*="senha" i], input[placeholder*="senha" i]');
        if (passwordInput) return false;

        // Se tiver um avatar/menú/"sair" é bom sinal.
        const sair = Array.from(document.querySelectorAll("button, a"))
          .map((el) => (el.innerText || "").trim().toLowerCase())
          .some((t) => t === "sair" || t.includes("logout"));

        if (sair) return true;

        // Caso não dê para inferir, assume "talvez logado".
        return true;
      },
      { loggedInSelector, loggedOutSelector }
    );
  } catch (err) {
    console.warn("[scraper] isLoggedIn falhou:", err.message);
    return false;
  }
}

async function waitForManualLogin(page, { timeoutMs = 0, pollMs = 2000, loggedInSelector, loggedOutSelector } = {}) {
  // timeoutMs=0 => espera indefinidamente (robô 24/7)
  const started = Date.now();
  for (;;) {
    const logged = await isLoggedIn(page, { loggedInSelector, loggedOutSelector });
    if (logged) return;

    if (timeoutMs > 0 && Date.now() - started > timeoutMs) {
      throw new Error("Timeout aguardando login manual");
    }

    console.log("[scraper] Aguardando login manual (faça login/captcha na janela do Chrome)...");
    await sleep(pollMs);
  }
}

function coerceSaleFromCells(cellsText) {
  // Como não sabemos o layout, fazemos um parsing heurístico.
  // Prioridades:
  // - valor: token com R$
  // - dataHora: token que pareça data/hora
  // - cliente/produto: primeiros campos
  const trimmed = cellsText.map((t) => (t || "").replace(/\s+/g, " ").trim()).filter(Boolean);
  if (trimmed.length === 0) return null;

  const joined = trimmed.join(" | ");

  const valorCandidate = trimmed.find((t) => /R\$\s?\d/i.test(t));
  const valor = normalizeMoneyText(valorCandidate || "");

  // data/hora: busca padrões tipo 04/02/2026 13:45, 04/02/2026, 13:45
  const dateCandidate = trimmed.find((t) => /(\d{2}\/\d{2}\/\d{4})/.test(t)) || "";
  const timeCandidate = trimmed.find((t) => /(\d{1,2}:\d{2})/.test(t)) || "";
  const dataHora = [dateCandidate, timeCandidate].filter(Boolean).join(" ").trim() || "";

  // cliente/produto: heurística por posição
  const first = trimmed[0] || "";
  const second = trimmed[1] || "";

  let cliente = "";
  let produto = "";

  // Se o primeiro campo tiver cara de data, pula
  const looksDate = (t) => /(\d{2}\/\d{2}\/\d{4})/.test(t) || /(\d{1,2}:\d{2})/.test(t);
  const candidates = trimmed.filter((t) => !looksDate(t) && !/R\$/i.test(t));

  if (candidates.length >= 2) {
    cliente = candidates[0];
    produto = candidates[1];
  } else {
    cliente = looksDate(first) ? (candidates[0] || second) : first;
    produto = candidates[1] || second;
  }

  // Se ficou muito vazio, retorna null.
  const hasSomething = Boolean(produto || valor || cliente || dataHora);
  if (!hasSomething) return null;

  const id = buildSaleId({ produto, valor, cliente, dataHora });

  return { id, produto, valor, cliente, dataHora, __raw: joined };
}

async function extractSalesFromDom(page) {
  // Algumas telas usam tabela virtualizada/infinite scroll: apenas parte das linhas existe no DOM.
  // Antes de extrair, tentamos rolar para garantir que todas as linhas do "All Orders" foram carregadas.
  // (best-effort; se não der, seguimos com o que estiver no DOM)
  try {
    await loadAllOrdersIntoDom(page, { maxMs: Number(process.env.UPSELLER_LOAD_ALL_MAX_MS || 12_000) });
  } catch {
    // ignore
  }

  // Extrai linhas de tabela/lista via evaluate.
  // Por padrão procura por tabelas e tenta extrair tr/td.
  // Você pode ajustar selectors via env, se necessário.
  const result = await page.evaluate(() => {
    const cleanText = (s) => String(s || "").replace(/\s+/g, " ").trim();

    const parseQtyToX = (txt) => {
      const t = cleanText(txt);
      const m = t.match(/(?:x|×)\s*(\d+)/i);
      const n = m?.[1] ? Number(m[1]) : null;
      if (!Number.isFinite(n) || n <= 0) return "";
      return `x${n}`;
    };

    const pickFirstMoney = (txt) => {
      const t = String(txt || "");
      const m = t.match(/R\$\s*[\u200e\u200f]*\s*\d{1,3}(?:\.\d{3})*,\d{2}/i);
      return m ? cleanText(String(m[0]).replace(/[\u200e\u200f]/g, "")).replace(/\s+/g, " ") : "";
    };

    const parseStatusBlocks = (statusTd) => {
      const info = { pago: "", expira: "", ordenado: "" };
      if (!statusTd) return info;
      const blocks = Array.from(statusTd.querySelectorAll(".mb_5"));
      for (const b of blocks) {
        const lines = cleanText(b.innerText || "").split(" ");
        // Melhor extrair por estrutura: primeiro div label e segundo div value
        const divs = Array.from(b.querySelectorAll(":scope > div"));
        const label = cleanText(divs[0]?.innerText || "").toLowerCase();
        const value = cleanText(divs[1]?.innerText || "");
        if (!label || !value) continue;
        if (label.includes("pag")) info.pago = value;
        else if (label.includes("expira")) info.expira = value;
        else if (label.includes("orden")) info.ordenado = value;
      }
      return info;
    };

    const extractTopIdFromRow = (rowEl) => {
      if (!rowEl) return "";
      const a = rowEl.querySelector("a");
      const txt = cleanText((a && a.innerText) || rowEl.innerText || "");
      const m = txt.match(/#UP[0-9A-Z]+/i);
      return m ? m[0].toUpperCase() : "";
    };

    const parseTopRowMeta = (topRowEl) => {
      const meta = { conta: "", plataforma: "" };
      if (!topRowEl) return meta;

      // Conta: costuma estar em span com title (ex: "Ahiper")
      const contaEl = topRowEl.querySelector(".tr_top_content .mr_10 span[title]");
      meta.conta = cleanText(contaEl?.getAttribute("title") || contaEl?.innerText || "");

      // Plataforma: geralmente é o último span do bloco da direita (ex: "Mercado Libre")
      const platCandidates = Array.from(topRowEl.querySelectorAll(".tr_top_content .mr_10 span"))
        .map((el) => cleanText(el.innerText))
        .filter(Boolean);
      meta.plataforma = platCandidates.find((t) => /mercado\s*libre/i.test(t)) || platCandidates[platCandidates.length - 1] || "";

      return meta;
    };

    const parseItemsFromProductTd = (productTd) => {
      if (!productTd) return [];

      // Cada item costuma estar em um bloco com classe "ml_12 flex mb_20"
      const blocks = Array.from(productTd.querySelectorAll(".ml_12.flex.mb_20"));
      const items = [];

      const parseBlock = (block) => {
        const imgEl = block.querySelector("img.img_local");
        const imagem = cleanText(imgEl?.getAttribute("src") || imgEl?.getAttribute("data-src") || "");

        const skuA = block.querySelector(".line_overflow_2 a[title]");
        const sku = cleanText(skuA?.getAttribute("title") || skuA?.innerText || "");
        const qty = parseQtyToX(block.querySelector("b")?.innerText || "");
        const preco = pickFirstMoney(block.innerText || "");

        // Variação costuma estar na 3a linha dentro de .flex_1 (logo após o preço)
        const flex1 = block.querySelector(".flex_1");
        const childTexts = flex1 ? Array.from(flex1.children).map((el) => cleanText(el.innerText)) : [];
        const variacaoCandidate = childTexts.find((t) => t && !/R\$/i.test(t) && !/(?:x|×)\s*\d+/i.test(t) && t !== sku);
        const variacao = cleanText(variacaoCandidate || "");

        const hasAny = Boolean(sku || preco || qty || variacao);
        if (!hasAny) return;
        items.push({ sku, preco, variacao, quantidade: qty, imagem });
      };

      for (const b of blocks) parseBlock(b);

      // Fallback: quando não há blocos, tenta pelos links de SKU
      if (items.length === 0) {
        const skus = Array.from(productTd.querySelectorAll(".line_overflow_2 a[title]"))
          .map((a) => cleanText(a.getAttribute("title") || a.innerText || ""))
          .filter(Boolean);
        for (const sku of skus) items.push({ sku, preco: "", variacao: "", quantidade: "" });
      }

      return items;
    };

    // Preferência: linhas com classe my_table_border (informação do usuário)
    // Importante: o ID (#UP...) fica em uma linha `tr.top_row` anterior.
    const bordered = Array.from(document.querySelectorAll(".my_table_border"));
    if (bordered.length) {
      const rows = [];
      for (const el of bordered.slice(0, 400)) {
        // Tenta achar a linha top_row imediatamente antes (ou poucos passos antes)
        let upsellerId = "";
        let prev = el.previousElementSibling;
        for (let i = 0; i < 5 && prev; i++) {
          if (prev.classList && prev.classList.contains("top_row")) {
            upsellerId = extractTopIdFromRow(prev);
            break;
          }
          prev = prev.previousElementSibling;
        }

        const topMeta = parseTopRowMeta(prev && prev.classList && prev.classList.contains("top_row") ? prev : null);

        // Se for uma linha de tabela, tenta pegar td; senão usa quebras de linha do texto.
        // Também tentamos extrair múltiplos produtos (quando houver) pelo 1o td.
        const tdEls = Array.from(el.querySelectorAll("td"));
        const tds = tdEls.map((td) => td.innerText || "").filter(Boolean);

        // Se o layout for o do exemplo, extraímos campos estruturados.
        const productTd = tdEls[0];
        const items = parseItemsFromProductTd(productTd);

        const valorPedido = pickFirstMoney(tdEls[1]?.innerText || "") || cleanText(tdEls[1]?.innerText || "");
        const clienteNome = cleanText(tdEls[2]?.querySelector("span[title]")?.getAttribute("title") || tdEls[2]?.querySelector("span[title]")?.innerText || "");
        const cidadeUf = cleanText(tdEls[2]?.querySelector(".f_gray_8c")?.innerText || "");

        const pedidoNumero = cleanText(tdEls[3]?.innerText || "").match(/\b\d{10,}\b/)?.[0] || "";
        const statusInfo = parseStatusBlocks(tdEls[4]);
        const envio = cleanText(tdEls[5]?.getAttribute("title") || tdEls[5]?.querySelector("[title]")?.getAttribute("title") || tdEls[5]?.innerText || "");

        const structuredSale = {
          upsellerId,
          id: upsellerId || pedidoNumero,
          pedidoNumero,
          valorPedido: cleanText(String(valorPedido || "").replace(/[\u200e\u200f]/g, "")),
          nome: clienteNome,
          cliente: clienteNome,
          cidadeUf,
          pago: statusInfo.pago,
          expira: statusInfo.expira,
          ordenado: statusInfo.ordenado,
          envio,
          conta: topMeta.conta,
          plataforma: topMeta.plataforma,
          itens: items,
          produtos: Array.from(new Set(items.map((i) => i && i.sku).filter(Boolean))),
        };

        // Campos de compatibilidade com o pipeline antigo
        if (!structuredSale.dataHora) structuredSale.dataHora = structuredSale.pago || structuredSale.ordenado || "";
        if (!structuredSale.valor) structuredSale.valor = structuredSale.valorPedido || pickFirstMoney(valorPedido);
        if (!structuredSale.produto) structuredSale.produto = structuredSale.produtos.join(" | ");

        // Se conseguimos extrair itens ou algum identificador, preferimos o payload estruturado.
        const hasStructured = Boolean(structuredSale.id || structuredSale.pedidoNumero || structuredSale.nome || structuredSale.produtos.length);
        if (hasStructured) {
          rows.push({ upsellerId, sale: structuredSale, cells: tds });
          continue;
        }

        // Fallback antigo: segue coletando colunas para parsing heurístico.
        let productCodes = [];
        const firstTd = tdEls[0];
        if (firstTd) {
          productCodes = Array.from(firstTd.querySelectorAll(".line_overflow_2 a[title]"))
            .map((a) => String(a.getAttribute("title") || a.innerText || "").trim())
            .filter(Boolean)
            .map((s) => s.replace(/\s+/g, " ").trim());
        }

        if (tds.length) {
          rows.push({ upsellerId, cells: tds, productCodes });
          continue;
        }

        const txt = el.innerText || "";
        if (!txt) continue;
        rows.push({ upsellerId, cells: [txt], productCodes });
      }
      return { rows, source: "my_table_border" };
    }

    const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

    // Heurística: pega as primeiras tabelas e tenta extrair linhas.
    const tables = Array.from(document.querySelectorAll("table"));

    const rows = [];
    for (const t of tables.slice(0, 8)) {
      const trs = Array.from(t.querySelectorAll("tbody tr"));
      for (const tr of trs.slice(0, 200)) {
        const cells = Array.from(tr.querySelectorAll("td")).map((td) => clean(td.innerText));
        const rowText = clean(tr.innerText);
        if (cells.length === 0 && rowText) {
          rows.push([rowText]);
        } else if (cells.length) {
          rows.push(cells);
        }
      }
    }

    // Fallback: se não tiver tabela, tenta listas genéricas.
    if (rows.length === 0) {
      const items = Array.from(document.querySelectorAll("[role='row'], li, .row"))
        .map((el) => clean(el.innerText))
        .filter(Boolean)
        .slice(0, 200);
      for (const txt of items) rows.push([txt]);
    }

    return { rows, source: "fallback" };
  });

  const sales = [];
  for (const row of result.rows || []) {
    if (result.source === "my_table_border") {
      if (row && typeof row === "object" && row.sale && typeof row.sale === "object") {
        const sale = row.sale;
        sales.push(sale);
        continue;
      }

      const segments = Array.isArray(row) ? row : row?.cells;
      const sale = coerceSaleFromSegments(segments);
      if (!sale) continue;

      const upsellerId = row && typeof row === "object" ? String(row.upsellerId || "").trim() : "";
      if (upsellerId) {
        sale.upsellerId = upsellerId;
        // Mantém o id anterior como legado para dedupe com históricos antigos.
        sale.legacyId = sale.legacyId || sale.id;
        sale.id = upsellerId;
      }

      // Quando um pedido tem mais de 1 produto, a UI costuma renderizar múltiplos itens no 1o TD.
      // Guardamos a lista em `produtos` para você identificar facilmente.
      const codes = row && typeof row === "object" && Array.isArray(row.productCodes) ? row.productCodes : [];
      if (codes.length) {
        sale.produtos = Array.from(new Set(codes));
        // Mantém `produto` compatível: concatena quando houver múltiplos.
        if (sale.produtos.length > 1) {
          sale.produto = sale.produtos.join(" | ");
        }
      }

      sales.push(sale);
      continue;
    }

    const sale = coerceSaleFromCells(row);
    if (sale) sales.push(sale);
  }

  // Merge defensivo: se a página renderizar duplicado o mesmo #UP (ex: produtos em múltiplas linhas),
  // unificamos em um único registro por id, agregando `produtos`.
  const mergedById = new Map();
  for (const s of sales) {
    const key = String(s?.id || "").trim();
    if (!key) continue;
    if (!mergedById.has(key)) {
      mergedById.set(key, s);
      continue;
    }
    const cur = mergedById.get(key);
    const curList = Array.isArray(cur.produtos) ? cur.produtos : [];
    const nextList = Array.isArray(s.produtos) ? s.produtos : [];
    const mergedList = Array.from(new Set(curList.concat(nextList))).filter(Boolean);
    if (mergedList.length) {
      cur.produtos = mergedList;
      if (mergedList.length > 1) cur.produto = mergedList.join(" | ");
    }
    // Preenche campos vazios sem sobrescrever os existentes
    for (const k of ["pedidoNumero", "productCode", "valor", "cliente", "dataHora"]) {
      if (!cur[k] && s[k]) cur[k] = s[k];
    }
  }

  return Array.from(mergedById.values());
}

async function loadAllOrdersIntoDom(page, { maxMs = 12_000, idleRounds = 3, stepDelayMs = 450 } = {}) {
  const started = Date.now();
  let lastCount = -1;
  let idle = 0;

  const getCounts = () =>
    page.evaluate(() => ({
      bordered: document.querySelectorAll(".my_table_border").length,
      top: document.querySelectorAll(".top_row").length,
    }));

  // Se não for a página com a tabela, sai rápido.
  const initial = await getCounts();
  if (!initial.bordered && !initial.top) return;
  const debug = String(process.env.UPSELLER_DEBUG_LOAD_ALL || "").trim() === "1";
  if (debug) console.log(`[scraper] loadAllOrdersIntoDom: initial bordered=${initial.bordered} top=${initial.top}`);

  while (Date.now() - started < maxMs) {
    const counts = await getCounts();
    const curCount = Math.max(counts.bordered, counts.top);

    if (curCount === lastCount) idle += 1;
    else idle = 0;

    if (idle >= idleRounds) break;
    lastCount = curCount;

    // Best-effort: rola o container mais provável. Se não achar, rola a página.
    await page.evaluate(() => {
      const row = document.querySelector(".my_table_border") || document.querySelector(".my_custom_table");
      const isScrollable = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        const overflowY = style.overflowY;
        const canScroll = (overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight + 10;
        return canScroll;
      };

      let scroller = null;
      let el = row;
      for (let i = 0; i < 12 && el; i++) {
        if (isScrollable(el)) {
          scroller = el;
          break;
        }
        el = el.parentElement;
      }

      if (scroller) {
        const step = Math.max(200, Math.floor(scroller.clientHeight * 0.85));
        scroller.scrollTop = Math.min(scroller.scrollTop + step, scroller.scrollHeight);
      } else {
        const step = Math.max(400, Math.floor(window.innerHeight * 0.85));
        window.scrollBy(0, step);
      }
    });

    await sleep(stepDelayMs);
  }

  if (debug) {
    const fin = await getCounts();
    console.log(`[scraper] loadAllOrdersIntoDom: final bordered=${fin.bordered} top=${fin.top} in ${Date.now() - started}ms`);
  }
}

async function readObserverSnapshots(page) {
  try {
    return await page.evaluate(() => {
      const buf = window.__upsellerBot?.salesSnapshots || [];
      return buf;
    });
  } catch {
    return [];
  }
}

async function openAndPrepare(page, { url = DEFAULT_URL } = {}) {
  await gotoWithRetries(page, url);
}

async function getFirstUpsellerIdInDom(page) {
  try {
    return await page.evaluate(() => {
      const el = document.querySelector(".top_row a") || document.querySelector(".top_row");
      const txt = (el && (el.innerText || "")) || "";
      const m = String(txt).match(/#UP[0-9A-Z]+/i);
      return m ? m[0].toUpperCase() : "";
    });
  } catch {
    return "";
  }
}

async function waitForOrdersListToChange(page, { previousFirstId = "", timeoutMs = 12_000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const cur = await getFirstUpsellerIdInDom(page);
    if (cur && previousFirstId && cur !== previousFirstId) return;
    // Se não der pra usar ID, tenta ao menos aguardar o DOM "respirar"
    await sleep(350);
  }
}

async function tryClickNextPagination(page) {
  try {
    return await page.evaluate(() => {
      // Ant Design (bem comum no Upseller)
      const li = document.querySelector("li.ant-pagination-next:not(.ant-pagination-disabled)");
      if (!li) return false;
      const btn = li.querySelector("button, a");
      if (!btn) return false;
      btn.click();
      return true;
    });
  } catch {
    return false;
  }
}

async function tryGoToFirstPage(page) {
  try {
    return await page.evaluate(() => {
      // Ant Design
      const li = document.querySelector("li.ant-pagination-item-1");
      if (!li) return false;
      if (li.classList.contains("ant-pagination-item-active")) return true;
      const btn = li.querySelector("a, button");
      if (!btn) return false;
      btn.click();
      return true;
    });
  } catch {
    return false;
  }
}

async function extractSalesFromDomAcrossPages(page, { maxPages = 3 } = {}) {
  const all = [];
  let paginated = false;

  for (let p = 0; p < maxPages; p++) {
    const pageSales = await extractSalesFromDom(page);
    all.push(...pageSales);

    const firstIdBefore = await getFirstUpsellerIdInDom(page);
    const clicked = await tryClickNextPagination(page);
    if (!clicked) break;
    paginated = true;

    await waitForOrdersListToChange(page, { previousFirstId: firstIdBefore, timeoutMs: 12_000 });
  }

  if (paginated) {
    const firstIdBefore = await getFirstUpsellerIdInDom(page);
    const ok = await tryGoToFirstPage(page);
    if (ok) await waitForOrdersListToChange(page, { previousFirstId: firstIdBefore, timeoutMs: 12_000 });
  }

  // Dedupe final por id
  const byId = new Map();
  for (const s of all) {
    const id = String(s?.id || "").trim();
    if (!id) continue;
    if (!byId.has(id)) byId.set(id, s);
    else {
      const cur = byId.get(id);
      const curList = Array.isArray(cur.produtos) ? cur.produtos : [];
      const nextList = Array.isArray(s.produtos) ? s.produtos : [];
      const mergedList = Array.from(new Set(curList.concat(nextList))).filter(Boolean);
      if (mergedList.length) {
        cur.produtos = mergedList;
        if (mergedList.length > 1) cur.produto = mergedList.join(" | ");
      }
      for (const k of ["pedidoNumero", "productCode", "valor", "cliente", "dataHora"]) {
        if (!cur[k] && s[k]) cur[k] = s[k];
      }
    }
  }

  return Array.from(byId.values());
}

module.exports = {
  DEFAULT_URL,
  buildSaleId,
  gotoWithRetries,
  installSalesObserver,
  isLoggedIn,
  waitForManualLogin,
  extractSalesFromDom,
  extractSalesFromDomAcrossPages,
  readObserverSnapshots,
  openAndPrepare,
};
