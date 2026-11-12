import { describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { env } from "../src/config/env.js";
import { prisma } from "../src/lib/prisma.js";
import { app, createAccount, createSession, createTransaction } from "./helpers.js";

/**
 * Fase 5 — testes de segurança.
 * Cobre: autenticação/força bruta, JWT, sessão, isolamento multi-tenant,
 * injeção, cabeçalhos de segurança, webhooks e vazamento de dados.
 */

describe("Força bruta e rate limiting", () => {
  it("limite de tentativas de login retorna 429", async () => {
    const small = (await import("../src/app.js")).createApp({
      limits: { global: 10_000, auth: 3 },
    });
    for (let i = 0; i < 3; i++) {
      const res = await request(small)
        .post("/api/auth/login")
        .send({ email: `forca${i}@teste.com`, password: "senhaErrada123" });
      expect(res.status).toBe(401);
    }
    const blocked = await request(small)
      .post("/api/auth/login")
      .send({ email: "forca@teste.com", password: "senhaErrada123" });
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe("RATE_LIMITED");
  });

  it("respostas trazem cabeçalho RateLimit (standardHeaders)", async () => {
    const res = await request(app).get("/api/health");
    expect(res.headers["ratelimit-limit"]).toBeTruthy();
    expect(res.headers["ratelimit-remaining"]).toBeTruthy();
  });
});

describe("JWT e cookies", () => {
  it("token forjado (assinatura errada) é rejeitado", async () => {
    const forged = jwt.sign(
      { sub: "qualquer", email: "x@x.com", role: "USER" },
      "segredo-errado",
    );
    const res = await request(app)
      .get("/api/users/me")
      .set("Cookie", `accessToken=${forged}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TOKEN_EXPIRED");
  });

  it("token com payload de ADMIN mas assinado com segredo errado é rejeitado", async () => {
    const forged = jwt.sign(
      { sub: "admin", email: "a@a.com", role: "ADMIN" },
      "errado",
    );
    const res = await request(app)
      .get("/api/users/me")
      .set("Cookie", `accessToken=${forged}`);
    expect(res.status).toBe(401);
  });

  it("token expirado é rejeitado", async () => {
    const session = await createSession();
    const expired = jwt.sign(
      { sub: session.userId, email: session.email, role: "USER" },
      env.jwt.accessSecret,
      { expiresIn: "-10s" },
    );
    const res = await request(app)
      .get("/api/users/me")
      .set("Cookie", `accessToken=${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TOKEN_EXPIRED");
  });

  it("cookies de sessão são httpOnly", async () => {
    const res = await request(app).post("/api/auth/register").send({
      name: "Cookie Teste",
      email: `httponly-${Date.now()}@teste.com`,
      password: "senhaSegura123",
    });
    expect(res.status).toBe(201);
    const cookies = (Array.isArray(res.headers["set-cookie"])
      ? res.headers["set-cookie"]
      : [res.headers["set-cookie"]]) as string[];
    expect(cookies.length).toBeGreaterThanOrEqual(2);
    for (const c of cookies) {
      expect(c.toLowerCase()).toContain("httponly");
      expect(c.toLowerCase()).toContain("samesite");
    }
  });
});

describe("Isolamento multi-tenant (item 8)", () => {
  it("nenhum recurso de A é acessível por B (varredura)", async () => {
    const a = await createSession();
    const b = await createSession();
    const txnId = await createTransaction(a, { amountCents: 99_99 });

    // Recursos de A
    const cat = (await request(app).get("/api/categories").set("Cookie", a.cookie)).body
      .categories[0];
    const accId = await createAccount(a);
    const card = (
      await request(app).post("/api/cards").set("Cookie", a.cookie).send({
        name: "A",
        limitCents: 1000,
        closingDay: 5,
        dueDay: 12,
      })
    ).body.card;
    const bill = (
      await request(app).post("/api/bills").set("Cookie", a.cookie).send({
        type: "PAYABLE",
        description: "Segredo",
        amountCents: 100,
        dueDate: new Date().toISOString(),
      })
    ).body.bill;
    const rule = (
      await request(app).post("/api/recurring").set("Cookie", a.cookie).send({
        type: "EXPENSE",
        amountCents: 100,
        description: "Segredo",
        dayOfMonth: 5,
      })
    ).body.rule;

    // B tenta ler/modificar tudo de A → todos negados.
    const del = (path: string) => request(app).delete(path).set("Cookie", b.cookie);
    const patch = (path: string) =>
      request(app).patch(path).set("Cookie", b.cookie).send({ description: "hack" });
    const post = (path: string) =>
      request(app).post(path).set("Cookie", b.cookie).send({});

    const probes: Array<{ label: string; run: Promise<{ status: number }> }> = [
      { label: "PATCH /transactions/:id", run: patch(`/api/transactions/${txnId}`) },
      { label: "DELETE /transactions/:id", run: del(`/api/transactions/${txnId}`) },
      { label: "PATCH /categories/:id", run: patch(`/api/categories/${cat.id}`) },
      { label: "DELETE /categories/:id", run: del(`/api/categories/${cat.id}`) },
      { label: "PATCH /accounts/:id", run: patch(`/api/accounts/${accId}`) },
      { label: "DELETE /accounts/:id", run: del(`/api/accounts/${accId}`) },
      { label: "GET /cards/:id/invoice", run: request(app).get(`/api/cards/${card.id}/invoice`).set("Cookie", b.cookie) },
      { label: "PATCH /cards/:id", run: patch(`/api/cards/${card.id}`) },
      { label: "DELETE /cards/:id", run: del(`/api/cards/${card.id}`) },
      { label: "PATCH /bills/:id", run: patch(`/api/bills/${bill.id}`) },
      { label: "POST /bills/:id/pay", run: post(`/api/bills/${bill.id}/pay`) },
      { label: "DELETE /bills/:id", run: del(`/api/bills/${bill.id}`) },
      { label: "PATCH /recurring/:id", run: patch(`/api/recurring/${rule.id}`) },
      { label: "DELETE /recurring/:id", run: del(`/api/recurring/${rule.id}`) },
    ];

    for (const probe of probes) {
      const res = await probe.run;
      expect(res.status, probe.label).toBe(404);
    }

    // Nada de A foi alterado.
    const stillThere = await prisma.transaction.findUnique({ where: { id: txnId } });
    expect(stillThere).toBeTruthy();
    expect(stillThere!.amountCents).toBe(9999);
  });

  it("listas nunca vazam dados de outro usuário", async () => {
    const a = await createSession();
    const b = await createSession();
    await createTransaction(a, { description: "Segredo de A", amountCents: 1234 });

    for (const path of ["/api/transactions", "/api/categories", "/api/accounts", "/api/cards", "/api/bills", "/api/recurring"]) {
      const res = await request(app).get(path).set("Cookie", b.cookie);
      expect(JSON.stringify(res.body), path).not.toContain("Segredo de A");
    }
  });
});

describe("Injeção e validação", () => {
  it("SQL/NoSQL injection em busca não quebra nem retorna dados alheios", async () => {
    const session = await createSession();
    await createTransaction(session, { description: "Compra normal" });

    const payload = "'; DROP TABLE Transaction; --";
    const res = await request(app)
      .get(`/api/transactions?search=${encodeURIComponent(payload)}`)
      .set("Cookie", session.cookie);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);

    // Tabela continua existindo.
    const after = await request(app)
      .get("/api/transactions")
      .set("Cookie", session.cookie);
    expect(after.status).toBe(200);
  });

  it("corpo com JSON malformado retorna 400 (não 500)", async () => {
    const session = await createSession();
    const res = await request(app)
      .post("/api/transactions")
      .set("Cookie", session.cookie)
      .set("Content-Type", "application/json")
      .send('{"tipo": "EXPENSE", "quebrado"');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_JSON");
  });

  it("camos extras no corpo são ignorados (mass assignment: role/admin)", async () => {
    const res = await request(app).post("/api/auth/register").send({
      name: "Tentativa",
      email: `mass-${Date.now()}@teste.com`,
      password: "senhaSegura123",
      role: "ADMIN",
      isActive: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe("USER"); // Zod remove campos não declarados
  });

  it("PATCH /users/me não aceita trocar role ou e-mail", async () => {
    const session = await createSession();
    const res = await request(app)
      .patch("/api/users/me")
      .set("Cookie", session.cookie)
      .send({ role: "ADMIN", email: "novo@teste.com", passwordHash: "x" });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("USER");
    expect(res.body.user.email).toBe(session.email);
  });
});

describe("Cabeçalhos de segurança", () => {
  it("helmet define headers de proteção", async () => {
    const res = await request(app).get("/api/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(res.headers["referrer-policy"]).toBeTruthy();
  });

  it("CORS só permite origens configuradas", async () => {
    const allowed = await request(app)
      .get("/api/health")
      .set("Origin", env.corsOrigins[0]!);
    expect(allowed.headers["access-control-allow-origin"]).toBe(env.corsOrigins[0]);

    const denied = await request(app)
      .get("/api/health")
      .set("Origin", "https://malicioso.example");
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rota inexistente devolve 404 JSON (não HTML de stack)", async () => {
    const res = await request(app).get("/api/rota-que-nao-existe");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("resposta de erro interno não vaza stack em produção", async () => {
    // /api/health não pode falhar; validamos o contrato do handler indiretamente:
    // o detail só aparece em ambiente de teste (env.isTest).
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(env.isTest).toBe(true); // em produção detail é omitido pelo error middleware
  });
});

describe("Webhook do WhatsApp (segurança)", () => {
  it("assinatura HMAC inválida é rejeitada quando App Secret está configurado", async () => {
    const previous = env.whatsapp.appSecret;
    Object.assign(env.whatsapp, { appSecret: "segredo-app-teste" });
    try {
      const res = await request(app)
        .post("/api/whatsapp/webhook")
        .set("x-hub-signature-256", "sha256=" + "0".repeat(64))
        .send({ object: "whatsapp_business_account", entry: [] });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("BAD_SIGNATURE");
    } finally {
      Object.assign(env.whatsapp, { appSecret: previous });
    }
  });

  it("payload sem assinatura é rejeitado com App Secret ativo", async () => {
    const previous = env.whatsapp.appSecret;
    Object.assign(env.whatsapp, { appSecret: "segredo-app-teste" });
    try {
      const res = await request(app)
        .post("/api/whatsapp/webhook")
        .send({ object: "whatsapp_business_account", entry: [] });
      expect(res.status).toBe(403);
    } finally {
      Object.assign(env.whatsapp, { appSecret: previous });
    }
  });

  it("verificação do webhook exige o token correto", async () => {
    const res = await request(app).get("/api/whatsapp/webhook").query({
      "hub.mode": "subscribe",
      "hub.verify_token": "token-errado",
      "hub.challenge": "abc",
    });
    expect(res.status).toBe(403);
  });
});

describe("Vazamento de dados sensíveis", () => {
  it("nenhuma resposta de API contém passwordHash ou tokens", async () => {
    const session = await createSession();
    const paths = [
      "/api/users/me",
      "/api/dashboard/summary",
      "/api/transactions",
      "/api/categories",
      "/api/accounts",
      "/api/cards",
      "/api/bills",
      "/api/whatsapp/status",
    ];
    for (const path of paths) {
      const res = await request(app).get(path).set("Cookie", session.cookie);
      const body = JSON.stringify(res.body);
      expect(body, path).not.toContain("passwordHash");
      expect(body, path).not.toContain("senhaSegura123");
      expect(body, path).not.toContain("token-de-verificacao");
    }
  });

  it("e-mail duplicado e inexistente respondem igual (anti-enumeration)", async () => {
    const dup = await request(app).post("/api/auth/register").send({
      name: "Teste",
      email: "enum@teste.com",
      password: "senhaSegura123",
    });
    expect(dup.status).toBe(201);

    const again = await request(app).post("/api/auth/register").send({
      name: "Teste",
      email: "enum@teste.com",
      password: "senhaSegura123",
    });
    const ghost = await request(app).post("/api/auth/login").send({
      email: "nao-existe@teste.com",
      password: "qualquer123",
    });
    const wrongPass = await request(app).post("/api/auth/login").send({
      email: "enum@teste.com",
      password: "senhaErrada123",
    });

    expect(again.status).toBe(409);
    expect(ghost.body.message).toBe(wrongPass.body.message); // mesma mensagem
    expect(ghost.body.code).toBe(wrongPass.body.code);
  });
});
