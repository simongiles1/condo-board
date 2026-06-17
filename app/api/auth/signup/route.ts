export const runtime = "nodejs";

import { NextResponse } from "next/server";

import {
  createSessionToken,
  registerUser,
  setSessionCookie,
} from "@/lib/auth/session";

export async function POST(req: Request) {
  let body: { email?: string; password?: string; firstName?: string; lastName?: string };

  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Malformed JSON body." }, { status: 400 });
  }

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
  await setSessionCookie(token);

  return NextResponse.json({
    ok: true,
    user: {
      email: result.email,
      firstName: result.firstName,
      lastName: result.lastName,
      role: result.role,
    },
  });
}
