# Relatório — FASE 1 (Fundação)

**Data:** 12/11/2026 | **Status:** ✅ CONCLUÍDA E TESTADA

## O que foi desenvolvido

### 1. Estrutura do projeto
- Monorepo `backend/` + `frontend/` + `docs/` + `docker-compose.yml` + `.env.example`
- Git inicializado com `.gitignore` (`.env`, `*.db`, `node_modules` nunca versionados)

### 2. Docker e banco de dados
- `docker-compose.yml`: PostgreSQL 16 + API + Nginx (web) com healthcheck
- `Dockerfile` multi-stage para API e para frontend
- **Ambiente atual (sem Docker):** SQLite via Prisma, schema portável para Postgres
  (sem enums/Json — ver D-002 em `docs/DECISOES-TECNICAS.md`)
- Migração inicial criada: `backend/prisma/migrations/`

### 3. Modelos (Fase 1)
| Modelo | Objetivo |
| --- | --- |
| `User` | contas de usuários (multi-usuário desde o dia 1) |
| `RefreshToken` | sessões com rotação, armazenados como hash |
| `AuditLog` | trilha de auditoria (LGPD / item 8) |

### 4. Autenticação (JWT)
- `POST /api/auth/register`, `/login`, `/refresh`, `/logout`
- Cookies `httpOnly` (access 15 min + refresh 7 dias com **rotação**)
- bcrypt cost 12, mensagens genéricas anti-enumeração, rate limit (20/15min nas rotas de auth)
- Validação Zod em todas as entradas

### 5. Módulos
- **Users:** `GET/PATCH /api/users/me` (isolation via token)
- **Dashboard:** `GET /api/dashboard/summary` (estrutura completa; totais = zeros reais até a Fase 2)
- **Health:** `GET /api/health`
- **Audit:** middleware de registro em todas as ações sensíveis

### 6. Painel web (React + Vite + Tailwind)
- Tela de **login/cadastro** com tratamento de erros
- **Dashboard** com 4 cards (saldo, receitas, despesas, resultado), gráfico
  Receitas × Despesas (Recharts), resumo de contas pendentes
- Rota protegida + restauração de sessão via refresh cookie
- Build de produção validado (`npm run build`)

## Testes realizados

**23/23 testes passando** (`cd backend && npm test`):

| Arquivo | Cobre |
| --- | --- |
| `auth.test.ts` (10) | registro, hash da senha, e-mail duplicado (409), validações, login, senha errada, anti-enumeração, **rotação de refresh token**, logout revogando sessão |
| `users.test.ts` (5) | `/users/me`, atualização + auditoria, validação de nome, **isolamento entre usuários**, estrutura do dashboard |
| `health.test.ts` (5) | health, 404, rotas protegidas sem sessão (401), token inválido (401) |
| `money.test.ts` (3) | conversão para centavos, erro em valor inválido, formatação BRL |

Além dos testes automatizados:
- `tsc --noEmit` (strict) limpo no backend e no frontend;
- **Teste de fumaça E2E:** API real subiu, registro + sessão + dashboard
  responderam corretamente via curl e via proxy do Vite (porta 5173).

## Como testar manualmente

```bash
cd backend && npm install && npx prisma migrate dev && npm run dev
cd frontend && npm install && npm run dev     # outra terminal
# abra http://localhost:5173 e crie uma conta
```

## O que falta configurar

1. **Docker/PostgreSQL** — quando disponíveis: trocar `provider = "postgresql"`
   no schema, gerar migração e subir `docker compose up --build` (passos no README).
2. **`.env` em produção** — gerar secrets fortes (`openssl rand -base64 48`),
   `COOKIE_SECURE=true`, `CORS_ORIGIN` do domínio real.
3. **Fase 3** — credenciais OpenAI/Gemini e WhatsApp Cloud API (já previstas no `.env.example`).
4. **Manual QA do UI** — fluxo visual de login/dashboard no navegador (API e build validados).
5. **Bundle do Recharts** — code-splitting agendado para a Fase 5.

## Próxima fase (não iniciada, conforme combinado)

**FASE 2 — Gestão financeira:** receitas, despesas, categorias, contas
bancárias, histórico e consultas financeiras — mantendo o contrato do
`/api/dashboard/summary` já consumido pelo frontend.
