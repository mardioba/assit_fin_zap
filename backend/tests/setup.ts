import { beforeEach } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { resetOutbox } from "../src/modules/whatsapp/whatsapp.client.js";

// Ordem respeita foreign keys.
beforeEach(async () => {
  await prisma.conversationState.deleteMany();
  await prisma.processedMessage.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
  resetOutbox();
});
