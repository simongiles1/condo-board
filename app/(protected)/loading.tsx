export default function ProtectedLoading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-6" aria-busy="true">
      <div className="h-7 w-48 animate-pulse rounded-xl bg-slate-100" />
      <div className="h-4 w-80 animate-pulse rounded-xl bg-slate-100" />
      <div className="mt-4 min-h-0 flex-1 animate-pulse rounded-xl bg-slate-100" />
    </div>
  );
}
