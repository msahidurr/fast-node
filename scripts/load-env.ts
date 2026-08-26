// Standalone scripts run outside the Prisma CLI and outside `shopify app dev`,
// so nothing else loads .env for them. Production hosts inject env vars
// directly, so this is a no-op there.
try {
  process.loadEnvFile();
} catch {
  // no .env file present
}
