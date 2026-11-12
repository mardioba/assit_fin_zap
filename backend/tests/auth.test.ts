import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { cookieHeader, findCookie } from "./helpers.js";

const app = createApp();

async function registerUser(overrides: Partial<{ name: string; email: string; password: string }> = {}) {
  return request(app).post("/api/auth/register").send({
    name: "Maria Silva",
    email: "maria@example.com",
    password: "senhaSegura123",
    ...overrides,
  });
}

describe("POST /api/auth/register", () => {
  it("registra usuário, faz hash da senha e cria cookies de sessão", async () => {
    const res = await registerUser();

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      name: "Maria Silva",
      email: "maria@example.com",
      role: "USER",
    });
    expect(res.body.user).not.toHaveProperty("passwordHash");
    const cookies = cookieHeader(res);
    expect(cookies).toMatch(/accessToken=/);
    expect(cookies).toMatch(/refreshToken=/);

    const user = await prisma.user.findUnique({ where: { email: "maria@example.com" } });
    expect(user).toBeTruthy();
    expect(user!.passwordHash).not.toBe("senhaSegura123");
    expect(user!.passwordHash).toMatch(/^\$2[aby]\$/); // bcrypt

    // Auditoria registrada (requisito de segurança).
    const logs = await prisma.auditLog.findMany({ where: { action: "auth.register" } });
    expect(logs).toHaveLength(1);
  });

  it("rejeita e-mail duplicado com 409", async () => {
    await registerUser();
    const res = await registerUser();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EMAIL_IN_USE");
  });

  it("rejeita senha com menos de 8 caracteres", async () => {
    const res = await registerUser({ password: "curta" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("rejeita e-mail inválido", async () => {
    const res = await registerUser({ email: "nao-e-email" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/login", () => {
  beforeEach(async () => {
    await registerUser();
  });

  it("autentica com credenciais válidas", async () => {
    const res = await request(app).post("/api/auth/login").send({
      email: "maria@example.com",
      password: "senhaSegura123",
    });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("maria@example.com");
    expect(cookieHeader(res)).toMatch(/accessToken=/);
  });

  it("rejeita senha incorreta com mensagem genérica", async () => {
    const res = await request(app).post("/api/auth/login").send({
      email: "maria@example.com",
      password: "senhaErrada123",
    });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_CREDENTIALS");
    expect(res.body.message).toBe("Credenciais inválidas");
  });

  it("rejeita e-mail inexistente com a mesma mensagem (anti-enumeration)", async () => {
    const res = await request(app).post("/api/auth/login").send({
      email: "naoexiste@example.com",
      password: "senhaSegura123",
    });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Credenciais inválidas");
  });
});

describe("POST /api/auth/refresh e /logout", () => {
  it("rotaciona o refresh token e revoga a família em caso de reuso", async () => {
    const reg = await registerUser();
    const refreshCookie = findCookie(reg, "refreshToken");

    const refresh1 = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", refreshCookie);
    expect(refresh1.status).toBe(200);

    // Reuso do token antigo falha (rotação)…
    const reuse = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", refreshCookie);
    expect(reuse.status).toBe(401);
    expect(reuse.body.code).toBe("REFRESH_REUSED");

    // …e indica roubo: TODA a família é revogada, inclusive o token novo.
    const newRefresh = findCookie(refresh1, "refreshToken");
    const refresh2 = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", newRefresh);
    expect(refresh2.status).toBe(401);
    expect(refresh2.body.code).toBe("REFRESH_REUSED");
  });

  it("logout revoga o refresh token", async () => {
    const reg = await registerUser();
    const refreshCookie = findCookie(reg, "refreshToken");

    const logout = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", cookieHeader(reg));
    expect(logout.status).toBe(200);

    const refresh = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", refreshCookie);
    expect(refresh.status).toBe(401);
  });

  it("refresh sem cookie retorna 401", async () => {
    const res = await request(app).post("/api/auth/refresh");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("NO_REFRESH_TOKEN");
  });
});
