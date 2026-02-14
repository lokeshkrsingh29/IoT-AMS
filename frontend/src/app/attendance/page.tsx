"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Attendance = {
  attendance_date: string;
  reg_number: string;
  name: string;
  time: string;
  status: string;
};

export default function AttendancePage() {
  const [rows, setRows] = useState<Attendance[]>([]);

  useEffect(() => {
    const run = async () => {
      const res = await fetch("/api/attendance");
      const json = await res.json();
      if (res.ok) setRows((json.attendance || []) as Attendance[]);
    };
    void run();
  }, []);

  return (
    <main className="mx-auto max-w-7xl p-4 md:p-8">
      <section className="rounded-3xl border border-white/10 bg-gradient-to-r from-[#0f1b32] via-[#0a1324] to-[#091120] p-6 md:p-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Attendance Ops</p>
            <h1 className="mt-2 text-3xl font-bold">Attendance</h1>
          </div>
          <div className="flex gap-2">
            <Link href="/workspace" className="rounded-xl bg-cyan-400/20 px-4 py-2 text-sm text-cyan-100">Open Live Attendance Workspace</Link>
            <Link href="/" className="rounded-xl bg-white/10 px-4 py-2 text-sm">Back</Link>
          </div>
        </div>
      </section>

      <section className="mt-4 rounded-2xl glass p-5 overflow-auto">
        <h2 className="text-xl font-semibold">Attendance Records</h2>
        <table className="mt-3 w-full text-sm">
          <thead className="text-muted">
            <tr>
              <th className="py-2 text-left">Date</th>
              <th className="py-2 text-left">Reg No</th>
              <th className="py-2 text-left">Name</th>
              <th className="py-2 text-left">Time</th>
              <th className="py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={`${row.reg_number}-${row.attendance_date}-${idx}`} className="border-t border-white/10">
                <td className="py-2">{row.attendance_date}</td>
                <td className="py-2 font-mono">{row.reg_number}</td>
                <td className="py-2">{row.name}</td>
                <td className="py-2">{row.time}</td>
                <td className="py-2">{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
