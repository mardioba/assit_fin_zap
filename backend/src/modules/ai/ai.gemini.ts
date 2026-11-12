import { env } from "../../config/env.js";
import { interpretationSchema, SYSTEM_PROMPT, type Interpretation } from "./ai.schema.js";

type Context = { today: string };

/** Interpretador via Google Gemini (generateContent, saída JSON). */
export async function interpretGemini(
  text: string,
  ctx: Context,
): Promise<Interpretation> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${env.ai.geminiModel}:generateContent?key=${env.ai.geminiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: `${SYSTEM_PROMPT}\nHOJE=${ctx.today}` }] },
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json" },
    }),
  });

  if (!res.ok) {
    throw new Error(`Gemini API error: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  return interpretationSchema.parse(JSON.parse(content));
}
