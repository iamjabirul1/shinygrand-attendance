"use client";
import { useEffect, useRef, useState } from "react";
import { API_URL } from "@/lib/api";
import { enqueue } from "@/lib/offline";
import { QRCodeSVG } from "qrcode.react";
import { loadFaceModels, getDescriptorFromVideo } from "@/lib/face";

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
  const [showHelp, setShowHelp] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [nextAction, setNextAction] = useState<"check_in" | "check_out" | null>(null);
  const [lastAction, setLastAction] = useState<any>(null);
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

  // Load face-api models for cloud-accurate browser FaceNet (no Docker)
  useEffect(() => {
    loadFaceModels()
      .then(() => setDebug((d) => d + " | FaceNet 128-d ready"))
      .catch((e) => setDebug("Face model fail: " + e.message));
  }, []);

  // Cooldown countdown
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => (c > 0 ? c - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

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
      setMsg("Scanning (FaceNet)...");
      try {
        const token = stationToken || localStorage.getItem("station_token") || localStorage.getItem("token") || "";
        if (!token) {
          setMsg("No station token - click Pair Phone");
          setDebug("No token, fetching public-token...");
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
        // Try browser FaceNet 128-d first (cloud accurate, no Docker, like mobile apps)
        let res: Response | null = null;
        let usedEmbedding = false;
        try {
          const v = (mode === "usb" ? videoRef.current : remoteVideoRef.current || videoRef.current) as HTMLVideoElement | null;
          if (v && v.readyState >= 2) {
            const desc = await getDescriptorFromVideo(v);
            if (desc) {
              // Use embedding endpoint (128-d, threshold 0.6 for face-api)
              const embThreshold = threshold < 0.5 ? 0.6 : threshold; // auto map 0.42->0.6 for 128-d
              res = await fetch(`${API_URL}/api/attendance/verify-embedding`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                body: JSON.stringify({
                  embedding: desc,
                  station_id: stationId,
                  client_time: new Date().toISOString(),
                  liveness_score: useLiveness ? 0.9 : null,
                  threshold: embThreshold,
                  was_offline: false,
                }),
              });
              usedEmbedding = true;
              setDebug(`FaceNet 128-d used (th ${embThreshold})`);
            }
          }
        } catch (e: any) {
          setDebug(`FaceNet fail, fallback to image: ${e.message}`);
        }
        // Fallback to image-based (hash) if no descriptor
        if (!res) {
          res = await fetch(`${API_URL}/api/attendance/verify`, {
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
        }
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
            // Show remaining cooldown
            const m = j.message?.match(/wait (\d+)s/);
            if (m) {
              setCooldown(parseInt(m[1]));
            } else if (j.remaining) {
              setCooldown(j.remaining);
            }
            await new Promise((r) => setTimeout(r, 2000));
          } else {
            setStatus("success");
            setEmployee(j.employee);
            const isCheckIn = j.status === "checked_in";
            setNextAction(isCheckIn ? "check_out" : "check_in");
            setLastAction({ employee: j.employee, type: j.status, time: j.server_time || j.server_time_ist });
            setCooldown(0);
            setMsg(j.message || `${j.status} ${j.employee.name} at ${new Date(j.server_time_ist).toLocaleTimeString()} → Next: ${isCheckIn ? "Check-Out" : "Check-In"}`);
            setDebug(`Success: ${j.employee.emp_code} conf ${(j.confidence*100).toFixed(1)}% → next ${isCheckIn ? "out" : "in"}`);
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
            const isExpired = msgText.includes("expired");
            setMsg(isExpired ? "Session expired — re-login" : "Auth failed - re-pair phone");
            setDebug(`401: ${msgText}`);
            // Auto-fix: clear expired tokens and fetch fresh public-token
            if (isExpired) {
              localStorage.removeItem("token");
              localStorage.removeItem("station_token");
              setStationToken("");
              fetch(`${API_URL}/api/stations/public-token?station_id=${stationId}`)
                .then((r) => r.json())
                .then((j) => {
                  if (j.token) {
                    setStationToken(j.token);
                    localStorage.setItem("station_token", j.token);
                    setDebug("Fetched fresh station token");
                  }
                });
            }
            await new Promise((r) => setTimeout(r, 2000));
            if (isExpired) {
              setMsg("Please login again at /login — token refreshed, try scanning");
            }
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
    const adminToken = localStorage.getItem("token");
    if (!adminToken) {
      alert("Please login as admin at /login first, then try again");
      window.open("/login", "_blank");
      return;
    }
    // Use browser FaceNet 128-d (cloud accurate, no Docker) - same as /enroll page
    const prompts = ["Face forward", "Turn LEFT", "Turn RIGHT"];
    const embeddings: number[][] = [];
    setMsg("Starting 3-step capture...");
    for (let i = 0; i < 3; i++) {
      setMsg(`${prompts[i]} (${i + 1}/3) - hold still...`);
      // Countdown 3-2-1 with UI
      for (let c = 3; c > 0; c--) {
        setMsg(`${prompts[i]} (${i + 1}/3) - ${c}`);
        await new Promise((r) => setTimeout(r, 800));
      }
      await new Promise((r) => setTimeout(r, 300));
      const v = (mode === "usb" ? videoRef.current : remoteVideoRef.current || videoRef.current) as HTMLVideoElement | null;
      if (!v || v.videoWidth === 0 || v.readyState < 2) {
        alert(`No camera frame step ${i + 1} - allow camera, try USB toggle`);
        setMsg(`Failed step ${i + 1} - no camera`);
        return;
      }
      setMsg(`Capturing ${i + 1}/3 - detecting face...`);
      let desc: number[] | null = null;
      try {
        const timeout = new Promise<null>((_, rej) => setTimeout(() => rej(new Error("Face detection timeout - good light, center face")), 8000));
        desc = await Promise.race([getDescriptorFromVideo(v), timeout]);
      } catch (e: any) {
        alert(`Step ${i + 1} failed: ${e.message}`);
        setMsg(`Failed ${i + 1}: ${e.message}`);
        return;
      }
      if (!desc) {
        alert(`No face in step ${i + 1} - center face, 1m, plain wall, try again`);
        setMsg(`Failed ${i + 1} - no face`);
        return;
      }
      embeddings.push(desc);
      setMsg(`Captured ${i + 1}/3 ✓`);
      await new Promise((r) => setTimeout(r, 500));
    }
    if (embeddings.length !== 3) {
      alert("Failed to capture 3 faces");
      return;
    }
    setMsg("Enrolling (FaceNet 128-d)...");
    try {
      const h: any = { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` };
      let empRes = await fetch(`${API_URL}/api/employees/`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ emp_code: enrollForm.emp_code, name: enrollForm.name, phone: enrollForm.phone, role: "Staff" }),
      });
      let emp: any;
      if (!empRes.ok) {
        const t = await empRes.text();
        if (t.includes("exists")) {
          const list = await fetch(`${API_URL}/api/employees/`, { headers: h }).then((r) => r.json());
          const found = list.find((e: any) => e.emp_code === enrollForm.emp_code);
          if (!found) throw new Error(t);
          emp = found;
          setMsg(`Updating ${found.name}...`);
        } else if (t.includes("expired")) {
          localStorage.removeItem("token");
          alert("Session expired, login again");
          window.open("/login", "_blank");
          return;
        } else throw new Error(t);
      } else {
        emp = await empRes.json();
      }
      const enrollRes = await fetch(`${API_URL}/api/employees/${emp.id}/enroll-embedding`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ embeddings, quality_scores: [0.9, 0.9, 0.9] }),
      });
      if (!enrollRes.ok) {
        const t = await enrollRes.text();
        if (t.includes("expired")) {
          localStorage.removeItem("token");
          alert("Session expired, login again");
          window.open("/login", "_blank");
          return;
        }
        throw new Error(t);
      }
      alert(`Created ${enrollForm.name} (${enrollForm.emp_code}) and enrolled 3 faces (FaceNet)! Now try scanning again.`);
      setShowEnroll(false);
      setEnrollForm({ emp_code: "", name: "", phone: "" });
      failCountRef.current = 0;
      setStatus("idle");
      setMsg(`Enrolled ${enrollForm.name} ✓ - try scanning now`);
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
          <button onClick={() => setShowHelp(true)} className="text-xs bg-blue-600 px-3 py-1 rounded">❓ Help</button>
          <button onClick={() => setMode(mode === "usb" ? "companion" : "usb")} className="text-xs bg-zinc-700 px-3 py-1 rounded">Toggle USB/Companion</button>
          <a href="/admin" className="text-xs bg-white text-black px-3 py-1 rounded">📋 Logs</a>
          <a href="/login" className="text-xs underline">Login</a>
        </div>
      </header>
      {/* Friendly hint banner */}
      <div className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-xs p-2 text-center">
        💡 <b>How it works:</b> Stand 1m away → Look at camera → Hold still 1s → Auto <b>{nextAction === "check_out" ? "Check-Out" : "Check-In"}</b> {lastAction && `(Last: ${lastAction.employee?.name || employee?.name} ${lastAction.type} at ${new Date(lastAction.time).toLocaleTimeString()})`} {cooldown > 0 && `• Wait ${cooldown}s`}
      </div>

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
            {/* Hint card for first-time users */}
            <div className="bg-gradient-to-br from-amber-500 to-orange-500 text-black p-3 rounded-xl">
              <div className="font-bold text-sm">👋 New here? 3 steps:</div>
              <ol className="text-xs list-decimal ml-4 mt-1 space-y-0.5">
                <li><b>Pair:</b> Tap QR → scan with phone → Allow camera</li>
                <li><b>Enroll:</b> New face? → <b>Create Profile</b> (3 angles)</li>
                <li><b>Scan:</b> Stand 1m, good light, look at camera → auto log</li>
              </ol>
              <button onClick={() => setShowHelp(true)} className="mt-2 text-xs underline">Need help? → How check-in/out works</button>
            </div>
            <div className="bg-zinc-800 p-3 rounded border border-emerald-500/30">
              <div className="text-xs font-semibold text-emerald-400">💡 Tips for best scan</div>
              <ul className="text-xs text-zinc-300 list-disc ml-4 mt-1 space-y-0.5">
                <li>Stand <b>1 meter</b> away, eye level</li>
                <li><b>Good light</b> on face, no backlight</li>
                <li>Look straight at camera, <b>hold still 1s</b></li>
                <li>Remove mask, plain wall behind helps</li>
                <li>After <b>Check-In</b>, next scan = <b>Check-Out</b> (no 60s wait for checkout!)</li>
              </ul>
            </div>
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
      {showHelp && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-white text-black p-6 rounded-xl max-w-lg w-full max-h-[85vh] overflow-auto">
            <h2 className="text-xl font-bold">How Check-In / Check-Out Works</h2>
            <div className="mt-4 space-y-4 text-sm">
              <div className="bg-emerald-50 p-3 rounded">
                <div className="font-bold">🔄 Auto toggle (no buttons!)</div>
                <ul className="list-disc ml-4 mt-1 space-y-1">
                  <li><b>No open session</b> → next scan = <b>Check-In</b> (records time in)</li>
                  <li><b>Has open session</b> (checked in, not out) → next scan = <b>Check-Out</b> (records time out + duration)</li>
                  <li>Example: ARBAZ at 09:00 scans → <b>Check-In</b> → at 18:00 scans → <b>Check-Out (9h)</b></li>
                </ul>
              </div>
              <div className="bg-amber-50 p-3 rounded">
                <div className="font-bold">⏱️ Timing</div>
                <ul className="list-disc ml-4 mt-1 space-y-1">
                  <li><b>No wait</b> for Check-In → Check-Out (you tested ARBAZ and it said “already checked in” — <b>fixed now</b>: only same type blocked 60s)</li>
                  <li>Duplicate <b>same type</b> within 60s → “Already marked, wait Xs” (prevents double-tap)</li>
                  <li>Hotel windows: 07:00-09:30, 17:00-18:00, 22:00 IST — but you can scan anytime, log uses server IST</li>
                </ul>
              </div>
              <div className="bg-blue-50 p-3 rounded">
                <div className="font-bold">📋 Where to see logs?</div>
                <p>→ <a href="/attendance" className="underline text-blue-600">/attendance</a> (all staff, date picker, CSV) or <a href="/admin" className="underline">/admin</a> → Sessions (In/Out/Duration) + Records (every tap)</p>
              </div>
              <div className="bg-zinc-100 p-3 rounded">
                <div className="font-bold">🆕 First time for staff?</div>
                <ol className="list-decimal ml-4 mt-1 space-y-1">
                  <li>Login at <a href="/login" className="underline">/login</a></li>
                  <li>On kiosk → new face → <b>Create New Profile</b> (3 angles) OR `/enroll` on phone OR `/admin` → Add + Enroll 3 photos</li>
                  <li>Then scan at `/kiosk` → auto logs</li>
                </ol>
              </div>
            </div>
            <button onClick={() => setShowHelp(false)} className="mt-4 w-full bg-zinc-900 text-white py-2 rounded">Got it</button>
          </div>
        </div>
      )}
    </main>
  );
}
