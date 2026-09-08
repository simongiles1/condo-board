import { execFileSync } from "child_process";
import path from "path";

export type RunMigrationsResult = {
  ok: boolean;
  output: string;
};

/** Apply pending SQL migrations from drizzle/ (same as npm run db:migrate). */
export function runPendingMigrations(): RunMigrationsResult {
  const script = path.join(process.cwd(), "scripts", "db-migrate.cjs");
  try {
    const output = execFileSync(process.execPath, [script], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    return { ok: true, output };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    const output = [err.stdout, err.stderr, err.message]
      .filter(Boolean)
      .join("\n");
    return { ok: false, output };
  }
}
