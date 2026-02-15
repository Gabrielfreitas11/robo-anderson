/*
  Entry-point raiz.
  Mantém o script de start simples: `npm start` -> `node index.js`
*/

const { run } = require("./bot");

run().catch((err) => {
  console.error("[FATAL] Erro não tratado no entry-point:", err);
  process.exitCode = 1;
});
