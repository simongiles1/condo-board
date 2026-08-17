import type { ReactNode, SVGProps } from "react";

import type { HarvestIconId } from "@/lib/email-analysis/harvest-highlight-theme";

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
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

export function HarvestTypeIcon({
  icon,
  className,
}: {
  icon: HarvestIconId;
  className?: string;
}) {
  const cls = className ?? "inline-block h-3 w-3 align-text-bottom";
  switch (icon) {
    case "person":
      return (
        <IconShell className={cls}>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5.5 19.5c1.2-3.2 3.6-4.8 6.5-4.8s5.3 1.6 6.5 4.8" />
        </IconShell>
      );
    case "phone":
      return (
        <IconShell className={cls}>
          <path d="M7 3.5h3.2l1.2 3-2 1.4a12 12 0 0 0 6.7 6.7l1.4-2 3 1.2V17c0 1.1-.9 2.2-2.1 2.4C9.4 20.8 3.2 14.6 4.6 5.6 4.8 4.4 5.9 3.5 7 3.5Z" />
        </IconShell>
      );
    case "briefcase":
      return (
        <IconShell className={cls}>
          <rect x="3.5" y="8" width="17" height="12" rx="2" />
          <path d="M8 8V6.5A2.5 2.5 0 0 1 10.5 4h3A2.5 2.5 0 0 1 16 6.5V8" />
        </IconShell>
      );
    case "building":
      return (
        <IconShell className={cls}>
          <path d="M5 20V6.5L12 4l7 2.5V20" />
          <path d="M9 20v-5h6v5" />
          <path d="M9 9h.01M12 9h.01M15 9h.01M9 12.5h.01M12 12.5h.01M15 12.5h.01" />
        </IconShell>
      );
    case "badge":
      return (
        <IconShell className={cls}>
          <circle cx="12" cy="11" r="6" />
          <path d="M8.5 16.5 7 21l5-2 5 2-1.5-4.5" />
        </IconShell>
      );
    case "globe":
      return (
        <IconShell className={cls}>
          <circle cx="12" cy="12" r="8" />
          <path d="M4 12h16M12 4c2.5 2.4 3.8 5.1 3.8 8s-1.3 5.6-3.8 8c-2.5-2.4-3.8-5.1-3.8-8s1.3-5.6 3.8-8Z" />
        </IconShell>
      );
    case "calendar":
      return (
        <IconShell className={cls}>
          <rect x="4" y="6" width="16" height="14" rx="2" />
          <path d="M8 4v4M16 4v4M4 11h16" />
        </IconShell>
      );
    case "calendar-x":
      return (
        <IconShell className={cls}>
          <rect x="4" y="6" width="16" height="14" rx="2" />
          <path d="M8 4v4M16 4v4M4 11h16M10 15l4 4M14 15l-4 4" />
        </IconShell>
      );
    case "calendar-move":
      return (
        <IconShell className={cls}>
          <rect x="3.5" y="6" width="13" height="13" rx="2" />
          <path d="M7.5 4v4M13 4v4M3.5 11h13M17 14h3.5M18.5 12l2.5 2-2.5 2" />
        </IconShell>
      );
    case "flag":
      return (
        <IconShell className={cls}>
          <path d="M6 4v16M6 5h11l-2.5 3.5L17 12H6" />
        </IconShell>
      );
    case "clipboard":
      return (
        <IconShell className={cls}>
          <rect x="6" y="5" width="12" height="15" rx="2" />
          <path d="M9 5.5V4h6v1.5M9 11h6M9 15h4" />
        </IconShell>
      );
    case "wrench":
      return (
        <IconShell className={cls}>
          <path d="M15.5 6.5a3.5 3.5 0 0 0-4.6 4.6L4 18l2 2 6.9-6.9a3.5 3.5 0 0 0 4.6-4.6L15.5 10.5 13.5 8.5Z" />
        </IconShell>
      );
    case "checklist":
      return (
        <IconShell className={cls}>
          <path d="M9 7h11M9 12h11M9 17h11" />
          <path d="M4 7.2 5.2 8.5 7.5 6M4 12.2 5.2 13.5 7.5 11M4 17.2 5.2 18.5 7.5 16" />
        </IconShell>
      );
    default:
      return null;
  }
}
