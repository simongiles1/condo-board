"use client";

import { createContext, useContext, type ReactNode } from "react";

const HoverPopoverRowContext = createContext<string | null>(null);

export function useHoverPopoverRowScanGroup(): string | null {
  return useContext(HoverPopoverRowContext);
}

/** Wrap a list/table row so badge-to-badge hover within the row skips the open delay. */
export function HoverPopoverRowProvider({
  rowId,
  children,
}: {
  rowId: string;
  children: ReactNode;
}) {
  return (
    <HoverPopoverRowContext.Provider value={rowId}>
      <div className="contents">{children}</div>
    </HoverPopoverRowContext.Provider>
  );
}
