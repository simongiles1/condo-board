export default function CalendarLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="-mt-6 -mb-4 flex min-h-0 flex-1 flex-col overflow-hidden">
      {children}
    </div>
  );
}
