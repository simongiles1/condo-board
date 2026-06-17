import type { Metadata } from "next";
import Link from "next/link";

import { AuthNav } from "@/components/AuthNav";
import { HeaderNavWrapper } from "@/components/HeaderNavWrapper";

import "./globals.css";

export const metadata: Metadata = {
  title: "Condo Board AI Assistant",
  description: "Local AI assistant for meeting minutes and action items",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-dvh">
      <body className="flex h-dvh flex-col overflow-hidden antialiased">
        <header className="shrink-0 border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
            <Link href="/" className="font-semibold text-teal-800">
              Condo Board AI Assistant
            </Link>
            <div className="flex items-center gap-4">
              <HeaderNavWrapper />
              <AuthNav />
            </div>
          </div>
        </header>
        <main className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col overflow-hidden px-4 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
