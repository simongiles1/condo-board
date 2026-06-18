import { createHash } from "crypto";

export function hashPassword(password: string): string {
  return createHash("sha256")
    .update(`${process.env.AUTH_SECRET ?? "dev"}:${password}`)
    .digest("hex");
}

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
