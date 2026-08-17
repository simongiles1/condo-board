export function AdminWorkspaceBanner() {
  return (
    <div
      role="status"
      className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
    >
      <span className="font-semibold tracking-wide">Admin Workspace</span>
      <span className="ml-2 text-amber-900/80">
        Developer and system tooling — not part of day-to-day board operations.
      </span>
    </div>
  );
}
