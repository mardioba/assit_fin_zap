import { describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../src/lib/prisma.js";
import { app, createSession, createTransaction } from "./helpers.js";

describe("GET /api/categories", () => {
  it("usuário novo recebe as categorias padrão (12) no cadastro", async () => {
    const session = await createSession();
    const res = await request(app).get("/api/categories").set("Cookie", session.cookie);

    expect(res.status).toBe(200);
    expect(res.body.categories).toHaveLength(12);
    expect(res.body.categories.filter((c: { type: string }) => c.type === "EXPENSE")).toHaveLength(8);
    expect(res.body.categories.filter((c: { type: string }) => c.type === "INCOME")).toHaveLength(4);
  });

  it("filtra por tipo", async () => {
    const session = await createSession();
    const res = await request(app)
      .get("/api/categories?type=INCOME")
      .set("Cookie", session.cookie);
    expect(res.body.categories.every((c: { type: string }) => c.type === "INCOME")).toBe(true);
  });

  it("não retorna categorias de outro usuário (isolamento)", async () => {
    const a = await createSession();
    const b = await createSession();
    await request(app)
      .post("/api/categories")
      .set("Cookie", a.cookie)
      .send({ name: "Categoria Privada", type: "EXPENSE" });

    const res = await request(app).get("/api/categories").set("Cookie", b.cookie);
    const names = res.body.categories.map((c: { name: string }) => c.name);
    expect(names).not.toContain("Categoria Privada");
  });
});

describe("POST /api/categories", () => {
  it("cria categoria personalizada", async () => {
    const session = await createSession();
    const res = await request(app)
      .post("/api/categories")
      .set("Cookie", session.cookie)
      .send({ name: "Pets", type: "EXPENSE", color: "#059669" });

    expect(res.status).toBe(201);
    expect(res.body.category).toMatchObject({ name: "Pets", type: "EXPENSE", color: "#059669" });

    const audit = await prisma.auditLog.findMany({ where: { action: "category.create" } });
    expect(audit).toHaveLength(1);
  });

  it("rejeita nome duplicado para o mesmo tipo (409)", async () => {
    const session = await createSession();
    const payload = { name: "Viagens", type: "EXPENSE" };
    await request(app).post("/api/categories").set("Cookie", session.cookie).send(payload);
    const res = await request(app)
      .post("/api/categories")
      .set("Cookie", session.cookie)
      .send(payload);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CATEGORY_EXISTS");
  });

  it("permite mesmo nome com tipos diferentes", async () => {
    const session = await createSession();
    const r1 = await request(app)
      .post("/api/categories")
      .set("Cookie", session.cookie)
      .send({ name: "Renda Extra", type: "INCOME" });
    expect(r1.status).toBe(201);

    const r2 = await request(app)
      .post("/api/categories")
      .set("Cookie", session.cookie)
      .send({ name: "Renda Extra", type: "EXPENSE" });
    expect(r2.status).toBe(201);
  });

  it("rejeita cor inválida", async () => {
    const session = await createSession();
    const res = await request(app)
      .post("/api/categories")
      .set("Cookie", session.cookie)
      .send({ name: "X", type: "EXPENSE", color: "vermelho" });
    expect(res.status).toBe(400);
  });
});

describe("PATCH e DELETE /api/categories/:id", () => {
  it("atualiza nome e cor", async () => {
    const session = await createSession();
    const created = await request(app)
      .post("/api/categories")
      .set("Cookie", session.cookie)
      .send({ name: "Aula", type: "EXPENSE" });

    const res = await request(app)
      .patch(`/api/categories/${created.body.category.id}`)
      .set("Cookie", session.cookie)
      .send({ name: "Aulas", color: "#123456" });

    expect(res.status).toBe(200);
    expect(res.body.category).toMatchObject({ name: "Aulas", color: "#123456" });
  });

  it("não permite editar categoria de outro usuário (404)", async () => {
    const a = await createSession();
    const b = await createSession();
    const created = await request(app)
      .post("/api/categories")
      .set("Cookie", a.cookie)
      .send({ name: "Privada", type: "EXPENSE" });

    const res = await request(app)
      .patch(`/api/categories/${created.body.category.id}`)
      .set("Cookie", b.cookie)
      .send({ name: "Hackeada" });
    expect(res.status).toBe(404);
  });

  it("exclui categoria e desvincula movimentações (SetNull)", async () => {
    const session = await createSession();
    const created = await request(app)
      .post("/api/categories")
      .set("Cookie", session.cookie)
      .send({ name: "Descartável", type: "EXPENSE" });
    const categoryId = created.body.category.id as string;
    await createTransaction(session, { categoryId });

    const res = await request(app)
      .delete(`/api/categories/${categoryId}`)
      .set("Cookie", session.cookie);
    expect(res.status).toBe(200);

    const txn = await prisma.transaction.findFirst({ where: { categoryId } });
    expect(txn).toBeNull();
  });
});
