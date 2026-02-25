function sanitizeInstanceName(raw) {
  const v = String(raw || "").trim();
  if (!v) return "default";

  // Mantém só caracteres seguros para usar em nomes de arquivo/pasta.
  const cleaned = v
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");

  return cleaned || "default";
}

function getInstanceName() {
  return sanitizeInstanceName(process.env.UPSELLER_INSTANCE || "default");
}

function isDefaultInstance(name) {
  return sanitizeInstanceName(name) === "default";
}

module.exports = {
  sanitizeInstanceName,
  getInstanceName,
  isDefaultInstance,
};
