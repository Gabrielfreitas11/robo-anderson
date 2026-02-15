const fs = require("fs");
const path = require("path");

const { sleep } = require("./utils");

const DEFAULT_PDF_WEBHOOK_URL = "https://webhook.n8n.spaceai.com.br/webhook/upseller";
const DEFAULT_SALES_WEBHOOK_URL = "https://webhook.n8n.spaceai.com.br/webhook/upseller";

function getPdfWebhookUrl() {
  // Se não setar, usamos o webhook padrão pedido pelo usuário.
  // Se setar vazio, desabilita.
  const raw = process.env.UPSELLER_PDF_WEBHOOK_URL;
  if (raw === undefined) return DEFAULT_PDF_WEBHOOK_URL;
  return String(raw).trim();
}

function getSalesWebhookUrl() {
  // Se não setar, usamos o webhook padrão.
  // Se setar vazio, desabilita.
  const raw = process.env.UPSELLER_SALES_WEBHOOK_URL;
  if (raw === undefined) return DEFAULT_SALES_WEBHOOK_URL;
  return String(raw).trim();
}

function isRetryableStatus(status) {
  if (!Number.isFinite(status)) return true; // erro de rede / sem status
  if (status === 408) return true;
  if (status === 429) return true;
  if (status >= 500) return true;
  return false;
}

function parseRetryAfterMs(retryAfterHeader) {
  if (!retryAfterHeader) return 0;
  const raw = String(retryAfterHeader).trim();
  if (!raw) return 0;
  // Pode ser segundos ("120") ou data HTTP.
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const dateMs = Date.parse(raw);
  if (!Number.isFinite(dateMs)) return 0;
  const delta = dateMs - Date.now();
  return delta > 0 ? delta : 0;
}

async function sendPdfToWebhook(filePath, { url = getPdfWebhookUrl(), filename } = {}) {
  if (!url) {
    return { skipped: true, reason: "no_url" };
  }

  const fileBuffer = await fs.promises.readFile(filePath);
  const name = filename || path.basename(filePath);

  const form = new FormData();
  const blob = new Blob([fileBuffer], { type: "application/pdf" });
  form.append("file", blob, name);

  const res = await fetch(url, {
    method: "POST",
    body: form,
  });

  const text = await res.text().catch(() => "");

  if (!res.ok) {
    const preview = text ? `: ${String(text).slice(0, 800)}` : "";
    const err = new Error(`Webhook respondeu ${res.status} ${res.statusText}${preview}`);
    err.status = res.status;
    err.responseText = text;
    throw err;
  }

  return { ok: true, status: res.status, responseText: text };
}

async function sendSaleToWebhook(sale, { url = getSalesWebhookUrl(), timeoutMs } = {}) {
  if (!url) {
    return { skipped: true, reason: "no_url" };
  }

  const ms = Number.isFinite(Number(timeoutMs))
    ? Number(timeoutMs)
    : Math.max(1000, Number(process.env.UPSELLER_SALES_WEBHOOK_TIMEOUT_MS || 15_000));

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(new Error("timeout")), ms);

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(sale),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(t);
  }

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    const retryAfterMs = parseRetryAfterMs(res.headers && res.headers.get ? res.headers.get("retry-after") : "");
    const preview = text ? `: ${String(text).slice(0, 800)}` : "";
    const err = new Error(`Webhook respondeu ${res.status} ${res.statusText}${preview}`);
    err.status = res.status;
    err.responseText = text;
    err.retryAfterMs = retryAfterMs;
    throw err;
  }

  return { ok: true, status: res.status, responseText: text };
}

async function sendSaleToWebhookWithRetry(sale, opts = {}) {
  const maxAttempts = Math.max(1, Number(process.env.UPSELLER_SALES_WEBHOOK_RETRIES || 5));
  const baseDelayMs = Math.max(0, Number(process.env.UPSELLER_SALES_WEBHOOK_RETRY_DELAY_MS || 1000));

  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await sendSaleToWebhook(sale, opts);
    } catch (err) {
      lastErr = err;
      const status = err && typeof err === "object" ? err.status : undefined;
      const retryable = isRetryableStatus(status);
      if (!retryable || attempt === maxAttempts) throw err;

      const retryAfterMs = err && typeof err === "object" && Number.isFinite(err.retryAfterMs) ? err.retryAfterMs : 0;
      const backoffMs = baseDelayMs * attempt;
      await sleep(Math.max(backoffMs, retryAfterMs));
    }
  }

  throw lastErr;
}

async function sendSalesToWebhookSequentially(sales, { delayMs } = {}) {
  if (!Array.isArray(sales) || sales.length === 0) return { ok: true, sent: 0 };

  const d = Number.isFinite(Number(delayMs))
    ? Number(delayMs)
    : Math.max(0, Number(process.env.UPSELLER_SALES_WEBHOOK_DELAY_MS || 800));

  let sent = 0;
  for (let i = 0; i < sales.length; i++) {
    await sendSaleToWebhookWithRetry(sales[i]);
    sent += 1;
    if (d > 0 && i < sales.length - 1) await sleep(d);
  }

  return { ok: true, sent };
}

async function sendPdfToWebhookWithRetry(filePath, opts = {}) {
  const maxAttempts = Math.max(1, Number(process.env.UPSELLER_PDF_WEBHOOK_RETRIES || 3));
  const baseDelayMs = Math.max(0, Number(process.env.UPSELLER_PDF_WEBHOOK_RETRY_DELAY_MS || 1000));

  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await sendPdfToWebhook(filePath, opts);
    } catch (err) {
      lastErr = err;
      const status = err && typeof err === "object" ? err.status : undefined;
      const retryable = isRetryableStatus(status);
      if (!retryable || attempt === maxAttempts) throw err;
      await sleep(baseDelayMs * attempt);
    }
  }

  // Nunca deve chegar aqui
  throw lastErr;
}

module.exports = {
  getPdfWebhookUrl,
  getSalesWebhookUrl,
  sendPdfToWebhook,
  sendPdfToWebhookWithRetry,
  sendSaleToWebhook,
  sendSaleToWebhookWithRetry,
  sendSalesToWebhookSequentially,
};
