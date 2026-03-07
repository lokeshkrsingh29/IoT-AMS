import { createClient } from "@supabase/supabase-js";

export const TABLES = {
  students: process.env.SUPABASE_STUDENTS_TABLE || "students",
  attendance: process.env.SUPABASE_ATTENDANCE_TABLE || "attendance",
  photos: process.env.SUPABASE_STUDENT_PHOTOS_TABLE || "student_photos",
  classes: process.env.SUPABASE_CLASSES_TABLE || "classes",
  teachers: process.env.SUPABASE_TEACHERS_TABLE || "teachers",
  teacherTimetable: process.env.SUPABASE_TEACHER_TIMETABLE_TABLE || "teacher_timetable",
};

export const PHOTOS_BUCKET = process.env.SUPABASE_PHOTOS_BUCKET || "student-photos";

export function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY)");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

type ServerErrorShape = {
  status: number;
  message: string;
};

export function mapBackendError(error: unknown, fallbackMessage: string): ServerErrorShape {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : "";
  const message = rawMessage.trim();
  const lower = message.toLowerCase();

  if (!message) {
    return { status: 500, message: fallbackMessage };
  }

  if (
    lower.includes("fetch failed") ||
    lower.includes("getaddrinfo") ||
    lower.includes("enotfound") ||
    lower.includes("dns")
  ) {
    return {
      status: 503,
      message: "Database service is unreachable. Check SUPABASE_URL, network, and DNS settings.",
    };
  }

  if (lower.includes("missing supabase_url") || lower.includes("supabase_service_role_key")) {
    return {
      status: 500,
      message: "Supabase configuration is missing. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    };
  }

  return { status: 500, message };
}
