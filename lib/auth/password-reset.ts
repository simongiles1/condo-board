import { randomBytes } from "crypto";

import { and, eq, gt, lt } from "drizzle-orm";

import { getAppBaseUrl } from "@/lib/app-url";
import { isAuthEnabled } from "@/lib/auth/config";
import { formatAuthDbError } from "@/lib/auth/db-errors";
import { sendPasswordResetEmail } from "@/lib/auth/mail";
import { hashPassword, hashResetToken } from "@/lib/auth/password-hash";
import { getDb } from "@/lib/db";
import { appUsers, passwordResetTokens } from "@/lib/db/schema";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export const PASSWORD_RESET_SENT_MESSAGE =
  "If an account exists for that email, a reset link has been sent.";

function buildResetUrl(token: string): string {
  const url = new URL("/reset-password", getAppBaseUrl());
  url.searchParams.set("token", token);
  return url.toString();
}

async function purgeExpiredResetTokens(nowIso: string) {
  const db = getDb();
  await db
    .delete(passwordResetTokens)
    .where(lt(passwordResetTokens.expiresAt, nowIso));
}

export async function requestPasswordReset(email: string): Promise<
  | {
      ok: true;
      message: string;
      devResetUrl?: string;
    }
  | { error: string }
> {
  if (!isAuthEnabled()) {
    return { error: "Authentication is not enabled." };
  }

  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    return { error: "Email is required." };
  }

  try {
    const db = getDb();
    const now = new Date();
    const nowIso = now.toISOString();
    await purgeExpiredResetTokens(nowIso);

    const [user] = await db
      .select({ id: appUsers.id, email: appUsers.email })
      .from(appUsers)
      .where(eq(appUsers.email, normalized));

    if (!user) {
      return { ok: true, message: PASSWORD_RESET_SENT_MESSAGE };
    }

    await db
      .delete(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, user.id));

    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = hashResetToken(rawToken);
    const expiresAt = new Date(now.getTime() + RESET_TOKEN_TTL_MS).toISOString();

    await db.insert(passwordResetTokens).values({
      id: randomBytes(16).toString("hex"),
      userId: user.id,
      tokenHash,
      expiresAt,
      createdAt: nowIso,
    });

    const resetUrl = buildResetUrl(rawToken);
    const { delivered } = await sendPasswordResetEmail({
      to: user.email,
      resetUrl,
    });

    const devResetUrl =
      !delivered && process.env.NODE_ENV === "development"
        ? resetUrl
        : undefined;

    return {
      ok: true,
      message: PASSWORD_RESET_SENT_MESSAGE,
      devResetUrl,
    };
  } catch (error) {
    console.error("[auth:requestPasswordReset] Failed:", error);
    return { error: formatAuthDbError(error, "Password reset request") };
  }
}

export async function resetPasswordWithToken(input: {
  token: string;
  password: string;
}): Promise<
  | {
      ok: true;
      user: {
        id: string;
        email: string;
        firstName: string | null;
        lastName: string | null;
        role: string;
      };
    }
  | { error: string }
> {
  if (!isAuthEnabled()) {
    return { error: "Authentication is not enabled." };
  }

  const token = input.token.trim();
  const password = input.password;

  if (!token) {
    return { error: "Reset link is invalid or expired." };
  }
  if (!password) {
    return { error: "Password is required." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  try {
    const db = getDb();
    const nowIso = new Date().toISOString();
    await purgeExpiredResetTokens(nowIso);

    const tokenHash = hashResetToken(token);
    const [resetRow] = await db
      .select({
        id: passwordResetTokens.id,
        userId: passwordResetTokens.userId,
      })
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          gt(passwordResetTokens.expiresAt, nowIso),
        ),
      );

    if (!resetRow) {
      return { error: "Reset link is invalid or expired." };
    }

    const [user] = await db
      .select()
      .from(appUsers)
      .where(eq(appUsers.id, resetRow.userId));

    if (!user) {
      return { error: "Reset link is invalid or expired." };
    }

    await db
      .update(appUsers)
      .set({ passwordHash: hashPassword(password) })
      .where(eq(appUsers.id, user.id));

    await db
      .delete(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, user.id));

    return {
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
    };
  } catch (error) {
    console.error("[auth:resetPasswordWithToken] Failed:", error);
    return { error: formatAuthDbError(error, "Password reset") };
  }
}
