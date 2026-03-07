import { NextResponse } from "next/server";
import { getSupabaseAdmin, TABLES } from "@/lib/supabaseAdmin";
import { getTeacherSessionId } from "@/lib/auth/teacherSession";

export async function GET() {
  const teacherId = await getTeacherSessionId();
  if (!teacherId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from(TABLES.teacherTimetable)
    .select("day_of_week,start_time,end_time,course_code,course_title")
    .eq("teacher_id", teacherId)
    .order("start_time", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ timetable: data ?? [] });
}
