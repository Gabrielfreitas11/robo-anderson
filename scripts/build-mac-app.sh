#!/bin/zsh
set -euo pipefail

# Cria um .app na Mesa (Desktop) que inicia o bot via Terminal.
# Uso:
#   ./scripts/build-mac-app.sh            # instancia default
#   ./scripts/build-mac-app.sh loja1      # instancia loja1

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

INSTANCE="${1:-default}"

TEMPLATE="$SCRIPT_DIR/upseller-bot.applescript.in"
GEN="$SCRIPT_DIR/upseller-bot.applescript"

if [[ -n "$INSTANCE" && "$INSTANCE" != "default" ]]; then
  APP_NAME="Upseller Bot (${INSTANCE})"
else
  APP_NAME="Upseller Bot"
fi

OUT_APP="$HOME/Desktop/${APP_NAME}.app"

if [[ ! -f "$TEMPLATE" ]]; then
  echo "Template não encontrado: $TEMPLATE" >&2
  exit 1
fi

# Substitui placeholders (escape básico de barras e &)
PROJECT_DIR_ESCAPED=${PROJECT_DIR//&/\\&}
PROJECT_DIR_ESCAPED=${PROJECT_DIR_ESCAPED//\//\\/}

INSTANCE_ESCAPED=${INSTANCE//&/\\&}
INSTANCE_ESCAPED=${INSTANCE_ESCAPED//\//\\/}

sed -e "s/__PROJECT_DIR__/${PROJECT_DIR_ESCAPED}/g" -e "s/__INSTANCE__/${INSTANCE_ESCAPED}/g" "$TEMPLATE" > "$GEN"

echo "[upseller] Gerando app em: $OUT_APP"
osacompile -o "$OUT_APP" "$GEN"

echo "[upseller] Pronto. Um ícone chamado '${APP_NAME}' apareceu na sua Mesa."
