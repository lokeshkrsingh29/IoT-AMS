import { NextResponse } from "next/server";
import { getSupabaseAdmin, TABLES } from "@/lib/supabaseAdmin";
import { sendTelegramMessage } from "@/lib/telegram";

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
  const classIdRaw = body.classId;
  const classId = classIdRaw == null ? null : Number(classIdRaw);

  if (!regNumber) {
    return NextResponse.json({ error: "Registration number is required." }, { status: 400 });
  }
  if (classIdRaw != null && (!Number.isInteger(classId) || Number(classId) <= 0)) {
    return NextResponse.json({ error: "classId must be a positive integer." }, { status: 400 });
  }

  const { data: student, error: studentError } = await supabaseAdmin
    .from(TABLES.students)
    .select("name,reg_number,telegram_id")
    .eq("reg_number", regNumber)
    .maybeSingle();

  if (studentError) {
    return NextResponse.json({ error: studentError.message }, { status: 500 });
  }

  if (!student) {
    return NextResponse.json({ error: "Student not found." }, { status: 404 });
  }

  let attendanceDate = new Date().toISOString().slice(0, 10);
  let className = "";
  let teacherName = "";
  if (classId != null) {
    const { data: classRow, error: classError } = await supabaseAdmin
      .from(TABLES.classes)
      .select("id,class_name,teacher_name,class_start_at")
      .eq("id", classId)
      .maybeSingle();
    if (classError) {
      return NextResponse.json({ error: classError.message }, { status: 500 });
    }
    if (!classRow) {
      return NextResponse.json({ error: "Class not found." }, { status: 404 });
    }
    attendanceDate = new Date(String(classRow.class_start_at)).toISOString().slice(0, 10);
    className = String(classRow.class_name);
    teacherName = String(classRow.teacher_name);
  }

  const existingQuery = supabaseAdmin
    .from(TABLES.attendance)
    .select("id")
    .eq("reg_number", regNumber)
    .eq("attendance_date", attendanceDate);

  if (classId != null) {
    existingQuery.eq("class_id", classId);
  } else {
    existingQuery.is("class_id", null);
  }

  const { data: existingAttendance, error: existingError } = await existingQuery.maybeSingle();
  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }

  const now = new Date();
  const payload = {
    attendance_date: attendanceDate,
    reg_number: String(student.reg_number),
    name: String(student.name),
    time: hhmmss(now),
    status: "Present",
    marked_at: now.toISOString(),
    class_id: classId,
  };

  if (existingAttendance) {
    return NextResponse.json({ message: "Attendance already marked.", entry: payload, alreadyMarked: true });
  }

  const { error: insertError } = await supabaseAdmin
    .from(TABLES.attendance)
    .insert(payload);

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (botToken && student.telegram_id) {
    const telegramId = String(student.telegram_id).trim();
    const classLine = classId != null ? `Class: ${className}\nTeacher: ${teacherName}\n` : "";
    const text =
      `Attendance Update\n` +
      `${classLine}` +
      `Hi ${student.name}, your attendance has been marked as Present.`;
    try {
      await sendTelegramMessage(botToken, telegramId, text);
    } catch {
      // Keep attendance success even if Telegram send fails.
    }
  }

  return NextResponse.json({ message: "Attendance marked.", entry: payload });
}
