import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { cookieHeader } from "./helpers.js";

const app = createApp();

async function login() {
  await request(app).post("/api/auth/register").send({
    name: "Ana Souza",
    email: "ana@example.com",
    password: "senhaSegura123",
  });
  return request(app)
    .post("/api/auth/login")
    .send({ email: "ana@example.com", password: "senhaSegura123" });
}

describe("GET /api/users/me", () => {
  it("retorna os dados do usuário autenticado", async () => {
    const auth = await login();
    const res = await request(app)
      .get("/api/users/me")
      .set("Cookie", cookieHeader(auth));

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: "ana@example.com", name: "Ana Souza" });
    expect(res.body.user).not.toHaveProperty("passwordHash");
  });
});

describe("PATCH /api/users/me", () => {
  it("atualiza o nome e registra auditoria", async () => {
    const auth = await login();
    const cookie = cookieHeader(auth);

    const res = await request(app)
      .patch("/api/users/me")
      .set("Cookie", cookie)
      .send({ name: "Ana Atualizada" });

    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe("Ana Atualizada");

    const updated = await prisma.user.findUnique({ where: { email: "ana@example.com" } });
    expect(updated!.name).toBe("Ana Atualizada");

    const logs = await prisma.auditLog.findMany({ where: { action: "user.update" } });
    expect(logs).toHaveLength(1);
  });

  it("rejeita nome muito curto", async () => {
    const auth = await login();
    const res = await request(app)
      .patch("/api/users/me")
      .set("Cookie", cookieHeader(auth))
      .send({ name: "A" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /api/dashboard/summary", () => {
  it("retorna estrutura do dashboard com zeros reais (Fase 1)", async () => {
    const auth = await login();
    const res = await request(app)
      .get("/api/dashboard/summary")
      .set("Cookie", cookieHeader(auth));

    expect(res.status).toBe(200);
    expect(res.body.totals).toEqual({
      balanceCents: 0,
      incomeMonthCents: 0,
      expenseMonthCents: 0,
      resultMonthCents: 0,
    });
    expect(res.body.period.start).toBeTruthy();
    expect(res.body.user.name).toBe("Ana Souza");
  });

  it("não retorna dados de outro usuário (isolamento)", async () => {
    const auth1 = await login();
    await request(app).post("/api/auth/register").send({
      name: "Outro Usuário",
      email: "outro@example.com",
      password: "senhaSegura123",
    });

    const res = await request(app)
      .get("/api/users/me")
      .set("Cookie", cookieHeader(auth1));
    expect(res.body.user.email).toBe("ana@example.com");
  });
});
