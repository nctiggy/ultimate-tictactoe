import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ultimate Tic Tac Toe",
  description: "Play Ultimate Tic Tac Toe with friends or bots"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="text-slate-100 bg-slate-950 antialiased">{children}</body>
    </html>
  );
}
