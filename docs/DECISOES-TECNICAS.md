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

## D-015 — Interface única de IA com provedores substituíveis

**Data:** Fase 3 | **Status:** aceito

`ai.schema.ts` define o contrato JSON (intent + transação + consulta) validado
por Zod. OpenAI, Gemini e o interpretador **local pt-BR** implementam o mesmo
contrato — o resto do sistema não sabe qual está ativo. `AI_PROVIDER=auto`
escolhe por disponibilidade de chave. O local mantém o sistema funcional e
testável **sem custos e sem rede** (13 testes dedicados); trocar para IA real
é mudar uma variável de ambiente.

## D-016 — Nunca gravar sem validação; nunca inventar valores

**Data:** Fase 3 | **Status:** aceito

A IA é um **interpretabor, não uma fonte de dados**: toda saída passa por Zod;
valores são conferidos (>0, centavos inteiros); consultas são executadas pelo
servidor com `groupBy` no banco do usuário. A IA não recebe os dados
financeiros — apenas emite a *intenção*. Itens 5 e 3 do escopo.

## D-017 — Deduplicação de webhook via PK do wamid

**Data:** Fase 3 | **Status:** aceito

A Meta pode reentregar mensagens. `ProcessedMessage.id = wamid` (PK) transforma
a reentrega em erro de unique → resposta `duplicate`, sem efeitos colaterais.
Mais simples e mais garantido que janela de tempo.

## D-018 — Confirmação antes de gravar informação ambígua

**Data:** Fase 3 | **Status:** aceito

Estado pendente por usuário (`ConversationState`, 1:1 com `User`):
- `fill` — falta valor/descrição → pergunta e completa na próxima mensagem;
- `confirm` — IA marcou `ambiguous` → pede "sim/não" antes de gravar.
Mensagem clara completa grava direto (exemplo do escopo: *"Despesa de R$ 50,00
registrada na categoria Alimentação."*). Qualquer outra resposta descarta o
pendente e reinterpreta — nunca trava a conversa.

## D-019 — Modo local para WhatsApp (outbox) sem credenciais

**Data:** Fase 3 | **Status:** aceito

`whatsapp.client.ts` envia pela Graph API quando `WHATSAPP_*` está configurado;
caso contrário, empilha em um `outbox` em memória. Permite exercitar o fluxo
completo (webhook → IA → banco → resposta) em dev/testes **sem violar a regra
de usar a API oficial**: em produção a API é obrigatória (o status no painel
indica "Modo local" vs "Configurada").

## D-020 — Ciclo de fatura calculado, não armazenado

**Data:** Fase 4 | **Status:** aceito

`invoicePeriod(closingDay, dueDay, ref)` deriva o ciclo atual a partir do dia de
fechamento: cap de dias em meses curtos (fechamento 31 → 28/02 em fevereiro) e
vencimento = primeiro `dueDay` em ou após o fim do ciclo (fecha 25/01, vence
10/02). Nada de datas pré-calculadas no banco: mudar o fechamento do cartão
recalcula tudo retroativamente.

## D-021 — Parcelamento como grupo de movimentações

**Data:** Fase 4 | **Status:** aceito

Parcelar cria N `Transaction` reais com `installmentGroup` (UUID) +
`installmentNumber/Total`, datas mensais e a última parcela ajustada para o
total fechar exato. Vantagens: relatórios/saldos/faturas funcionam **sem
lógica especial** (cada parcela é uma movimentação comum), edição/exclusão
individual possível. A alternativa (1 linha com campo de parcelas) exigiria
considerar parcelas futuras em todo cálculo — rejeitada.

## D-022 — Recorrência com dedupe por chave única

**Data:** Fase 4 | **Status:** aceito

`recurrenceKey = "ruleId:YYYY-MM"` com `@unique` torna a materialização
**idempotente** mesmo com corrida (agendador + botão manual): o segundo
criador recebe `P2002` e ignora. Status nunca é gravado — só existe a
movimentação criada ou não. Agendador interno (setInterval no server.ts)
com `unref()`; na Fase 5, avaliar worker separado para múltiplas instâncias.

## D-023 — Status de conta derivado (OPEN/OVERDUE/PAID)

**Data:** Fase 4 | **Status:** aceito

`billStatus()` é calculado a cada leitura: `paidAt` → PAID/RECEIVED; vencido →
OVERDUE; senão OPEN. **Nunca há campo de status no banco** — impossível
dessincronizar (ex.: vencer sem ninguém marcar). Lembretes usam `remindedAt`
como marca anti-spam de envio único; mudar o vencimento zera a marca.

## D-024 — Mídia (áudio/comprovante) no mesmo contrato da IA

**Data:** Fase 4 | **Status:** aceito

Transcrição (Whisper/Gemini) e leitura de comprovante (vision) produzem o
**mesmo JSON** `interpretationSchema` da IA de texto, validado por Zod, e o
resultado entra na **mesma máquina de estados** (confirm/fill) do fluxo de
texto — inclusive o comprovante completo exige "sim" antes de gravar (item 3).
Provedores usam as mesmas chaves (`OPENAI_API_KEY`/`GEMINI_API_KEY`); sem
chave/credencial a resposta é honesta pedindo texto (nunca inventa dados).
Download da mídia via Graph API oficial com `WHATSAPP_*`.

## D-025 — Exportação CSV (BOM) + PDF (pdfkit)

**Data:** Fase 4 | **Status:** aceito

CSV com **BOM UTF-8**, separador `;` e valores com vírgula decimal abre
correto no Excel pt-BR sem configuração; campos com `;`/aspas são escapados.
PDF gerado por `pdfkit` (A4, resumo + lista colorida) — sem serviço externo,
tudo no processo da API. Download autenticado via cookies httpOnly
(`downloadFile`), nunca URL pública com token.

## D-026 — Detecção de reuso de refresh token

**Data:** Fase 5 | **Status:** aceito

Ao receber um refresh token **já revogado**, o servidor assume roubo de token
(não apenas expiração) e revoga **toda a família** — todos os refresh tokens
ativos do usuário — respondendo `REFRESH_REUSED`. Custo: o usuário perde a
sessão e precisa logar de novo. Benefício: um token vazado não permite
manter sessão indefinidamente nem detectar silenciosamente o abuso.

## D-027 — Rate limiting em duas camadas

**Data:** Fase 5 | **Status:** aceito

- Global (`RATE_LIMIT_GLOBAL`, 300/15min/IP) — abuso geral;
- **Autenticação** (`RATE_LIMIT_AUTH`, 30/15min/IP) — brute force de senha,
  aplicado só em `/api/auth`.
Configurável por ambiente (testes criam instâncias com limites pequenos para
validar o 429). Resposta JSON com `code: RATE_LIMITED` (coerente com o resto
da API). Cabeçalhos `RateLimit-*` (draft standardHeaders) para observabilidade.

## D-028 — Erros de parsing e do Prisma com status corretos

**Data:** Fase 5 | **Status:** aceito

O middleware global mapeia: JSON malformado → 400 `INVALID_JSON`; corpo acima
de 1MB → 413; códigos Prisma `P2002` → 409, `P2025` → 404, `P2003` → 400
(mensagem de FK legível). Antes, tudo isso virava 500 "erro interno". Detalhes
técnicos do erro só aparecem em `NODE_ENV=test` — produção nunca vaza stack.

## D-029 — Testes de segurança como suíte dedicada

**Data:** Fase 5 | **Status:** aceito

`tests/security.test.ts` (21 testes) cobre as frentes do item 8 e boas práticas
OWASP do projeto: força bruta, JWT forjado/expirado, isolamento multi-tenant
(varredura de 14 endpoints), injeção, mass assignment, headers, CORS, webhook
HMAC, vazamento de dados e anti-enumeration. A suíte roda em CI com as demais
(171 no total) — regressões de segurança falham o build.
