/**
 * Apply Prisma migrations during the Vercel build, using the DIRECT (unpooled) connection — pooled
 * pgbouncer endpoints break migrations. Runs only when a Neon/Vercel direct URL is present, so local
 * `npm run build` (which has no such var) simply skips it and is unaffected.
 */
import { execSync } from "node:child_process";

const direct = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING;
if (!direct) {
  console.log("[vercel-migrate] no direct DB url in env — skipping (local/non-Vercel build)");
  process.exit(0);
}
console.log("[vercel-migrate] applying prisma migrate deploy against the direct connection…");
execSync("prisma migrate deploy", { stdio: "inherit", env: { ...process.env, DATABASE_URL: direct } });
