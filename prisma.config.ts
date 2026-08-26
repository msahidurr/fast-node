import { defineConfig } from "prisma/config";

try {
  // Prisma stops auto-loading .env once a prisma.config.ts exists; restore that
  // for local dev (production hosts inject DATABASE_URL directly, so this is a
  // no-op there).
  process.loadEnvFile();
} catch {
  // no .env file present
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
