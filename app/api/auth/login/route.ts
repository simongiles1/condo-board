export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { attachSessionCookie } from "@/lib/auth/cookies";
import {
  authenticateUser,
  createSessionToken,
} from "@/lib/auth/session";

export async function POST(req: Request) {
  let body: { email?: string; password?: string };

  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Malformed JSON body." }, { status: 400 });
  }

  const email = body.email?.trim();
  const password = body.password ?? "";

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required." },
      { status: 400 },
    );
  }

  try {
    const user = await authenticateUser(email, password);
    if (!user) {
      return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
    }

    const token = createSessionToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    const response = NextResponse.json({
      ok: true,
      user: {
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
    });
    return attachSessionCookie(response, token);
  } catch (error) {
    console.error("[auth/login] Failed:", error);
    const message =
      error instanceof Error ? error.message : "Unexpected server error.";
    return NextResponse.json(
      { error: `Login failed: ${message}` },
      { status: 500 },
    );
  }
}
