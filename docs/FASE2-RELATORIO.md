# Relatório — FASE 2 (Gestão financeira)

**Data:** 12/11/2026 | **Status:** ✅ CONCLUÍDA E TESTADA

## O que foi desenvolvido

### Modelos novos (Prisma, portáveis SQLite ⇄ Postgres)
| Modelo | Objetivo |
| --- | --- |
| `Category` | categorias personalizadas por usuário (`UNIQUE(userId, name, type)`) |
| `Account` | contas bancárias, espécie e carteiras digitais (com saldo inicial) |
| `Transaction` | receitas e despesas (centavos, data, categoria, conta, pagamento, estabelecimento) |
| `Transfer` | transferências entre contas — **muda saldo, não conta como receita/despesa** |

### Endpoints (todos exigem sessão e filtram por `userId` do token)
- **Categorias:** `GET/POST /api/categories`, `PATCH/DELETE /api/categories/:id`
- **Contas:** `GET/POST /api/accounts`, `PATCH/DELETE /api/accounts/:id`, `POST /api/accounts/transfer`
- **Movimentações:** `GET /api/transactions` (filtros: `month`, `type`, `categoryId`, `accountId`, `search`, paginação), `POST`, `PATCH`, `DELETE`
- **Relatórios:** `GET /api/reports/summary?month=` · `GET /api/reports/by-category?month=&type=` · `GET /api/reports/monthly?months=6`
- **Dashboard:** `GET /api/dashboard/summary?month=` — agora com **valores reais** (saldo, receitas, despesas, resultado, contagem)

### Regras de negócio
- **Saldo total** = Σ saldos iniciais + receitas − despesas (transferências se anulam no total)
- **Saldo por conta** = inicial + movimentações da conta ± transferências
- Exclusão de conta com movimentações é **bloqueada** (409 `ACCOUNT_IN_USE`) — ative-a em vez disso
- Excluir categoria **desvincula** movimentações (`SetNull`)
- Usuário novo recebe **12 categorias padrão** (configuração de uso, não dados fictícios)
- Valores em **centavos** do início ao fim (nenhum `float`)

### Frontend (React)
- **Movimentações:** tabela com filtros (mês/busca/tipo), formulário de criar/editar/excluir
- **Categorias:** grupos receita/despesa, criar com cor, renomear, excluir
- **Contas:** lista com saldo real, criar conta, transferir entre contas, excluir
- **Dashboard:** 4 cards reais + gráfico 6 meses (Receitas × Despesas) + despesas por categoria + top 5 despesas

## Testes realizados

**64/64 testes passando** (`cd backend && npm test`) — 41 novos nesta fase:

| Arquivo | Cobre |
| --- | --- |
| `finance.test.ts` (4) | `parseMonth` (YYYY-MM, padrão, inválidos), `lastMonths` |
| `categories.test.ts` (9) | padrões no cadastro, filtros, CRUD, nome duplicado 409, mesmo nome em tipos distintos, cor inválida, **isolamento**, exclusão com `SetNull` |
| `accounts.test.ts` (10) | tipos válidos, **saldo real com receita/despesa/transferência**, isolamento, exclusão bloqueada 409, mesma conta 400, conta alheia 404 |
| `transactions.test.ts` (11) | criação completa, validações (valor/data/categoria alheia), filtros + paginação, edição, exclusão com auditoria, **isolamento** |
| `reports.test.ts` (7) | resumo real do mês, zeros, mês inválido, por-categoria com percentuais, série mensal, **dashboard com valores exatos**, isolamento |
| Fase 1 (23) | auth, users, health, money — continuam verdes |

**Teste de fumaça E2E (API real):** registro/login → conta → movimentação →
dashboard (saldo 96.500 = 100.000 − 3.500) → transferência (76.500/20.000 ✓) →
relatório por categoria → lista. `tsc --noEmit` limpo em backend e frontend;
`npm run build` OK.

## Como testar

```bash
cd backend && npm run dev       # API :4000
cd frontend && npm run dev      # Web :5173
# login → Movimentações → criar conta → lançar receita/despesa → Dashboard
```

## O que falta configurar

1. **Docker/PostgreSQL** — inalterado da Fase 1 (ver README)
2. **QA manual no navegador** das novas telas (API/build validados)
3. **Fase 3** — WhatsApp Cloud API + IA (credenciais no `.env.example`)

## Itens do escopo NÃO incluídos (para fases posteriores)

- Contas a pagar/receber com vencimento e lembretes (contrato já reservado no dashboard: `pendingBills*`)
- Receitas/despesas **recorrentes**, cartões, parcelamentos → Fase 4
- Exportação Excel/PDF e gráfico de pizza completo → Fase 4/7

## Próxima fase (não iniciada, conforme combinado)

**FASE 3 — WhatsApp:** webhook oficial da Meta, recebimento/envio de mensagens
e interpretação com IA gravando nas tabelas desta fase.
