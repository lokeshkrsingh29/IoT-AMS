import { NextResponse } from "next/server";
import { getSupabaseAdmin, mapBackendError, TABLES } from "@/lib/supabaseAdmin";
import { getTeacherSessionId } from "@/lib/auth/teacherSession";

export async function GET() {
  const teacherId = await getTeacherSessionId();
  if (!teacherId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from(TABLES.teachers)
      .select("teacher_name,teacher_id")
      .eq("teacher_id", teacherId)
      .maybeSingle();

    if (error) {
      const mapped = mapBackendError(error, "Unable to validate teacher session.");
      return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }

    if (!data) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json({ teacher: data });
  } catch (error) {
    const mapped = mapBackendError(error, "Unable to validate teacher session.");
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
