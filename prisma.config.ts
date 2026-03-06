import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

// Load .env.local first, then .env as fallback
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Use DIRECT_URL for migrations (bypasses connection pooler)
    url: process.env["DIRECT_URL"] || process.env["DATABASE_URL"],
  },
});
