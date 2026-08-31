"use client";
import { useEffect, useRef, useState } from "react";
import { API_URL, authHeaders } from "@/lib/api";
import { loadFaceModels, getDescriptorFromVideo } from "@/lib/face";

export default function EnrollPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState({ emp_code: "", name: "", phone: "" });
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    let s: MediaStream;
    (async () => {
      try {
        setMsg("Loading face model (12MB)...");
        await loadFaceModels();
        s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 1280 }, audio: false });
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          await videoRef.current.play();
          setMsg("Model ready — center face, good light");
        }
      } catch (e: any) {
        setMsg("Camera/model fail: " + e.message + " - need HTTPS and permission");
      }
    })();
    return () => s?.getTracks().forEach((t) => t.stop());
  }, []);

  function capture(): string | null {
    const v = videoRef.current, c = canvasRef.current;
    if (!v || !c || v.videoWidth === 0) return null;
    c.width = 640; c.height = 480;
    c.getContext("2d")!.drawImage(v, 0, 0, 640, 480);
    return c.toDataURL("image/jpeg", 0.8);
  }

  async function doEnroll() {
    if (!form.emp_code || !form.name) {
      alert("Enter code and name");
      return;
    }
    const token = localStorage.getItem("token");
    if (!token) {
      alert("Login as admin at /login first");
      window.open("/login", "_blank");
      return;
    }
    // Guided capture like iPhone: 3 steps — now using browser FaceNet 128-d (cloud accurate, no Docker)
    const prompts = ["Face forward - hold still", "Turn slightly LEFT", "Turn slightly RIGHT"];
    const embeddings: number[][] = [];
    for (let i = 0; i < 3; i++) {
      setMsg(prompts[i] + ` (${i + 1}/3)`);
      for (let c = 3; c > 0; c--) {
        setCountdown(c);
        await new Promise((r) => setTimeout(r, 700));
      }
      setCountdown(0);
      const v = videoRef.current;
      if (!v || v.videoWidth === 0) {
        alert("No camera frame - check permission");
        return;
      }
      setMsg(`Capturing ${i + 1}/3 - detecting face...`);
      const desc = await getDescriptorFromVideo(v);
      if (!desc) {
        alert(`No face detected in step ${i + 1} - center face, good light, try again`);
        setMsg(`Failed step ${i + 1} - no face, retry`);
        return;
      }
      embeddings.push(desc);
      setMsg(`Captured ${i + 1}/3 ✓`);
      await new Promise((r) => setTimeout(r, 400));
    }

    try {
      setMsg("Creating employee...");
      let h: any = { "Content-Type": "application/json", ...authHeaders() };
      let empRes = await fetch(`${API_URL}/api/employees/`, { method: "POST", headers: h, body: JSON.stringify({ emp_code: form.emp_code, name: form.name, phone: form.phone, role: "Staff" }) });
      let emp: any;
      if (!empRes.ok) {
        const t = await empRes.text();
        if (t.includes("exists") || t.includes("Signature has expired")) {
          if (t.includes("expired")) {
            localStorage.removeItem("token");
            alert("Session expired — please login again at /login, then retry enroll");
            window.open("/login", "_blank");
            return;
          }
          const list = await fetch(`${API_URL}/api/employees/`, { headers: authHeaders() as any }).then((r) => r.json());
          emp = list.find((e: any) => e.emp_code === form.emp_code);
          if (!emp) throw new Error(t);
          setMsg("Employee exists, updating face (browser FaceNet)...");
        } else throw new Error(t);
      } else {
        emp = await empRes.json();
      }

      setMsg("Uploading 128-d embeddings (cloud)...");
      const enrollRes = await fetch(`${API_URL}/api/employees/${emp.id}/enroll-embedding`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() } as any,
        body: JSON.stringify({ embeddings, quality_scores: [0.9, 0.9, 0.9] }),
      });
      if (!enrollRes.ok) {
        const t = await enrollRes.text();
        if (t.includes("expired")) {
          localStorage.removeItem("token");
          alert("Session expired — login again at /login");
          window.open("/login", "_blank");
          return;
        }
        throw new Error(t);
      }
      const j = await enrollRes.json();
      setMsg(`Done! Enrolled ${j.enrolled} faces (128-d) for ${form.name}. Now test at /kiosk`);
      alert(`Success! ${form.name} enrolled with browser FaceNet (cloud, no Docker, very accurate). Go to /kiosk and scan.`);
    } catch (e: any) {
      if (e.message.includes("expired")) {
        localStorage.removeItem("token");
        alert("Session expired — please login again at /login");
        window.open("/login", "_blank");
      } else {
        setMsg("Failed: " + e.message);
        alert(e.message);
      }
    }
  }

  return (
    <main className="max-w-xl mx-auto p-6">
      <h1 className="text-2xl font-bold">Enroll Staff — iPhone-like Face ID</h1>
      <p className="text-sm text-zinc-600">First time scan for each staff. Use phone camera — like creating Face ID on iPhone. Captures 3 angles automatically.</p>

      <div className="mt-4 relative bg-black rounded-xl overflow-hidden">
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-[50vh] object-cover" />
        <canvas ref={canvasRef} className="hidden" />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-56 h-72 border-2 border-white/70 rounded-3xl flex items-center justify-center">
            {countdown > 0 && <span className="text-6xl font-bold text-white drop-shadow">{countdown}</span>}
          </div>
        </div>
        <div className="absolute bottom-2 left-2 right-2 bg-black/60 text-white text-sm p-2 rounded text-center">{msg || "Center face, good light, then tap Enroll"}</div>
      </div>

      <div className="mt-4 space-y-3 bg-white p-4 rounded shadow">
        <input placeholder="Employee Code (EMP-002)" value={form.emp_code} onChange={(e) => setForm({ ...form, emp_code: e.target.value })} className="w-full border p-2 rounded" />
        <input placeholder="Full Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border p-2 rounded" />
        <input placeholder="Phone (optional)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full border p-2 rounded" />
        <button onClick={doEnroll} className="w-full bg-amber-500 text-black py-3 rounded font-bold">📸 Start 3-step Capture & Enroll</button>
        <div className="text-xs text-zinc-500">Tip: Open this page on the phone you use as camera — captures straight from phone. Or use on PC with USB webcam. Needs admin login.</div>
        <div className="flex gap-2 text-sm">
          <a href="/kiosk" className="underline">Back to Kiosk</a>
          <a href="/admin" className="underline ml-auto">Admin logs</a>
          <a href="/attendance" className="underline">Attendance log</a>
        </div>
      </div>

      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded text-sm">
        <b>How first-time scan works:</b>
        <ol className="list-decimal ml-5 space-y-1 mt-2">
          <li>Login at <a href="/login" className="underline">/login</a> as admin</li>
          <li>Open <b>/enroll</b> on phone (this page) — grant camera</li>
          <li>Enter code+name → tap Enroll → follow 3 prompts (forward, left, right)</li>
          <li>Now that staff can walk to <b>/kiosk</b> → face → auto logs <b>check-in</b> → later same face → <b>check-out</b> + duration (IST, 60s duplicate guard)</li>
        </ol>
      </div>
    </main>
  );
}
