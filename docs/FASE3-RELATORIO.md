# Relatório — FASE 3 (WhatsApp + Inteligência Artificial)

**Data:** 12/11/2026 | **Status:** ✅ CONCLUÍDA E TESTADA

## O que foi desenvolvido

### Webhook oficial da Meta (`/api/whatsapp/webhook`)
- **GET**: verificação do webhook (`hub.mode` + `hub.verify_token` + `hub.challenge`)
- **POST**: recepção de mensagens com **validação HMAC-SHA256**
  (`X-Hub-Signature-256` + `WHATSAPP_APP_SECRET`, comparação em tempo constante)
- **Proteção contra duplicidade**: `wamid` (ID da mensagem) como chave primária —
  reentregas do webhook retornam `duplicate` e não gravam duas vezes (item 8)
- Resposta 200 imediata (regra da Meta)

### Interpretador de IA com provedores configuráveis
| Provedor | Ativação |
| --- | --- |
| **OpenAI** | `OPENAI_API_KEY` (JSON mode, temperature 0) |
| **Google Gemini** | `GEMINI_API_KEY` (responseMimeType JSON) |
| **Local pt-BR (mock)** | sem chaves — regras determinísticas, 100% offline |

- **Contrato único** (`ai.schema.ts`): todos os provedores retornam o mesmo JSON,
  validado por **Zod antes de qualquer uso** — a IA nunca grava sem validação
- `AI_PROVIDER=auto|openai|gemini|mock`; painel mostra o provedor ativo
- Endpoint de debug `POST /api/whatsapp/test-interpret`

### Fluxo de conversa (servidor de mensagens)
1. Deduplica (`ProcessedMessage`) → associa telefone ao usuário (`User.whatsappPhone`, único)
2. Número **não vinculado** → instrução automática de vinculação no painel
3. Texto → interpretação → intent:
   - **Criação clara** → grava e confirma: *"✅ Despesa de R$ 35,00 registrada na categoria Transporte."*
   - **Ambígua** → salva `ConversationState` e pergunta: *"Responda sim ou não"* — só grava após confirmação (item 3)
   - **Faltando valor/descrição** → pergunta o dado e completa na resposta seguinte
   - **Consultas** → calcula **apenas com dados reais do banco**: resumo do mês,
     saldo, por categoria, maiores gastos — nunca inventa valores (item 5)
   - **Áudio/foto** → responde que a leitura chega na Fase 4 (item 6)
4. Categorias: casmai (sem acento/caixa) com as do usuário ou **criadas sob demanda**
5. Toda gravação gera registro de **auditoria** com origem `whatsapp`

### Painel web — tela "WhatsApp"
Status da integração (API, verificação, assinatura, provedor de IA), vínculo do
número, teste de interpretação e envio de mensagem de teste + guia de
configuração da API Meta.

## Testes realizados

**95/95 testes passando** (31 novos nesta fase):

| Arquivo | Cobre |
| --- | --- |
| `ai.mock.test.ts` (13) | despesa/receita, decimal, ambíguo, "ontem", resumo, saldo, categoria+mês, mês passado, saudação, unknown |
| `whatsapp.test.ts` (18) | verificação Meta (ok/403), número não vinculado, registro completo, receita, **duplicidade (wamid)**, fluxo de valor pendente, **confirmação sim/não**, consultas com valores reais, **isolamento A/B**, áudio/foto → Fase 4, status sem segredos, envio autenticado (401/201), test-interpret |
| Fases 1–2 (64) | permanecem verdes |

**E2E real (curl):** registro → vincular telefone → webhook com texto →
transação `R$ 42,90 [Transporte]` no banco → consulta → dashboard reflete
`-4290` → status `aiProvider: mock` → número desconhecido tratado.

## Como testar

```bash
cd backend && npm run dev
# Simule uma mensagem (sem precisar da Meta):
curl -X POST http://localhost:4000/api/whatsapp/webhook \
  -H 'Content-Type: application/json' \
  -d '{"object":"whatsapp_business_account","entry":[{"changes":[{"value":{"messages":[
    {"id":"wamid.1","from":"SEU_NUMERO","type":"text","text":{"body":"Gastei 35 reais de combustível"}}]}}]}]}'
```

Ou use a tela **WhatsApp** no painel (vínculo do número + interpretador).

## O que falta configurar (credenciais reais)

1. **Meta**: criar app no Meta Developers → produto WhatsApp → preencher
   `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`,
   `WHATSAPP_APP_SECRET` no `.env` e apontar o webhook para
   `https://SEU_DOMINIO/api/whatsapp/webhook`
2. **IA**: `OPENAI_API_KEY` **ou** `GEMINI_API_KEY` (sem chaves, o interpretador
   local pt-BR atende dev/testes — já coberto por 31 testes)
3. **Domínio com HTTPS** (obrigatório para webhook da Meta) → Fase 5 (VPS)

## Escopo adiado para a Fase 4 (item 6 e 10)

- Processamento de **áudio** (transcrição) e leitura de **comprovantes/fotos** (OCR)
- Cartões de crédito, parcelamentos, contas recorrentes, contas a pagar/receber

## Próxima fase (não iniciada): FASE 4 — Recursos avançados
