import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { materializeRecurring } from "./modules/recurring/recurring.routes.js";
import { runBillReminders } from "./modules/bills/bills.routes.js";

const app = createApp();

app.listen(env.port, () => {
  console.log(`API iniciada na porta ${env.port} [${env.nodeEnv}]`);

  // Fase 4 — agendadores internos (em produção, substituir por cron/worker).
  // Materializa recorrências mensais (idempotente) a cada hora.
  const HOURLY = 60 * 60 * 1000;
  setInterval(() => {
    materializeRecurring()
      .then((created) => {
        if (created > 0) console.log(`[recurring] ${created} movimentação(ões) criada(s)`);
      })
      .catch((err) => console.error("[recurring] falha:", err));
  }, HOURLY).unref();

  // Lembretes de contas a pagar/receber via WhatsApp — a cada 6 horas
  // (anti-spam garantido pelo campo remindedAt).
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  setInterval(() => {
    runBillReminders()
      .then((sent) => {
        if (sent > 0) console.log(`[reminders] ${sent} lembrete(s) enviado(s)`);
      })
      .catch((err) => console.error("[reminders] falha:", err));
  }, SIX_HOURS).unref();
});
