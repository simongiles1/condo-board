"use client";

import {
  useEffect,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

const VIEWPORT_MARGIN = 8;
const MENU_GAP = 4;

type Align = "start" | "end";

function computeAnchoredMenuStyle(
  triggerRect: DOMRect,
  menuWidth: number,
  menuHeight: number,
  align: Align,
  zIndex = 50,
): CSSProperties {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let left = align === "end" ? triggerRect.right - menuWidth : triggerRect.left;
  left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(left, viewportWidth - menuWidth - VIEWPORT_MARGIN),
  );

  let top = triggerRect.bottom + MENU_GAP;
  if (top + menuHeight > viewportHeight - VIEWPORT_MARGIN) {
    const aboveTop = triggerRect.top - menuHeight - MENU_GAP;
    if (aboveTop >= VIEWPORT_MARGIN) {
      top = aboveTop;
    } else {
      top = Math.max(
        VIEWPORT_MARGIN,
        Math.min(top, viewportHeight - menuHeight - VIEWPORT_MARGIN),
      );
    }
  }

  return {
    position: "fixed",
    top,
    left,
    width: menuWidth,
    zIndex,
  };
}

export function useAnchoredMenuDismiss(
  open: boolean,
  onClose: () => void,
  triggerRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      onClose();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose, triggerRef, menuRef]);
}

export function AnchoredMenuPortal({
  open,
  triggerRef,
  menuRef,
  align = "end",
  width,
  matchTriggerWidth = false,
  zIndex = 50,
  className,
  children,
}: {
  open: boolean;
  triggerRef: RefObject<HTMLElement | null>;
  menuRef: RefObject<HTMLDivElement | null>;
  align?: Align;
  width?: number;
  matchTriggerWidth?: boolean;
  zIndex?: number;
  className?: string;
  children: ReactNode;
}) {
  const [style, setStyle] = useState<CSSProperties>({
    position: "fixed",
    top: 0,
    left: 0,
    visibility: "hidden",
    zIndex,
  });

  useLayoutEffect(() => {
    if (!open) return;

    function updatePosition() {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger) return;

      const triggerRect = trigger.getBoundingClientRect();
      const menuWidth = matchTriggerWidth
        ? triggerRect.width
        : (width ?? menu?.offsetWidth ?? 256);
      const menuHeight = menu?.offsetHeight ?? 0;

      setStyle(
        computeAnchoredMenuStyle(
          triggerRect,
          menuWidth,
          menuHeight,
          align,
          zIndex,
        ),
      );
    }

    updatePosition();

    const menu = menuRef.current;
    const resizeObserver =
      menu && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(updatePosition)
        : null;
    if (resizeObserver && menu) {
      resizeObserver.observe(menu);
    }

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, triggerRef, menuRef, align, width, matchTriggerWidth, zIndex, children]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div ref={menuRef} style={style} className={className}>
      {children}
    </div>,
    document.body,
  );
}
