import { NextResponse } from "next/server";
import { TEACHER_AUTH_COOKIE } from "@/lib/auth/teacherSession";

export async function POST() {
  const res = NextResponse.json({ message: "Logged out" });
  res.cookies.set(TEACHER_AUTH_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}
