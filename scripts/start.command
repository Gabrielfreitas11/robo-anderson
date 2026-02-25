#!/bin/zsh
set -euo pipefail

# Inicia o Upseller bot a partir da raiz do projeto.
# Dica: você pode arrastar este arquivo para a Mesa (Desktop) e dar duplo clique.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

INSTANCE="${1:-${UPSELLER_INSTANCE:-default}}"

echo "[upseller] Diretório: $PROJECT_DIR"
echo "[upseller] Instância: $INSTANCE"
echo "[upseller] Iniciando com: npm start"
echo

if [[ -n "$INSTANCE" && "$INSTANCE" != "default" ]]; then
	UPSELLER_INSTANCE="$INSTANCE" npm start -- --instance "$INSTANCE"
else
	npm start
fi

# Se o bot sair, mantém a janela aberta para você ver o motivo.
echo
read "REPLY?\n[upseller] O processo terminou. Pressione Enter para fechar... "
