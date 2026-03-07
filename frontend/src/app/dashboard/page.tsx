"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type ScheduledClass = {
  id: number;
  class_name: string;
  teacher_name: string;
  class_start_at: string;
  class_end_at: string;
};

type TeacherSession = {
  teacher_name: string;
  teacher_id: string;
};

type TimetableRow = {
  day_of_week: string;
  start_time: string;
  end_time: string;
  course_code: string;
  course_title: string;
};

type UpcomingFromTimetable = {
  class_name: string;
  class_start_at: string;
  class_end_at: string;
};

const dayOrder: Record<string, number> = {
  MON: 1,
  TUES: 2,
  WED: 3,
  THUR: 4,
  FRI: 5,
  SAT: 6,
};

function formatCountdown(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function Home() {
  const router = useRouter();
  const [teacher, setTeacher] = useState<TeacherSession | null>(null);
  const [classes, setClasses] = useState<ScheduledClass[]>([]);
  const [timetable, setTimetable] = useState<TimetableRow[]>([]);
  const [studentsCount, setStudentsCount] = useState(0);
  const [attendanceCount, setAttendanceCount] = useState(0);
  const [nowMs, setNowMs] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const weekEndMs = useMemo(() => nowMs + 7 * 24 * 60 * 60 * 1000, [nowMs]);

  useEffect(() => {
    const run = async () => {
      const [sessionRes, classesRes, studentsRes, attendanceRes, timetableRes] = await Promise.all([
        fetch("/api/teacher-session", { cache: "no-store" }),
        fetch("/api/classes?upcoming=1"),
        fetch("/api/students"),
        fetch("/api/attendance"),
        fetch("/api/teacher-timetable", { cache: "no-store" }),
      ]);

      const sessionJson = await sessionRes.json();
      const classesJson = await classesRes.json();
      const studentsJson = await studentsRes.json();
      const attendanceJson = await attendanceRes.json();
      const timetableJson = await timetableRes.json();

      if (sessionRes.ok) {
        setTeacher(sessionJson.teacher as TeacherSession);
      }

      if (classesRes.ok) setClasses((classesJson.classes || []) as ScheduledClass[]);
      if (studentsRes.ok) setStudentsCount((studentsJson.students || []).length);
      if (attendanceRes.ok) setAttendanceCount((attendanceJson.attendance || []).length);
      if (timetableRes.ok) {
        const rows = (timetableJson.timetable || []) as TimetableRow[];
        rows.sort((a, b) => {
          const dayA = dayOrder[a.day_of_week] ?? 99;
          const dayB = dayOrder[b.day_of_week] ?? 99;
          if (dayA !== dayB) return dayA - dayB;
          return a.start_time.localeCompare(b.start_time);
        });
        setTimetable(rows);
      }
    };

    void run();
  }, []);

  const weeklyClasses = useMemo(() => {
    return classes
      .filter((item) => (teacher ? item.teacher_name === teacher.teacher_name : true))
      .filter((item) => {
        const startMs = new Date(item.class_start_at).getTime();
        return startMs >= nowMs && startMs <= weekEndMs;
      })
      .sort((a, b) => new Date(a.class_start_at).getTime() - new Date(b.class_start_at).getTime());
  }, [classes, nowMs, teacher, weekEndMs]);

  const weeklyFromTimetable = useMemo(() => {
    const dayMap: Record<string, number> = {
      SUN: 0,
      MON: 1,
      TUES: 2,
      WED: 3,
      THUR: 4,
      FRI: 5,
      SAT: 6,
    };
    const now = new Date(nowMs);
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const rows: UpcomingFromTimetable[] = [];

    for (let d = 0; d <= 7; d += 1) {
      const date = new Date(startOfToday);
      date.setDate(startOfToday.getDate() + d);
      const dow = date.getDay();

      for (const slot of timetable) {
        if ((dayMap[slot.day_of_week] ?? -1) !== dow) continue;
        const [sh, sm] = slot.start_time.slice(0, 5).split(":").map(Number);
        const [eh, em] = slot.end_time.slice(0, 5).split(":").map(Number);
        const start = new Date(date);
        const end = new Date(date);
        start.setHours(sh, sm, 0, 0);
        end.setHours(eh, em, 0, 0);
        if (end.getTime() <= start.getTime()) end.setDate(end.getDate() + 1);
        if (start.getTime() < nowMs || start.getTime() > weekEndMs) continue;

        rows.push({
          class_name: `${slot.course_code} - ${slot.course_title}`,
          class_start_at: start.toISOString(),
          class_end_at: end.toISOString(),
        });
      }
    }

    rows.sort((a, b) => new Date(a.class_start_at).getTime() - new Date(b.class_start_at).getTime());
    return rows;
  }, [timetable, nowMs, weekEndMs]);

  const effectiveUpcomingCount = weeklyClasses.length > 0 ? weeklyClasses.length : weeklyFromTimetable.length;
  const nextClass = useMemo(() => {
    if (weeklyClasses[0]) return weeklyClasses[0];
    if (weeklyFromTimetable[0]) {
      return {
        id: -1,
        class_name: weeklyFromTimetable[0].class_name,
        teacher_name: teacher?.teacher_name || "Teacher",
        class_start_at: weeklyFromTimetable[0].class_start_at,
        class_end_at: weeklyFromTimetable[0].class_end_at,
      } satisfies ScheduledClass;
    }
    return null;
  }, [weeklyClasses, weeklyFromTimetable, teacher]);

  async function logout() {
    await fetch("/api/teacher-logout", { method: "POST" });
    router.push("/");
  }

  return (
    <main className="mx-auto max-w-7xl p-4 md:p-8">
      <section className="rounded-3xl border border-white/10 bg-gradient-to-r from-[#0f1b32] via-[#0b1528] to-[#08111f] p-6 shadow-2xl md:p-10">
        <div className="flex items-start justify-between gap-4">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Face Recognition Suite</p>
          <button
            type="button"
            onClick={logout}
            className="rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-xs"
          >
            Logout
          </button>
        </div>
        <h1 className="mt-3 text-3xl font-bold md:text-5xl">Teacher Operations Dashboard</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted md:text-base">
          Professional workspace for class scheduling, student onboarding, live attendance control, and records.
        </p>
        {teacher ? (
          <p className="mt-2 text-sm text-cyan-200">
            Logged in as {teacher.teacher_name} ({teacher.teacher_id})
          </p>
        ) : null}

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <p className="text-xs text-muted">Students</p>
            <p className="mt-1 text-3xl font-semibold">{studentsCount}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <p className="text-xs text-muted">My Upcoming Classes</p>
            <p className="mt-1 text-3xl font-semibold">{effectiveUpcomingCount}</p>
            <p className="mt-1 text-xs text-muted">Next 7 days</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <p className="text-xs text-muted">Attendance Rows</p>
            <p className="mt-1 text-3xl font-semibold">{attendanceCount}</p>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-cyan-300/20 bg-cyan-400/10 p-4">
          {nextClass ? (
            <>
              <p className="text-sm text-cyan-100">
                Next class: <span className="font-semibold">{nextClass.class_name}</span> by {nextClass.teacher_name}
              </p>
              <p className="mt-1 font-mono text-2xl text-cyan-200">
                starts in {formatCountdown(new Date(nextClass.class_start_at).getTime() - nowMs)}
              </p>
              <p className="mt-1 text-xs text-cyan-100/80">
                {new Date(nextClass.class_start_at).toLocaleString()} to {new Date(nextClass.class_end_at).toLocaleString()}
              </p>
            </>
          ) : (
            <p className="text-sm text-cyan-100">No upcoming class currently scheduled.</p>
          )}
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-sm font-semibold">My Weekly Timetable</p>
          {timetable.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No timetable rows found for this teacher.</p>
          ) : (
            <div className="mt-3 overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-muted">
                  <tr>
                    <th className="py-2 text-left">Day</th>
                    <th className="py-2 text-left">Time</th>
                    <th className="py-2 text-left">Course</th>
                    <th className="py-2 text-left">Title</th>
                  </tr>
                </thead>
                <tbody>
                  {timetable.map((row, idx) => (
                    <tr key={`${row.day_of_week}-${row.start_time}-${row.course_code}-${idx}`} className="border-t border-white/10">
                      <td className="py-2">{row.day_of_week}</td>
                      <td className="py-2 font-mono">{row.start_time.slice(0, 5)}-{row.end_time.slice(0, 5)}</td>
                      <td className="py-2">{row.course_code}</td>
                      <td className="py-2">{row.course_title}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Link href="/classes" className="rounded-2xl glass p-5 transition hover:-translate-y-0.5">
          <p className="text-xs text-muted">Scheduling</p>
          <h2 className="mt-1 text-xl font-semibold">Classes</h2>
          <p className="mt-1 text-sm text-muted">Create class with process popup and auto scheduling.</p>
        </Link>
        <Link href="/students" className="rounded-2xl glass p-5 transition hover:-translate-y-0.5">
          <p className="text-xs text-muted">Onboarding</p>
          <h2 className="mt-1 text-xl font-semibold">Students</h2>
          <p className="mt-1 text-sm text-muted">Register students and maintain directory.</p>
        </Link>
        <Link href="/attendance" className="rounded-2xl glass p-5 transition hover:-translate-y-0.5">
          <p className="text-xs text-muted">Operations</p>
          <h2 className="mt-1 text-xl font-semibold">Attendance</h2>
          <p className="mt-1 text-sm text-muted">Review marked attendance records.</p>
        </Link>
        <Link href="/workspace" className="rounded-2xl glass p-5 transition hover:-translate-y-0.5">
          <p className="text-xs text-muted">Advanced</p>
          <h2 className="mt-1 text-xl font-semibold">Live Workspace</h2>
          <p className="mt-1 text-sm text-muted">Full camera and recognition console.</p>
        </Link>
      </section>
    </main>
  );
}
