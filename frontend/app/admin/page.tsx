"use client";
import { useEffect, useState } from "react";
import { API_URL, authHeaders } from "@/lib/api";

export default function AdminPage() {
  const [emps, setEmps] = useState<any[]>([]);
  const [records, setRecords] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [form, setForm] = useState({ emp_code: "", name: "", phone: "", role: "" });
  const [date, setDate] = useState(new Date().toISOString().slice(0,10));

  async function load() {
    const h = authHeaders();
    if (!h.Authorization) { alert("Login first at /login"); return; }
    const e = await fetch(`${API_URL}/api/employees/`, { headers: h }).then(r=>r.json()).catch(()=>[]);
    setEmps(e);
    const r = await fetch(`${API_URL}/api/attendance/?from_date=${date}&to_date=${date}`, { headers: h }).then(r=>r.json()).catch(()=>[]);
    setRecords(r);
    const s = await fetch(`${API_URL}/api/attendance/sessions?date=${date}`, { headers: h }).then(r=>r.json()).catch(()=>[]);
    setSessions(s);
  }
  useEffect(()=>{ load(); }, [date]);

  async function createEmp() {
    const ah = authHeaders() as Record<string,string>;
    const h: Record<string,string> = { "Content-Type":"application/json", ...ah };
    const res = await fetch(`${API_URL}/api/employees/`, { method:"POST", headers: h, body: JSON.stringify(form) });
    if(!res.ok) alert(await res.text()); else { setForm({emp_code:"",name:"",phone:"",role:""}); load(); }
  }
  async function enroll(empId: string, files: FileList) {
    const h = authHeaders();
    const fd = new FormData();
    Array.from(files).forEach(f=>fd.append("files", f));
    const res = await fetch(`${API_URL}/api/employees/${empId}/enroll`, { method:"POST", headers: h as any, body: fd });
    alert(res.ok ? "Enrolled" : await res.text());
    load();
  }

  return (
    <main className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-bold">Admin — Hotel Shiny Grand</h1>
      <div className="flex gap-2 mt-4">
        <input type="date" value={date} onChange={e=>setDate(e.target.value)} className="border p-2 rounded" />
        <button onClick={load} className="bg-zinc-900 text-white px-4 rounded">Refresh</button>
        <a href={`${API_URL}/api/attendance/export.csv?from_date=${date}&to_date=${date}`} target="_blank" className="bg-emerald-600 text-white px-4 py-2 rounded text-sm">Export CSV</a>
        <a href="/kiosk" className="ml-auto underline">Open Kiosk</a>
      </div>

      <section className="mt-8 grid md:grid-cols-2 gap-6">
        <div className="bg-white p-4 rounded shadow">
          <h2 className="font-semibold">Employees ({emps.length})</h2>
          <div className="flex gap-2 mt-3">
            <input placeholder="EMP-001" value={form.emp_code} onChange={e=>setForm({...form, emp_code:e.target.value})} className="border p-1 rounded w-24 text-sm" />
            <input placeholder="Name" value={form.name} onChange={e=>setForm({...form, name:e.target.value})} className="border p-1 rounded flex-1 text-sm" />
            <input placeholder="Phone" value={form.phone} onChange={e=>setForm({...form, phone:e.target.value})} className="border p-1 rounded w-28 text-sm" />
            <button onClick={createEmp} className="bg-brand text-white px-3 rounded text-sm">Add</button>
          </div>
          <div className="mt-4 space-y-2 max-h-96 overflow-auto">
            {emps.map(emp=>(
              <div key={emp.id} className="border p-2 rounded flex items-center gap-2">
                <div className="flex-1">
                  <div className="font-medium text-sm">{emp.emp_code} — {emp.name}</div>
                  <div className="text-xs text-zinc-500">{emp.role} • embeddings: {emp.embeddings} • {emp.is_active?"active":"inactive"}</div>
                </div>
                <label className="text-xs bg-zinc-100 px-2 py-1 rounded cursor-pointer">Enroll<input type="file" multiple accept="image/*" className="hidden" onChange={e=>e.target.files && enroll(emp.id, e.target.files)} /></label>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white p-4 rounded shadow">
          <h2 className="font-semibold">Today Sessions (IST date {date})</h2>
          <div className="mt-3 overflow-auto max-h-96">
            <table className="w-full text-xs">
              <thead><tr className="text-zinc-500"><th className="text-left">Emp</th><th>In (IST)</th><th>Out</th><th>Dur</th><th>Status</th></tr></thead>
              <tbody>
                {sessions.map((s:any)=>(
                  <tr key={s.id} className="border-t"><td>{s.employee?.name}</td><td>{new Date(s.check_in_ist).toLocaleTimeString()}</td><td>{s.check_out_ist? new Date(s.check_out_ist).toLocaleTimeString(): "—"}</td><td>{s.duration_minutes ?? "—"}</td><td>{s.status}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mt-6 bg-white p-4 rounded shadow">
        <h2 className="font-semibold">Records ({records.length})</h2>
        <div className="overflow-auto max-h-80 mt-2">
          <table className="w-full text-xs">
            <thead><tr className="text-zinc-500"><th>Date</th><th>Emp</th><th>Type</th><th>IST Time</th><th>Conf</th><th>Station</th><th>Offline</th></tr></thead>
            <tbody>
              {records.map((r:any)=>(
                <tr key={r.id} className="border-t"><td>{r.date}</td><td>{r.employee?.name}</td><td>{r.type}</td><td>{new Date(r.server_time_ist).toLocaleString()}</td><td>{r.confidence?.toFixed(2)}</td><td>{r.station_id}</td><td>{r.was_offline?"yes":""}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="text-xs text-zinc-500 mt-6">Privacy: embeddings stored, raw crops deleted. Offer PIN fallback if staff declines face. DPDP notice required at enrollment.</p>
    </main>
  );
}
