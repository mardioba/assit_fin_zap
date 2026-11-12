import { env } from "../../config/env.js";
import { interpretationSchema, SYSTEM_PROMPT, type Interpretation } from "./ai.schema.js";

type Context = { today: string };

/** Interpretador via OpenAI (chat completions, saída JSON). */
export async function interpretOpenAI(
  text: string,
  ctx: Context,
): Promise<Interpretation> {
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
        { role: "system", content: SYSTEM_PROMPT },
        { role: "system", content: `HOJE=${ctx.today}` },
        { role: "user", content: text },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI API error: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const content = data.choices[0]?.message?.content ?? "{}";
  return interpretationSchema.parse(JSON.parse(content));
}
