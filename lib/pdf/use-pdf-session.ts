"use client";

import { useEffect, useRef } from "react";

import { releasePdfBuffers } from "./pdfjs-browser";

/**
 * Hold PDF file URLs while a floor-plan editor is mounted. Cached bytes are
 * dropped when the plan changes or the editor unmounts. URLs shared across
 * overlay toggles stay cached so the base sheet does not reload.
 */
export function usePdfSession(active: boolean, urls: string[]): void {
  const sessionKey = urls.filter(Boolean).join("\0");
  const heldKeyRef = useRef("");

  useEffect(() => {
    if (!active) {
      if (heldKeyRef.current) {
        releasePdfBuffers(heldKeyRef.current.split("\0"));
        heldKeyRef.current = "";
      }
      return;
    }
    if (!sessionKey) return;

    const prevUrls = heldKeyRef.current ? heldKeyRef.current.split("\0") : [];
    const nextUrls = sessionKey.split("\0");
    for (const url of prevUrls) {
      if (!nextUrls.includes(url)) {
        releasePdfBuffers([url]);
      }
    }
    heldKeyRef.current = sessionKey;
  }, [active, sessionKey]);

  useEffect(() => {
    return () => {
      if (heldKeyRef.current) {
        releasePdfBuffers(heldKeyRef.current.split("\0"));
        heldKeyRef.current = "";
      }
    };
  }, []);
}
