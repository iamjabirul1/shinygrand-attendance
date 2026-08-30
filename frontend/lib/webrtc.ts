"use client";
// Minimal WebRTC helper: kiosk creates offer, phone answers via WS signaling via backend
// For MVP we also support pure P2P without server relay (manual SDP exchange via QR+polling is overkill)
// Simplified: Kiosk is the answerer, phone is offerer via direct WebSocket relay through backend /ws/signal
// Fallback: If WS not available, phone just uses getUserMedia and we show its stream via backend relay polling (degraded)

export function createPeer(withStun = true): RTCPeerConnection {
  return new RTCPeerConnection(
    withStun ? { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] } : undefined
  );
}
