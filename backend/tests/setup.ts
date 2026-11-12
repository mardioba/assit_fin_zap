import { beforeEach } from "vitest";
import { prisma } from "../src/lib/prisma.js";

// Ordem respeita foreign keys.
beforeEach(async () => {
  await prisma.auditLog.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
});
