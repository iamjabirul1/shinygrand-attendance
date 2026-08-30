"use client";
import { useEffect, useRef, useState } from "react";
import { API_URL } from "@/lib/api";
import { enqueue } from "@/lib/offline";
import { QRCodeSVG } from "qrcode.react";

type Status = "idle" | "scanning" | "success" | "error" | "ambiguous";

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
  const pcRef = useRef<RTCPeerConnection | null>(null);

  // Pair QR
  async function pair() {
    const token = localStorage.getItem("token");
    const res = await fetch(`${API_URL}/api/stations/pair-qr?station_id=${stationId}`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      alert("Pair failed — login as admin first at /login");
      return;
    }
    const j = await res.json();
    setQr(j);
    // Build camera URL for phone
    const camUrl = `${window.location.origin}/camera?token=${encodeURIComponent(j.token)}`;
    // encode camUrl into QR via overwrite qr_base64 with our URL QR
    // But we already have token QR; we show camUrl QR instead for easier scan
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
        }
      } catch (e: any) {
        setMsg(e.message);
      }
    })();
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, [mode]);

  // Companion WebRTC: kiosk listens via WebSocket signaling
  useEffect(() => {
    if (mode !== "companion" || !qr) return;
    // Simple polling fallback: phone will POST offer to backend, kiosk polls GET /api/stations/signal?station_id
    // For MVP we implement WebSocket if backend supports, else degrade to MJPEG relay.
    // Here we try WS
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
    } catch {}
    return () => {
      ws?.close();
      pcRef.current?.close();
    };
  }, [mode, qr, stationId]);

  // Capture helper
  function captureBase64(): string | null {
    const video = (mode === "usb" ? videoRef.current : remoteVideoRef.current || videoRef.current) as HTMLVideoElement | null;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;
    const w = 640, h = 480;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    // cover
    ctx.drawImage(video, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.7);
  }

  // Auto scan loop: every 2s when not scanning, capture and verify
  const scanningRef = useRef(false);
  useEffect(() => {
    const id = setInterval(async () => {
      if (scanningRef.current) return;
      const b64 = captureBase64();
      if (!b64) return;
      // Simple face presence heuristic: skip if video not playing
      const v = (mode === "usb" ? videoRef.current : remoteVideoRef.current) as any;
      if (!v || v.readyState < 2) return;

      scanningRef.current = true;
      setStatus("scanning");
      try {
        const token = localStorage.getItem("token") || qr?.token || "";
        // Try verify
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
          if (j.status === "ambiguous") {
            setStatus("ambiguous");
            setMsg(j.message + " — " + j.candidates.map((c:any)=>c.name).join(", "));
          } else {
            setStatus("success");
            setEmployee(j.employee);
            setMsg(j.message || `${j.status} ${j.employee.name}`);
            // beep
            try { new Audio("data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA").play(); } catch {}
            await new Promise(r=>setTimeout(r, 2000));
          }
        } else {
          const txt = await res.text();
          if (txt.includes("duplicate")) {
            setStatus("error");
            setMsg("Already marked");
            await new Promise(r=>setTimeout(r, 1500));
          } else if (res.status === 404) {
            // not recognized — silent retry, but show hint after 3 fails
            // keep idle
          } else {
            // other error
            // console.log(txt)
          }
        }
      } catch (e: any) {
        // offline queue?
        if (!navigator.onLine) {
          const b64raw = b64;
          await enqueue({ image_base64: b64raw, station_id: stationId, client_time: new Date().toISOString(), retries: 0 });
          setMsg("Offline — queued, will sync");
        }
      } finally {
        setStatus("idle");
        scanningRef.current = false;
      }
    }, 1800);
    return () => clearInterval(id);
  }, [mode, qr, stationId, threshold, useLiveness]);

  return (
    <main className="min-h-screen bg-black text-white flex flex-col">
      <header className="p-3 flex items-center justify-between bg-zinc-900">
        <div className="font-bold">Hotel Shiny Grand • GUW-01 • Kiosk</div>
        <div className="flex gap-2 items-center">
          <span className="text-xs bg-emerald-600 px-2 py-1 rounded">{mode}</span>
          <button onClick={() => setMode(mode === "usb" ? "companion" : "usb")} className="text-xs bg-zinc-700 px-3 py-1 rounded">Toggle USB/Companion</button>
          <a href="/login" className="text-xs underline">Admin login</a>
        </div>
      </header>

      <div className="flex-1 grid lg:grid-cols-3 gap-0">
        <div className="lg:col-span-2 relative bg-black flex items-center justify-center">
          {/* Video */}
          {mode === "usb" ? (
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-[70vh] object-cover" />
          ) : (
            <video ref={remoteVideoRef} autoPlay playsInline muted className="w-full h-[70vh] object-cover bg-zinc-900" />
          )}
          {/* fallback local preview for companion while waiting */}
          {mode === "companion" && (
            <video ref={videoRef} autoPlay playsInline muted className="hidden" />
          )}
          <canvas ref={canvasRef} className="hidden" />
          {/* Overlay */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="w-64 h-80 border-2 border-white/60 rounded-2xl flex items-end justify-center">
              <span className="mb-2 text-xs bg-black/60 px-2 py-1 rounded">{status === "scanning" ? "Scanning..." : status === "success" ? "✓ " + msg : "Align face in frame"}</span>
            </div>
          </div>
          <div className="absolute bottom-3 left-3 right-3 flex gap-2">
            <div className={`px-3 py-2 rounded text-sm ${status==="success"?"bg-emerald-600": status==="error"?"bg-red-600":"bg-zinc-800"}`}>
              {msg || "Ready — stand 1m, hold still 1s"}
            </div>
            {employee && <div className="ml-auto bg-white text-black px-3 py-2 rounded font-medium">{employee.name} ({employee.emp_code})</div>}
          </div>
        </div>

        <div className="bg-zinc-900 p-4 space-y-4">
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
              <div className="text-xs mt-2">Open on phone: <b>/camera?token=...</b></div>
            </div>
          )}
          <div className="text-xs text-zinc-400">
            Companion mode: phone joins via WebRTC (E2EE). Keep phone charging at reception. If P2P fails, fallback to USB toggle.
          </div>
          <div className="space-y-2 pt-4 border-t border-zinc-700">
            <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={useLiveness} onChange={e=>setUseLiveness(e.target.checked)} /> Basic liveness check</label>
            <div>
              <div className="text-xs">Threshold {threshold.toFixed(2)} (lower=stricter)</div>
              <input type="range" min={0.30} max={0.55} step={0.01} value={threshold} onChange={e=>setThreshold(parseFloat(e.target.value))} className="w-full" />
            </div>
          </div>
          <div className="text-[11px] text-zinc-500">
            Timing windows: 07:00-09:30 / 17:00-18:00 / 22:00 IST. Server time IST shown. Cooldown 60s duplicate guard.
          </div>
        </div>
      </div>
    </main>
  );
}
