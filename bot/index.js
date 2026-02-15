const path = require("path");
const puppeteer = require("puppeteer");

const {
  DEFAULT_URL,
  installSalesObserver,
  openAndPrepare,
  waitForManualLogin,
  isLoggedIn,
  extractSalesFromDom,
  extractSalesFromDomAcrossPages,
  gotoWithRetries,
} = require("./scraper");

const { loadState, saveState, appendSales, loadSales } = require("./storage");
const { generateSalesPdf } = require("./pdf");
const { sendPdfToWebhookWithRetry } = require("./webhook");
const { nowIso, sleep, withTimeout } = require("./utils");

const SESSION_DIR = path.join(__dirname, "..", ".session");

// Intervalos (ms)
const SCRAPE_EVERY_MS = 30_000;
const PDF_EVERY_MS = 10 * 60_000;

function envFlag(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  const v = String(raw).trim().toLowerCase();
  if (v === "" && defaultValue !== undefined) return defaultValue;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  return defaultValue;
}

function getEnvConfig() {
  const startUrl = process.env.UPSELLER_START_URL || process.env.UPSELLER_URL || DEFAULT_URL;
  let ordersUrl = process.env.UPSELLER_ORDERS_URL || "";

  // Mantém o mesmo host da sessão (evita perder cookies entre .com e .com.br)
  if (!ordersUrl) {
    const origin = new URL(startUrl).origin;
    ordersUrl = `${origin}/pt/order/all-orders`;
  }

  return {
    startUrl,
    ordersUrl,

    // Se o painel só atualiza com refresh, habilite aqui.
    // Padrão: recarrega a cada 30s (mesmo ritmo do scrape).
    reloadEveryMs: Number(process.env.UPSELLER_RELOAD_EVERY_MS || 30_000),

    // Opcional: se você souber um seletor que só existe logado/deslogado, configure aqui.
    loggedInSelector: process.env.UPSELLER_LOGGED_IN_SELECTOR || "",
    loggedOutSelector: process.env.UPSELLER_LOGGED_OUT_SELECTOR || "",

    // Robustez
    navigationTimeoutMs: Number(process.env.NAV_TIMEOUT_MS || 60_000),
    actionTimeoutMs: Number(process.env.ACTION_TIMEOUT_MS || 30_000),

    // Performance
    blockResources: envFlag("BLOCK_RESOURCES", true),

    // Logs
    logPageConsole: envFlag("LOG_PAGE_CONSOLE", true),
    filterNoisyPageConsole: envFlag("FILTER_NOISY_PAGE_CONSOLE", true),
  };
}

async function createBrowserAndPage(cfg) {
  const browser = await puppeteer.launch({
    headless: false,
    userDataDir: SESSION_DIR,
    defaultViewport: null,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(cfg.navigationTimeoutMs);
  page.setDefaultTimeout(cfg.actionTimeoutMs);

  // Performance: bloqueia imagens/fonts/media se desejado
  if (cfg.blockResources) {
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      if (type === "image" || type === "media" || type === "font") {
        return req.abort();
      }
      return req.continue();
    });
  }

  // Logs úteis
  page.on("console", (msg) => {
    if (!cfg.logPageConsole) return;

    const type = msg.type();
    const txt = msg.text();

    if (cfg.filterNoisyPageConsole) {
      // Ruídos comuns do Chrome na página (não afetam o bot):
      // - Mixed Content (imagens http em página https)
      // - Failed to load resource: net::ERR_FAILED (frequente quando bloqueamos imagens/fonts)
      const lower = String(txt || "").toLowerCase();

      if (lower.includes("mixed content")) return;
      if (lower.includes("[cloudflare turnstile]")) return;

      // Alguns Chromium mudam ligeiramente o texto; usa match bem tolerante.
      if (lower.includes("failed to load resource") && lower.includes("err_failed")) return;
    }

    if (type === "error") console.warn(`[page:console:${type}]`, txt);
    else console.log(`[page:console:${type}]`, txt);
  });
  page.on("pageerror", (err) => console.warn("[pageerror]", err.message));
  page.on("error", (err) => console.warn("[page:error]", err.message));

  // Observador (MutationObserver) para reduzir custo (best-effort)
  await installSalesObserver(page);

  return { browser, page };
}

function dedupeNewSales(newSales, knownIdsSet) {
  const getKeys = (s) => {
    if (!s || typeof s !== "object") return [];
    const keys = [];
    const pushKey = (v) => {
      if (v === undefined || v === null) return;
      const str = String(v).trim();
      if (!str) return;
      keys.push(str);
    };
    pushKey(s.id);
    pushKey(s.upsellerId);
    pushKey(s.orderId);
    pushKey(s.pedidoId);
    return Array.from(new Set(keys));
  };

  const unique = [];
  for (const s of newSales) {
    const keys = getKeys(s);
    if (keys.length === 0) continue;

    // Compat: se o histórico antigo salvava `id` como outro valor (ex: nº do pedido),
    // o `legacyId` do scrape novo deve impedir duplicação APENAS quando ele bater com um `id` já conhecido.
    const legacy = s && typeof s === "object" && s.legacyId ? String(s.legacyId).trim() : "";
    if (legacy && knownIdsSet.has(legacy)) {
      continue;
    }

    let duplicated = false;
    for (const k of keys) {
      if (knownIdsSet.has(k)) {
        duplicated = true;
        break;
      }
    }
    if (duplicated) continue;

    for (const k of keys) knownIdsSet.add(k);
    unique.push(s);
  }
  return unique;
}

async function ensureLoggedInFlow(page, cfg) {
  const logged = await isLoggedIn(page, {
    loggedInSelector: cfg.loggedInSelector,
    loggedOutSelector: cfg.loggedOutSelector,
  });

  if (logged) return;

  console.log("[bot] Parece deslogado. Abra a janela e faça login/captcha novamente...");
  await waitForManualLogin(page, {
    timeoutMs: 0,
    loggedInSelector: cfg.loggedInSelector,
    loggedOutSelector: cfg.loggedOutSelector,
  });

  console.log("[bot] Login detectado. Continuando...");

  // Após relogin, volte para a tela que queremos monitorar
  try {
    console.log(`[bot] Indo para página de pedidos: ${cfg.ordersUrl}`);
    await gotoWithRetries(page, cfg.ordersUrl, { timeoutMs: cfg.navigationTimeoutMs });
  } catch (err) {
    console.warn("[bot] Não consegui navegar para a página de pedidos após relogin:", err.message);
  }
}

async function tryReloadIfNeeded(page) {
  try {
    // Se a aba ficou travada, um reload costuma recuperar.
    await withTimeout(page.reload({ waitUntil: "domcontentloaded" }), 45_000, "Reload");
  } catch (err) {
    console.warn("[bot] Reload falhou:", err.message);
  }
}

async function runOnceCycle(page, cfg, state, knownIdsSet) {
  // 1) Garantir que a aba está em uma URL válida
  const currentUrl = page.url();
  if (!currentUrl || currentUrl === "about:blank") {
    await gotoWithRetries(page, cfg.startUrl, { timeoutMs: cfg.navigationTimeoutMs });
  }

  // 2) Garantir login
  await ensureLoggedInFlow(page, cfg);

  // 2.1) Garantir que estamos na página alvo (all-orders)
  try {
    const here = page.url();
    if (here && !here.startsWith(cfg.ordersUrl)) {
      await gotoWithRetries(page, cfg.ordersUrl, { timeoutMs: cfg.navigationTimeoutMs });
    }
  } catch (err) {
    console.warn("[bot] Falha ao garantir página de pedidos:", err.message);
  }

  // 2.2) Recarregar a página para capturar novos pedidos (se necessário)
  try {
    const lastReload = state.lastReloadAt ? new Date(state.lastReloadAt).getTime() : 0;
    const shouldReload = Number.isFinite(cfg.reloadEveryMs) && cfg.reloadEveryMs > 0 && Date.now() - lastReload >= cfg.reloadEveryMs;
    if (shouldReload) {
      console.log("[bot] Recarregando página para atualizar pedidos...");
      await tryReloadIfNeeded(page);
      await ensureLoggedInFlow(page, cfg);
      state.lastReloadAt = nowIso();
      saveState(state);

      // Em alguns casos o reload pode redirecionar; garante novamente.
      const here = page.url();
      if (here && !here.startsWith(cfg.ordersUrl)) {
        await gotoWithRetries(page, cfg.ordersUrl, { timeoutMs: cfg.navigationTimeoutMs });
      }
    }
  } catch (err) {
    console.warn("[bot] Falha ao recarregar página:", err.message);
  }

  // 3) Extrair vendas
  let sales;
  try {
    const maxPages = Number(process.env.UPSELLER_MAX_PAGES || 3);
    const extractTimeoutMs = Number(process.env.UPSELLER_EXTRACT_TIMEOUT_MS || 70_000);
    const extractor = maxPages > 1 ? extractSalesFromDomAcrossPages(page, { maxPages }) : extractSalesFromDom(page);
    sales = await withTimeout(extractor, extractTimeoutMs, "Extração de vendas");
  } catch (err) {
    console.warn("[bot] Extração falhou; tentando reload e re-extração:", err.message);
    await tryReloadIfNeeded(page);
    await ensureLoggedInFlow(page, cfg);
    const maxPages = Number(process.env.UPSELLER_MAX_PAGES || 3);
    const extractTimeoutMs = Number(process.env.UPSELLER_EXTRACT_TIMEOUT_MS || 70_000);
    const extractor = maxPages > 1 ? extractSalesFromDomAcrossPages(page, { maxPages }) : extractSalesFromDom(page);
    sales = await withTimeout(extractor, extractTimeoutMs, "Extração de vendas (2a tentativa)");
  }

  const fresh = dedupeNewSales(sales, knownIdsSet);

  let appended = 0;
  if (fresh.length > 0) {
    ({ appended } = appendSales(fresh));
    console.log(`[bot] +${appended} novas vendas (total conhecido: ${knownIdsSet.size})`);
  } else {
    console.log("[bot] Nenhuma venda nova.");
  }

  state.knownIds = Array.from(knownIdsSet).slice(-50_000); // evita crescimento infinito
  state.lastRunAt = nowIso();
  saveState(state);

  // PDF: só gera se entrou venda nova; e com throttle (default 10 min)
  if (appended > 0) {
    const lastPdf = state.lastPdfAt ? new Date(state.lastPdfAt).getTime() : 0;
    const shouldGenerate = Date.now() - lastPdf >= PDF_EVERY_MS;
    if (shouldGenerate) {
      const all = loadSales();
      const { outPath } = await generateSalesPdf(all, { date: new Date() });
      state.lastPdfAt = nowIso();
      saveState(state);
      console.log(`[bot] PDF gerado: ${outPath}`);

      try {
        const result = await sendPdfToWebhookWithRetry(outPath);
        if (result && result.skipped) {
          console.log("[bot] Webhook de PDF desabilitado (UPSELLER_PDF_WEBHOOK_URL vazio).");
        } else {
          console.log(`[bot] PDF enviado ao webhook (HTTP ${result.status}).`);
        }
      } catch (err) {
        console.warn("[bot] Falha ao enviar PDF ao webhook:", err.message);
      }
    } else {
      const waitSec = Math.ceil((PDF_EVERY_MS - (Date.now() - lastPdf)) / 1000);
      console.log(`[bot] Venda nova detectada, mas PDF está em cooldown (~${waitSec}s).`);
    }
  }
}

async function runRobotLoop() {
  const cfg = getEnvConfig();
  const state = loadState();
  const knownIdsSet = new Set();

  // Reforça dedupe com base no histórico em vendas.json (evita duplicar após mudanças de parsing/ID)
  try {
    const existing = loadSales();
    for (const s of existing) {
      if (s?.id) knownIdsSet.add(String(s.id));
      if (s?.upsellerId) knownIdsSet.add(String(s.upsellerId));
    }
  } catch {
    // ignore
  }

  let browser;
  let page;
  let stopping = false;

  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`\n[bot] Recebido ${signal}. Encerrando com segurança...`);
    try {
      state.knownIds = Array.from(knownIdsSet).slice(-50_000);
      state.lastRunAt = nowIso();
      saveState(state);
    } catch {
      // ignore
    }

    try {
      if (page) await page.close({ runBeforeUnload: true });
    } catch {
      // ignore
    }
    try {
      if (browser) await browser.close();
    } catch {
      // ignore
    }
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Loop 24/7 com auto-restart do browser
  for (;;) {
    try {
      console.log("[bot] Iniciando browser...");
      ({ browser, page } = await createBrowserAndPage(cfg));

      console.log(`[bot] Abrindo ${cfg.startUrl} ...`);
      await openAndPrepare(page, { url: cfg.startUrl });

      console.log("[bot] Se necessário, faça login/captcha na janela (sessão será salva em .session).");
      await waitForManualLogin(page, {
        timeoutMs: 0,
        loggedInSelector: cfg.loggedInSelector,
        loggedOutSelector: cfg.loggedOutSelector,
      });

      // Após login, navega para a página especificada pelo usuário
      console.log(`[bot] Login detectado. Indo para: ${cfg.ordersUrl}`);
      await gotoWithRetries(page, cfg.ordersUrl, { timeoutMs: cfg.navigationTimeoutMs });

      console.log("[bot] Monitoramento 24/7 iniciado.");

      // Scheduler simples
      let nextTick = Date.now();
      while (!stopping) {
        nextTick += SCRAPE_EVERY_MS;

        await runOnceCycle(page, cfg, state, knownIdsSet);

        const sleepMs = Math.max(0, nextTick - Date.now());
        await sleep(sleepMs);
      }

      // Se saiu do while por stopping, encerra.
      await shutdown("STOP");
      return;
    } catch (err) {
      console.warn("[bot] Loop falhou (provável crash/desconexão). Reiniciando em 5s...", err.message);

      try {
        if (browser) await browser.close();
      } catch {
        // ignore
      }
      browser = null;
      page = null;

      // Backoff leve
      await sleep(5000);
    }
  }
}

async function run() {
  // try/catch global extra
  try {
    await runRobotLoop();
  } catch (err) {
    console.error("[FATAL] Erro fatal no robô:", err);
    process.exitCode = 1;
  }
}

module.exports = { run };
