export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { attachSessionCookie } from "@/lib/auth/cookies";
import { resetPasswordWithToken } from "@/lib/auth/password-reset";
import { createSessionToken } from "@/lib/auth/session";
import { isUserRole } from "@/lib/auth/roles";

export async function POST(req: Request) {
  let body: { token?: string; password?: string };

  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Malformed JSON body." }, { status: 400 });
  }

  const result = await resetPasswordWithToken({
    token: body.token ?? "",
    password: body.password ?? "",
  });

  if ("error" in result) {
    const status =
      result.error.includes("invalid or expired") ||
      result.error.includes("required") ||
      result.error.includes("at least")
        ? 400
        : 500;
    return NextResponse.json({ error: result.error }, { status });
  }

  if (!isUserRole(result.user.role)) {
    return NextResponse.json(
      { error: "Password reset failed." },
      { status: 500 },
    );
  }

  const token = createSessionToken({
    id: result.user.id,
    email: result.user.email,
    role: result.user.role,
  });

  const response = NextResponse.json({
    ok: true,
    user: {
      email: result.user.email,
      firstName: result.user.firstName,
      lastName: result.user.lastName,
      role: result.user.role,
    },
  });
  return attachSessionCookie(response, token);
}
