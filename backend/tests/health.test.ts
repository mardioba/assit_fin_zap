import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

const app = createApp();

describe("GET /api/health", () => {
  it("retorna status ok", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});

describe("Isolamento de rotas", () => {
  it("rota inexistente retorna 404", async () => {
    const res = await request(app).get("/api/rota-inexistente");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("rota protegida sem sessão retorna 401", async () => {
    const res = await request(app).get("/api/users/me");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });

  it("dashboard sem sessão retorna 401", async () => {
    const res = await request(app).get("/api/dashboard/summary");
    expect(res.status).toBe(401);
  });

  it("token inválido retornado como 401", async () => {
    const res = await request(app)
      .get("/api/users/me")
      .set("Cookie", "accessToken=token-invalido");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TOKEN_EXPIRED");
  });
});
