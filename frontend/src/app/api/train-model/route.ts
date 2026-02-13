import { NextResponse } from "next/server";
import { getSupabaseAdmin, TABLES } from "@/lib/supabaseAdmin";

export async function POST() {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from(TABLES.students)
    .select("reg_number,model_trained");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data || data.length === 0) {
    return NextResponse.json({ error: "No students registered to train." }, { status: 400 });
  }

  const untrained = data
    .filter((row) => !row.model_trained)
    .map((row) => String(row.reg_number));

  if (untrained.length === 0) {
    return NextResponse.json({ error: "Model has already been trained for all students." }, { status: 409 });
  }

  const nowIso = new Date().toISOString();
  const { error: updateError } = await supabaseAdmin
    .from(TABLES.students)
    .update({ model_trained: true, model_trained_at: nowIso })
    .in("reg_number", untrained);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({
    message: "Model trained successfully.",
    trainedStudents: untrained.length,
  });
}
