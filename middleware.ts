import { NextResponse, type NextRequest } from "next/server";

import { getAppBaseUrl } from "@/lib/app-url";
import { isAuthEnabled } from "@/lib/auth/config";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import {
  hasMinRole,
  pathRequiresAdmin,
  pathRequiresSuperAdmin,
} from "@/lib/auth/roles";
import { verifySignedSessionTokenEdge } from "@/lib/auth/token-edge";

const PUBLIC_PATHS = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/signup",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/health",
  "/api/inngest",
  "/api/email/oauth/start",
  "/api/email/oauth/callback",
  "/api/email/oauth/config",
  "/api/telegram/webhook",
];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

function isAuthorizedInternalFilePull(request: NextRequest): boolean {
  const expected = process.env.FILE_PULL_TOKEN?.trim();
  if (!expected) return false;
  const header = request.headers.get("authorization")?.trim();
  if (!header?.toLowerCase().startsWith("bearer ")) return false;
  const provided = header.slice("bearer ".length).trim();
  return Boolean(provided && provided === expected);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // pdf.js worker must load without a session cookie (module worker fetch).
  if (pathname === "/pdf.worker.min.mjs") {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/internal/")) {
    if (isAuthorizedInternalFilePull(request)) {
      return NextResponse.next();
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAuthEnabled()) {
    return NextResponse.next();
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const session = await verifySignedSessionTokenEdge(token);
  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", pathname);
    const response = NextResponse.redirect(loginUrl);
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }

  if (pathRequiresSuperAdmin(pathname) && session.role !== "super_admin") {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/", getAppBaseUrl()));
  }

  if (pathRequiresAdmin(pathname) && !hasMinRole(session.role, "admin")) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/", getAppBaseUrl()));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
