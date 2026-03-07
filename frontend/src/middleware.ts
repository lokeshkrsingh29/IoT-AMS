import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { TEACHER_AUTH_COOKIE } from "@/lib/auth/teacherSession";

const protectedPrefixes = ["/dashboard", "/classes", "/students", "/attendance", "/workspace"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = Boolean(req.cookies.get(TEACHER_AUTH_COOKIE)?.value);
  const isProtected = protectedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

  if (pathname === "/" && hasSession) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  if (isProtected && !hasSession) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/dashboard/:path*", "/classes/:path*", "/students/:path*", "/attendance/:path*", "/workspace/:path*"],
};
