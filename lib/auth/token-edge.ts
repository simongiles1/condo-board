import type { UserRole } from "@/lib/auth/roles";
import { isUserRole } from "@/lib/auth/roles";

export type SessionPayload = {
  userId: string;
  email: string;
  role: UserRole;
};

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function base64UrlDecode(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

async function expectedSignature(payload: string): Promise<string> {
  const secret = process.env.AUTH_SECRET ?? "dev-auth-secret";
  return sha256Hex(`${secret}:${payload}`);
}

/** Edge-safe session verification for middleware (no Node.js crypto or DB). */
export async function verifySignedSessionTokenEdge(
  token: string,
): Promise<SessionPayload | null> {
  const lastDot = token.lastIndexOf(".");
  if (lastDot <= 0) return null;

  const payload = token.slice(0, lastDot);
  const signature = token.slice(lastDot + 1);
  const expected = await expectedSignature(payload);
  if (!timingSafeEqual(signature, expected)) return null;

  try {
    const parsed = JSON.parse(base64UrlDecode(payload)) as Partial<SessionPayload>;
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
