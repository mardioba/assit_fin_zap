import { beforeEach } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { resetOutbox } from "../src/modules/whatsapp/whatsapp.client.js";

// Ordem respeita foreign keys (Fase 4: transações referenciam cartões).
beforeEach(async () => {
  await prisma.conversationState.deleteMany();
  await prisma.processedMessage.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.bill.deleteMany();
  await prisma.recurringRule.deleteMany();
  await prisma.creditCard.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
  resetOutbox();
});
