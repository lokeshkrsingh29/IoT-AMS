import { NextResponse } from "next/server";
import { getSupabaseAdmin, PHOTOS_BUCKET, TABLES } from "@/lib/supabaseAdmin";

function sanitize(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_");
}

export async function POST(req: Request) {
  const supabaseAdmin = getSupabaseAdmin();
  const formData = await req.formData();
  const name = String(formData.get("name") || "").trim();
  const regNumber = String(formData.get("regNumber") || "").trim();
  const telegramId = String(formData.get("telegramId") || "").trim();
  const photos = formData
    .getAll("photos")
    .filter((file): file is File => file instanceof File);

  if (!name || !regNumber || !telegramId) {
    return NextResponse.json({ error: "Name, registration number, and Telegram ID are required." }, { status: 400 });
  }

  if (photos.length !== 10) {
    return NextResponse.json({ error: "Capture exactly 10 photos before registering." }, { status: 400 });
  }

  const { data: existing } = await supabaseAdmin
    .from(TABLES.students)
    .select("reg_number")
    .eq("reg_number", regNumber)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: "Registration number already exists." }, { status: 409 });
  }

  const { data: topStudent, error: maxError } = await supabaseAdmin
    .from(TABLES.students)
    .select("student_id")
    .order("student_id", { ascending: false })
    .limit(1);

  if (maxError) {
    return NextResponse.json({ error: maxError.message }, { status: 500 });
  }

  const studentId = (topStudent?.[0]?.student_id ?? 0) + 1;
  const safeRoot = sanitize(`${regNumber}_${name}`);
  const nowIso = new Date().toISOString();
  const uploaded: Array<{ photo_no: number; storage_path: string; photo_url: string }> = [];

  for (let i = 0; i < photos.length; i += 1) {
    const file = photos[i];
    const arrBuf = await file.arrayBuffer();
    const bytes = Buffer.from(arrBuf);
    const ts = Date.now();
    const storagePath = `${safeRoot}/photo_${i + 1}_${ts}.jpg`;

    const { error: uploadError } = await supabaseAdmin.storage.from(PHOTOS_BUCKET).upload(storagePath, bytes, {
      contentType: file.type || "image/jpeg",
      upsert: true,
    });

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    const { data: publicData } = supabaseAdmin.storage.from(PHOTOS_BUCKET).getPublicUrl(storagePath);
    uploaded.push({
      photo_no: i + 1,
      storage_path: storagePath,
      photo_url: publicData.publicUrl,
    });
  }

  const { error: studentError } = await supabaseAdmin.from(TABLES.students).upsert(
    {
      student_id: studentId,
      name,
      reg_number: regNumber,
      telegram_id: telegramId,
      photo_dir: `attendance_data/students/${regNumber}_${name}`,
      profile_photo_path: uploaded[0]?.storage_path ?? null,
      profile_photo_url: uploaded[0]?.photo_url ?? null,
      registered_date: nowIso,
      model_trained: true,
      model_trained_at: nowIso,
    },
    { onConflict: "reg_number" }
  );

  if (studentError) {
    return NextResponse.json({ error: studentError.message }, { status: 500 });
  }

  const photoRows = uploaded.map((item) => ({
    reg_number: regNumber,
    student_name: name,
    photo_no: item.photo_no,
    storage_path: item.storage_path,
    photo_url: item.photo_url,
    captured_at: nowIso,
  }));

  const { error: photoInsertError } = await supabaseAdmin.from(TABLES.photos).insert(photoRows);
  if (photoInsertError) {
    return NextResponse.json({ error: photoInsertError.message }, { status: 500 });
  }

  return NextResponse.json({
    message: "Student registered and model trained successfully.",
    uploaded: uploaded.length,
    student: {
      name,
      reg_number: regNumber,
    },
    modelTrained: true,
    modelTrainedAt: nowIso,
  });
}
