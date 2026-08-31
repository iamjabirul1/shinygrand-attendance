import Link from "next/link";
export default function Home() {
  return (
    <main className="max-w-3xl mx-auto p-8">
      <h1 className="text-3xl font-bold text-brand">Hotel Shiny Grand — Attendance</h1>
      <p className="mt-2 text-zinc-600">Single kiosk GUW-01 • Guwahati • IST</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-8">
        <Link href="/kiosk" className="p-6 bg-white rounded-xl shadow border hover:shadow-md">
          <div className="font-semibold">📷 Kiosk</div><div className="text-sm text-zinc-500">Check-in/out (PC + phone)</div>
        </Link>
        <Link href="/enroll" className="p-6 bg-amber-50 rounded-xl shadow border border-amber-200 hover:shadow-md">
          <div className="font-semibold">🆕 Enroll Staff</div><div className="text-sm text-zinc-500">iPhone-like 3-step capture</div>
        </Link>
        <Link href="/attendance" className="p-6 bg-emerald-50 rounded-xl shadow border border-emerald-200 hover:shadow-md">
          <div className="font-semibold">📋 Attendance Log</div><div className="text-sm text-zinc-500">All staff, all days, CSV</div>
        </Link>
        <Link href="/admin" className="p-6 bg-white rounded-xl shadow border hover:shadow-md">
          <div className="font-semibold">🛡️ Admin</div><div className="text-sm text-zinc-500">Employees + corrections</div>
        </Link>
      </div>
      <div className="mt-8 p-4 bg-amber-50 border border-amber-200 rounded">
        <div className="font-medium">Zero-budget setup</div>
        <ol className="list-decimal ml-6 text-sm mt-2 space-y-1">
          <li>Open <b>/kiosk</b> on front desk PC</li>
          <li>Click <b>Pair Phone</b> → QR appears</li>
          <li>Scan QR with phone → phone becomes camera via WebRTC (no app)</li>
          <li>Stand 1m, face center → auto check-in/out in &lt;3s</li>
        </ol>
      </div>
    </main>
  );
}
