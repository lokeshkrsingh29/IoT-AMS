import { NextResponse } from "next/server";
import { getSupabaseAdmin, TABLES } from "@/lib/supabaseAdmin";

export async function GET() {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from(TABLES.students)
    .select("student_id,name,reg_number,telegram_id,registered_date,model_trained,model_trained_at,profile_photo_url")
    .order("registered_date", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ students: data ?? [] });
}
