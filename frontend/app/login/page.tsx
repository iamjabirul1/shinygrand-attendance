"use client";
import { useState } from "react";
import { API_URL } from "@/lib/api";
export default function LoginPage() {
  const [email, setEmail] = useState("admin@shinygrand.local");
  const [pass, setPass] = useState("Admin@123");
  const [msg, setMsg] = useState("");
  async function login() {
    try {
      const res = await fetch(`${API_URL}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pass }) });
      if (!res.ok) throw new Error(await res.text());
      const j = await res.json();
      localStorage.setItem("token", j.access_token);
      setMsg("Logged in as " + j.role + " — now open /kiosk Pair or /admin");
    } catch (e: any) { setMsg(e.message); }
  }
  async function seed() {
    const res = await fetch(`${API_URL}/api/auth/seed`, { method: "POST" });
    setMsg(await res.text());
  }
  return (
    <main className="max-w-md mx-auto p-8">
      <h1 className="text-xl font-bold">Admin Login</h1>
      <div className="mt-4 space-y-3">
        <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="email" className="w-full border p-2 rounded" />
        <input value={pass} onChange={e=>setPass(e.target.value)} type="password" placeholder="password" className="w-full border p-2 rounded" />
        <button onClick={login} className="w-full bg-brand text-white py-2 rounded">Login</button>
        <button onClick={seed} className="w-full bg-zinc-200 py-2 rounded text-sm">Seed default admin (first time)</button>
        <div className="text-sm text-zinc-600 whitespace-pre-wrap">{msg}</div>
        <div className="text-xs text-zinc-500">Default: admin@shinygrand.local / Admin@123 — change after first login.</div>
      </div>
    </main>
  );
}
