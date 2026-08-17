import type { Metadata } from "next";

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
        {children}
      </body>
    </html>
  );
}
