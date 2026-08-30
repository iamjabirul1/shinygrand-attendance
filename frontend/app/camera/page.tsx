"use client";
import { useEffect, useRef, useState } from "react";
import { API_URL } from "@/lib/api";

export default function CameraPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState("idle");
  const [facing, setFacing] = useState<"user" | "environment">("user");

  // Get token from query
  const [token, setToken] = useState("");
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token") || "";
    setToken(t);
  }, []);

  useEffect(() => {
    let stream: MediaStream | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 } }, audio: false });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setStatus("streaming");
        }
        // Try WebRTC offer to kiosk via WS signaling
        if (token) {
          try {
            const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
            stream!.getTracks().forEach((tr) => pc.addTrack(tr, stream!));
            const wsUrl = API_URL.replace("http", "ws") + `/ws/signal?station_id=GUW-01&token=${encodeURIComponent(token)}`;
            const ws = new WebSocket(wsUrl);
            pc.onicecandidate = (e) => {
              if (e.candidate && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ice", candidate: e.candidate }));
            };
            ws.onopen = async () => {
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              ws.send(JSON.stringify({ type: "offer", sdp: offer }));
            };
            ws.onmessage = async (ev) => {
              const m = JSON.parse(ev.data);
              if (m.type === "answer") {
                await pc.setRemoteDescription(new RTCSessionDescription(m.sdp));
                setStatus("connected (WebRTC)");
              } else if (m.type === "ice") {
                try { await pc.addIceCandidate(m.candidate); } catch {}
              }
            };
          } catch (e) {
            console.log("webrtc fail", e);
          }
        }
      } catch (e: any) {
        setStatus("error: " + e.message + " — need HTTPS and allow camera");
      }
    })();
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, [facing, token]);

  return (
    <main className="min-h-screen bg-black text-white flex flex-col">
      <div className="p-3 bg-zinc-900 flex justify-between items-center">
        <div className="font-semibold">📱 Camera Companion</div>
        <button onClick={() => setFacing(facing === "user" ? "environment" : "user")} className="text-xs bg-zinc-700 px-3 py-1 rounded">Flip</button>
      </div>
      <video ref={videoRef} autoPlay playsInline muted className="flex-1 w-full object-cover bg-zinc-900" />
      <div className="p-3 text-center text-sm bg-zinc-900">
        <div>{status}</div>
        <div className="text-xs text-zinc-400 mt-1">Keep this page open, keep phone charging at reception. Point rear camera to staff face.</div>
        {!token && <div className="text-amber-300 text-xs mt-2">No token — scan QR from kiosk first.</div>}
      </div>
    </main>
  );
}
