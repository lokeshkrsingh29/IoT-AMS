import { NextResponse } from "next/server";
import { getSupabaseAdmin, mapBackendError, TABLES } from "@/lib/supabaseAdmin";
import { sendTelegramMessage } from "@/lib/telegram";
import { getTeacherSessionId } from "@/lib/auth/teacherSession";

type CreateClassBody = {
  className?: string;
  durationMinutes?: number;
  classTime?: string;
  classStartAt?: string;
  classEndAt?: string;
};

type TimetableRow = {
  teacher_id: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  course_code: string;
  course_title: string;
};

type TeacherRow = {
  teacher_id: string;
  teacher_name: string;
};

type ClassRow = {
  id: number;
  teacher_name: string;
  teacher_unique_id: string;
  class_name: string;
  duration_minutes: number;
  class_time: string;
  class_start_at: string;
  class_end_at: string;
  notification_status?: string;
  notification_scheduled_for?: string | null;
};

type NotificationResult = {
  sent: number;
  failed: number;
  total: number;
};

const NOTIFY_LEAD_MS = 30 * 60 * 1000;
const classNotificationTimers = new Map<number, ReturnType<typeof setTimeout>>();

function normalizeText(value: string) {
  return value.trim();
}

function isValidTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function parseTimeToHoursMinutes(timeValue: string) {
  const [h, m] = timeValue.split(":").map(Number);
  return { h, m };
}

function buildClassDateTimes(baseDate: Date, startTime: string, endTime: string) {
  const start = new Date(baseDate);
  const end = new Date(baseDate);
  const { h: sh, m: sm } = parseTimeToHoursMinutes(startTime);
  const { h: eh, m: em } = parseTimeToHoursMinutes(endTime);
  start.setHours(sh, sm, 0, 0);
  end.setHours(eh, em, 0, 0);
  if (end.getTime() <= start.getTime()) {
    end.setDate(end.getDate() + 1);
  }
  return { start, end };
}

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

  return { sent, failed, total: studentRows.length } satisfies NotificationResult;
}

async function notifyStudentsClassCancelled(params: {
  botToken: string;
  className: string;
  teacherName: string;
  classStartAt: string;
  classEndAt: string;
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

  for (const student of studentRows) {
    const telegramId = String(student.telegram_id || "").trim();
    if (!telegramId) {
      failed += 1;
      continue;
    }

    const text =
      `Class Cancelled\n` +
      `Student: ${student.name} (${student.reg_number})\n` +
      `Class: ${params.className}\n` +
      `Teacher: ${params.teacherName}\n` +
      `Scheduled: ${new Date(params.classStartAt).toLocaleString()} to ${new Date(params.classEndAt).toLocaleString()}`;

    try {
      await sendTelegramMessage(params.botToken, telegramId, text);
      sent += 1;
    } catch {
      failed += 1;
    }
  }

  return { sent, failed, total: studentRows.length } satisfies NotificationResult;
}

async function scheduleNotificationForClass(classRow: ClassRow) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return;

  const supabase = getSupabaseAdmin();
  const startDate = new Date(classRow.class_start_at);
  const msUntilClassStart = startDate.getTime() - Date.now();
  const msUntilNotification = msUntilClassStart - NOTIFY_LEAD_MS;

  if (msUntilClassStart <= 0) {
    return;
  }

  if (msUntilClassStart <= NOTIFY_LEAD_MS) {
    const result = await notifyStudentsForClass({
      botToken,
      className: classRow.class_name,
      teacherName: classRow.teacher_name,
      classStartAt: classRow.class_start_at,
      classEndAt: classRow.class_end_at,
      durationMinutes: classRow.duration_minutes,
    });

    await supabase
      .from(TABLES.classes)
      .update({
        notification_status: "sent",
        notification_sent_at: new Date().toISOString(),
      })
      .eq("id", classRow.id);

    void result;
    return;
  }

  if (classNotificationTimers.has(classRow.id)) {
    return;
  }

  const scheduledForIso = new Date(Date.now() + msUntilNotification).toISOString();
  await supabase
    .from(TABLES.classes)
    .update({
      notification_status: "scheduled",
      notification_scheduled_for: scheduledForIso,
    })
    .eq("id", classRow.id);

  const timer = setTimeout(async () => {
    try {
      await notifyStudentsForClass({
        botToken,
        className: classRow.class_name,
        teacherName: classRow.teacher_name,
        classStartAt: classRow.class_start_at,
        classEndAt: classRow.class_end_at,
        durationMinutes: classRow.duration_minutes,
      });

      const runtimeSupabase = getSupabaseAdmin();
      await runtimeSupabase
        .from(TABLES.classes)
        .update({
          notification_status: "sent",
          notification_sent_at: new Date().toISOString(),
        })
        .eq("id", classRow.id);
    } catch {
      const runtimeSupabase = getSupabaseAdmin();
      await runtimeSupabase
        .from(TABLES.classes)
        .update({ notification_status: "failed" })
        .eq("id", classRow.id);
    } finally {
      classNotificationTimers.delete(classRow.id);
    }
  }, msUntilNotification);

  classNotificationTimers.set(classRow.id, timer);
}

async function findConflicts(classStartAt: string, classEndAt: string, excludeClassId?: number) {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from(TABLES.classes)
    .select("id,class_name,teacher_name,class_start_at,class_end_at")
    .lt("class_start_at", classEndAt)
    .gt("class_end_at", classStartAt)
    .order("class_start_at", { ascending: true })
    .limit(10);

  if (excludeClassId) {
    query = query.neq("id", excludeClassId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

async function syncTimetableClasses(daysAhead: number = 7) {
  const supabase = getSupabaseAdmin();
  const now = new Date();
  const startWindow = new Date(now);
  startWindow.setHours(0, 0, 0, 0);
  const endWindow = new Date(startWindow);
  endWindow.setDate(endWindow.getDate() + daysAhead);
  endWindow.setHours(23, 59, 59, 999);

  const [{ data: teachers, error: teachersError }, { data: ttRows, error: ttError }, { data: existing, error: existingError }] = await Promise.all([
    supabase.from(TABLES.teachers).select("teacher_id,teacher_name"),
    supabase.from(TABLES.teacherTimetable).select("teacher_id,day_of_week,start_time,end_time,course_code,course_title"),
    supabase
      .from(TABLES.classes)
      .select("teacher_unique_id,class_name,class_start_at,class_end_at")
      .gte("class_start_at", startWindow.toISOString())
      .lte("class_start_at", endWindow.toISOString()),
  ]);

  if (teachersError) throw new Error(teachersError.message);
  if (ttError) throw new Error(ttError.message);
  if (existingError) throw new Error(existingError.message);

  const teacherMap = new Map<string, string>();
  (teachers as TeacherRow[] | null | undefined)?.forEach((teacher) => {
    teacherMap.set(teacher.teacher_id, teacher.teacher_name);
  });

  const existingKeys = new Set<string>();
  (existing ?? []).forEach((row) => {
    existingKeys.add(`${row.teacher_unique_id}|${row.class_name}|${row.class_start_at}|${row.class_end_at}`);
  });

  const inserts: Array<Record<string, string | number>> = [];
  const ttList = (ttRows as TimetableRow[] | null | undefined) ?? [];

  for (let offset = 0; offset <= daysAhead; offset += 1) {
    const date = new Date(startWindow);
    date.setDate(startWindow.getDate() + offset);
    const dayNames = ["SUN", "MON", "TUES", "WED", "THUR", "FRI", "SAT"];
    const dayName = dayNames[date.getDay()];

    for (const row of ttList) {
      if (row.day_of_week !== dayName) continue;
      const teacherName = teacherMap.get(row.teacher_id);
      if (!teacherName) continue;

      const startTime = String(row.start_time).slice(0, 5);
      const endTime = String(row.end_time).slice(0, 5);
      const { start, end } = buildClassDateTimes(date, startTime, endTime);
      if (end.getTime() <= now.getTime()) continue;

      const className = `${row.course_code} - ${row.course_title}`;
      const key = `${row.teacher_id}|${className}|${start.toISOString()}|${end.toISOString()}`;
      if (existingKeys.has(key)) continue;

      existingKeys.add(key);
      inserts.push({
        teacher_name: teacherName,
        teacher_unique_id: row.teacher_id,
        class_name: className,
        duration_minutes: Math.max(1, Math.floor((end.getTime() - start.getTime()) / 60000)),
        class_time: startTime,
        class_start_at: start.toISOString(),
        class_end_at: end.toISOString(),
        notification_status: "pending",
      });
    }
  }

  if (inserts.length === 0) {
    return;
  }

  const { data: inserted, error: insertError } = await supabase
    .from(TABLES.classes)
    .insert(inserts)
    .select("id,teacher_name,teacher_unique_id,class_name,duration_minutes,class_time,class_start_at,class_end_at,notification_status,notification_scheduled_for");

  if (insertError) {
    throw new Error(insertError.message);
  }

  for (const row of (inserted as ClassRow[] | null | undefined) ?? []) {
    await scheduleNotificationForClass(row);
  }
}

export async function POST(req: Request) {
  const supabaseAdmin = getSupabaseAdmin();
  const body = (await req.json()) as CreateClassBody;
  const loggedInTeacherId = await getTeacherSessionId();

  const className = normalizeText(String(body.className ?? ""));
  const durationMinutes = Number(body.durationMinutes);
  const classTime = normalizeText(String(body.classTime ?? ""));
  const classStartAt = normalizeText(String(body.classStartAt ?? ""));
  const classEndAt = normalizeText(String(body.classEndAt ?? ""));

  if (!loggedInTeacherId) {
    return NextResponse.json({ error: "Unauthorized teacher session." }, { status: 401 });
  }

  const { data: teacherRow, error: teacherError } = await supabaseAdmin
    .from(TABLES.teachers)
    .select("teacher_name,teacher_id")
    .eq("teacher_id", loggedInTeacherId)
    .maybeSingle();

  if (teacherError) {
    return NextResponse.json({ error: teacherError.message }, { status: 500 });
  }

  if (!teacherRow) {
    return NextResponse.json({ error: "Teacher not allowed to schedule classes." }, { status: 403 });
  }

  if (!className || !Number.isFinite(durationMinutes) || durationMinutes <= 0 || !classTime) {
    return NextResponse.json(
      { error: "Class name, duration, and time are required." },
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

  const conflicts = await findConflicts(classStartAt, classEndAt);
  if (conflicts.length > 0) {
    return NextResponse.json(
      {
        error: "Another class is already scheduled in this time window.",
        conflicts,
      },
      { status: 409 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from(TABLES.classes)
    .insert({
      teacher_name: String(teacherRow.teacher_name),
      teacher_unique_id: String(teacherRow.teacher_id),
      class_name: className,
      duration_minutes: durationMinutes,
      class_time: classTime,
      class_start_at: classStartAt,
      class_end_at: classEndAt,
      notification_status: "pending",
    })
    .select("id,teacher_name,teacher_unique_id,class_name,duration_minutes,class_time,class_start_at,class_end_at,notification_status,notification_scheduled_for")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await scheduleNotificationForClass(data as ClassRow);

  return NextResponse.json({
    message: "Class created successfully.",
    classId: data.id,
    classStartAt,
    classEndAt,
  });
}

export async function GET(req: Request) {
  const supabaseAdmin = getSupabaseAdmin();
  const url = new URL(req.url);
  const onlyUpcoming = url.searchParams.get("upcoming") === "1";
  const checkConflict = url.searchParams.get("checkConflict") === "1";
  const classStartAt = String(url.searchParams.get("classStartAt") || "").trim();
  const classEndAt = String(url.searchParams.get("classEndAt") || "").trim();

  if (checkConflict) {
    if (!classStartAt || !classEndAt) {
      return NextResponse.json({ conflicts: [] });
    }

    try {
      const conflicts = await findConflicts(classStartAt, classEndAt);
      return NextResponse.json({ conflicts });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Conflict check failed." }, { status: 500 });
    }
  }

  try {
    await syncTimetableClasses(7);
  } catch {
    // Continue returning classes even if auto-sync fails.
  }

  const nowIso = new Date().toISOString();

  let query = supabaseAdmin
    .from(TABLES.classes)
    .select(
      "id,teacher_name,teacher_unique_id,class_name,duration_minutes,class_time,class_start_at,class_end_at,created_at"
    )
    .order("class_start_at", { ascending: true })
    .limit(300);

  if (onlyUpcoming) {
    query = query.gte("class_end_at", nowIso);
  }

  const { data, error } = await query;
  if (error) {
    const mapped = mapBackendError(error, "Unable to load classes.");
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }

  return NextResponse.json({ classes: data ?? [] });
}

export async function DELETE(req: Request) {
  const supabase = getSupabaseAdmin();
  const loggedInTeacherId = await getTeacherSessionId();
  if (!loggedInTeacherId) {
    return NextResponse.json({ error: "Unauthorized teacher session." }, { status: 401 });
  }

  const url = new URL(req.url);
  const classId = Number(url.searchParams.get("id") || "");
  if (!Number.isInteger(classId) || classId <= 0) {
    return NextResponse.json({ error: "Valid class id is required." }, { status: 400 });
  }

  const { data: classRow, error: classError } = await supabase
    .from(TABLES.classes)
    .select("id,teacher_name,teacher_unique_id,class_name,duration_minutes,class_time,class_start_at,class_end_at")
    .eq("id", classId)
    .maybeSingle();

  if (classError) {
    return NextResponse.json({ error: classError.message }, { status: 500 });
  }

  if (!classRow) {
    return NextResponse.json({ error: "Class not found." }, { status: 404 });
  }

  if (String(classRow.teacher_unique_id) !== loggedInTeacherId) {
    return NextResponse.json({ error: "You can cancel only your own classes." }, { status: 403 });
  }

  const timer = classNotificationTimers.get(classId);
  if (timer) {
    clearTimeout(timer);
    classNotificationTimers.delete(classId);
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  let cancellationNotification: NotificationResult | null = null;
  if (botToken) {
    try {
      cancellationNotification = await notifyStudentsClassCancelled({
        botToken,
        className: String(classRow.class_name),
        teacherName: String(classRow.teacher_name),
        classStartAt: String(classRow.class_start_at),
        classEndAt: String(classRow.class_end_at),
      });
    } catch {
      cancellationNotification = null;
    }
  }

  const { error: deleteError } = await supabase.from(TABLES.classes).delete().eq("id", classId);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({
    message: "Class cancelled successfully.",
    cancellationNotification,
  });
}
