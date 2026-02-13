import { createClient } from "@supabase/supabase-js";

export const TABLES = {
  students: process.env.SUPABASE_STUDENTS_TABLE || "students",
  attendance: process.env.SUPABASE_ATTENDANCE_TABLE || "attendance",
  photos: process.env.SUPABASE_STUDENT_PHOTOS_TABLE || "student_photos",
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
