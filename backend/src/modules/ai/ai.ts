import { env } from "../../config/env.js";
import { interpretGemini } from "./ai.gemini.js";
import { interpretMock } from "./ai.mock.js";
import { interpretOpenAI } from "./ai.openai.js";
import type { Interpretation } from "./ai.schema.js";

export type AiProviderName = "openai" | "gemini" | "mock";

/**
 * Resolve o provedor de IA ativo.
 * - AI_PROVIDER=auto (padrão): openai se houver chave, senão gemini, senão mock.
 * - AI_PROVIDER=openai|gemini|mock: força o escolhido.
 * O mock mantém o sistema 100% funcional offline (dev/testes sem credenciais).
 */
export function resolveProvider(): AiProviderName {
  const configured = env.ai.provider;
  if (configured === "openai" || configured === "gemini" || configured === "mock") {
    if (configured === "openai" && !env.ai.openaiKey) return "mock";
    if (configured === "gemini" && !env.ai.geminiKey) return "mock";
    return configured;
  }
  if (env.ai.openaiKey) return "openai";
  if (env.ai.geminiKey) return "gemini";
  return "mock";
}

export async function interpretMessage(text: string): Promise<Interpretation> {
  const provider = resolveProvider();
  const ctx = { today: new Date().toISOString().slice(0, 10) };
  switch (provider) {
    case "openai":
      return interpretOpenAI(text, ctx);
    case "gemini":
      return interpretGemini(text, ctx);
    default:
      return interpretMock(text);
  }
}

export type { Interpretation };
