# 💰 Assistente Financeiro Inteligente via WhatsApp

Sistema de gestão financeira com interpretação por IA e integração ao WhatsApp.
Este repositório está na **FASE 5 (concluída)** — relatórios em
[docs/](docs/): [FASE1](docs/FASE1-RELATORIO.md), [FASE2](docs/FASE2-RELATORIO.md),
[FASE3](docs/FASE3-RELATORIO.md), [FASE4](docs/FASE4-RELATORIO.md),
[FASE5](docs/FASE5-RELATORIO.md).

## Stack

| Camada | Tecnologia |
| --- | --- |
| Backend | Node.js 22 + TypeScript + Express 5 |
| Banco | SQLite (dev/teste) / PostgreSQL (produção, via Docker) |
| ORM | Prisma |
| Auth | JWT (access + refresh com rotação) em cookies `httpOnly`, senha bcrypt |
| Frontend | React 19 + Vite + Tailwind CSS 4 + Recharts |
| Testes | Vitest + Supertest |
| Infra | Docker Compose (API + PostgreSQL + Nginx) |

## Estrutura

```
assit_fin_zap/
├── backend/          # API REST (src/modules: auth, users, dashboard, health, audit)
│   ├── prisma/       # schema + migrations
│   └── tests/        # testes automatizados
├── frontend/         # Painel web (login + dashboard)
├── docs/             # Decisões técnicas e relatórios de fase
├── iniciar.sh        # script de início local (backend + frontend)
├── docker-compose.yml
└── .env.example      # modelo de configuração (copie para .env)
```

## Como rodar (sem Docker — ambiente atual)

Requisitos: Node.js ≥ 22 e npm.

### 0. Início rápido (script)

```bash
./iniciar.sh            # backend + frontend
./iniciar.sh backend    # só a API  (http://localhost:4000)
./iniciar.sh frontend   # só o painel (http://localhost:5173)
./iniciar.sh --help     # ajuda
```

Na primeira execução o script faz tudo sozinho: cria `backend/.env`
(a partir de `.env.example`), gera os segredos JWT, instala as
dependências, aplica as migrações do SQLite e sobe os dois processos.
`Ctrl+C` encerra backend e frontend.

### 1. Backend (manual)

```bash
cd backend
npm install
cp ../.env.example .env          # já inclui DATABASE_URL do SQLite
# gere segredos: openssl rand -base64 48  (cole em JWT_ACCESS_SECRET/REFRESH)
npx prisma migrate dev           # cria o banco SQLite (dev.db)
npm run dev                      # API em http://localhost:4000
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev                      # web em http://localhost:5173 (proxy /api -> :4000)
```

Acesse `http://localhost:5173`, crie uma conta e verá o dashboard.

### 3. Testes

```bash
cd backend && npm test           # 171 testes (inclui 21 de segurança)
npm run typecheck                # TypeScript strict
```

## Como rodar com Docker (produção)

> Requer Docker instalado. Antes de subir, troque `provider = "sqlite"` por
> `"postgresql"` em `backend/prisma/schema.prisma` e gere as migrações:
> `cd backend && npx prisma migrate dev --name postgres-provider`.

```bash
cp .env.example .env             # preencha POSTGRES_PASSWORD, JWT_*_SECRET
docker compose up --build -d
```

- Web: http://localhost:8080
- API: http://localhost:4000/api/health

## Variáveis de ambiente

Todas documentadas em [`.env.example`](.env.example). **Nunca** coloque senhas ou
tokens diretamente no código — apenas em `.env` (ignorado pelo Git).

## WhatsApp e IA (Fase 3)

1. **Sem credenciais (atual):** o interpretador **local pt-BR** e o envio em
   modo local já funcionam — veja a tela *WhatsApp* no painel.
2. **Com API oficial (produção):** preencha no `.env`:
   `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`,
   `WHATSAPP_APP_SECRET` e aponte o webhook da Meta para
   `https://SEU_DOMINIO/api/whatsapp/webhook`.
3. **IA:** defina `OPENAI_API_KEY` ou `GEMINI_API_KEY` (com `AI_PROVIDER=auto`).
   Sem chaves, o interpretador local é usado automaticamente.
4. **Áudio e comprovantes (Fase 4):** usam a **mesma chave** de IA + `WHATSAPP_*`
   (para a Graph API baixar a mídia). Sem isso, o bot responde pedindo dados em
   texto.

## Roadmap

- ✅ **Fase 1** — Fundação: estrutura, Docker, banco, auth JWT, dashboard
- ✅ **Fase 2** — Receitas, despesas, categorias, contas, histórico, consultas
- ✅ **Fase 3** — WhatsApp Cloud API + interpretação com IA
- ✅ **Fase 4** — Áudio, comprovantes, cartões, recorrências, contas, exportação
- ✅ **Fase 5** — Testes de segurança, tratamento de erros, VPS

## Endpoints principais

| Método | Rota | Descrição |
| --- | --- | --- |
| POST | `/api/auth/register` `/login` `/refresh` `/logout` | Sessão JWT em cookies |
| GET/PATCH | `/api/users/me` | Perfil do usuário |
| GET | `/api/dashboard/summary?month=` | Saldo, receitas, despesas, resultado |
| GET/POST | `/api/categories` | Categorias (12 padrões no cadastro) |
| GET/POST | `/api/accounts` | Contas (BANK/CASH/WALLET) com saldo real |
| POST | `/api/accounts/transfer` | Transferência entre contas |
| GET/POST | `/api/transactions` | Movimentações com filtros e paginação |
| GET | `/api/reports/summary` `/by-category` `/monthly` `/annual` | Consultas e gráficos |
| GET | `/api/reports/export?month=&format=csv\|pdf` | Exportação Excel (CSV+BOM) e PDF |
| GET/POST | `/api/whatsapp/webhook` | Verificação Meta + recepção (HMAC, anti-duplicidade, áudio/foto) |
| POST | `/api/whatsapp/send` `/test-interpret` | Envio pelo painel e teste do interpretador |
| GET | `/api/whatsapp/status` | Status da integração (sem expor segredos) |
| PATCH | `/api/users/me` | Perfil + `whatsappPhone` (vínculo do número) |
| GET/POST | `/api/cards` `/:id/invoice` | Cartões, fatura por ciclo e limite disponível |
| GET/POST | `/api/recurring` `/run` | Contas recorrentes (materialização idempotente) |
| GET/POST | `/api/bills` `/:id/pay` `/run-reminders` | Contas a pagar/receber + lembretes WhatsApp |

## Documentação

- [Decisões técnicas](docs/DECISOES-TECNICAS.md) (D-001 → D-029)
- [Relatório da Fase 1](docs/FASE1-RELATORIO.md)
- [Relatório da Fase 2](docs/FASE2-RELATORIO.md)
- [Relatório da Fase 3](docs/FASE3-RELATORIO.md)
- [Relatório da Fase 4](docs/FASE4-RELATORIO.md)
- [Relatório da Fase 5](docs/FASE5-RELATORIO.md)
- [Guia de deploy em VPS](docs/DEPLOY-VPS.md)
