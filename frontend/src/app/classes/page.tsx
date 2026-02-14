"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

type ScheduledClass = {
  id: number;
  teacher_name: string;
  teacher_unique_id: string;
  class_name: string;
  duration_minutes: number;
  class_time: string;
  class_start_at: string;
  class_end_at: string;
};

type ProcessStep = {
  key: string;
  label: string;
  status: "pending" | "active" | "done" | "error";
  detail?: string;
};

function buildInitial(start: Date, end: Date): ProcessStep[] {
  return [
    { key: "window", label: "Compute class window", status: "done", detail: `Start ${start.toLocaleString()}, End ${end.toLocaleString()}` },
    { key: "db", label: "Save class in database", status: "active" },
    { key: "telegram", label: "Schedule Telegram reminders", status: "pending" },
    { key: "camera", label: "Set camera automation", status: "pending" },
  ];
}

function computeWindow(classTime: string, durationMinutes: number) {
  const [h, m] = classTime.split(":").map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m)) throw new Error("Invalid class time.");

  const now = new Date();
  const start = new Date(now);
  start.setHours(h, m, 0, 0);
  if (start.getTime() <= now.getTime()) start.setDate(start.getDate() + 1);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  return { start, end };
}

export default function ClassesPage() {
  const [teacherName, setTeacherName] = useState("");
  const [teacherUniqueId, setTeacherUniqueId] = useState("");
  const [className, setClassName] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [classTime, setClassTime] = useState("");
  const [classes, setClasses] = useState<ScheduledClass[]>([]);
  const [creating, setCreating] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [steps, setSteps] = useState<ProcessStep[]>([]);
  const [notice, setNotice] = useState("");
  const [nowMs, setNowMs] = useState(0);

  async function loadClasses() {
    const res = await fetch("/api/classes?upcoming=1");
    const json = await res.json();
    if (res.ok) setClasses((json.classes || []) as ScheduledClass[]);
  }

  useEffect(() => {
    const boot = window.setTimeout(() => {
      void loadClasses();
    }, 0);
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => {
      window.clearTimeout(boot);
      window.clearInterval(timer);
    };
  }, []);

  const nextClass = useMemo(() => {
    const list = classes
      .filter((item) => new Date(item.class_start_at).getTime() > nowMs)
      .sort((a, b) => new Date(a.class_start_at).getTime() - new Date(b.class_start_at).getTime());
    return list[0] ?? null;
  }, [classes, nowMs]);

  function updateStep(key: string, status: ProcessStep["status"], detail?: string) {
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, status, detail: detail ?? s.detail } : s)));
  }

  async function createClass(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!classTime) {
      setNotice("Please select class time.");
      return;
    }

    const { start, end } = computeWindow(classTime, durationMinutes);
    setSteps(buildInitial(start, end));
    setShowModal(true);
    setCreating(true);

    const res = await fetch("/api/classes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teacherName,
        teacherUniqueId,
        className,
        durationMinutes,
        classTime,
        classStartAt: start.toISOString(),
        classEndAt: end.toISOString(),
      }),
    });

    const json = await res.json();
    if (!res.ok) {
      updateStep("db", "error", json.error || "DB save failed.");
      setNotice(json.error || "Class creation failed.");
      setCreating(false);
      return;
    }

    updateStep("db", "done", "Class saved");
    if (json.notificationAction === "sent_now") {
      updateStep("telegram", "done", `Reminder sent now to ${json.notificationResult?.sent ?? 0}/${json.notificationResult?.total ?? 0}`);
    } else if (json.notificationAction === "scheduled") {
      const when = json.notificationScheduledFor ? new Date(String(json.notificationScheduledFor)).toLocaleString() : "30 minutes before class";
      updateStep("telegram", "done", `Reminder scheduled for ${when}`);
    } else {
      updateStep("telegram", "error", "TELEGRAM_BOT_TOKEN not configured");
    }

    updateStep("camera", "done", `Auto start ${start.toLocaleString()} / stop ${end.toLocaleString()}`);
    setNotice("Class created successfully.");

    setTeacherName("");
    setTeacherUniqueId("");
    setClassName("");
    setDurationMinutes(60);
    setClassTime("");
    await loadClasses();
    setCreating(false);
  }

  return (
    <main className="mx-auto max-w-7xl p-4 md:p-8">
      {showModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-3xl border border-white/15 bg-[#0b1426] p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Class Creation Process</h2>
              <button type="button" onClick={() => setShowModal(false)} className="rounded-lg border border-white/15 px-3 py-1 text-xs text-muted">Close</button>
            </div>
            <ul className="mt-4 space-y-2">
              {steps.map((s) => (
                <li key={s.key} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">{s.label}</span>
                    <span className={`rounded-md px-2 py-1 text-xs ${s.status === "done" ? "bg-emerald-500/20 text-emerald-300" : s.status === "active" ? "bg-cyan-500/20 text-cyan-200" : s.status === "error" ? "bg-rose-500/20 text-rose-300" : "bg-white/10 text-slate-300"}`}>{s.status}</span>
                  </div>
                  {s.detail ? <p className="mt-1 text-xs text-muted">{s.detail}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <section className="rounded-3xl border border-white/10 bg-gradient-to-r from-[#0f1b32] via-[#0a1324] to-[#091120] p-6 md:p-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Scheduling</p>
            <h1 className="mt-2 text-3xl font-bold">Classes</h1>
          </div>
          <Link href="/" className="rounded-xl bg-white/10 px-4 py-2 text-sm">Back</Link>
        </div>
        <p className="mt-2 text-sm text-muted">Create class windows and monitor upcoming sessions across all teachers.</p>
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <article className="rounded-2xl glass p-5">
          <h2 className="text-xl font-semibold">New Class</h2>
          <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={createClass}>
            <input className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 outline-none focus:border-cyan-300" placeholder="Teacher Name" value={teacherName} onChange={(e) => setTeacherName(e.target.value)} required />
            <input className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 outline-none focus:border-cyan-300" placeholder="Teacher Unique ID" value={teacherUniqueId} onChange={(e) => setTeacherUniqueId(e.target.value)} required />
            <input className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 outline-none focus:border-cyan-300" placeholder="Class Name" value={className} onChange={(e) => setClassName(e.target.value)} required />
            <input type="number" min={1} step={1} className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 outline-none focus:border-cyan-300" placeholder="Duration (minutes)" value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value))} required />
            <input type="time" className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 outline-none focus:border-cyan-300" value={classTime} onChange={(e) => setClassTime(e.target.value)} required />
            <button type="submit" disabled={creating} className="w-full rounded-xl bg-emerald-500/20 px-3 py-2 text-emerald-200 disabled:opacity-40">{creating ? "Creating..." : "Create Class"}</button>
          </form>
          {notice ? <p className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-muted">{notice}</p> : null}
        </article>

        <article className="rounded-2xl glass p-5">
          <h2 className="text-xl font-semibold">Next Class</h2>
          {nextClass ? (
            <div className="mt-3 rounded-xl border border-cyan-300/20 bg-cyan-400/10 p-4">
              <p className="text-sm text-cyan-100">{nextClass.class_name} by {nextClass.teacher_name}</p>
              <p className="mt-1 text-xs text-cyan-100/80">{new Date(nextClass.class_start_at).toLocaleString()}</p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">No upcoming classes.</p>
          )}
        </article>
      </section>

      <section className="mt-4 rounded-2xl glass p-5 overflow-auto">
        <h2 className="text-xl font-semibold">Upcoming Queue</h2>
        <table className="mt-3 w-full text-sm">
          <thead className="text-muted">
            <tr>
              <th className="py-2 text-left">Class</th>
              <th className="py-2 text-left">Teacher</th>
              <th className="py-2 text-left">Teacher ID</th>
              <th className="py-2 text-left">Start</th>
              <th className="py-2 text-left">End</th>
            </tr>
          </thead>
          <tbody>
            {classes.map((item) => (
              <tr key={item.id} className="border-t border-white/10">
                <td className="py-2">{item.class_name}</td>
                <td className="py-2">{item.teacher_name}</td>
                <td className="py-2 font-mono">{item.teacher_unique_id}</td>
                <td className="py-2">{new Date(item.class_start_at).toLocaleString()}</td>
                <td className="py-2">{new Date(item.class_end_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
