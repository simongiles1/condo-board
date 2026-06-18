export const runtime = "nodejs";

import { NextResponse } from "next/server";

import {
  attachSessionCookie,
  createSessionToken,
  registerUser,
} from "@/lib/auth/session";

export async function POST(req: Request) {
  let body: {
    email?: string;
    password?: string;
    firstName?: string;
    lastName?: string;
  };

  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Malformed JSON body." }, { status: 400 });
  }

  try {
    const result = await registerUser({
      email: body.email ?? "",
      password: body.password ?? "",
      firstName: body.firstName,
      lastName: body.lastName,
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    const token = createSessionToken({
      id: result.id,
      email: result.email,
      role: result.role,
    });

    const response = NextResponse.json({
      ok: true,
      user: {
        email: result.email,
        firstName: result.firstName,
        lastName: result.lastName,
        role: result.role,
      },
    });
    return attachSessionCookie(response, token);
  } catch (error) {
    console.error("[auth/signup] Failed:", error);
    return NextResponse.json(
      { error: "Sign up failed on the server. Check app logs." },
      { status: 500 },
    );
  }
}
