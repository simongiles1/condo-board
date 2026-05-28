import { createHash, randomBytes, timingSafeEqual } from "crypto";

import { eq } from "drizzle-orm";
import { cookies } from "next/headers";

import { getDb } from "@/lib/db";
import { appUsers } from "@/lib/db/schema";

export const SESSION_COOKIE = "condo_board_session";

function hashPassword(password: string): string {
  return createHash("sha256")
    .update(`${process.env.AUTH_SECRET ?? "dev"}:${password}`)
    .digest("hex");
}

function signSession(payload: string): string {
  const secret = process.env.AUTH_SECRET ?? "dev-auth-secret";
  const signature = createHash("sha256")
    .update(`${secret}:${payload}`)
    .digest("hex");
  return `${payload}.${signature}`;
}

function verifySessionToken(token: string): { userId: string; email: string } | null {
  const lastDot = token.lastIndexOf(".");
  if (lastDot <= 0) return null;

  const payload = token.slice(0, lastDot);
  const signature = token.slice(lastDot + 1);
  const expected = signSession(payload).slice(lastDot + 1);

  const sigBuf = Buffer.from(signature, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { userId?: string; email?: string };
    if (!parsed.userId || !parsed.email) return null;
    return { userId: parsed.userId, email: parsed.email };
  } catch {
    return null;
  }
}

export function isAuthEnabled(): boolean {
  return process.env.AUTH_ENABLED === "true";
}

export async function ensureDefaultUsers() {
  if (!isAuthEnabled()) return;

  const db = getDb();
  const existing = await db.select({ id: appUsers.id }).from(appUsers);
  if (existing.length > 0) return;

  const seed = process.env.AUTH_USERS;
  if (!seed) return;

  const now = new Date().toISOString();
  const entries = seed.split(",").map((part) => part.trim()).filter(Boolean);

  for (const entry of entries) {
    const [email, password, name] = entry.split(":");
    if (!email || !password) continue;

    await db.insert(appUsers).values({
      id: randomBytes(16).toString("hex"),
      email: email.trim().toLowerCase(),
      passwordHash: hashPassword(password.trim()),
      name: name?.trim() ?? null,
      createdAt: now,
    });
  }
}

export async function authenticateUser(email: string, password: string) {
  await ensureDefaultUsers();
  const db = getDb();
  const normalized = email.trim().toLowerCase();

  const [user] = await db
    .select()
    .from(appUsers)
    .where(eq(appUsers.email, normalized));

  if (!user) return null;

  const candidate = hashPassword(password);
  const userBuf = Buffer.from(user.passwordHash, "utf8");
  const candidateBuf = Buffer.from(candidate, "utf8");
  if (userBuf.length !== candidateBuf.length) return null;
  if (!timingSafeEqual(userBuf, candidateBuf)) return null;

  return user;
}

export function createSessionToken(user: { id: string; email: string }) {
  const payload = Buffer.from(
    JSON.stringify({ userId: user.id, email: user.email }),
    "utf8",
  ).toString("base64url");
  return signSession(payload);
}

export async function getSessionUser() {
  if (!isAuthEnabled()) return null;

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = verifySessionToken(token);
  if (!session) return null;

  const db = getDb();
  const [user] = await db
    .select({
      id: appUsers.id,
      email: appUsers.email,
      name: appUsers.name,
    })
    .from(appUsers)
    .where(eq(appUsers.id, session.userId));

  return user ?? null;
}

export async function setSessionCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}
