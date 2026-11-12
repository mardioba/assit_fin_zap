import { env } from "../../config/env.js";

export type OutboundMessage = {
  to: string;
  body: string;
  at: string;
  mocked: boolean;
};

/**
 * Fila de mensagens SAÍDAS.
 * Sem credenciais (dev/testes): mensagens ficam aqui — permite testar o
 * fluxo completo offline. Com WHATSAPP_PHONE_NUMBER_ID + ACCESS_TOKEN,
 * cada mensagem é enviada pela Graph API oficial da Meta.
 */
export const outbox: OutboundMessage[] = [];

export function resetOutbox(): void {
  outbox.length = 0;
}

export function isWhatsAppConfigured(): boolean {
  return Boolean(env.whatsapp.phoneNumberId && env.whatsapp.accessToken);
}

/** Envia texto para um telefone (E.164 sem sinal: 5511999999999). */
export async function sendText(
  to: string,
  body: string,
): Promise<{ mocked: boolean }> {
  if (!isWhatsAppConfigured()) {
    outbox.push({ to, body, at: new Date().toISOString(), mocked: true });
    return { mocked: true };
  }

  const url = `https://graph.facebook.com/${env.whatsapp.apiVersion}/${env.whatsapp.phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.whatsapp.accessToken}`,
    },
    body: JSON.stringify({
      messaging_type: "UTILITY",
      to,
      type: "text",
      text: { body },
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`WhatsApp API error ${res.status}: ${detail}`);
  }
  outbox.push({ to, body, at: new Date().toISOString(), mocked: false });
  return { mocked: false };
}

/** Normaliza telefone para dígitos (comparação e armazenamento). */
export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}
