const fs = require("fs");
const path = require("path");

const { sleep } = require("./utils");

const DEFAULT_PDF_WEBHOOK_URL = "https://webhook.n8n.spaceai.com.br/webhook/upseller";

function getPdfWebhookUrl() {
  // Se não setar, usamos o webhook padrão pedido pelo usuário.
  // Se setar vazio, desabilita.
  const raw = process.env.UPSELLER_PDF_WEBHOOK_URL;
  if (raw === undefined) return DEFAULT_PDF_WEBHOOK_URL;
  return String(raw).trim();
}

function isRetryableStatus(status) {
  if (!Number.isFinite(status)) return true; // erro de rede / sem status
  if (status === 408) return true;
  if (status === 429) return true;
  if (status >= 500) return true;
  return false;
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
  sendPdfToWebhook,
  sendPdfToWebhookWithRetry,
};
