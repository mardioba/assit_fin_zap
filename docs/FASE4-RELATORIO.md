# Relatório — FASE 4 (Recursos avançados)

**Data:** 12/11/2026 | **Status:** ✅ CONCLUÍDA E TESTADA

## O que foi desenvolvido

### 1. Áudio via WhatsApp (transcrição)
- Webhook aceita mensagens `audio` → baixa a mídia pela **Graph API oficial**
  (`downloadMedia`), transcreve e alimenta o **mesmo fluxo de texto**
  (interpretação → consulta/registro → confirmação)
- Provedores: **OpenAI Whisper** (`OPENAI_API_KEY`) ou **Gemini** (`GEMINI_API_KEY`),
  mesmas variáveis do interpretador de texto
- Sem credenciais: resposta honesta pedindo dados em texto (nunca inventa)
- Áudio vazio → *"Não consegui transcrever o áudio"*; falha de rede → erro amigável

### 2. Comprovantes/fotos (OCR por visão)
- `image` → download → **visão computacional** (OpenAI vision / Gemini) no
  **contrato único** `interpretationSchema` (Zod) — mesma validação da IA de texto
- Fluxo **sempre com confirmação** (item 3):
  - leitura completa → *"Confirma despesa de R$ 15,90 em …? Responda sim ou não"* —
    nada é gravado antes do "sim"
  - sem valor → pergunta *"Quanto foi o valor?"* e completa na resposta
  - foto que não é comprovante → responde sem inventar dados
- Falha no vision → erro amigável, zero gravações

### 3. Cartões de crédito e faturas
- `CreditCard`: limite, **dia de fechamento** e **dia de vencimento** (1–28)
- `GET /api/cards/:id/invoice?ref=` — ciclo calculado por
  `invoicePeriod()` (cap de dias em meses curtos, vencimento pula mês quando
  `dueDay < closingDay`), com total da fatura, itens e **limite disponível**
  (limite − fatura atual − parcelas futuras)
- Cartão com compras não pode ser excluído (409 `CARD_IN_USE`) — só desativado

### 4. Parcelamento
- `POST /api/transactions` com `installments` (2–60) cria N movimentações com
  `installmentGroup` (UUID), `installmentNumber/Total`, datas mensais e a
  **última parcela ajustada** para fechar o total exato
- Compra em cartão → `paymentMethod=CREDIT` automático

### 5. Contas recorrentes
- `RecurringRule` (tipo, valor, dia 1–28, categoria/conta/cartão, ativa/inativa)
- `materializeRecurring()` **idempotente**: dedupe por `recurrenceKey`
  (`ruleId:YYYY-MM` @unique) — corrida com o agendador vira `P2002` e é ignorada
- Agendador **horário** no `server.ts` + `POST /api/recurring/run` manual

### 6. Contas a pagar/receber + lembretes
- `Bill` (PAYABLE/RECEIVABLE, vencimento, pago/recebido)
- **Status derivado** (`billStatus`): pago → PAID/RECEIVED; vencido → OVERDUE;
  senão OPEN — nunca armazenado, nunca dessincroniza
- `POST /:id/pay` com `{undo:true}` para desfazer
- **Lembretes WhatsApp** (`runBillReminders`): vence hoje/amanhã ou atrasada,
  janela corrigida para incluir qualquer hora do dia do vencimento,
  **anti-spam** por `remindedAt` (uma vez por conta; trocar o vencimento reativa),
  só para telefone vinculado; agendador de 6h + `POST /api/bills/run-reminders`
- Dashboard: `pendingBillsPayable/Receivable` agora são **contagens reais**

### 7. Relatórios avançados e exportação
- `GET /api/reports/annual?year=` — 12 meses + totais do ano
- `GET /api/reports/export?month=&format=csv|pdf`:
  - **CSV com BOM** e separador `;` → abre direto no Excel pt-BR (acentos íntegros,
    campos com `;`/aspas entre aspas, valores com vírgula decimal)
  - **PDF via pdfkit** (A4): resumo, lista colorida receita/despesa, rodapé com data
- Download autenticado pelo painel (`downloadFile` com cookies httpOnly)

### 8. Painel web — telas novas
- **Cartões**: CRUD, barra de uso do limite, fatura detalhada
- **A pagar/receber**: filtros por tipo/status, pagar/receber/desfazer,
  botão "Enviar lembretes agora"
- **Movimentações**: campos de cartão e parcelas + botões **⬇ CSV** / **⬇ PDF**

## Testes realizados

**150/150 testes passando** (55 novos nesta fase):

| Arquivo | Cobre |
| --- | --- |
| `cards.test.ts` (15) | `invoicePeriod` (4 casos: ciclo, vencimento, fevereiro), CRUD, isolamento, fatura com estatísticas, 409 em cartão com compras, validação de dias, **parcelamento** (N parcelas, fechamento exato, CREDIT) |
| `recurring.test.ts` (9) | CRUD + isolamento, materialização, **idempotência (0 no 2º run)**, regras inativas, dia capado, `/run` via API |
| `bills.test.ts` (16) | `billStatus` (4 casos), CRUD, filtros, pagar/desfazer, dashboard, **lembretes** (janela, anti-spam, sem telefone, conta paga, reativação, `/run-reminders`) |
| `export.test.ts` (7) | CSV BOM+separador+escaping, mês vazio, isolamento, 401, **PDF `%PDF-`**, anual 12 meses, validação de ano |
| `media.test.ts` (8) | **Pipeline completo mockado**: áudio→transcrição→registro, áudio vazio, falha, consulta por áudio, comprovante→confirmação→gravação, sem valor→pergunta, foto inválida, falha no vision |
| Fases 1–3 (95) | permanecem verdes |

**E2E real (curl):** cartão → compra 3x R$300 → fatura `total=10000`
(parcela do ciclo) `disp=970000` (limite − fatura − futuras 20000) → conta
`OPEN` → recorrência materializa 1x (2º run = 0) → CSV com BOM → `%PDF-` →
anual 12 meses → dashboard `contasPagar=1`.

## Como testar

```bash
cd backend && npm test          # 150 testes
cd frontend && npm run build    # build de produção

# Smoke E2E (sem credenciais):
curl -X POST http://localhost:4000/api/cards \
  -H 'Content-Type: application/json' -b cookies.txt \
  -d '{"name":"Visa","limitCents":500000,"closingDay":5,"dueDay":12}'
curl -b cookies.txt "http://localhost:4000/api/reports/export?month=2026-11&format=csv"
```

## O que falta configurar (credenciais reais)

1. **Áudio/comprovantes**: `OPENAI_API_KEY` **ou** `GEMINI_API_KEY` (mesma chave
   do interpretador de texto) + `WHATSAPP_*` para baixar a mídia
2. Agendadores do `server.ts` são `setInterval` in-process — na VPS (Fase 5),
   avaliar cron/worker separado para múltiplas instâncias

## Próxima fase (não iniciada): FASE 5 — Qualidade e produção
