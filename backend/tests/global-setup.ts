// Configura global do Vitest: garante schema do banco de testes.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export default function setup(): void {
  const result = spawnSync(
    "npx",
    ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"],
    {
      cwd: root,
      env: { ...process.env, DATABASE_URL: "file:./test.db" },
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `Falha ao preparar banco de testes:\n${result.stdout}\n${result.stderr}`,
    );
  }
}
