// Seed opcional — NÃO cria dados financeiros fictícios (regra do projeto).
// Cria apenas um usuário administrador a partir do .env, se informado:
//   ADMIN_EMAIL=... ADMIN_PASSWORD=... ADMIN_NAME=... npx prisma db seed
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.log(
      "[seed] ADMIN_EMAIL/ADMIN_PASSWORD não definidos — nenhum dado criado (ok).",
    );
    return;
  }
  if (password.length < 8) {
    throw new Error("ADMIN_PASSWORD deve ter no mínimo 8 caracteres.");
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log("[seed] Usuário administrador já existe — nada a fazer.");
    return;
  }

  await prisma.user.create({
    data: {
      name: process.env.ADMIN_NAME ?? "Administrador",
      email,
      role: "ADMIN",
      passwordHash: await bcrypt.hash(password, 12),
    },
  });
  console.log(`[seed] Administrador criado: ${email}`);
}

main()
  .catch((err) => {
    console.error("[seed] erro:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
