import { NextResponse } from "next/server";
import { getSupabaseAdmin, TABLES } from "@/lib/supabaseAdmin";
import { TEACHER_AUTH_COOKIE } from "@/lib/auth/teacherSession";

type TeacherLoginBody = {
  teacherId?: string;
  password?: string;
};

function normalize(value: unknown) {
  return String(value ?? "").trim();
}

export async function POST(req: Request) {
  const body = (await req.json()) as TeacherLoginBody;
  const teacherId = normalize(body.teacherId);
  const password = normalize(body.password);

  if (!teacherId || !password) {
    return NextResponse.json({ error: "Teacher ID and password are required." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from(TABLES.teachers)
    .select("teacher_name,teacher_id,password")
    .eq("teacher_id", teacherId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data || String(data.password) !== password) {
    return NextResponse.json({ error: "Invalid teacher ID or password." }, { status: 401 });
  }

  const res = NextResponse.json({
    teacher: {
      teacher_name: data.teacher_name,
      teacher_id: data.teacher_id,
    },
  });

  res.cookies.set(TEACHER_AUTH_COOKIE, String(data.teacher_id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });

  return res;
}
