import type { ReactNode, SVGProps } from "react";

import type { NavIconName } from "@/lib/nav/structure";

function IconShell({
  children,
  ...props
}: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

export function NavIcon({
  name,
  className,
}: {
  name: NavIconName;
  className?: string;
}) {
  const cls = className ?? "h-5 w-5";
  switch (name) {
    case "home":
      return (
        <IconShell className={cls}>
          <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </IconShell>
      );
    case "clipboard-check":
      return (
        <IconShell className={cls}>
          <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
          <path d="m9 14 2 2 4-4" />
        </IconShell>
      );
    case "book-open":
      return (
        <IconShell className={cls}>
          <path d="M12 7v14" />
          <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
        </IconShell>
      );
    case "building":
      return (
        <IconShell className={cls}>
          <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
          <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
          <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
          <path d="M10 6h4" />
          <path d="M10 10h4" />
          <path d="M10 14h4" />
          <path d="M10 18h4" />
        </IconShell>
      );
    case "trending-up":
      return (
        <IconShell className={cls}>
          <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
          <polyline points="16 7 22 7 22 13" />
        </IconShell>
      );
    case "code":
      return (
        <IconShell className={cls}>
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </IconShell>
      );
    case "shield":
      return (
        <IconShell className={cls}>
          <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
        </IconShell>
      );
  }
}

export function BuildoutIcon({ className }: { className?: string }) {
  return (
    <IconShell className={className ?? "h-5 w-5"}>
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <path d="m3 6 1 1 2-2" />
      <path d="m3 12 1 1 2-2" />
      <path d="M3.5 18h.01" />
    </IconShell>
  );
}

export function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <IconShell className={className ?? "h-4 w-4"}>
      <path d="m15 18-6-6 6-6" />
    </IconShell>
  );
}

export function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <IconShell className={className ?? "h-4 w-4"}>
      <path d="m9 18 6-6-6-6" />
    </IconShell>
  );
}

export function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <IconShell className={className ?? "h-4 w-4"}>
      <path d="m6 9 6 6 6-6" />
    </IconShell>
  );
}

export function MenuIcon({ className }: { className?: string }) {
  return (
    <IconShell className={className ?? "h-5 w-5"}>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </IconShell>
  );
}

export function CloseIcon({ className }: { className?: string }) {
  return (
    <IconShell className={className ?? "h-5 w-5"}>
      <path d="M6 6l12 12M18 6L6 18" />
    </IconShell>
  );
}
