import { NextResponse } from "next/server";
import { getSupabaseAdmin, TABLES } from "@/lib/supabaseAdmin";
import { sendTelegramMessage } from "@/lib/telegram";

type FinalizeBody = {
  classId?: number;
};

export async function POST(req: Request) {
  const supabaseAdmin = getSupabaseAdmin();
  const body = (await req.json()) as FinalizeBody;
  const classId = Number(body.classId);

  if (!Number.isInteger(classId) || classId <= 0) {
    return NextResponse.json({ error: "Valid classId is required." }, { status: 400 });
  }

  const { data: classRow, error: classError } = await supabaseAdmin
    .from(TABLES.classes)
    .select("id,class_name,teacher_name,class_start_at,class_end_at,attendance_notification_sent_at")
    .eq("id", classId)
    .maybeSingle();

  if (classError) {
    return NextResponse.json({ error: classError.message }, { status: 500 });
  }
  if (!classRow) {
    return NextResponse.json({ error: "Class not found." }, { status: 404 });
  }
  if (classRow.attendance_notification_sent_at) {
    return NextResponse.json({ message: "Class attendance notifications already sent." });
  }

  const { data: students, error: studentsError } = await supabaseAdmin
    .from(TABLES.students)
    .select("reg_number,name,telegram_id");
  if (studentsError) {
    return NextResponse.json({ error: studentsError.message }, { status: 500 });
  }

  const { data: attendanceRows, error: attendanceError } = await supabaseAdmin
    .from(TABLES.attendance)
    .select("reg_number")
    .eq("class_id", classId)
    .eq("status", "Present");
  if (attendanceError) {
    return NextResponse.json({ error: attendanceError.message }, { status: 500 });
  }

  const presentRegs = new Set((attendanceRows ?? []).map((row) => String(row.reg_number)));
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  let sent = 0;
  let failed = 0;

  if (botToken) {
    const classStart = new Date(String(classRow.class_start_at)).toLocaleString();
    const classEnd = new Date(String(classRow.class_end_at)).toLocaleString();
    for (const student of students ?? []) {
      const telegramId = String(student.telegram_id || "").trim();
      if (!telegramId) {
        failed += 1;
        continue;
      }

      const isPresent = presentRegs.has(String(student.reg_number));
      const statusLine = isPresent ? "Your attendance has been marked as Present." : "You were marked Absent.";
      const text =
        `Class Completed\n` +
        `Class: ${classRow.class_name}\n` +
        `Teacher: ${classRow.teacher_name}\n` +
        `Start: ${classStart}\n` +
        `End: ${classEnd}\n` +
        `Status: ${statusLine}`;

      try {
        await sendTelegramMessage(botToken, telegramId, text);
        sent += 1;
      } catch {
        failed += 1;
      }
    }
  }

  await supabaseAdmin
    .from(TABLES.classes)
    .update({
      attendance_notification_sent_at: new Date().toISOString(),
      attendance_notification_status: botToken ? "sent" : "skipped_no_token",
    })
    .eq("id", classId);

  return NextResponse.json({
    message: "Class finalized.",
    notification: {
      sent,
      failed,
      total: (students ?? []).length,
      skipped: !botToken,
    },
  });
}

