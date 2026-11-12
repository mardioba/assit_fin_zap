#!/usr/bin/env bash
# ============================================================
# Assistente Financeiro via WhatsApp — iniciar localmente
# (Linux/macOS)
#
# Uso:
#   ./iniciar.sh            sobe backend + frontend
#   ./iniciar.sh backend    sobe só a API (porta 4000)
#   ./iniciar.sh frontend   sobe só o painel (porta 5173)
#
# O que o script faz, na primeira execução:
#   1. Verifica Node.js >= 22 e npm
#   2. Cria backend/.env a partir de .env.example (se não existir)
#      e gera os segredos JWT com o gerador criptográfico do Node
#   3. Instala dependências (backend e frontend), se faltarem
#   4. Gera o Prisma Client e aplica as migrações (SQLite local)
#   5. Sobe os dois processos; Ctrl+C encerra tudo
# ============================================================
# Se executado com "sh iniciar.sh", reexecuta com bash
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

# ---------- cores/terminal ----------
if [ -t 1 ]; then
  C_VERDE=$'\033[32m'; C_AMARELO=$'\033[33m'; C_VERMELHO=$'\033[31m'
  C_CIANO=$'\033[36m'; C_RESET=$'\033[0m'
else
  C_VERDE=""; C_AMARELO=""; C_VERMELHO=""; C_CIANO=""; C_RESET=""
fi

log()    { printf '%s\n' "${C_CIANO}[info]${C_RESET} $*"; }
ok()     { printf '%s\n' "${C_VERDE}[ok]${C_RESET} $*"; }
aviso()  { printf '%s\n' "${C_AMARELO}[aviso]${C_RESET} $*"; }
falhar() { printf '%s\n' "${C_VERMELHO}[erro]${C_RESET} $*" >&2; exit 1; }

# ---------- argumentos ----------
ALVO="tudo"
case "${1:-}" in
  ""|tudo|--tudo)        ALVO="tudo" ;;
  backend|--backend)     ALVO="backend" ;;
  frontend|--frontend)   ALVO="frontend" ;;
  -h|--help)
    sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 0 ;;
  *) falhar "Opção desconhecida: $1 (use: tudo | backend | frontend | --help)" ;;
esac

# ---------- 1. pré-requisitos ----------
command -v node >/dev/null 2>&1 || falhar \
"Node.js não encontrado. Instale o Node 22+:
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt install -y nodejs"
command -v npm >/dev/null 2>&1 || falhar "npm não encontrado (reinstale o Node.js)."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || falhar \
"Node.js 22+ é necessário (atual: $(node --version)). Instale com:
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt install -y nodejs"
ok "Node $(node --version) / npm $(npm --version)"

# ---------- 2. backend/.env ----------
gerar_segredo() {
  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
}

if [ ! -f backend/.env ]; then
  [ -f .env.example ] || falhar ".env.example não encontrado na raiz do projeto."
  cp .env.example backend/.env
  ok "backend/.env criado a partir de .env.example"
fi

# Preenche segredos ausentes ou ainda no placeholder REPLACE_ME
for CHAVE in JWT_ACCESS_SECRET JWT_REFRESH_SECRET; do
  if grep -qE "^${CHAVE}=(REPLACE_ME.*)?$" backend/.env; then
    SEGREDO="$(gerar_segredo)"
    sed -i "s|^${CHAVE}=.*|${CHAVE}=${SEGREDO}|" backend/.env
    ok "Segredo ${CHAVE} gerado (openssl/Node crypto)"
  fi
done
# WHATSAPP_VERIFY_TOKEN: só preenche se estiver descomentado e vazio
if grep -qE "^WHATSAPP_VERIFY_TOKEN=$" backend/.env; then
  sed -i "s|^WHATSAPP_VERIFY_TOKEN=.*|WHATSAPP_VERIFY_TOKEN=$(gerar_segredo)|" backend/.env
  ok "Segredo WHATSAPP_VERIFY_TOKEN gerado"
fi

# ---------- 3. dependências ----------
if [ ! -d backend/node_modules ]; then
  log "Instalando dependências do backend (pode levar alguns minutos)..."
  (cd backend && npm install --no-audit --no-fund)
  ok "backend: node_modules instalado"
fi
if [ "$ALVO" != "backend" ] && [ ! -d frontend/node_modules ]; then
  log "Instalando dependências do frontend (pode levar alguns minutos)..."
  (cd frontend && npm install --no-audit --no-fund)
  ok "frontend: node_modules instalado"
fi

# ---------- 4. banco local (SQLite) + Prisma ----------
if [ "$ALVO" != "frontend" ]; then
  log "Aplicando migrações do banco (SQLite local)..."
  (cd backend && npx prisma generate >/dev/null && npx prisma migrate deploy)
  ok "Banco atualizado (backend/prisma/dev.db)"
fi

# ---------- 5. portas ----------
porta_ocupada() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk '{print $4}' | grep -q ":$1\$"
  else
    return 1
  fi
}
[ "$ALVO" != "frontend" ] && porta_ocupada 4000 && \
  aviso "Porta 4000 já está em uso — encerre o processo anterior antes de continuar."
[ "$ALVO" != "backend" ] && porta_ocupada 5173 && \
  aviso "Porta 5173 já está em uso — encerre o processo anterior antes de continuar."
true # evita exit code do set -e nas comparações acima

# ---------- 6. subir processos ----------
encerrar() {
  trap - INT TERM
  echo
  log "Encerrando backend e frontend..."
  kill -TERM 0 2>/dev/null || true
}
trap encerrar INT TERM

printf '\n%s╔══════════════════════════════════════════════════════╗%s\n' "$C_VERDE" "$C_RESET"
printf   '%s║  Assistente Financeiro via WhatsApp — modo local     ║%s\n' "$C_VERDE" "$C_RESET"
printf   '%s╚══════════════════════════════════════════════════════╝%s\n\n' "$C_VERDE" "$C_RESET"

if [ "$ALVO" != "frontend" ]; then
  log "Backend  → http://localhost:4000  (API + webhook)"
  (cd backend && npm run dev) &
fi
if [ "$ALVO" != "backend" ]; then
  log "Frontend → http://localhost:5173  (painel; proxy /api → :4000)"
  (cd frontend && npm run dev) &
fi

ok "Pronto! Abra http://localhost:5173 no navegador."
log "Pressione Ctrl+C para encerrar tudo."

# Aguarda o próximo processo sair (queda/desligamento) e derruba o resto
wait -n 2>/dev/null || true
encerrar
wait 2>/dev/null || true
