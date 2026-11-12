import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { env } from "../src/config/env.js";
import { prisma } from "../src/lib/prisma.js";
import { interpretMock } from "../src/modules/ai/ai.mock.js";
import { outbox } from "../src/modules/whatsapp/whatsapp.client.js";
import { app, createSession, type Session } from "./helpers.js";

/**
 * Fase 4 — processamento de mídia com provedores reais mockados.
 * Simula a Graph API (download da mídia) e a OpenAI (transcrição/vision)
 * para exercitar o pipeline completo offline: webhook → mídia → IA →
 * confirmação → banco.
 */

const PHONE = "5511999990001";

const savedEnv = {
  whatsapp: { ...env.whatsapp },
  ai: { ...env.ai },
};

function json(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as unknown as Response;
}

type FetchInput = string | URL | { toString(): string };

function webhook(mediaType: "audio" | "image", mediaId: string): object {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  id: `wamid.${mediaType}.${Math.random().toString(36).slice(2)}`,
                  from: PHONE,
                  type: mediaType,
                  [mediaType]: {
                    id: mediaId,
                    mime_type: mediaType === "audio" ? "audio/ogg" : "image/jpeg",
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

async function linkPhone(session: Session): Promise<void> {
  const res = await request(app)
    .patch("/api/users/me")
    .set("Cookie", session.cookie)
    .send({ whatsappPhone: PHONE });
  expect(res.status).toBe(200);
}

function lastReply(): string {
  const last = outbox[outbox.length - 1];
  if (!last) throw new Error("Nenhuma mensagem na caixa de saída");
  return last.body;
}

beforeEach(() => {
  // Ativa credenciais de WhatsApp + OpenAI em runtime (restauradas no afterEach).
  Object.assign(env.whatsapp, {
    phoneNumberId: "1234567890",
    accessToken: "token-teste",
    apiVersion: "v21.0",
  });
  Object.assign(env.ai, { provider: "auto", openaiKey: "sk-teste" });
});

afterEach(() => {
  Object.assign(env.whatsapp, savedEnv.whatsapp);
  Object.assign(env.ai, savedEnv.ai);
  vi.unstubAllGlobals();
});

/** Roteia fetch para Graph API (mídia) e OpenAI (transcrição/vision). */
function stubFetch(handlers: {
  transcript?: string;
  interpretation?: unknown;
}): void {
  const mock = vi.fn(async (input: FetchInput) => {
    const url = String(input);

    if (url.includes("/messages")) {
      // Envio de resposta pelo sendText (Graph API).
      return json({ messages: [{ id: "wamid.out.ok" }] });
    }
    if (url.startsWith("https://graph.facebook.com/") && !url.includes("/messages")) {
      // Metadados da mídia → devolve URL interna de download.
      return json({ url: "https://media.teste/arquivo", mime_type: "audio/ogg" });
    }
    if (url.startsWith("https://media.teste/")) {
      return {
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
      } as unknown as Response;
    }
    if (url.includes("/v1/audio/transcriptions")) {
      return json({ text: handlers.transcript ?? "" });
    }
    if (url.includes("/v1/chat/completions")) {
      // Sem interpretação explícita, deriva do transcrito com o mock local
      // (mesmo contrato — o teste valida o PIPELINE, não o provedor de IA).
      const interpretation =
        handlers.interpretation ?? interpretMock(handlers.transcript ?? "");
      return json({
        choices: [
          {
            message: {
              content: JSON.stringify(interpretation),
            },
          },
        ],
      });
    }
    throw new Error(`Fetch inesperado no teste: ${url}`);
  });
  vi.stubGlobal("fetch", mock);
}

describe("Áudio via WhatsApp (transcrição)", () => {
  it("transcreve e registra a movimentação como texto", async () => {
    stubFetch({ transcript: "Gastei 42,90 reais de combustivel" });
    const session = await createSession();
    await linkPhone(session);

    const res = await request(app)
      .post("/api/whatsapp/webhook")
      .send(webhook("audio", "wamid.media.audio1"));

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual(["processed"]);
    expect(lastReply()).toMatch(/Despesa de R\$\s42,90 registrada na categoria Transporte\./);

    const txn = await prisma.transaction.findFirst({ where: { amountCents: 4290 } });
    expect(txn).toBeTruthy();
    expect(txn!.type).toBe("EXPENSE");
  });

  it("áudio vazio responde pedindo para repetir", async () => {
    stubFetch({ transcript: "   " });
    const session = await createSession();
    await linkPhone(session);

    const res = await request(app)
      .post("/api/whatsapp/webhook")
      .send(webhook("audio", "wamid.media.audio2"));

    expect(res.body.results).toEqual(["audio_empty"]);
    expect(lastReply()).toContain("transcrever");
    expect(await prisma.transaction.count()).toBe(0);
  });

  it("falha na transcrição responde com erro amigável", async () => {
    const mock = vi.fn(async (input: FetchInput) => {
      const url = String(input);
      if (url.includes("/messages")) return json({ messages: [{ id: "wamid.out.ok" }] });
      if (url.startsWith("https://graph.facebook.com/")) {
        return json({ url: "https://media.teste/arquivo", mime_type: "audio/ogg" });
      }
      if (url.startsWith("https://media.teste/")) {
        return {
          ok: true,
          arrayBuffer: async () => new Uint8Array([1]).buffer,
        } as unknown as Response;
      }
      return {
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => "boom",
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", mock);

    const session = await createSession();
    await linkPhone(session);
    const res = await request(app)
      .post("/api/whatsapp/webhook")
      .send(webhook("audio", "wamid.media.audio3"));

    expect(res.body.results).toEqual(["audio_error"]);
    expect(lastReply()).toContain("não consegui processar seu áudio");
    expect(await prisma.transaction.count()).toBe(0);
  });

  it("fluxo de consulta por áudio usa dados reais", async () => {
    const session = await createSession();
    await linkPhone(session);
    // movimentação real antes do áudio
    await request(app)
      .post("/api/transactions")
      .set("Cookie", session.cookie)
      .send({
        type: "EXPENSE",
        amountCents: 3500,
        description: "Combustível",
        date: new Date().toISOString(),
      });

    stubFetch({
      transcript: "Quanto gastei esse mes?",
      interpretation: {
        intent: "query_summary",
        query: { month: new Date().toISOString().slice(0, 7) },
        ambiguous: false,
        missing: [],
      },
    });

    await request(app)
      .post("/api/whatsapp/webhook")
      .send(webhook("audio", "wamid.media.audio4"));

    expect(lastReply()).toMatch(/gastou R\$\s35,00/);
  });
});

describe("Comprovante/foto via WhatsApp (visão)", () => {
  it("lê o comprovante e pede confirmação antes de gravar", async () => {
    stubFetch({
      interpretation: {
        intent: "create_transaction",
        transaction: {
          type: "EXPENSE",
          amountCents: 15_90,
          description: "Mercado",
          date: new Date().toISOString().slice(0, 10),
        },
        ambiguous: true,
        missing: [],
      },
    });
    const session = await createSession();
    await linkPhone(session);

    const res = await request(app)
      .post("/api/whatsapp/webhook")
      .send(webhook("image", "wamid.media.img1"));

    expect(res.body.results).toEqual(["processed"]);
    // Confirmação antes de gravar (item 3) — nada gravado ainda.
    // NBSP do formatBRL: usar regex com \s.
    expect(lastReply()).toMatch(/Confirma despesa de R\$\s15,90/);
    expect(lastReply()).toContain("sim");
    expect(await prisma.transaction.count()).toBe(0);
    expect(await prisma.conversationState.count()).toBe(1);

    // Confirmação → grava.
    await request(app)
      .post("/api/whatsapp/webhook")
      .send({
        object: "whatsapp_business_account",
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [{ id: "wamid.conf1", from: PHONE, type: "text", text: { body: "sim" } }],
                },
              },
            ],
          },
        ],
      });

    const txn = await prisma.transaction.findFirst({ where: { amountCents: 1590 } });
    expect(txn).toBeTruthy();
    expect(txn!.description).toBe("Mercado");
    expect(await prisma.conversationState.count()).toBe(0);
  });

  it("comprovante sem valor pede o dado que falta", async () => {
    stubFetch({
      interpretation: {
        intent: "create_transaction",
        transaction: {
          type: "EXPENSE",
          description: "Farmácia",
          date: new Date().toISOString().slice(0, 10),
        },
        ambiguous: true,
        missing: ["valor"],
      },
    });
    const session = await createSession();
    await linkPhone(session);

    const res = await request(app)
      .post("/api/whatsapp/webhook")
      .send(webhook("image", "wamid.media.img2"));

    expect(res.body.results).toEqual(["processed"]);
    expect(lastReply()).toContain("Quanto foi o valor");
    expect(await prisma.transaction.count()).toBe(0);
  });

  it("foto que não é comprovante responde sem inventar", async () => {
    stubFetch({ interpretation: { intent: "unknown", ambiguous: false, missing: [] } });
    const session = await createSession();
    await linkPhone(session);

    const res = await request(app)
      .post("/api/whatsapp/webhook")
      .send(webhook("image", "wamid.media.img3"));

    expect(res.body.results).toEqual(["image_unreadable"]);
    expect(lastReply()).toContain("não consegui identificar uma movimentação");
    expect(await prisma.transaction.count()).toBe(0);
  });

  it("falha no vision responde com erro amigável", async () => {
    const mock = vi.fn(async (input: FetchInput) => {
      const url = String(input);
      if (url.includes("/messages")) return json({ messages: [{ id: "wamid.out.ok" }] });
      if (url.startsWith("https://graph.facebook.com/")) {
        return json({ url: "https://media.teste/arquivo", mime_type: "image/jpeg" });
      }
      if (url.startsWith("https://media.teste/")) {
        return {
          ok: true,
          arrayBuffer: async () => new Uint8Array([1]).buffer,
        } as unknown as Response;
      }
      return {
        ok: false,
        status: 429,
        json: async () => ({}),
        text: async () => "rate limited",
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", mock);

    const session = await createSession();
    await linkPhone(session);
    const res = await request(app)
      .post("/api/whatsapp/webhook")
      .send(webhook("image", "wamid.media.img4"));

    expect(res.body.results).toEqual(["image_error"]);
    expect(await prisma.transaction.count()).toBe(0);
  });
});
