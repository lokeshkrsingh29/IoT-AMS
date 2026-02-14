import { NextResponse } from "next/server";
import { getSupabaseAdmin, TABLES } from "@/lib/supabaseAdmin";
import { sendTelegramMessage } from "@/lib/telegram";

type CreateClassBody = {
  teacherName?: string;
  teacherUniqueId?: string;
  className?: string;
  durationMinutes?: number;
  classTime?: string;
  classStartAt?: string;
  classEndAt?: string;
};

function normalizeText(value: string) {
  return value.trim();
}

function isValidTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

type NotificationResult = {
  sent: number;
  failed: number;
  total: number;
};

const classNotificationTimers = new Map<number, ReturnType<typeof setTimeout>>();

async function notifyStudentsForClass(params: {
  botToken: string;
  className: string;
  teacherName: string;
  classStartAt: string;
  classEndAt: string;
  durationMinutes: number;
}) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data: students, error } = await supabaseAdmin
    .from(TABLES.students)
    .select("telegram_id,name,reg_number");

  if (error) {
    throw new Error(error.message);
  }

  const studentRows = students ?? [];
  let sent = 0;
  let failed = 0;
  const startLocal = new Date(params.classStartAt).toLocaleString();
  const endLocal = new Date(params.classEndAt).toLocaleString();

  for (const student of studentRows) {
    const telegramId = String(student.telegram_id || "").trim();
    if (!telegramId) {
      failed += 1;
      continue;
    }

    const text =
      `Class Reminder\n` +
      `Student: ${student.name} (${student.reg_number})\n` +
      `Class: ${params.className}\n` +
      `Teacher: ${params.teacherName}\n` +
      `Start: ${startLocal}\n` +
      `End: ${endLocal}\n` +
      `Duration: ${params.durationMinutes} min`;

    try {
      await sendTelegramMessage(params.botToken, telegramId, text);
      sent += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    sent,
    failed,
    total: studentRows.length,
  } satisfies NotificationResult;
}

export async function POST(req: Request) {
  const supabaseAdmin = getSupabaseAdmin();
  const body = (await req.json()) as CreateClassBody;

  const teacherName = normalizeText(String(body.teacherName ?? ""));
  const teacherUniqueId = normalizeText(String(body.teacherUniqueId ?? ""));
  const className = normalizeText(String(body.className ?? ""));
  const durationMinutes = Number(body.durationMinutes);
  const classTime = normalizeText(String(body.classTime ?? ""));
  const classStartAt = normalizeText(String(body.classStartAt ?? ""));
  const classEndAt = normalizeText(String(body.classEndAt ?? ""));

  if (!teacherName || !teacherUniqueId || !className || !Number.isFinite(durationMinutes) || durationMinutes <= 0 || !classTime) {
    return NextResponse.json(
      { error: "Teacher name, teacher unique ID, class name, duration, and time are required." },
      { status: 400 }
    );
  }

  if (!Number.isInteger(durationMinutes)) {
    return NextResponse.json({ error: "Duration must be a whole number in minutes." }, { status: 400 });
  }

  if (!isValidTime(classTime)) {
    return NextResponse.json({ error: "Time must be in HH:MM format (24-hour)." }, { status: 400 });
  }

  if (!classStartAt || !classEndAt) {
    return NextResponse.json({ error: "Class start and end timestamps are required." }, { status: 400 });
  }

  const startDate = new Date(classStartAt);
  const endDate = new Date(classEndAt);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return NextResponse.json({ error: "Invalid class start/end timestamps." }, { status: 400 });
  }
  if (endDate <= startDate) {
    return NextResponse.json({ error: "Class end time must be after class start time." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from(TABLES.classes)
    .insert({
      teacher_name: teacherName,
      teacher_unique_id: teacherUniqueId,
      class_name: className,
      duration_minutes: durationMinutes,
      class_time: classTime,
      class_start_at: classStartAt,
      class_end_at: classEndAt,
      notification_status: "pending",
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const msUntilClassStart = startDate.getTime() - Date.now();
  const notifyLeadMs = 30 * 60 * 1000;
  const msUntilNotification = msUntilClassStart - notifyLeadMs;
  let notificationAction: "sent_now" | "scheduled" | "skipped_no_token" = "skipped_no_token";
  let notificationResult: NotificationResult | null = null;
  let notificationScheduledFor: string | null = null;

  if (botToken) {
    if (msUntilClassStart <= notifyLeadMs) {
      notificationAction = "sent_now";
      notificationResult = await notifyStudentsForClass({
        botToken,
        className,
        teacherName,
        classStartAt,
        classEndAt,
        durationMinutes,
      });
      await supabaseAdmin
        .from(TABLES.classes)
        .update({
          notification_status: "sent",
          notification_sent_at: new Date().toISOString(),
        })
        .eq("id", data.id);
    } else {
      notificationAction = "scheduled";
      const scheduledForIso = new Date(Date.now() + msUntilNotification).toISOString();
      notificationScheduledFor = scheduledForIso;

      await supabaseAdmin
        .from(TABLES.classes)
        .update({
          notification_status: "scheduled",
          notification_scheduled_for: scheduledForIso,
        })
        .eq("id", data.id);

      const timer = setTimeout(async () => {
        try {
          const result = await notifyStudentsForClass({
            botToken,
            className,
            teacherName,
            classStartAt,
            classEndAt,
            durationMinutes,
          });

          const runtimeSupabase = getSupabaseAdmin();
          await runtimeSupabase
            .from(TABLES.classes)
            .update({
              notification_status: "sent",
              notification_sent_at: new Date().toISOString(),
            })
            .eq("id", data.id);

          void result;
        } catch {
          const runtimeSupabase = getSupabaseAdmin();
          await runtimeSupabase
            .from(TABLES.classes)
            .update({ notification_status: "failed" })
            .eq("id", data.id);
        } finally {
          classNotificationTimers.delete(data.id);
        }
      }, msUntilNotification);

      classNotificationTimers.set(data.id, timer);
    }
  }

  return NextResponse.json({
    message: "Class created successfully.",
    classId: data.id,
    classStartAt,
    classEndAt,
    notificationAction,
    notificationScheduledFor,
    notificationResult,
  });
}

export async function GET(req: Request) {
  const supabaseAdmin = getSupabaseAdmin();
  const url = new URL(req.url);
  const onlyUpcoming = url.searchParams.get("upcoming") === "1";
  const nowIso = new Date().toISOString();

  let query = supabaseAdmin
    .from(TABLES.classes)
    .select(
      "id,teacher_name,teacher_unique_id,class_name,duration_minutes,class_time,class_start_at,class_end_at,created_at"
    )
    .order("class_start_at", { ascending: true })
    .limit(200);

  if (onlyUpcoming) {
    query = query.gte("class_end_at", nowIso);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ classes: data ?? [] });
}
