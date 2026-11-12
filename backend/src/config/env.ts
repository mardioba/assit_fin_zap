import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

const nodeEnv = process.env.NODE_ENV ?? "development";

export const env = {
  nodeEnv,
  isTest: nodeEnv === "test",
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required(
    "DATABASE_URL",
    nodeEnv === "test" ? "file:./test.db" : undefined,
  ),
  jwt: {
    accessSecret: required("JWT_ACCESS_SECRET"),
    refreshSecret: required("JWT_REFRESH_SECRET"),
    accessTtl: process.env.JWT_ACCESS_TTL ?? "15m",
    refreshTtlDays: Number(process.env.JWT_REFRESH_TTL_DAYS ?? 7),
  },
  corsOrigins: (process.env.CORS_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  cookieSecure: process.env.COOKIE_SECURE === "true",
  whatsapp: {
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? "",
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? "",
    appSecret: process.env.WHATSAPP_APP_SECRET ?? "",
    apiVersion: process.env.WHATSAPP_API_VERSION ?? "v21.0",
  },
  ai: {
    // "auto" escolhe openai > gemini > mock conforme as chaves presentes.
    provider: (process.env.AI_PROVIDER ?? "auto") as
      | "auto"
      | "openai"
      | "gemini"
      | "mock",
    openaiKey: process.env.OPENAI_API_KEY ?? "",
    geminiKey: process.env.GEMINI_API_KEY ?? "",
    openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.0-flash",
  },
} as const;
