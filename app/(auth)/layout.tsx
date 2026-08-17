import Link from "next/link";

export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <header className="shrink-0 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center px-4 py-3">
          <Link href="/" className="font-semibold text-teal-800">
            <span className="hidden sm:inline">Condo Board AI Assistant</span>
            <span className="sm:hidden">Condo Board</span>
          </Link>
        </div>
      </header>
      <main className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col overflow-auto px-4 py-4 md:py-8">
        {children}
      </main>
    </>
  );
}
