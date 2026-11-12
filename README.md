# 💰 Assistente Financeiro Inteligente via WhatsApp

Sistema de gestão financeira com interpretação por IA e integração ao WhatsApp.
Este repositório está na **FASE 1 (Fundação)** — ver [docs/FASE1-RELATORIO.md](docs/FASE1-RELATORIO.md).

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
├── docker-compose.yml
└── .env.example      # modelo de configuração (copie para .env)
```

## Como rodar (sem Docker — ambiente atual)

Requisitos: Node.js ≥ 22 e npm.

### 1. Backend

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
cd backend && npm test           # 23 testes (auth, users, dashboard, segurança)
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

## Roadmap

- ✅ **Fase 1** — Fundação: estrutura, Docker, banco, auth JWT, dashboard
- ⬜ **Fase 2** — Receitas, despesas, categorias, contas, consultas
- ⬜ **Fase 3** — WhatsApp Cloud API + interpretação com IA
- ⬜ **Fase 4** — Áudio, comprovantes, cartões, recorrências, relatórios
- ⬜ **Fase 5** — Testes de segurança, tratamento de erros, VPS

## Documentação

- [Decisões técnicas](docs/DECISOES-TECNICAS.md)
- [Relatório da Fase 1](docs/FASE1-RELATORIO.md)
