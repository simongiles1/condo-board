import { defineConfig } from "drizzle-kit";

/** After editing lib/db/schema.ts: npm run db:generate && npm run db:migrate */
export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://condo:condo@localhost:5433/condo_board",
  },
});
