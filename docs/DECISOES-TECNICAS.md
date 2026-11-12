# Decisões Técnicas

Registro de todas as decisões de arquitetura (regra do projeto, item 11.8).

## D-001 — Monorepo com `backend/` e `frontend/`

**Data:** Fase 1 | **Status:** aceito

Dois pacotes npm independentes na mesma pasta, com `.env` raiz compartilhado
via `dotenv`. Facilita deploy separado (API e web) e evita dependências cruzadas.
Alternativa descartada: npm workspaces (complexidade desnecessária nesta fase).

## D-002 — SQLite no desenvolvimento, PostgreSQL na produção

**Data:** Fase 1 | **Status:** aceito

O ambiente de desenvolvimento atual não possui Docker/PostgreSQL. Para não
bloquear a Fase 1 e atender a regra "não modificar o sistema", usa-se SQLite
(`file:./dev.db`) com schema **100% portável** para PostgreSQL:

- sem `enum` (campos `String` documentados: ex. `role = "USER" | "ADMIN"`);
- sem tipos `Json` (metadados como String JSON);
- valores financeiros em **centavos (`Int`)** — ver D-003.

O `docker-compose.yml` já sobe PostgreSQL 16 + API + Nginx. Migração futura:
trocar `provider` no `schema.prisma` e rodar `prisma migrate dev`.

## D-003 — Valores financeiros em centavos (`Int`)

**Data:** Fase 1 | **Status:** aceito

`Float` introduz erros de aritmética binária (0,1 + 0,2 ≠ 0,3). Armazenar em
centavos (`Int`) dá soma exata no banco e formato BRL correto. Helpers em
`backend/src/lib/money.ts` (`toCents`, `formatBRL`) com testes.

## D-004 — Autenticação: access token (15 min) + refresh token com rotação

**Data:** Fase 1 | **Status:** aceito

- Ambos os tokens em **cookies `httpOnly`** (não acessíveis por JS → mitiga XSS;
  frontend não usa `localStorage`).
- Refresh token é **rotativo**: cada uso revoga o anterior e emite novos.
- No banco fica apenas o **hash SHA-256** do refresh token (vazamento do banco
  não permite sequestro de sessão).
- Senhas com **bcrypt (cost 12)**.
- Mensagem de login genérica ("Credenciais inválidas") para evitar enumeração
  de usuários.

Alternativa descartada (por ora): refresh token em DB com detecção de roubo
(token reuse) — pode ser adicionado na Fase 5 com testes de segurança.

## D-005 — Express 5 + estrutura modular (sem NestJS)

**Data:** Fase 1 | **Status:** aceito (conforme preferência do usuário)

Módulos independentes em `src/modules/<dominio>/` (routes/service), seguindo o
pedido de arquitetura modular do projeto. Validação com **Zod**, erros via
`AppError` + middleware global, handlers async com `asyncHandler`.

## D-006 — Auditoria (LGPD / item 8)

**Data:** Fase 1 | **Status:** aceito

Tabela `AuditLog` registra `auth.register`, `auth.login`, `auth.logout`,
`user.update` com IP e user-agent. A escrita de auditoria nunca derruba a
requisição principal (falhas vão para log de erro).

## D-007 — Isolamento de dados por usuário

**Data:** Fase 1 | **Status:** aceito

Todas as rotas protegidas leem o `userId` do **token** (`req.user.sub`), nunca
do corpo da requição. O dashboard soma apenas dados do usuário autenticado —
garantia de isolamento testada em `tests/users.test.ts`. Os módulos financeiros
da Fase 2 herdarão esta regra (`userId` obrigatório em todas as queries).

## D-008 — Sem dados fictícios em produção

**Data:** Fase 1 | **Status:** aceito

O `seed` só cria usuário administrador **se** `ADMIN_EMAIL`/`ADMIN_PASSWORD`
forem informados no `.env`. Nenhum dado financeiro de exemplo é gerado. Os
totais do dashboard na Fase 1 são **zeros reais** (a tabela de movimentações
ainda não existe).

## D-009 — Versões de dependências fixadas em ambiente "futuro"

**Data:** Fase 1 | **Status:** aceito

O registry npm deste ambiente apresenta versões mais recentes que as
documentadas (ex.: Vite 8, TypeScript 5.9.3 como máximo da série 5). Pacotes
foram fixados em versões resolvidas e testadas (`prisma`/`@prisma/client` em
`6.19.3` — estável, sem RC).

## D-010 — Frontend: React + Vite + Tailwind 4

**Data:** Fase 1 | **Status:** aceito (conforme preferência do usuário)

SPA com proxy `/api` → `:4000` em dev; em produção, Nginx faz reverse proxy.
Gráficos com Recharts. Code-splitting do Recharts adiado para Fase 5
(aviso de bundle > 500 kB).

## D-011 — Transferências entre contas não são receitas/despesas

**Data:** Fase 2 | **Status:** aceito

Modelo `Transfer` separado de `Transaction`. Transferência altera o saldo de
duas contas, mas **nunca** entra nos totais de receitas/despesas nem nos
gráficos — regra financeira padrão (evita inflar faturamento). Consequência:
saldo total = Σ saldos iniciais + receitas − despesas (transferências se anulam).

## D-012 — Saldos calculados via agregação, sem coluna desnormalizada

**Data:** Fase 2 | **Status:** aceito

Não existe coluna `balance` na conta: o saldo é calculado (`groupBy` de
movimentações + transferências). Evita dessincronização (o clássico bug de
"saldo corrompido"). Se houver lentidão com milhares de lançamentos, otimizar
com coluna atualizada + gatilho/index — decisão futura documentada aqui.

## D-013 — Exclusão bloqueada para conta com movimentações

**Data:** Fase 2 | **Status:** aceito

Conta com histórico não pode ser apagada (409 `ACCOUNT_IN_USE`); o caminho é
desativar (`isActive=false`). Protege a integridade dos saldos e a rastreabilidade
auditoria/LGPD. Categorias, ao contrário, são excluídas e desvinculam
movimentações (`SetNull`) — dado histórico permanece íntegro.

## D-014 — Categorias padrão criadas no cadastro

**Data:** Fase 2 | **Status:** aceito

12 categorias (8 despesa, 4 receita) criadas em `POST /register` com
`isDefault=true`. São **configuração de uso**, não dados financeiros fictícios
(regra 11.5 respeitada). O usuário pode renomear/excluir todas; novas são
criadas sob demanda com `UNIQUE(userId, name, type)`.
