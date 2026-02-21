# Upseller Bot (Puppeteer)

Robô Node.js com Puppeteer para abrir o painel Upseller, permitir login manual (captcha), manter sessão em `./.session`, navegar para a página de pedidos (all-orders) e monitorar vendas 24/7, persistir em JSON e gerar PDFs periódicos.

## Requisitos

- Node.js 18+ (recomendado)

## Instalar

```bash
npm install
```

## Rodar

```bash
npm start
```

## Botão na Mesa (macOS)

Você tem duas opções simples para iniciar “com um clique”:

1) Duplo clique (mais simples)

- Use o arquivo [scripts/start.command](../scripts/start.command) (duplo clique abre o Terminal e roda o bot).
- Você pode arrastar esse arquivo para a Mesa (Desktop).

2) Ícone de aplicativo (.app)

- Gere um app na Mesa com:

```bash
chmod +x scripts/build-mac-app.sh
./scripts/build-mac-app.sh
```

Isso cria um "Upseller Bot.app" na Mesa que, ao clicar, abre o Terminal e executa `npm start` na pasta do projeto.

## Botão na Área de Trabalho (Windows)

1) Duplo clique (mais simples)

- Use o arquivo [scripts/start-windows.bat](../scripts/start-windows.bat) (duplo clique abre um terminal e roda o bot).
- Você pode criar um atalho desse `.bat` na Área de Trabalho.

2) Criar atalho automaticamente (PowerShell)

Abra um PowerShell na pasta do projeto e rode:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\create-desktop-shortcut.ps1
```

Isso cria um atalho "Upseller Bot" na Área de Trabalho apontando para o `.bat`.

Ao abrir o Chrome (visível), faça login manualmente. A sessão fica persistida em `./.session`.

Após o login, o bot navega automaticamente para `.../pt/order/all-orders` (página de pedidos) e roda a coleta a partir dela.

## Arquivos gerados

- `bot/vendas.json`: array com todas as vendas coletadas
- `bot/state.json`: estado (IDs já vistos e timestamps)
- `bot/reports/`: PDFs gerados a cada ~10 minutos

## Ajustes (opcional)

Se quiser tornar a detecção de login mais certeira, você pode configurar seletores via variáveis de ambiente:

- `UPSELLER_LOGGED_IN_SELECTOR` (ex.: um seletor que só existe após logar)
- `UPSELLER_LOGGED_OUT_SELECTOR` (ex.: seletor do formulário de login)

URLs:

- `UPSELLER_START_URL`: URL inicial para abrir (padrão: o `DEFAULT_URL` definido em `bot/scraper.js`)
- `UPSELLER_ORDERS_URL`: URL da página de pedidos (padrão: mesmo host do `UPSELLER_START_URL` + `/pt/order/all-orders`)

Atualização do painel:

- `UPSELLER_RELOAD_EVERY_MS`: força recarregar a página periodicamente para aparecerem pedidos novos (padrão: `30000`)

Webhook (envio de vendas em JSON, 1 venda por requisição):

- `UPSELLER_SALES_WEBHOOK_URL`: URL do webhook (padrão: `https://webhook.n8n.spaceai.com.br/webhook/upseller`). Para desabilitar, defina vazio.
- `UPSELLER_SALES_WEBHOOK_DELAY_MS`: delay entre disparos quando chegam várias vendas (padrão: `800`)
- `UPSELLER_SALES_WEBHOOK_TIMEOUT_MS`: timeout por requisição (padrão: `15000`)
- `UPSELLER_SALES_WEBHOOK_RETRIES`: tentativas em caso de 429/5xx (padrão: `5`)
- `UPSELLER_SALES_WEBHOOK_RETRY_DELAY_MS`: backoff base entre tentativas (padrão: `1000`)

## Sobre os avisos no console

É normal aparecerem mensagens como:

- `Mixed Content ... requested an insecure element http://...`
- `Failed to load resource: net::ERR_FAILED`

Isso geralmente é o Chrome reclamando de imagens/recursos externos (muitas vezes em HTTP) ou de recursos que o bot bloqueia por performance (imagens/fontes). Em geral não afeta a extração das vendas.

Para reduzir o ruído:

- Desativar logs do console da página: `LOG_PAGE_CONSOLE=0 npm start`
- Manter logs, mas filtrar ruídos (padrão): `FILTER_NOISY_PAGE_CONSOLE=1`
- Se quiser parar de bloquear imagens/fontes (menos `ERR_FAILED`, porém mais pesado): `BLOCK_RESOURCES=0 npm start`

Exemplo:

```bash
UPSELLER_LOGGED_OUT_SELECTOR='input[type="password"]' npm start

# Exemplo de URL customizada
UPSELLER_START_URL='https://app.upseller.com.br' UPSELLER_ORDERS_URL='https://app.upseller.com.br/pt/order/all-orders' npm start
```

## Observações

- A extração de vendas usa heurísticas (tabelas e listas genéricas). Caso o painel tenha uma tabela específica, você pode me pedir para ajustar o scraper com base no HTML real.
