import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    globalSetup: ["tests/global-setup.ts"],
    setupFiles: ["tests/setup.ts"],
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "file:./test.db",
      JWT_ACCESS_SECRET: "test-access-secret-do-not-use-em-producao",
      JWT_REFRESH_SECRET: "test-refresh-secret-do-not-use-em-producao",
      WHATSAPP_VERIFY_TOKEN: "token-de-verificacao-teste",
      PORT: "0",
    },
  },
});
