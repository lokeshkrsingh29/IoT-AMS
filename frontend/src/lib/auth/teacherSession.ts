import { cookies } from "next/headers";

export const TEACHER_AUTH_COOKIE = "teacher_session";

export async function getTeacherSessionId() {
  const cookieStore = await cookies();
  return String(cookieStore.get(TEACHER_AUTH_COOKIE)?.value || "").trim();
}
