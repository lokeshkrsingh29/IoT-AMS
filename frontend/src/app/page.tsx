"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Teacher = {
  teacher_name: string;
  teacher_id: string;
};

export default function LoginPage() {
  const router = useRouter();
  const [teacherId, setTeacherId] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [teachers, setTeachers] = useState<Teacher[]>([]);

  useEffect(() => {
    const boot = async () => {
      const [sessionRes, teachersRes] = await Promise.all([
        fetch("/api/teacher-session", { cache: "no-store" }),
        fetch("/api/teachers", { cache: "no-store" }),
      ]);

      if (sessionRes.ok) {
        router.push("/dashboard");
        return;
      }

      if (teachersRes.ok) {
        const json = await teachersRes.json();
        setTeachers((json.teachers || []) as Teacher[]);
      }
    };

    void boot();
  }, [router]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setNotice("");

    const res = await fetch("/api/teacher-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teacherId, password }),
    });

    const json = await res.json();
    if (!res.ok) {
      setNotice(json.error || "Login failed.");
      setLoading(false);
      return;
    }

    router.push("/dashboard");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl items-center justify-center p-4 md:p-8">
      <section className="grid w-full gap-4 rounded-3xl border border-white/10 bg-[#081121]/80 p-6 backdrop-blur md:grid-cols-[1fr_1.1fr] md:p-8">
        <article className="rounded-2xl border border-cyan-300/20 bg-cyan-400/10 p-5">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-200">6th Sem CSE (IoT)</p>
          <h1 className="mt-2 text-2xl font-bold">Teacher Access Login</h1>
          <p className="mt-2 text-sm text-cyan-100/80">
            Only timetable-listed teachers can login and create classes.
          </p>
          <ul className="mt-4 space-y-2 text-sm text-cyan-100">
            {teachers.map((teacher) => (
              <li key={teacher.teacher_id} className="rounded-lg border border-cyan-200/20 bg-black/20 px-3 py-2">
                {teacher.teacher_name} <span className="font-mono text-cyan-200">({teacher.teacher_id})</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="rounded-2xl glass p-5">
          <h2 className="text-xl font-semibold">Sign In</h2>
          <form className="mt-4 space-y-3" onSubmit={onSubmit}>
            <input
              className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 font-mono outline-none focus:border-cyan-300"
              placeholder="Teacher ID"
              value={teacherId}
              onChange={(e) => setTeacherId(e.target.value)}
              required
            />
            <input
              type="password"
              className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 font-mono outline-none focus:border-cyan-300"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-emerald-500/25 px-3 py-2 text-emerald-200 disabled:opacity-40"
            >
              {loading ? "Signing in..." : "Login"}
            </button>
          </form>
          {notice ? <p className="mt-3 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-200">{notice}</p> : null}
        </article>
      </section>
    </main>
  );
}
