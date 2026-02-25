/*
  Entry-point raiz.
  Mantém o script de start simples: `npm start` -> `node index.js`

  Suporta múltiplas instâncias (ex: dois logins diferentes) via:
  - env: UPSELLER_INSTANCE=loja1 npm start
  - argv: npm start -- --instance loja1
*/

function readArgValue(argv, name) {
  const flag = `--${name}`;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === flag && argv[i + 1]) return argv[i + 1];
    if (typeof a === "string" && a.startsWith(flag + "=")) return a.slice(flag.length + 1);
  }
  return "";
}

function readShortArgValue(argv, shortFlag) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === shortFlag && argv[i + 1]) return argv[i + 1];
  }
  return "";
}

// IMPORTANT: define a instância antes de carregar qualquer módulo do bot,
// porque os paths (sessão/state/vendas) são derivados dessa env.
if (!process.env.UPSELLER_INSTANCE) {
  const v = readArgValue(process.argv, "instance") || readShortArgValue(process.argv, "-i");
  if (v && String(v).trim()) process.env.UPSELLER_INSTANCE = String(v).trim();
}

const { run } = require("./bot");

run().catch((err) => {
  console.error("[FATAL] Erro não tratado no entry-point:", err);
  process.exitCode = 1;
});
