import "./globals.css";
export const metadata = { title: "Hotel Shiny Grand — Attendance", description: "Web kiosk attendance GUW-01" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
