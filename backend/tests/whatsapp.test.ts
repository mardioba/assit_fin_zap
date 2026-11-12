import { describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../src/lib/prisma.js";
import { outbox } from "../src/modules/whatsapp/whatsapp.client.js";
import { app, createSession, type Session } from "./helpers.js";

const VERIFY = "token-de-verificacao-teste";
const PHONE_A = "5511999990001";
const PHONE_B = "5511999990002";

function webhookPayload(
  from: string,
  body: {
    type: string;
    text?: string;
    mediaId?: string;
    mime?: string;
    caption?: string;
  },
  id = `wamid.${Math.random().toString(36).slice(2)}`,
): object {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  id,
                  from,
                  type: body.type,
                  ...(body.text !== undefined ? { text: { body: body.text } } : {}),
                  ...(body.mediaId !== undefined
                    ? {
                        [body.type]: {
                          id: body.mediaId,
                          ...(body.mime ? { mime_type: body.mime } : {}),
                          ...(body.caption ? { caption: body.caption } : {}),
                        },
                      }
                    : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

async function sendText(from: string, text: string, id?: string) {
  return request(app)
    .post("/api/whatsapp/webhook")
    .send(webhookPayload(from, { type: "text", text }, id));
}

async function linkPhone(session: Session, phone: string): Promise<void> {
  const res = await request(app)
    .patch("/api/users/me")
    .set("Cookie", session.cookie)
    .send({ whatsappPhone: phone });
  expect(res.status).toBe(200);
}

function lastReply(): string {
  const last = outbox[outbox.length - 1];
  if (!last) throw new Error("Nenhuma mensagem na caixa de saída");
  return last.body;
}

describe("GET /api/whatsapp/webhook — verificação Meta", () => {
  it("aceita token correto e devolve o challenge", async () => {
    const res = await request(app).get("/api/whatsapp/webhook").query({
      "hub.mode": "subscribe",
      "hub.verify_token": VERIFY,
      "hub.challenge": "12345",
    });
    expect(res.status).toBe(200);
    expect(res.text).toBe("12345");
  });

  it("rejeita token incorreto com 403", async () => {
    const res = await request(app).get("/api/whatsapp/webhook").query({
      "hub.mode": "subscribe",
      "hub.verify_token": "errado",
      "hub.challenge": "12345",
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/whatsapp/webhook — número não vinculado", () => {
  it("responde instruções de vinculação", async () => {
    const res = await sendText(PHONE_A, "Olá");
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual(["unlinked"]);
    expect(lastReply()).toContain("não está vinculado");
  });
});

describe("Fluxo completo de movimentação via WhatsApp", () => {
  it("registra despesa clara e confirma (exemplo do escopo)", async () => {
    const session = await createSession();
    await linkPhone(session, PHONE_A);

    const res = await sendText(PHONE_A, "Hoje gastei 35 reais de combustível.");
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual(["processed"]);
    expect(lastReply()).toMatch(/Despesa de R\$\s35,00 registrada na categoria Transporte\./);

    // Gravado no banco com os dados interpretados.
    const txn = await prisma.transaction.findFirst({
      where: { amountCents: 3500 },
      include: { category: true },
    });
    expect(txn).toBeTruthy();
    expect(txn!.type).toBe("EXPENSE");
    expect(txn!.category?.name).toBe("Transporte");
  });

  it("registra receita", async () => {
    const session = await createSession();
    await linkPhone(session, PHONE_A);

    await sendText(PHONE_A, "Recebi 250 reais de um serviço.");
    expect(lastReply()).toMatch(/Receita de R\$\s250,00 registrada/);

    const txn = await prisma.transaction.findFirst({
      where: { amountCents: 25000 },
      include: { category: true },
    });
    expect(txn!.type).toBe("INCOME");
    expect(txn!.category?.name).toBe("Serviços"); // categoria padrão INCOME
  });

  it("protege contra duplicidade da Meta (mesmo wamid)", async () => {
    const session = await createSession();
    await linkPhone(session, PHONE_A);

    const id = "wamid.duplicada123";
    const first = await sendText(PHONE_A, "Gastei 10 reais de café", id);
    const second = await sendText(PHONE_A, "Gastei 10 reais de café", id);

    expect(first.body.results).toEqual(["processed"]);
    expect(second.body.results).toEqual(["duplicate"]);

    const count = await prisma.transaction.count({ where: { amountCents: 1000 } });
    expect(count).toBe(1);
  });

  it("pede o valor quando ambíguo e completa após resposta", async () => {
    const session = await createSession();
    await linkPhone(session, PHONE_A);

    await sendText(PHONE_A, "Gastei no almoço hoje");
    expect(lastReply()).toContain("Quanto foi o valor");

    await sendText(PHONE_A, "45,50");
    expect(lastReply()).toMatch(/Despesa de R\$\s45,50 registrada na categoria Alimentação\./);

    const txn = await prisma.transaction.findFirst({ where: { amountCents: 4550 } });
    expect(txn).toBeTruthy();

    // Estado pendente foi limpo.
    const states = await prisma.conversationState.count();
    expect(states).toBe(0);
  });

  it("confirmação explícita: 'não' cancela a gravação", async () => {
    const session = await createSession();
    await linkPhone(session, PHONE_A);

    // Força o fluxo de confirmação via estado pendente (IA ambígua).
    await prisma.conversationState.create({
      data: {
        userId: session.userId,
        pendingJson: JSON.stringify({
          kind: "confirm",
          transaction: { type: "EXPENSE", amountCents: 9999, description: "teste" },
        }),
      },
    });

    await sendText(PHONE_A, "não");
    expect(lastReply()).toContain("Cancelado");
    expect(await prisma.transaction.count({ where: { amountCents: 9999 } })).toBe(0);
    expect(await prisma.conversationState.count()).toBe(0);

    await prisma.conversationState.create({
      data: {
        userId: session.userId,
        pendingJson: JSON.stringify({
          kind: "confirm",
          transaction: { type: "EXPENSE", amountCents: 8888, description: "teste2" },
        }),
      },
    });
    await sendText(PHONE_A, "sim");
    expect(lastReply()).toMatch(/Despesa de R\$\s88,88/);
    expect(await prisma.transaction.count({ where: { amountCents: 8888 } })).toBe(1);
  });
});

describe("Consultas financeiras via WhatsApp (dados reais)", () => {
  it("resumo do mês com valores do banco", async () => {
    const session = await createSession();
    await linkPhone(session, PHONE_A);
    await request(app)
      .post("/api/transactions")
      .set("Cookie", session.cookie)
      .send({
        type: "EXPENSE",
        amountCents: 3500,
        description: "Combustível",
        date: new Date().toISOString(),
      });

    await sendText(PHONE_A, "Quanto gastei esse mês?");
    expect(lastReply()).toMatch(/gastou R\$\s35,00/);
    expect(lastReply()).toContain("Resultado do mês");
  });

  it("saldo disponível soma contas e movimentações", async () => {
    const session = await createSession();
    await linkPhone(session, PHONE_A);
    await request(app)
      .post("/api/accounts")
      .set("Cookie", session.cookie)
      .send({ name: "Banco", type: "BANK", initialBalanceCents: 100000 });
    await request(app)
      .post("/api/transactions")
      .set("Cookie", session.cookie)
      .send({
        type: "EXPENSE",
        amountCents: 7500,
        description: "Compra",
        date: new Date().toISOString(),
      });

    await sendText(PHONE_A, "Quanto tenho disponível?");
    expect(lastReply()).toMatch(/saldo atual é R\$\s925,00/);
  });

  it("não inventa valores: consulta sem dados responde zero", async () => {
    const session = await createSession();
    await linkPhone(session, PHONE_A);

    await sendText(PHONE_A, "Quanto gastei esse mês?");
    expect(lastReply()).toMatch(/gastou R\$\s0,00/);
  });

  it("maiores gastos por categoria", async () => {
    const session = await createSession();
    await linkPhone(session, PHONE_A);
    const cats = await request(app)
      .get("/api/categories?type=EXPENSE")
      .set("Cookie", session.cookie);
    const food = cats.body.categories.find((c: { name: string }) => c.name === "Alimentação");

    await request(app)
      .post("/api/transactions")
      .set("Cookie", session.cookie)
      .send({
        type: "EXPENSE",
        amountCents: 15000,
        description: "Mercado",
        date: new Date().toISOString(),
        categoryId: food.id,
      });

    await sendText(PHONE_A, "Quais foram meus maiores gastos?");
    expect(lastReply()).toContain("Maiores despesas");
    expect(lastReply()).toContain("Alimentação: R$");
  });

  it("isolamento: usuário B não vê dados do usuário A", async () => {
    const a = await createSession();
    const b = await createSession();
    await linkPhone(a, PHONE_A);
    await linkPhone(b, PHONE_B);
    await request(app)
      .post("/api/transactions")
      .set("Cookie", a.cookie)
      .send({ type: "EXPENSE", amountCents: 9900, description: "Segredo", date: new Date().toISOString() });

    await sendText(PHONE_B, "Quanto gastei esse mês?");
    expect(lastReply()).toMatch(/gastou R\$\s0,00/);
  });
});

describe("Mídia e utilitários", () => {
  it("áudio/foto sem credenciais respondem com instrução honesta", async () => {
    const session = await createSession();
    await linkPhone(session, PHONE_A);

    await request(app)
      .post("/api/whatsapp/webhook")
      .send(webhookPayload(PHONE_A, { type: "audio" }));
    expect(lastReply()).toContain("credenciais");
    expect(lastReply()).toContain("texto");

    await request(app)
      .post("/api/whatsapp/webhook")
      .send(webhookPayload(PHONE_A, { type: "image" }));
    expect(lastReply()).toContain("comprovante");
    expect(lastReply()).toContain("OPENAI_API_KEY");
  });

  it("vídeo/documento são recusados com instrução", async () => {
    const session = await createSession();
    await linkPhone(session, PHONE_A);
    await request(app)
      .post("/api/whatsapp/webhook")
      .send(webhookPayload(PHONE_A, { type: "video" }));
    expect(lastReply()).toContain("vídeo");
  });

  it("GET /api/whatsapp/status expõe config sem segredos", async () => {
    const session = await createSession();
    const res = await request(app)
      .get("/api/whatsapp/status")
      .set("Cookie", session.cookie);
    expect(res.status).toBe(200);
    expect(res.body.aiProvider).toBe("mock");
    expect(res.body.whatsappConfigured).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain("token-de-verificacao");
  });

  it("POST /api/whatsapp/send exige autenticação", async () => {
    const res = await request(app)
      .post("/api/whatsapp/send")
      .send({ phone: PHONE_A, message: "oi" });
    expect(res.status).toBe(401);
  });

  it("POST /api/whatsapp/send envia pelo painel autenticado", async () => {
    const session = await createSession();
    const res = await request(app)
      .post("/api/whatsapp/send")
      .set("Cookie", session.cookie)
      .send({ phone: PHONE_A, message: "Olá do painel" });
    expect(res.status).toBe(201);
    expect(res.body.mocked).toBe(true);
    expect(lastReply()).toBe("Olá do painel");
  });

  it("POST /api/whatsapp/test-interpret mostra a leitura da IA", async () => {
    const session = await createSession();
    const res = await request(app)
      .post("/api/whatsapp/test-interpret")
      .set("Cookie", session.cookie)
      .send({ text: "Gastei 10 reais de café" });
    expect(res.status).toBe(200);
    expect(res.body.interpretation.intent).toBe("create_transaction");
    expect(res.body.interpretation.transaction.amountCents).toBe(1000);
  });
});
