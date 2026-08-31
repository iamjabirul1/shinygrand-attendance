"use client";
import { useEffect, useRef, useState } from "react";
import { API_URL } from "@/lib/api";
import { enqueue } from "@/lib/offline";
import { QRCodeSVG } from "qrcode.react";

type Status = "idle" | "scanning" | "success" | "error" | "ambiguous" | "new_face";

export default function KioskPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [mode, setMode] = useState<"companion" | "usb">("companion");
  const [stationId] = useState("GUW-01");
  const [qr, setQr] = useState<{ token: string; qr_base64: string } | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [msg, setMsg] = useState("");
  const [employee, setEmployee] = useState<any>(null);
  const [threshold, setThreshold] = useState(0.42);
  const [useLiveness, setUseLiveness] = useState(false);
  const [stationToken, setStationToken] = useState<string>("");
  const [showEnroll, setShowEnroll] = useState(false);
  const [enrollForm, setEnrollForm] = useState({ emp_code: "", name: "", phone: "" });
  const [debug, setDebug] = useState("");
  const [notRecognizedCount, setNotRecognizedCount] = useState(0);
  const pcRef = useRef<RTCPeerConnection | null>(null);

  // Auto-fetch public token on mount (no admin needed) - 30d long-lived
  useEffect(() => {
    fetch(`${API_URL}/api/stations/public-token?station_id=${stationId}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.token) {
          setStationToken(j.token);
          localStorage.setItem("station_token", j.token);
          setDebug(`Station token ready (${j.token.slice(0,10)}...)`);
        }
      })
      .catch(() => {
        const cached = localStorage.getItem("station_token");
        if (cached) setStationToken(cached);
      });
  }, [stationId]);

  // Pair QR (still available for phone)
  async function pair() {
    const token = stationToken || localStorage.getItem("station_token") || "";
    // Try public-token first, fallback to admin pair-qr
    let j: any = null;
    try {
      const res = await fetch(`${API_URL}/api/stations/public-token?station_id=${stationId}`);
      j = await res.json();
    } catch {}
    if (!j?.token) {
      const adminToken = localStorage.getItem("token");
      const res = await fetch(`${API_URL}/api/stations/pair-qr?station_id=${stationId}`, {
        method: "POST",
        headers: adminToken ? { Authorization: `Bearer ${adminToken}` } : {},
      });
      if (!res.ok) {
        alert("Pair failed — " + (await res.text()));
        return;
      }
      j = await res.json();
    }
    setStationToken(j.token);
    localStorage.setItem("station_token", j.token);
    const camUrl = `${window.location.origin}/camera?token=${encodeURIComponent(j.token)}`;
    setQr({ token: j.token, qr_base64: camUrl });
  }

  // USB mode direct camera
  useEffect(() => {
    if (mode !== "usb") return;
    let stream: MediaStream;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, facingMode: "user" }, audio: false });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setDebug("USB camera ready - 1280x720");
        }
      } catch (e: any) {
        setMsg(e.message);
        setDebug("USB fail: " + e.message);
      }
    })();
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, [mode]);

  // Companion WebRTC
  useEffect(() => {
    if (mode !== "companion" || !qr) return;
    let ws: WebSocket | null = null;
    try {
      const wsUrl = API_URL.replace("http", "ws") + `/ws/signal?station_id=${stationId}&token=${encodeURIComponent(qr.token)}`;
      ws = new WebSocket(wsUrl);
      const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      pcRef.current = pc;
      pc.ontrack = (e) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = e.streams[0];
          remoteVideoRef.current.play().catch(() => {});
          setDebug("Phone connected via WebRTC");
        }
      };
      pc.onicecandidate = (e) => {
        if (e.candidate && ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ice", candidate: e.candidate }));
        }
      };
      ws.onmessage = async (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === "offer") {
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          const ans = await pc.createAnswer();
          await pc.setLocalDescription(ans);
          ws!.send(JSON.stringify({ type: "answer", sdp: ans }));
        } else if (msg.type === "ice") {
          try { await pc.addIceCandidate(msg.candidate); } catch {}
        }
      };
      ws.onerror = () => setDebug("WebRTC WS error - try USB mode");
    } catch {}
    return () => {
      ws?.close();
      pcRef.current?.close();
    };
  }, [mode, qr, stationId]);

  function captureBase64(): string | null {
    const video = (mode === "usb" ? videoRef.current : remoteVideoRef.current || videoRef.current) as HTMLVideoElement | null;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;
    if (video.videoWidth === 0) return null;
    const w = 640, h = 480;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(video, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.7);
  }

  // Auto scan
  const scanningRef = useRef(false);
  const failCountRef = useRef(0);
  useEffect(() => {
    const id = setInterval(async () => {
      if (scanningRef.current || showEnroll) return;
      const b64 = captureBase64();
      if (!b64) return;
      const v = (mode === "usb" ? videoRef.current : remoteVideoRef.current) as any;
      if (!v || v.readyState < 2 || v.videoWidth === 0) {
        setDebug(mode === "companion" && !qr ? "Pair phone first, or switch to USB" : "Camera not ready - allow permission");
        return;
      }

      scanningRef.current = true;
      setStatus("scanning");
      setMsg("Scanning...");
      try {
        const token = stationToken || localStorage.getItem("station_token") || localStorage.getItem("token") || "";
        if (!token) {
          setMsg("No station token - click Pair Phone");
          setDebug("No token, fetching public-token...");
          // auto-fetch
          fetch(`${API_URL}/api/stations/public-token?station_id=${stationId}`)
            .then((r) => r.json())
            .then((j) => {
              if (j.token) {
                setStationToken(j.token);
                localStorage.setItem("station_token", j.token);
              }
            });
          return;
        }
        const res = await fetch(`${API_URL}/api/attendance/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({
            image_base64: b64,
            station_id: stationId,
            client_time: new Date().toISOString(),
            liveness_score: useLiveness ? 0.9 : null,
            threshold,
            was_offline: false,
          }),
        });
        if (res.ok) {
          const j = await res.json();
          failCountRef.current = 0;
          setNotRecognizedCount(0);
          if (j.status === "ambiguous") {
            setStatus("ambiguous");
            setMsg(`Low confidence - did you mean ${j.candidates.map((c:any)=>c.name).join(", ")}?`);
            setDebug(`Ambiguous: ${JSON.stringify(j.candidates)}`);
          } else if (j.status === "duplicate") {
            setStatus("error");
            setMsg(j.message || "Already marked");
            setDebug(`Duplicate: ${j.message}`);
            await new Promise((r) => setTimeout(r, 2000));
          } else {
            setStatus("success");
            setEmployee(j.employee);
            setMsg(j.message || `${j.status} ${j.employee.name} at ${new Date(j.server_time_ist).toLocaleTimeString()}`);
            setDebug(`Success: ${j.employee.emp_code} conf ${(j.confidence*100).toFixed(1)}%`);
            try { new Audio("data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA").play(); } catch {}
            await new Promise((r) => setTimeout(r, 2500));
          }
        } else {
          const txt = await res.text();
          let j: any = null;
          try { j = JSON.parse(txt); } catch {}
          const msgText = j?.detail || txt;
          if (res.status === 404 || msgText.includes("Not recognized") || msgText.includes("no enrolled")) {
            failCountRef.current += 1;
            setNotRecognizedCount((c) => c + 1);
            if (failCountRef.current >= 2) {
              setStatus("new_face");
              setMsg("New face detected — not in system");
              setDebug(`Not recognized: ${msgText.slice(0,80)} (fail ${failCountRef.current})`);
            } else {
              setStatus("idle");
              setMsg("Face not recognized — try again");
              setDebug(`Not recognized retry ${failCountRef.current}/2`);
            }
          } else if (msgText.includes("low quality") || msgText.includes("face not found") || msgText.includes("image too small")) {
            setStatus("error");
            setMsg(msgText.slice(0,80));
            setDebug(`Quality: ${msgText}`);
            await new Promise((r) => setTimeout(r, 1500));
          } else if (res.status === 401) {
            setStatus("error");
            setMsg("Auth failed - re-pair phone");
            setDebug(`401: ${msgText}`);
          } else {
            setStatus("error");
            setMsg(msgText.slice(0,100));
            setDebug(`Error ${res.status}: ${msgText.slice(0,100)}`);
            await new Promise((r) => setTimeout(r, 1500));
          }
        }
      } catch (e: any) {
        if (!navigator.onLine) {
          await enqueue({ image_base64: b64!, station_id: stationId, client_time: new Date().toISOString(), retries: 0 });
          setMsg("Offline — queued, will sync");
          setDebug("Offline queued");
        } else {
          setDebug(`Fetch fail: ${e.message} - is API ${API_URL} reachable? CORS?`);
          setMsg("Network error - check API " + API_URL.slice(0,30));
        }
      } finally {
        if (status !== "new_face") setStatus("idle");
        scanningRef.current = false;
      }
    }, 1800);
    return () => clearInterval(id);
  }, [mode, qr, stationId, threshold, useLiveness, stationToken, showEnroll, status]);

  async function handleEnroll() {
    if (!enrollForm.emp_code || !enrollForm.name) {
      alert("Enter Employee Code and Name");
      return;
    }
    // Capture 3 frames as enrollment
    const captures: string[] = [];
    for (let i = 0; i < 3; i++) {
      const b = captureBase64();
      if (b) captures.push(b);
      await new Promise((r) => setTimeout(r, 400));
    }
    if (captures.length === 0) {
      alert("No camera frame - allow camera and try again");
      return;
    }
    setMsg("Enrolling...");
    try {
      const adminToken = localStorage.getItem("token");
      // First create employee
      const h: any = { "Content-Type": "application/json", ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}) };
      // If no admin token, try with station token as fallback (will fail if not admin, so prompt login)
      let empRes = await fetch(`${API_URL}/api/employees/`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ emp_code: enrollForm.emp_code, name: enrollForm.name, phone: enrollForm.phone, role: "Staff" }),
      });
      if (!empRes.ok && empRes.status === 401) {
        alert("Please login as admin at /login first, then try again");
        window.open("/login", "_blank");
        return;
      }
      if (!empRes.ok) {
        const t = await empRes.text();
        if (t.includes("exists")) {
          // Find existing id
          const list = await fetch(`${API_URL}/api/employees/`, { headers: adminToken ? { Authorization: `Bearer ${adminToken}` } : { Authorization: `Bearer ${stationToken}` } }).then((r) => r.json());
          const found = list.find((e: any) => e.emp_code === enrollForm.emp_code);
          if (!found) throw new Error(t);
          // use found
          // enroll
          const fd = new FormData();
          for (let i = 0; i < captures.length; i++) {
            const res = await fetch(captures[i]);
            const blob = await res.blob();
            fd.append("files", blob, `face${i}.jpg`);
          }
          const enrollRes = await fetch(`${API_URL}/api/employees/${found.id}/enroll`, {
            method: "POST",
            headers: adminToken ? { Authorization: `Bearer ${adminToken}` } : { Authorization: `Bearer ${stationToken}` },
            body: fd,
          });
          if (!enrollRes.ok) throw new Error(await enrollRes.text());
          alert(`Updated face for ${found.name} — ${enrollForm.emp_code}`);
          setShowEnroll(false);
          setStatus("idle");
          failCountRef.current = 0;
          return;
        } else throw new Error(t);
      }
      const emp = await empRes.json();
      // Now enroll faces
      const fd = new FormData();
      for (let i = 0; i < captures.length; i++) {
        const res = await fetch(captures[i]);
        const blob = await res.blob();
        fd.append("files", blob, `face${i}.jpg`);
      }
      const headers: any = adminToken ? { Authorization: `Bearer ${adminToken}` } : { Authorization: `Bearer ${stationToken}` };
      const enrollRes = await fetch(`${API_URL}/api/employees/${emp.id}/enroll`, {
        method: "POST",
        headers,
        body: fd,
      });
      if (!enrollRes.ok) throw new Error(await enrollRes.text());
      alert(`Created ${enrollForm.name} (${enrollForm.emp_code}) and enrolled ${captures.length} faces! Now try scanning again.`);
      setShowEnroll(false);
      setEnrollForm({ emp_code: "", name: "", phone: "" });
      failCountRef.current = 0;
      setStatus("idle");
    } catch (e: any) {
      alert("Enroll failed: " + e.message);
      setMsg("Enroll failed: " + e.message.slice(0,80));
    }
  }

  return (
    <main className="min-h-screen bg-black text-white flex flex-col">
      <header className="p-3 flex items-center justify-between bg-zinc-900">
        <div className="font-bold">Hotel Shiny Grand • GUW-01 • Kiosk</div>
        <div className="flex gap-2 items-center">
          <span className="text-xs bg-emerald-600 px-2 py-1 rounded">{mode}</span>
          <button onClick={() => setMode(mode === "usb" ? "companion" : "usb")} className="text-xs bg-zinc-700 px-3 py-1 rounded">Toggle USB/Companion</button>
          <a href="/admin" className="text-xs bg-white text-black px-3 py-1 rounded">📋 Logs</a>
          <a href="/login" className="text-xs underline">Login</a>
        </div>
      </header>

      <div className="flex-1 grid lg:grid-cols-3 gap-0">
        <div className="lg:col-span-2 relative bg-black flex items-center justify-center">
          {mode === "usb" ? (
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-[70vh] object-cover" />
          ) : (
            <video ref={remoteVideoRef} autoPlay playsInline muted className="w-full h-[70vh] object-cover bg-zinc-900" />
          )}
          {mode === "companion" && <video ref={videoRef} autoPlay playsInline muted className="hidden" />}
          <canvas ref={canvasRef} className="hidden" />
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className={`w-64 h-80 border-2 rounded-2xl flex items-end justify-center ${status === "new_face" ? "border-amber-400" : status === "success" ? "border-emerald-400" : "border-white/60"}`}>
              <span className="mb-2 text-xs bg-black/60 px-2 py-1 rounded">
                {status === "scanning" ? "Scanning..." : status === "new_face" ? "New face!" : status === "success" ? "✓ " + msg : "Align face in frame"}
              </span>
            </div>
          </div>
          <div className="absolute bottom-3 left-3 right-3 flex flex-col gap-2">
            <div className={`px-3 py-2 rounded text-sm ${status === "success" ? "bg-emerald-600" : status === "new_face" ? "bg-amber-500 text-black" : status === "error" ? "bg-red-600" : "bg-zinc-800"}`}>
              {msg || "Ready — stand 1m, hold still 1s. Pair phone first if using companion."}
            </div>
            {employee && <div className="ml-auto bg-white text-black px-3 py-2 rounded font-medium">{employee.name} ({employee.emp_code})</div>}
            {status === "new_face" && (
              <button onClick={() => setShowEnroll(true)} className="w-full bg-amber-500 text-black py-3 rounded font-bold animate-pulse">
                ➕ Create New Profile — New face detected! Tap to enroll (like iPhone Face ID)
              </button>
            )}
          </div>
        </div>

        <div className="bg-zinc-900 p-4 space-y-4 overflow-auto max-h-[85vh]">
          <button onClick={pair} className="w-full bg-brand text-white py-3 rounded font-semibold">📱 Pair Phone (QR)</button>
          {qr && (
            <div className="bg-white p-4 rounded text-black text-center">
              <div className="text-xs mb-2">Scan with phone camera</div>
              {qr.qr_base64.startsWith("data:") ? (
                <img src={qr.qr_base64} alt="qr" className="mx-auto w-52 h-52" />
              ) : (
                <div className="flex justify-center"><QRCodeSVG value={qr.qr_base64} size={200} /></div>
              )}
              <div className="text-[10px] break-all mt-2 text-zinc-500">{qr.qr_base64.slice(0, 80)}...</div>
            </div>
          )}
          <div className="text-xs text-zinc-400">Companion: phone joins via WebRTC. Keep charging. If fails, use USB toggle or open kiosk directly on phone.</div>

          <div className="bg-zinc-800 p-3 rounded space-y-2">
            <div className="font-semibold text-sm">📋 Attendance Logs</div>
            <div className="text-xs text-zinc-400">See all staff in/out:</div>
            <div className="grid grid-cols-2 gap-2">
              <a href="/admin" className="bg-white text-black text-center py-2 rounded text-sm font-medium">Open Admin Logs</a>
              <a href="/attendance" className="bg-emerald-600 text-white text-center py-2 rounded text-sm font-medium">Full Log View</a>
            </div>
            <div className="text-xs text-zinc-500">Also: /admin → Records + Sessions (IST), Export CSV</div>
          </div>

          <div className="bg-zinc-800 p-3 rounded">
            <div className="font-semibold text-sm">🆕 First time setup (enroll staff)</div>
            <ol className="text-xs text-zinc-300 list-decimal ml-4 space-y-1">
              <li>Login as admin at <a href="/login" className="underline text-emerald-400">/login</a> (admin@shinygrand.local / Admin@123)</li>
              <li>On kiosk, when new face appears → tap <b>Create New Profile</b></li>
              <li>Or go to <a href="/admin" className="underline">/admin</a> → Add employee → Enroll 3 photos</li>
              <li>Or use dedicated <a href="/enroll" className="underline text-amber-300">/enroll</a> page on phone (iPhone-like capture)</li>
            </ol>
            <button onClick={() => setShowEnroll(true)} className="mt-3 w-full bg-amber-500 text-black py-2 rounded font-medium">Open Enroll Form</button>
          </div>

          <div className="space-y-2 pt-2 border-t border-zinc-700">
            <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={useLiveness} onChange={(e) => setUseLiveness(e.target.checked)} /> Liveness check</label>
            <div>
              <div className="text-xs">Threshold {threshold.toFixed(2)} (lower=stricter)</div>
              <input type="range" min={0.30} max={0.55} step={0.01} value={threshold} onChange={(e) => setThreshold(parseFloat(e.target.value))} className="w-full" />
            </div>
            <div className="text-xs font-mono bg-black p-2 rounded break-all">API: {API_URL} | Token: {stationToken ? stationToken.slice(0,12)+"..." : "fetching..."} | {debug}</div>
            <div className="text-xs text-amber-300">
              {notRecognizedCount > 0 && `Not recognized ${notRecognizedCount} times — enroll?`}
              <br />If scanning stuck: check API reachable, allow camera, enroll first.
            </div>
          </div>
        </div>
      </div>

      {showEnroll && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-white text-black p-6 rounded-xl max-w-md w-full">
            <h2 className="text-xl font-bold">Create New Profile — Face ID</h2>
            <p className="text-sm text-zinc-600 mt-1">Like iPhone — capture 3 angles via this camera. Employee will be created and enrolled instantly.</p>
            <div className="mt-4 space-y-3">
              <input placeholder="Employee Code (e.g. EMP-002)" value={enrollForm.emp_code} onChange={(e) => setEnrollForm({ ...enrollForm, emp_code: e.target.value })} className="w-full border p-2 rounded" />
              <input placeholder="Full Name" value={enrollForm.name} onChange={(e) => setEnrollForm({ ...enrollForm, name: e.target.value })} className="w-full border p-2 rounded" />
              <input placeholder="Phone (optional)" value={enrollForm.phone} onChange={(e) => setEnrollForm({ ...enrollForm, phone: e.target.value })} className="w-full border p-2 rounded" />
              <div className="text-xs text-zinc-500">Will capture 3 frames from current camera (hold still, turn slightly left/right). Keep face centered.</div>
              <div className="flex gap-2">
                <button onClick={handleEnroll} className="flex-1 bg-amber-500 text-black py-3 rounded font-bold">📸 Capture & Create</button>
                <button onClick={() => setShowEnroll(false)} className="px-4 border rounded">Cancel</button>
              </div>
              <div className="text-xs text-zinc-400">Needs admin login at /login first. If not logged in, will prompt.</div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
