#!/bin/zsh
set -euo pipefail

# Inicia o Upseller bot a partir da raiz do projeto.
# Dica: você pode arrastar este arquivo para a Mesa (Desktop) e dar duplo clique.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

echo "[upseller] Diretório: $PROJECT_DIR"
echo "[upseller] Iniciando com: npm start"
echo

npm start

# Se o bot sair, mantém a janela aberta para você ver o motivo.
echo
read "REPLY?\n[upseller] O processo terminou. Pressione Enter para fechar... "
