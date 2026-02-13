import { NextResponse } from "next/server";
import { getSupabaseAdmin, TABLES } from "@/lib/supabaseAdmin";

export async function GET() {
  const supabaseAdmin = getSupabaseAdmin();

  const { data: students, error: studentsError } = await supabaseAdmin
    .from(TABLES.students)
    .select("reg_number,name,profile_photo_url")
    .order("registered_date", { ascending: false });

  if (studentsError) {
    return NextResponse.json({ error: studentsError.message }, { status: 500 });
  }

  const { data: photos, error: photosError } = await supabaseAdmin
    .from(TABLES.photos)
    .select("reg_number,photo_url,photo_no")
    .order("photo_no", { ascending: true });

  if (photosError) {
    return NextResponse.json({ error: photosError.message }, { status: 500 });
  }

  const photoMap = new Map<string, string[]>();
  for (const row of photos ?? []) {
    const reg = String(row.reg_number);
    const url = String(row.photo_url || "").trim();
    if (!url) continue;
    const existing = photoMap.get(reg) || [];
    existing.push(url);
    photoMap.set(reg, existing);
  }

  const dataset = (students ?? []).map((student) => {
    const reg = String(student.reg_number);
    const urls = photoMap.get(reg) || [];
    if (urls.length === 0 && student.profile_photo_url) {
      urls.push(String(student.profile_photo_url));
    }
    return {
      reg_number: reg,
      name: String(student.name),
      photo_urls: urls.slice(0, 6),
    };
  });

  return NextResponse.json({ dataset });
}
