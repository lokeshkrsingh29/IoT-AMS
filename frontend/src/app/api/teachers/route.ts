import { NextResponse } from "next/server";
import { getSupabaseAdmin, mapBackendError, TABLES } from "@/lib/supabaseAdmin";

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from(TABLES.teachers)
      .select("teacher_name,teacher_id")
      .order("teacher_name", { ascending: true });

    if (error) {
      const mapped = mapBackendError(error, "Unable to load teachers.");
      return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }

    return NextResponse.json({ teachers: data ?? [] });
  } catch (error) {
    const mapped = mapBackendError(error, "Unable to load teachers.");
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
