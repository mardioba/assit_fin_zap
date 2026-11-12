import { env } from "../../config/env.js";
import { interpretationSchema, SYSTEM_PROMPT, type Interpretation } from "./ai.schema.js";

/**
 * Processamento de mídia (Fase 4): transcrição de áudio e leitura de
 * comprovantes/fotos (OCR por visão computacional).
 *
 * Mesmo padrão da interpretação de texto: contrato único validado por Zod,
 * provedores substituíveis (OpenAI / Gemini) e modo "none" honesto quando
 * não há chave — o servidor responde pedindo dados em texto, nunca inventa.
 */
export type MediaProvider = "openai" | "gemini" | "none";

export function resolveMediaProvider(): MediaProvider {
  const configured = env.ai.provider;
  if (configured === "mock") return "none";
  if (configured === "openai") return env.ai.openaiKey ? "openai" : "none";
  if (configured === "gemini") return env.ai.geminiKey ? "gemini" : "none";
  if (env.ai.openaiKey) return "openai";
  if (env.ai.geminiKey) return "gemini";
  return "none";
}

const TRANSCRIBE_PROMPT =
  "Transcreva este áudio em português do Brasil. Retorne apenas o texto transcrito.";

const RECEIPT_PROMPT = `Você lê comprovantes e recibos (foto) de um assistente financeiro em pt-BR.
Extraia os dados da movimentação e retorne APENAS o JSON do contrato:
{"intent":"create_transaction","transaction":{"type":"INCOME"|"EXPENSE","amountCents":<centavos>,"description":"<texto>","date":"<YYYY-MM-DD>","categoryName":"<categoria>"},"ambiguous":true,"missing":[]}
Regras:
- amountCents em centavos (R$ 35,50 = 3550). Sem valor legível: "missing":["valor"].
- type: saída/compra = EXPENSE, entrada/recebimento = INCOME.
- date: use a data impressa no comprovante; sem data, a data HOJE informada pelo servidor.`;

/** Transcreve áudio (WhatsApp envia ogg/opus) — retorna o texto em pt-BR. */
export async function transcribeAudio(
  buffer: Buffer,
  mime: string,
): Promise<string> {
  const provider = resolveMediaProvider();
  if (provider === "none") {
    throw new Error("Nenhum provedor de mídia configurado");
  }

  if (provider === "openai") {
    const form = new FormData();
    form.append("model", "whisper-1");
    form.append("prompt", TRANSCRIBE_PROMPT);
    form.append(
      "file",
      new Blob([new Uint8Array(buffer)], { type: mime || "audio/ogg" }),
      "audio",
    );
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.ai.openaiKey}` },
      body: form,
    });
    if (!res.ok) {
      throw new Error(`OpenAI transcription error: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { text?: string };
    return data.text ?? "";
  }

  // Gemini: aceita áudio inline (base64) em generateContent.
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${env.ai.geminiModel}:generateContent?key=${env.ai.geminiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { inlineData: { mimeType: mime || "audio/ogg", data: buffer.toString("base64") } },
            { text: TRANSCRIBE_PROMPT },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini transcription error: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

/**
 * Lê um comprovante/foto e devolve a movimentação interpretada
 * (contrato único, sempre validado por Zod no retorno).
 */
export async function extractReceipt(
  buffer: Buffer,
  mime: string,
  today: string,
): Promise<Interpretation> {
  const provider = resolveMediaProvider();
  if (provider === "none") {
    throw new Error("Nenhum provedor de mídia configurado");
  }
  const imagePart = `data:${mime || "image/jpeg"};base64,${buffer.toString("base64")}`;

  let content: string;
  if (provider === "openai") {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.ai.openaiKey}`,
      },
      body: JSON.stringify({
        model: env.ai.openaiModel,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `${SYSTEM_PROMPT}\n${RECEIPT_PROMPT}` },
          { role: "system", content: `HOJE=${today}` },
          {
            role: "user",
            content: [
              { type: "text", text: "Leia este comprovante e extraia a movimentação." },
              { type: "image_url", image_url: { url: imagePart } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI vision error: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    content = data.choices[0]?.message?.content ?? "{}";
  } else {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${env.ai.geminiModel}:generateContent?key=${env.ai.geminiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: `${SYSTEM_PROMPT}\n${RECEIPT_PROMPT}\nHOJE=${today}` }] },
        contents: [
          {
            parts: [
              { inlineData: { mimeType: mime || "image/jpeg", data: buffer.toString("base64") } },
              { text: "Leia este comprovante e extraia a movimentação." },
            ],
          },
        ],
        generationConfig: { temperature: 0, responseMimeType: "application/json" },
      }),
    });
    if (!res.ok) {
      throw new Error(`Gemini vision error: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  }

  return interpretationSchema.parse(JSON.parse(content));
}
