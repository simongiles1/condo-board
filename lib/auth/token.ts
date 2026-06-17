import { createHash, timingSafeEqual } from "crypto";

import type { UserRole } from "@/lib/auth/roles";
import { isUserRole } from "@/lib/auth/roles";

export type SessionPayload = {
  userId: string;
  email: string;
  role: UserRole;
};

function signPayload(payload: string): string {
  const secret = process.env.AUTH_SECRET ?? "dev-auth-secret";
  const signature = createHash("sha256")
    .update(`${secret}:${payload}`)
    .digest("hex");
  return `${payload}.${signature}`;
}

export function createSignedSessionToken(payload: SessionPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  return signPayload(encoded);
}

export function verifySignedSessionToken(
  token: string,
): SessionPayload | null {
  const lastDot = token.lastIndexOf(".");
  if (lastDot <= 0) return null;

  const payload = token.slice(0, lastDot);
  const signature = token.slice(lastDot + 1);
  const expected = signPayload(payload).slice(lastDot + 1);

  const sigBuf = Buffer.from(signature, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Partial<SessionPayload>;
    if (!parsed.userId || !parsed.email || !parsed.role) return null;
    if (!isUserRole(parsed.role)) return null;
    return {
      userId: parsed.userId,
      email: parsed.email,
      role: parsed.role,
    };
  } catch {
    return null;
  }
}
