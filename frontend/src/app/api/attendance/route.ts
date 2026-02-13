import { NextResponse } from "next/server";
import { getSupabaseAdmin, TABLES } from "@/lib/supabaseAdmin";

function hhmmss(date: Date) {
  return date.toTimeString().slice(0, 8);
}

export async function GET() {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from(TABLES.attendance)
    .select("attendance_date,reg_number,name,time,status,marked_at")
    .order("attendance_date", { ascending: false })
    .order("time", { ascending: false })
    .limit(300);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ attendance: data ?? [] });
}

export async function POST(req: Request) {
  const supabaseAdmin = getSupabaseAdmin();
  const body = await req.json();
  const regNumber = String(body.regNumber || "").trim();

  if (!regNumber) {
    return NextResponse.json({ error: "Registration number is required." }, { status: 400 });
  }

  const { data: student, error: studentError } = await supabaseAdmin
    .from(TABLES.students)
    .select("name,reg_number")
    .eq("reg_number", regNumber)
    .maybeSingle();

  if (studentError) {
    return NextResponse.json({ error: studentError.message }, { status: 500 });
  }

  if (!student) {
    return NextResponse.json({ error: "Student not found." }, { status: 404 });
  }

  const now = new Date();
  const payload = {
    attendance_date: now.toISOString().slice(0, 10),
    reg_number: String(student.reg_number),
    name: String(student.name),
    time: hhmmss(now),
    status: "Present",
    marked_at: now.toISOString(),
  };

  const { error } = await supabaseAdmin
    .from(TABLES.attendance)
    .upsert(payload, { onConflict: "attendance_date,reg_number" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ message: "Attendance marked.", entry: payload });
}
