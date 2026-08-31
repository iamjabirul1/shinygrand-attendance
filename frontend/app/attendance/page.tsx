"use client";
import { useEffect, useState } from "react";
import { API_URL, authHeaders } from "@/lib/api";

export default function AttendancePage() {
  const [records, setRecords] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [filter, setFilter] = useState("");

  async function load() {
    const h = authHeaders();
    if (!h.Authorization) {
      alert("Login first at /login");
      return;
    }
    const r = await fetch(`${API_URL}/api/attendance/?from_date=${date}&to_date=${date}`, { headers: h }).then((r) => r.json()).catch(() => []);
    setRecords(r);
    const s = await fetch(`${API_URL}/api/attendance/sessions?date=${date}`, { headers: h }).then((r) => r.json()).catch(() => []);
    setSessions(s);
  }
  useEffect(() => { load(); }, [date]);

  const filtered = records.filter((r) => !filter || r.employee?.name.toLowerCase().includes(filter.toLowerCase()) || r.employee?.emp_code.toLowerCase().includes(filter.toLowerCase()));

  return (
    <main className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-bold">Attendance Log — All Staff</h1>
      <p className="text-sm text-zinc-600">Every check-in/out for Hotel Shiny Grand • GUW-01 • IST. Use for payroll, audit, and daily review.</p>
      <div className="flex flex-wrap gap-2 mt-4">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border p-2 rounded" />
        <input placeholder="Filter by name or code" value={filter} onChange={(e) => setFilter(e.target.value)} className="border p-2 rounded flex-1 min-w-[200px]" />
        <button onClick={load} className="bg-zinc-900 text-white px-4 rounded">Refresh</button>
        <a href={`${API_URL}/api/attendance/export.csv?from_date=${date}&to_date=${date}`} target="_blank" className="bg-emerald-600 text-white px-4 py-2 rounded text-sm">Export CSV</a>
        <a href="/admin" className="ml-auto text-sm underline">Admin (enroll)</a>
        <a href="/kiosk" className="text-sm underline">Kiosk</a>
      </div>

      <div className="mt-6 grid md:grid-cols-2 gap-6">
        <div className="bg-white p-4 rounded shadow">
          <h2 className="font-semibold">Sessions Today ({sessions.length}) — In/Out + Duration</h2>
          <div className="overflow-auto max-h-[60vh] mt-2">
            <table className="w-full text-sm">
              <thead><tr className="text-zinc-500 text-xs"><th className="text-left p-2">Staff</th><th>In (IST)</th><th>Out</th><th>Min</th><th>Status</th></tr></thead>
              <tbody>
                {sessions.map((s: any) => (
                  <tr key={s.id} className="border-t hover:bg-zinc-50">
                    <td className="p-2 font-medium">{s.employee?.emp_code} {s.employee?.name}</td>
                    <td className="p-2">{new Date(s.check_in_ist).toLocaleTimeString()}</td>
                    <td className="p-2">{s.check_out_ist ? new Date(s.check_out_ist).toLocaleTimeString() : "—"}</td>
                    <td className="p-2">{s.duration_minutes ?? "—"}</td>
                    <td className="p-2"><span className={`px-2 py-1 rounded text-xs ${s.status === "open" ? "bg-amber-100" : "bg-emerald-100"}`}>{s.status}</span></td>
                  </tr>
                ))}
                {sessions.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-zinc-500">No sessions yet — mark attendance at /kiosk</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white p-4 rounded shadow">
          <h2 className="font-semibold">Raw Records ({filtered.length}) — every tap</h2>
          <div className="overflow-auto max-h-[60vh] mt-2">
            <table className="w-full text-xs">
              <thead><tr className="text-zinc-500"><th>Date</th><th>Staff</th><th>Type</th><th>IST Time</th><th>Conf</th></tr></thead>
              <tbody>
                {filtered.map((r: any) => (
                  <tr key={r.id} className="border-t hover:bg-zinc-50">
                    <td className="p-2">{r.date}</td>
                    <td className="p-2">{r.employee?.emp_code} {r.employee?.name}</td>
                    <td className="p-2"><span className={`px-2 py-1 rounded ${r.type === "check_in" ? "bg-blue-100" : "bg-orange-100"}`}>{r.type}</span></td>
                    <td className="p-2">{new Date(r.server_time_ist).toLocaleString()}</td>
                    <td className="p-2">{r.confidence?.toFixed(2)}</td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-zinc-500">No records for this date</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded text-sm">
        <b>Where to find logs?</b> This page <code>/attendance</code> and <code>/admin</code> both show the same data. Use date picker for any day, search by name, export CSV for payroll. Logs are server-time authoritative (IST), duplicate-blocked 60s, with audit trail for corrections.
      </div>
    </main>
  );
}
