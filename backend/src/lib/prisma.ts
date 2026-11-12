import { PrismaClient } from "@prisma/client";

// Instância única (singleton) para evitar esgotar conexões do pool.
export const prisma = new PrismaClient();

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
