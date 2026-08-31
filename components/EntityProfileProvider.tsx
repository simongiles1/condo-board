"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { EntityProfileSidePanel } from "@/components/EntityProfileSidePanel";
import { closeActiveHoverPopover } from "@/lib/ui/hover-popover-group";
import type {
  EntityProfileKind,
  EntityProfilePayload,
  EntityProfileResolveHint,
} from "@/lib/entities/entity-profile-shared";

export type OpenEntityProfileInput = {
  kind: EntityProfileKind;
  id: string;
  displayName?: string | null;
  focusedAlias?: string | null;
};

type EntityProfileContextValue = {
  openProfile: (input: OpenEntityProfileInput) => void;
  openUnlinkedProfile: (payload: EntityProfilePayload) => void;
  openHarvestProfile: (hint: EntityProfileResolveHint, fallback: EntityProfilePayload) => Promise<void>;
  closeProfile: () => void;
};

const EntityProfileContext = createContext<EntityProfileContextValue | null>(
  null,
);

export function useEntityProfile(): EntityProfileContextValue {
  const value = useContext(EntityProfileContext);
  if (!value) {
    return {
      openProfile: () => {},
      openUnlinkedProfile: () => {},
      openHarvestProfile: async () => {},
      closeProfile: () => {},
    };
  }
  return value;
}

type FetchTarget = {
  kind: EntityProfileKind;
  id: string;
  nameHint: string | null;
  focusedAlias?: string | null;
};

export function EntityProfileProvider({ children }: { children: ReactNode }) {
  const [fetchTarget, setFetchTarget] = useState<FetchTarget | null>(null);
  const [unlinked, setUnlinked] = useState<EntityProfilePayload | null>(null);
  const [profile, setProfile] = useState<EntityProfilePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [scope, setScope] = useState<"content" | "all">("content");

  const closeProfile = useCallback(() => {
    setFetchTarget(null);
    setUnlinked(null);
    setProfile(null);
    setError(null);
    setLoading(false);
    setPage(1);
    setScope("content");
  }, []);

  const openProfile = useCallback((input: OpenEntityProfileInput) => {
    closeActiveHoverPopover();
    setUnlinked(null);
    setProfile(null);
    setError(null);
    setPage(1);
    setScope("content");
    setFetchTarget({
      kind: input.kind,
      id: input.id,
      nameHint: input.displayName?.trim() || null,
      focusedAlias: input.focusedAlias?.trim() || null,
    });
  }, []);

  const openUnlinkedProfile = useCallback((payload: EntityProfilePayload) => {
    closeActiveHoverPopover();
    setFetchTarget(null);
    setProfile(payload);
    setUnlinked(payload);
    setError(null);
    setLoading(false);
    setPage(1);
    setScope("content");
  }, []);

  const openHarvestProfile = useCallback(
    async (
      hint: EntityProfileResolveHint,
      fallback: EntityProfilePayload,
    ) => {
      closeActiveHoverPopover();
      setUnlinked(null);
      setProfile(fallback);
      setError(null);
      setLoading(true);
      setPage(1);
      setScope("content");
      try {
        const response = await fetch("/api/entities/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(hint),
        });
        const data = (await response.json()) as {
          id?: string | null;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(data.error ?? "Could not resolve entity.");
        }
        if (data.id) {
          setFetchTarget({
            kind: hint.kind,
            id: data.id,
            nameHint: fallback.displayName,
          });
          return;
        }
        setFetchTarget(null);
        setUnlinked(fallback);
        setProfile(fallback);
      } catch (resolveError: unknown) {
        setFetchTarget(null);
        setUnlinked(fallback);
        setProfile(fallback);
        setError(
          resolveError instanceof Error
            ? resolveError.message
            : "Could not resolve entity.",
        );
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const open = fetchTarget != null || unlinked != null || profile != null;

  const value = useMemo(
    () => ({
      openProfile,
      openUnlinkedProfile,
      openHarvestProfile,
      closeProfile,
    }),
    [openProfile, openUnlinkedProfile, openHarvestProfile, closeProfile],
  );

  return (
    <EntityProfileContext.Provider value={value}>
      {children}
      <EntityProfileSidePanel
        open={open}
        fetchTarget={fetchTarget}
        profile={profile}
        loading={loading}
        error={error}
        page={page}
        scope={scope}
        onProfile={setProfile}
        onLoading={setLoading}
        onError={setError}
        onPage={setPage}
        onScope={(next) => {
          setScope(next);
          setPage(1);
        }}
        onClose={closeProfile}
      />
    </EntityProfileContext.Provider>
  );
}
