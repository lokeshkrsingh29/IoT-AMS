"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type ScheduledClass = {
  id: number;
  class_name: string;
  teacher_name: string;
  class_start_at: string;
  class_end_at: string;
};

function formatCountdown(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function Home() {
  const [classes, setClasses] = useState<ScheduledClass[]>([]);
  const [studentsCount, setStudentsCount] = useState(0);
  const [attendanceCount, setAttendanceCount] = useState(0);
  const [nowMs, setNowMs] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const run = async () => {
      const [classesRes, studentsRes, attendanceRes] = await Promise.all([
        fetch("/api/classes?upcoming=1"),
        fetch("/api/students"),
        fetch("/api/attendance"),
      ]);

      const classesJson = await classesRes.json();
      const studentsJson = await studentsRes.json();
      const attendanceJson = await attendanceRes.json();

      if (classesRes.ok) setClasses((classesJson.classes || []) as ScheduledClass[]);
      if (studentsRes.ok) setStudentsCount((studentsJson.students || []).length);
      if (attendanceRes.ok) setAttendanceCount((attendanceJson.attendance || []).length);
    };

    void run();
  }, []);

  const nextClass = useMemo(() => {
    const upcoming = classes
      .filter((item) => new Date(item.class_start_at).getTime() > nowMs)
      .sort((a, b) => new Date(a.class_start_at).getTime() - new Date(b.class_start_at).getTime());
    return upcoming[0] ?? null;
  }, [classes, nowMs]);

  return (
    <main className="mx-auto max-w-7xl p-4 md:p-8">
      <section className="rounded-3xl border border-white/10 bg-gradient-to-r from-[#0f1b32] via-[#0b1528] to-[#08111f] p-6 shadow-2xl md:p-10">
        <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Face Recognition Suite</p>
        <h1 className="mt-3 text-3xl font-bold md:text-5xl">Teacher Operations Dashboard</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted md:text-base">
          Professional workspace for class scheduling, student onboarding, live attendance control, and records.
        </p>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <p className="text-xs text-muted">Students</p>
            <p className="mt-1 text-3xl font-semibold">{studentsCount}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <p className="text-xs text-muted">Upcoming Classes</p>
            <p className="mt-1 text-3xl font-semibold">{classes.length}</p>
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
