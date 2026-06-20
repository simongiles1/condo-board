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
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3 md:gap-4">
            <Link
              href="/"
              className="min-w-0 shrink font-semibold text-teal-800"
            >
              <span className="hidden sm:inline">Condo Board AI Assistant</span>
              <span className="sm:hidden">Condo Board</span>
            </Link>
            <div className="flex shrink-0 items-center gap-2 md:gap-4">
              <HeaderNavWrapper />
              <AuthNav />
            </div>
          </div>
        </header>
        <main className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col overflow-hidden px-4 py-4 md:py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
