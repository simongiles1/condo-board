import { randomBytes, timingSafeEqual } from "crypto";

import { asc, eq } from "drizzle-orm";
import { cookies } from "next/headers";

import { isAuthEnabled } from "@/lib/auth/config";
import { isUserRole, type UserRole } from "@/lib/auth/roles";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { sessionCookieOptions } from "@/lib/auth/cookies";
import { formatAuthDbError } from "@/lib/auth/db-errors";
import { hashPassword } from "@/lib/auth/password-hash";
import {
  createSignedSessionToken,
  verifySignedSessionToken,
} from "@/lib/auth/token";
import { getDb } from "@/lib/db";
import { appUsers, extractionSources } from "@/lib/db/schema";

export type AppUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: UserRole;
};

function normalizeNamePart(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function splitFullName(fullName: string | undefined): {
  firstName: string | null;
  lastName: string | null;
} {
  const trimmed = fullName?.trim();
  if (!trimmed) {
    return { firstName: null, lastName: null };
  }

  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) {
    return { firstName: trimmed, lastName: null };
  }

  return {
    firstName: trimmed.slice(0, spaceIndex).trim() || null,
    lastName: trimmed.slice(spaceIndex + 1).trim() || null,
  };
}

export { isAuthEnabled } from "@/lib/auth/config";

export function isSignupEnabled(): boolean {
  return process.env.AUTH_ALLOW_SIGNUP === "true";
}

async function isBootstrapSignupAllowed(): Promise<boolean> {
  const db = getDb();
  const [existingUser] = await db.select({ id: appUsers.id }).from(appUsers).limit(1);
  return !existingUser;
}

async function canRegisterNewUser(): Promise<boolean> {
  return isSignupEnabled() || (await isBootstrapSignupAllowed());
}

function parseSeedRole(value: string | undefined, isFirstUser: boolean): UserRole {
  if (value && isUserRole(value)) return value;
  return isFirstUser ? "super_admin" : "user";
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

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const [email, password, fullName, role] = entry.split(":");
    if (!email || !password) continue;

    const { firstName, lastName } = splitFullName(fullName);

    await db.insert(appUsers).values({
      id: randomBytes(16).toString("hex"),
      email: email.trim().toLowerCase(),
      passwordHash: hashPassword(password.trim()),
      firstName,
      lastName,
      role: parseSeedRole(role?.trim(), index === 0),
      createdAt: now,
    });
  }
}

export async function registerUser(input: {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
}): Promise<AppUser | { error: string }> {
  if (!isAuthEnabled()) {
    return { error: "Authentication is not enabled." };
  }

  try {
    if (!(await canRegisterNewUser())) {
      return { error: "Sign up is disabled for this deployment." };
    }

    const email = input.email.trim().toLowerCase();
    const password = input.password;
    const firstName = normalizeNamePart(input.firstName);
    const lastName = normalizeNamePart(input.lastName);

    if (!email || !password) {
      return { error: "Email and password are required." };
    }
    if (password.length < 8) {
      return { error: "Password must be at least 8 characters." };
    }

    const db = getDb();

    const [existing] = await db
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(eq(appUsers.email, email));
    if (existing) {
      return { error: "An account with this email already exists." };
    }

    const now = new Date().toISOString();
    const user: AppUser = {
      id: randomBytes(16).toString("hex"),
      email,
      firstName,
      lastName,
      role: "user",
    };

    await db.insert(appUsers).values({
      id: user.id,
      email: user.email,
      passwordHash: hashPassword(password),
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      createdAt: now,
    });

    return user;
  } catch (error) {
    console.error("[auth/registerUser] Failed:", error);
    return { error: formatAuthDbError(error, "Sign up") };
  }
}

export async function authenticateUser(
  email: string,
  password: string,
): Promise<(typeof appUsers.$inferSelect) | { error: string } | null> {
  try {
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
  } catch (error) {
    console.error("[auth/authenticateUser] Failed:", error);
    return { error: formatAuthDbError(error, "Login") };
  }
}

export function createSessionToken(user: {
  id: string;
  email: string;
  role: UserRole;
}) {
  return createSignedSessionToken({
    userId: user.id,
    email: user.email,
    role: user.role,
  });
}

export async function getSessionUser(): Promise<AppUser | null> {
  if (!isAuthEnabled()) return null;

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = verifySignedSessionToken(token);
  if (!session) return null;

  const db = getDb();
  const [user] = await db
    .select({
      id: appUsers.id,
      email: appUsers.email,
      firstName: appUsers.firstName,
      lastName: appUsers.lastName,
      role: appUsers.role,
    })
    .from(appUsers)
    .where(eq(appUsers.id, session.userId));

  if (!user || !isUserRole(user.role)) return null;

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
  };
}

export async function setSessionCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, sessionCookieOptions());
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export async function listAppUsers() {
  const db = getDb();
  return db
    .select({
      id: appUsers.id,
      email: appUsers.email,
      firstName: appUsers.firstName,
      lastName: appUsers.lastName,
      role: appUsers.role,
      createdAt: appUsers.createdAt,
    })
    .from(appUsers)
    .orderBy(asc(appUsers.createdAt));
}

export async function updateUserRole(input: {
  userId: string;
  role: UserRole;
  actorId: string;
}): Promise<{ ok: true } | { error: string }> {
  if (input.userId === input.actorId && input.role !== "super_admin") {
    return { error: "You cannot demote your own super admin account." };
  }

  const db = getDb();
  const [target] = await db
    .select({ id: appUsers.id, role: appUsers.role })
    .from(appUsers)
    .where(eq(appUsers.id, input.userId));

  if (!target) {
    return { error: "User not found." };
  }

  if (target.role === "super_admin" && input.role !== "super_admin") {
    const superAdmins = await db
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(eq(appUsers.role, "super_admin"));
    if (superAdmins.length <= 1) {
      return { error: "At least one super admin is required." };
    }
  }

  await db
    .update(appUsers)
    .set({ role: input.role })
    .where(eq(appUsers.id, input.userId));

  return { ok: true };
}

export async function updateUserNames(input: {
  userId: string;
  firstName?: string | null;
  lastName?: string | null;
}): Promise<{ ok: true } | { error: string }> {
  const db = getDb();
  const [target] = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(eq(appUsers.id, input.userId));

  if (!target) {
    return { error: "User not found." };
  }

  const updates: { firstName?: string | null; lastName?: string | null } = {};
  if (input.firstName !== undefined) {
    updates.firstName = normalizeNamePart(input.firstName);
  }
  if (input.lastName !== undefined) {
    updates.lastName = normalizeNamePart(input.lastName);
  }

  if (Object.keys(updates).length === 0) {
    return { error: "No name fields to update." };
  }

  await db.update(appUsers).set(updates).where(eq(appUsers.id, input.userId));

  return { ok: true };
}

export async function deleteAppUser(input: {
  userId: string;
  actorId: string;
}): Promise<{ ok: true } | { error: string }> {
  if (input.userId === input.actorId) {
    return { error: "You cannot delete your own account." };
  }

  const db = getDb();
  const [target] = await db
    .select({ id: appUsers.id, role: appUsers.role })
    .from(appUsers)
    .where(eq(appUsers.id, input.userId));

  if (!target) {
    return { error: "User not found." };
  }

  if (target.role === "super_admin") {
    const superAdmins = await db
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(eq(appUsers.role, "super_admin"));
    if (superAdmins.length <= 1) {
      return { error: "At least one super admin is required." };
    }
  }

  await db
    .update(extractionSources)
    .set({ triggeredByUserId: null })
    .where(eq(extractionSources.triggeredByUserId, input.userId));

  await db.delete(appUsers).where(eq(appUsers.id, input.userId));

  return { ok: true };
}
