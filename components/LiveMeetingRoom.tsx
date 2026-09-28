"use client";

import Link from "next/link";
import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Room, RoomEvent, Track } from "livekit-client";

import { MarkdownPreview } from "@/components/MarkdownPreview";
import { useLiveSpeechRecognition } from "@/components/useLiveSpeechRecognition";
import { ZoomablePdfViewer } from "@/components/ZoomablePdfViewer";
import { agendaItemIndentDepth } from "@/lib/meeting-v2/agenda-outline";
import {
  groupPageRanges,
  liveRoomAgendaSidebarRows,
  navigationAllowed,
  stageMove,
  stagePackagePage,
  stagePages,
  type LiveRoomSnapshot,
} from "@/lib/meeting-v2/live-agenda";
import type { LiveArchiveLink } from "@/lib/meeting-v2/live-archive-links";
import {
  linkPackagePageCitations,
  packagePageFromHref,
} from "@/lib/meeting-v2/package-page-refs";
import { clipStageTextToItem } from "@/lib/meeting-v2/stage-item-text";
import { formatMediaClock, type RecordingHealthState } from "@/lib/meeting-v2/live-clock";

type JoinPayload = {
  token: string;
  serverUrl: string;
  identity: string;
  displayName: string;
  snapshot: LiveRoomSnapshot;
};

type Person = {
  identity: string;
  name: string;
  microphone: boolean;
};

type Connection = "idle" | "connecting" | "connected" | "disconnected";

type DocumentDrawer =
  | { kind: "package"; page: number; end: number; label: string }
  | { kind: "file"; fileId: string; label: string };

const HEALTH_CLASS: Record<RecordingHealthState, string> = {
  unconfigured: "border-amber-200 bg-amber-50 text-amber-900",
  waiting: "border-amber-200 bg-amber-50 text-amber-900",
  recording: "border-emerald-200 bg-emerald-50 text-emerald-900",
  failed: "border-rose-200 bg-rose-50 text-rose-900",
  finished: "border-slate-200 bg-slate-100 text-slate-700",
  unknown: "border-rose-200 bg-rose-50 text-rose-900",
};

type BoundaryState = { error: Error | null };

/** Keeps a live-room render throw on this page, with the message Next's blank error screen hides. */
class LiveRoomErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-0 flex-1 flex-col items-start gap-3 bg-slate-950 p-6 text-white">
        <p className="text-base font-semibold">The live room hit an error.</p>
        <p className="max-w-xl text-sm text-rose-200">{this.state.error.message}</p>
        <button
          type="button"
          className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium"
          onClick={() => this.setState({ error: null })}
        >
          Try again
        </button>
      </div>
    );
  }
}

/**
 * LiveKit room, recording health, and one shared agenda leaf for a V2 meeting.
 * A render failure stays in this panel instead of replacing the whole app.
 */
export function LiveMeetingRoom({ meetingId }: { meetingId: string }) {
  return (
    <LiveRoomErrorBoundary>
      <LiveMeetingRoomBody meetingId={meetingId} />
    </LiveRoomErrorBoundary>
  );
}

function LiveMeetingRoomBody({ meetingId }: { meetingId: string }) {
  const [snapshot, setSnapshot] = useState<LiveRoomSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [connection, setConnection] = useState<Connection>("idle");
  const [people, setPeople] = useState<Person[]>([]);
  const [navBusy, setNavBusy] = useState(false);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [mapBusy, setMapBusy] = useState(false);
  const [presenterBusy, setPresenterBusy] = useState(false);
  const [selfIdentity, setSelfIdentity] = useState<string | null>(null);
  const [extractPages, setExtractPages] = useState<
    Array<{ pageNumber: number; pageHeading: string | null; extractedText: string }>
  >([]);
  const [archiveLinks, setArchiveLinks] = useState<LiveArchiveLink[]>([]);
  const [drawer, setDrawer] = useState<DocumentDrawer | null>(null);
  const [captions, setCaptions] = useState<
    Array<{
      id: string;
      speakerLabel: string;
      text: string;
      corrections: Array<{
        id: string;
        heardText: string;
        proposedText: string;
        status: "proposed" | "accepted" | "rejected";
        decidedByIdentity: string | null;
      }>;
    }>
  >([]);
  const [hintPhrases, setHintPhrases] = useState<string[]>([]);
  const roomRef = useRef<Room | null>(null);
  const audioRef = useRef<HTMLDivElement>(null);
  const autoJoined = useRef(false);

  const postRecognitionCue = useCallback(
    (text: string, durationMs: number) => {
      void fetch(`/api/v2/meetings/${meetingId}/live/recognition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, durationMs }),
      })
        .then(async (response) => (response.ok ? response.json() : null))
        .then((payload: { cue?: { id: string; speakerLabel: string; text: string; corrections?: Array<{ id: string; heardText: string; proposedText: string; status: "proposed" | "accepted" | "rejected"; decidedByIdentity: string | null }> } | null } | null) => {
          const cue = payload?.cue;
          if (!cue) return;
          setCaptions((current) =>
            current.some((row) => row.id === cue.id)
              ? current
              : [...current, { ...cue, corrections: cue.corrections ?? [] }].slice(-40),
          );
        })
        .catch(() => undefined);
    },
    [meetingId],
  );
  const decideCorrection = useCallback(
    async (correctionId: string, status: "accepted" | "rejected") => {
      const response = await fetch(`/api/v2/meetings/${meetingId}/live/recognition/corrections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ correctionId, status }),
      });
      const payload = (await response.json().catch(() => null)) as {
        correction?: { id: string; status: "accepted" | "rejected"; decidedByIdentity: string | null };
      } | null;
      const correction = payload?.correction;
      if (!response.ok || !correction) return;
      setCaptions((current) =>
        current.map((cue) => ({
          ...cue,
          corrections: cue.corrections.map((row) =>
            row.id === correction.id
              ? { ...row, status: correction.status, decidedByIdentity: correction.decidedByIdentity }
              : row,
          ),
        })),
      );
    },
    [meetingId],
  );
  const speech = useLiveSpeechRecognition({
    enabled: connection === "connected",
    phrases: hintPhrases,
    onFinal: postRecognitionCue,
  });

  useEffect(() => {
    if (connection !== "connected") return;
    let cancelled = false;
    const load = () => {
      void fetch(`/api/v2/meetings/${meetingId}/live/recognition`, { cache: "no-store" })
        .then(async (response) => (response.ok ? response.json() : null))
        .then((payload: { cues?: Array<{ id: string; speakerLabel: string; text: string; corrections?: Array<{ id: string; heardText: string; proposedText: string; status: "proposed" | "accepted" | "rejected"; decidedByIdentity: string | null }> }> } | null) => {
          if (!cancelled && payload?.cues) {
            setCaptions(payload.cues.map((cue) => ({ ...cue, corrections: cue.corrections ?? [] })));
          }
        })
        .catch(() => undefined);
    };
    load();
    const timer = window.setInterval(load, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [connection, meetingId]);

  useEffect(() => {
    if (connection !== "connected") return;
    let cancelled = false;
    const load = () => {
      void fetch(`/api/v2/meetings/${meetingId}/live/vocabulary`, { cache: "no-store" })
        .then(async (response) => (response.ok ? response.json() : null))
        .then((payload: { phrases?: string[] } | null) => {
          if (!cancelled && payload?.phrases) setHintPhrases(payload.phrases);
        })
        .catch(() => undefined);
    };
    load();
    const timer = window.setInterval(load, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [connection, meetingId]);

  const refreshPeople = useCallback((room: Room) => {
    const local = room.localParticipant;
    const next: Person[] = [
      {
        identity: local.identity,
        name: local.name || local.identity,
        microphone: local.isMicrophoneEnabled,
      },
    ];
    for (const participant of room.remoteParticipants.values()) {
      next.push({
        identity: participant.identity,
        name: participant.name || participant.identity,
        microphone: participant.isMicrophoneEnabled,
      });
    }
    setPeople(next);
  }, []);

  const connectRoom = useCallback(
    async (joined: JoinPayload) => {
      setConnection("connecting");
      setJoinError(null);
      setMicError(null);
      roomRef.current?.disconnect();
      const room = new Room();
      roomRef.current = room;

      const sync = () => refreshPeople(room);
      room.on(RoomEvent.ParticipantConnected, sync);
      room.on(RoomEvent.ParticipantDisconnected, sync);
      room.on(RoomEvent.TrackMuted, sync);
      room.on(RoomEvent.TrackUnmuted, sync);
      room.on(RoomEvent.LocalTrackPublished, sync);
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio && audioRef.current) {
          const element = track.attach();
          element.autoplay = true;
          audioRef.current.appendChild(element);
        }
        sync();
      });
      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        for (const element of track.detach()) element.remove();
        sync();
      });
      room.on(RoomEvent.Disconnected, () => setConnection("disconnected"));

      await room.connect(joined.serverUrl, joined.token);
      setConnection("connected");
      try {
        // Camera stays off so auto track egress records microphone audio.
        await room.localParticipant.setMicrophoneEnabled(true);
      } catch (error) {
        setMicError(
          error instanceof Error ? error.message : "Microphone permission was denied.",
        );
      }
      sync();
    },
    [refreshPeople],
  );

  const join = useCallback(async () => {
    setJoinError(null);
    try {
      const response = await fetch(`/api/v2/meetings/${meetingId}/live/join`, { method: "POST" });
      const payload = (await response.json().catch(() => null)) as
        | (JoinPayload & { error?: string })
        | null;
      if (!response.ok || !payload || payload.error || !payload.token) {
        setJoinError(payload?.error ?? "Could not join the room.");
        setConnection("idle");
        return;
      }
      setSelfIdentity(payload.identity);
      if (payload.snapshot) setSnapshot(payload.snapshot);
      await connectRoom(payload);
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : "Could not join the room.");
      setConnection("idle");
    }
  }, [connectRoom, meetingId]);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/v2/meetings/${meetingId}/live`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as
          | (LiveRoomSnapshot & { error?: string })
          | null;
        if (!response.ok) {
          throw new Error(payload?.error ?? "Could not load the live room.");
        }
        return payload;
      })
      .then((payload) => {
        if (!cancelled && payload) setSnapshot(payload);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Could not load the live room.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  useEffect(() => {
    if (!snapshot?.configured || autoJoined.current) return;
    autoJoined.current = true;
    void join();
  }, [join, snapshot?.configured]);

  useEffect(() => {
    if (!snapshot?.roomName) return;
    const timer = window.setInterval(() => {
      void fetch(`/api/v2/meetings/${meetingId}/live`, { cache: "no-store" })
        .then(async (response) => (response.ok ? response.json() : null))
        .then((payload: LiveRoomSnapshot | null) => {
          if (!payload) return;
          // CONCERN: followers learn the presenter's leaf and shared page on this 5s poll.
          setSnapshot(payload);
        })
        .catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [meetingId, snapshot?.roomName]);

  useEffect(() => {
    return () => {
      roomRef.current?.disconnect();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/v2/meetings/${meetingId}/board-package-extract`, { cache: "no-store" })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((payload: { pages?: Array<{ pageNumber: number; pageHeading: string | null; extractedText: string }> } | null) => {
        if (!cancelled && payload?.pages) setExtractPages(payload.pages);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/v2/meetings/${meetingId}/live/archive-links`, { cache: "no-store" })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((payload: { links?: LiveArchiveLink[] } | null) => {
        if (!cancelled && payload?.links) setArchiveLinks(payload.links);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  async function postSnapshot(path: string, body?: unknown): Promise<LiveRoomSnapshot> {
    const response = await fetch(path, {
      method: "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as
      | (LiveRoomSnapshot & { error?: string })
      | null;
    if (!response.ok || !payload || payload.error || !payload.leaves) {
      throw new Error(payload?.error ?? "Could not update the live room.");
    }
    setSnapshot(payload);
    return payload;
  }

  async function moveTo(
    target: { agendaItemId: string; page?: number | null } | { unscheduled: true },
  ) {
    setNavBusy(true);
    setJoinError(null);
    try {
      await postSnapshot(
        `/api/v2/meetings/${meetingId}/live/navigate`,
        "unscheduled" in target
          ? { unscheduled: true }
          : { agendaItemId: target.agendaItemId, page: target.page ?? undefined },
      );
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : "Could not store the navigation event.");
    } finally {
      setNavBusy(false);
    }
  }

  const leaves = snapshot?.leaves ?? [];
  const navigation = snapshot?.navigation ?? [];

  async function stepStage(direction: -1 | 1) {
    if (!snapshot) return;
    const move = stageMove({
      leaves,
      navigation,
      presentedPage: snapshot.presentedPage,
      direction,
    });
    if (!move) return;
    await moveTo({ agendaItemId: move.agendaItemId, page: move.page });
  }

  function openPackagePage(page: number, end = page) {
    const label = end === page ? `Page ${page}` : `Pages ${page}–${end}`;
    setDrawer({ kind: "package", page, end, label });
  }

  const viewerIsPresenter = navigationAllowed(
    snapshot?.presenterIdentity ?? null,
    selfIdentity ?? "",
  );
  const active = snapshot?.activeUnscheduled
    ? null
    : (leaves.find((leaf) => leaf.id === snapshot?.activeAgendaItemId) ?? null);
  const focus = snapshot?.activeUnscheduled
    ? { kind: "unscheduled" as const }
    : active
      ? { kind: "leaf" as const, agendaItemId: active.id }
      : null;
  const pagesOnItem = stagePages(active?.sourcePages ?? []);
  const stagePage = stagePackagePage(focus, active?.sourcePages ?? []);
  const stageExtracts = pagesOnItem.shown
    .map((pageNumber) => extractPages.find((page) => page.pageNumber === pageNumber))
    .filter((page): page is NonNullable<typeof page> => page != null);
  const attachedRanges = groupPageRanges(pagesOnItem.attached);
  const itemArchiveLinks = archiveLinks.filter((link) => link.agendaItemId === active?.id);
  const otherItemTitles = (snapshot?.leaves ?? [])
    .filter((leaf) => leaf.id !== active?.id)
    .map((leaf) => leaf.title);
  const canStepBack = snapshot
    ? stageMove({
        leaves,
        navigation,
        presentedPage: snapshot.presentedPage,
        direction: -1,
      }) != null
    : false;
  const canStepForward = snapshot
    ? stageMove({
        leaves,
        navigation,
        presentedPage: snapshot.presentedPage,
        direction: 1,
      }) != null
    : false;
  const localPerson = people.find((person) => person.identity === selfIdentity) ?? null;

  async function recordInterruption() {
    setCaptureBusy(true);
    setJoinError(null);
    try {
      const response = await fetch(`/api/v2/meetings/${meetingId}/live/capture-interruption`, {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as
        | (LiveRoomSnapshot & { error?: string })
        | null;
      if (!response.ok || !payload || payload.error) {
        throw new Error(payload?.error ?? "Could not record the capture interruption.");
      }
      setSnapshot(payload);
    } catch (error) {
      setJoinError(
        error instanceof Error ? error.message : "Could not record the capture interruption.",
      );
    } finally {
      setCaptureBusy(false);
    }
  }

  const recording = snapshot?.recording;
  const pageMap = snapshot?.pageMap;
  const captureGaps = snapshot?.captureGaps ?? [];
  const captureFiles = snapshot?.captureFiles ?? [];
  const critical = recording?.severity === "critical";
  const interrupted = captureGaps.find((gap) => gap.acceptedAt) ?? null;
  const agendaSidebarRows = liveRoomAgendaSidebarRows(snapshot);
  const barButton =
    "rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white disabled:opacity-40";

  async function toggleMic() {
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.localParticipant.setMicrophoneEnabled(!localPerson?.microphone);
      setMicError(null);
      refreshPeople(room);
    } catch (error) {
      setMicError(error instanceof Error ? error.message : "Microphone permission was denied.");
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-950">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-white">
        <Link
          href={`/operations/meetings/v2/${meetingId}`}
          className="text-sm font-medium text-slate-300 hover:text-white"
        >
          &larr; Back to meeting
        </Link>
        <p className="text-sm text-slate-300">
          {connection === "connected"
            ? "Connected"
            : connection === "connecting"
              ? "Connecting"
              : connection === "disconnected"
                ? "Disconnected"
                : "Not connected"}
          {people.length > 0 ? ` · ${people.length} in the room` : ""}
          {viewerIsPresenter
            ? " · You are presenting"
            : snapshot?.presenterDisplayName
              ? ` · ${snapshot.presenterDisplayName} is presenting`
              : ""}
        </p>
        {recording && !critical ? (
          <span
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${HEALTH_CLASS[recording.state] ?? ""}`}
          >
            {recording.label}
          </span>
        ) : (
          <span />
        )}
        {connection === "connected" && speech.status !== "idle" ? (
          <span
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${
              speech.status === "listening"
                ? "border-slate-500 bg-slate-800 text-slate-100"
                : "border-amber-300 bg-amber-50 text-amber-950"
            }`}
            title={speech.detail ?? undefined}
          >
            {speech.status === "listening"
              ? hintPhrases.length > 0
                ? `Captions on · ${hintPhrases.length} hints`
                : "Captions on"
              : speech.status === "unsupported"
                ? "No captions"
                : "Captions stopped"}
          </span>
        ) : null}
      </header>

      {critical && snapshot ? (
        <div role="alert" className="mx-4 mb-3 rounded-2xl border border-rose-300 bg-rose-50 px-4 py-4 text-rose-950">
          <p className="text-base font-semibold">Critical: capture is not healthy</p>
          <p className="mt-2 text-sm">{recording?.detail}</p>
          {captureGaps.length > 0 ? (
            <ul className="mt-3 space-y-1 text-sm">
              {captureGaps.map((gap) => (
                <li key={gap.id}>
                  Gap from {formatMediaClock(gap.startOffsetMs)}
                  {gap.endOffsetMs == null ? "" : ` to ${formatMediaClock(gap.endOffsetMs)}`}
                  {gap.acceptedAt ? " · interruption recorded" : ""}
                </li>
              ))}
            </ul>
          ) : null}
          {interrupted ? (
            <p className="mt-3 text-sm">
              Discussion after {formatMediaClock(interrupted.startOffsetMs)} is absent until capture
              is healthy again.
            </p>
          ) : null}
          <button
            type="button"
            disabled={captureBusy || !snapshot.roomName}
            onClick={() => void recordInterruption()}
            className="mt-4 rounded-lg bg-rose-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {captureBusy ? "Recording…" : "Record capture interrupted"}
          </button>
        </div>
      ) : null}

      {pageMap && !pageMap.checkedAt ? (
        <div role="status" className="mx-4 mb-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-amber-950">
          <p className="text-sm font-semibold">The leaf-to-page map has not been checked.</p>
          {(pageMap.leavesWithoutPages?.length ?? 0) > 0 ? (
            <p className="mt-1 text-sm">
              {pageMap.leavesWithoutPages.length} item
              {pageMap.leavesWithoutPages.length === 1 ? "" : "s"} have no package pages.
            </p>
          ) : null}
          <button
            type="button"
            disabled={mapBusy}
            onClick={() => {
              setMapBusy(true);
              setJoinError(null);
              void postSnapshot(`/api/v2/meetings/${meetingId}/live/page-map`)
                .catch((error: unknown) => {
                  setJoinError(
                    error instanceof Error ? error.message : "Could not record the map check.",
                  );
                })
                .finally(() => setMapBusy(false));
            }}
            className="mt-2 rounded-lg bg-amber-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {mapBusy ? "Recording…" : "Record map check"}
          </button>
        </div>
      ) : null}

      {(loadError || joinError || micError) && (
        <p className="mx-4 mb-3 text-sm text-rose-200">{loadError || joinError || micError}</p>
      )}

      <div className="relative mx-4 mb-3 flex min-h-0 flex-1 gap-3">
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white text-slate-900 shadow-sm">
        <div className="border-b border-slate-200 px-6 py-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            {snapshot?.activeUnscheduled ? "Unscheduled" : "Shared package"}
            {pagesOnItem.shown.length > 1
              ? ` · Pages ${pagesOnItem.shown[0]}–${pagesOnItem.shown[pagesOnItem.shown.length - 1]}`
              : stagePage != null
                ? ` · Page ${stagePage}`
                : ""}
          </p>
          <h1 className="mt-1 text-2xl font-semibold">
            {snapshot?.activeUnscheduled
              ? "Unscheduled discussion"
              : active
                ? `${active.itemNumber ? `${active.itemNumber} ` : ""}${active.title}`
                : "Live room"}
          </h1>
          {stageExtracts[0]?.pageHeading ? (
            <p className="mt-1 text-sm text-slate-500">{stageExtracts[0].pageHeading}</p>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
          {snapshot?.activeUnscheduled ? (
            <p className="text-slate-600">
              This discussion is not an agenda item. Next and Previous return to the package.
            </p>
          ) : (
            <div className="space-y-4">
              {itemArchiveLinks.length > 0 || attachedRanges.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {itemArchiveLinks.map((link) => (
                    <button
                      key={link.fileId}
                      type="button"
                      onClick={() =>
                        setDrawer({ kind: "file", fileId: link.fileId, label: link.label })
                      }
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-teal-800 hover:bg-slate-50"
                    >
                      Open {link.label}
                    </button>
                  ))}
                  {attachedRanges.map((range) => (
                    <button
                      key={`${range.start}-${range.end}`}
                      type="button"
                      onClick={() => openPackagePage(range.start, range.end)}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-teal-800 hover:bg-slate-50"
                    >
                      Open {range.start === range.end ? `page ${range.start}` : `pages ${range.start}–${range.end}`}
                    </button>
                  ))}
                </div>
              ) : null}
              {stageExtracts.some((page) => page.extractedText?.trim()) ? (
                stageExtracts.map((page) =>
                  page.extractedText?.trim() ? (
                    <MarkdownPreview
                      key={page.pageNumber}
                      onPackagePage={(href) => {
                        const target = packagePageFromHref(href);
                        if (target) openPackagePage(target.start, target.end);
                      }}
                    >
                      {linkPackagePageCitations(
                        active
                          ? clipStageTextToItem(page.extractedText, active.title, otherItemTitles)
                          : page.extractedText,
                      )}
                    </MarkdownPreview>
                  ) : null,
                )
              ) : (
                <p className="text-slate-500">
                  {stagePage == null
                    ? itemArchiveLinks.length > 0
                      ? "This item has no package page. Open the file above."
                      : "This item has no package page."
                    : `No extracted text is stored for page ${stagePage}.`}
                </p>
              )}
            </div>
          )}
        </div>
        {captions.length > 0 || speech.interim || captureFiles.length > 0 ? (
          <div className="max-h-48 overflow-auto border-t border-slate-200 bg-slate-50 px-6 py-3 text-sm">
            {captureFiles.some((file) => file.playable) ? (
              <p className="mb-2 text-xs text-slate-500">
                Audio{" "}
                {captureFiles
                  .filter((file) => file.playable)
                  .map((file) => (
                    <a
                      key={file.trackId}
                      href={`/api/v2/meetings/${meetingId}/live/capture/${file.trackId}`}
                      className="ml-2 font-medium text-teal-800 underline"
                    >
                      Play {file.participantIdentity}
                    </a>
                  ))}
              </p>
            ) : null}
            {captions.slice(-6).map((cue) => (
              <div key={cue.id} className="mb-2 text-slate-800">
                <p>
                  <span className="font-semibold text-slate-600">{cue.speakerLabel}: </span>
                  {cue.text}
                </p>
                {cue.corrections
                  .filter((correction) => correction.status !== "rejected")
                  .map((correction) => (
                    <p key={correction.id} className="mt-1 text-xs text-slate-600">
                      {correction.status === "accepted" ? "Accepted correction" : "Suggestion"}:{" "}
                      {correction.heardText} → {correction.proposedText}
                      {correction.status === "proposed" ? (
                        <>
                          <button
                            type="button"
                            className="ml-2 font-medium text-teal-800 underline"
                            onClick={() => void decideCorrection(correction.id, "accepted")}
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            className="ml-2 font-medium text-slate-500 underline"
                            onClick={() => void decideCorrection(correction.id, "rejected")}
                          >
                            Dismiss
                          </button>
                        </>
                      ) : null}
                    </p>
                  ))}
              </div>
            ))}
            {speech.interim ? <p className="text-slate-500">{speech.interim}</p> : null}
          </div>
        ) : null}
      </main>
      {drawer ? (
        <aside className="absolute inset-y-0 right-72 z-20 flex w-[min(42rem,calc(100%-19rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
            <p className="truncate text-sm font-semibold">{drawer.label}</p>
            <button
              type="button"
              onClick={() => setDrawer(null)}
              className="rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
            >
              Close
            </button>
          </div>
          <ZoomablePdfViewer
            key={drawer.kind === "package" ? `pkg-${drawer.page}` : drawer.fileId}
            className="min-h-0 flex-1"
            url={
              drawer.kind === "package"
                ? `/api/meetings/${meetingId}/board-package`
                : `/api/email/attachments/${drawer.fileId}`
            }
            initialPage={drawer.kind === "package" ? drawer.page : 1}
            citedEnd={drawer.kind === "package" ? drawer.end : undefined}
          />
        </aside>
      ) : null}
      <aside className="flex w-72 shrink-0 flex-col overflow-hidden rounded-2xl bg-white text-slate-900 shadow-sm">
        <p className="border-b border-slate-200 px-3 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Agenda
        </p>
        <ul className="min-h-0 flex-1 overflow-auto p-1">
          {agendaSidebarRows.map((row) => {
            const selected =
              row.kind === "leaf" &&
              !snapshot?.activeUnscheduled &&
              row.agendaItemId === active?.id;
            const paddingLeft = `${12 + agendaItemIndentDepth(row.itemNumber) * 20}px`;
            if (row.kind === "heading") {
              return (
                <li key={row.key}>
                  <div
                    style={{ paddingLeft }}
                    className="w-full rounded-lg py-1.5 pr-2 text-left text-sm font-medium text-slate-600"
                  >
                    {row.itemNumber ? `${row.itemNumber} ` : ""}
                    {row.title}
                  </div>
                </li>
              );
            }
            return (
              <li key={row.key}>
                <button
                  type="button"
                  disabled={!viewerIsPresenter || navBusy || !snapshot?.roomName}
                  style={{ paddingLeft }}
                  className={`w-full rounded-lg py-1.5 pr-2 text-left text-sm disabled:opacity-60 ${
                    selected ? "bg-slate-900 text-white" : "hover:bg-slate-50"
                  }`}
                  onClick={() => {
                    if (!row.agendaItemId) return;
                    void moveTo({
                      agendaItemId: row.agendaItemId,
                      page: stagePackagePage(
                        { kind: "leaf", agendaItemId: row.agendaItemId },
                        row.sourcePages,
                      ),
                    });
                  }}
                >
                  {row.itemNumber ? `${row.itemNumber} ` : ""}
                  {row.title}
                </button>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              disabled={!viewerIsPresenter || navBusy || !snapshot?.roomName}
              className={`w-full rounded-lg px-2 py-1.5 text-left text-sm disabled:opacity-60 ${
                snapshot?.activeUnscheduled ? "bg-slate-900 text-white" : "hover:bg-slate-50"
              }`}
              onClick={() => void moveTo({ unscheduled: true })}
            >
              Unscheduled discussion
            </button>
          </li>
        </ul>
      </aside>
      </div>

      <footer className="flex flex-wrap items-center justify-center gap-2 px-4 pb-4">
        {connection !== "connected" ? (
          <button
            type="button"
            onClick={() => void join()}
            disabled={connection === "connecting" || snapshot?.configured === false}
            className={barButton}
          >
            {connection === "connecting" ? "Joining…" : "Join"}
          </button>
        ) : (
          <button type="button" onClick={() => void toggleMic()} className={barButton}>
            {localPerson?.microphone ? "Mute" : "Unmute"}
          </button>
        )}
        <button
          type="button"
          disabled={!viewerIsPresenter || navBusy || !canStepBack}
          onClick={() => void stepStage(-1)}
          className={barButton}
        >
          Previous
        </button>
        <button
          type="button"
          disabled={!viewerIsPresenter || navBusy || !canStepForward}
          onClick={() => void stepStage(1)}
          className={barButton}
        >
          Next
        </button>
        {viewerIsPresenter ? (
          <button
            type="button"
            disabled={presenterBusy || connection !== "connected"}
            onClick={() => {
              setPresenterBusy(true);
              setJoinError(null);
              void postSnapshot(`/api/v2/meetings/${meetingId}/live/presenter`, { action: "release" })
                .catch((error: unknown) => {
                  setJoinError(error instanceof Error ? error.message : "Could not stop presenting.");
                })
                .finally(() => setPresenterBusy(false));
            }}
            className={barButton}
          >
            Stop presenting
          </button>
        ) : (
          <button
            type="button"
            disabled={presenterBusy || connection !== "connected" || Boolean(snapshot?.presenterIdentity)}
            onClick={() => {
              setPresenterBusy(true);
              setJoinError(null);
              void postSnapshot(`/api/v2/meetings/${meetingId}/live/presenter`, { action: "claim" })
                .catch((error: unknown) => {
                  setJoinError(
                    error instanceof Error ? error.message : "Could not become the presenter.",
                  );
                })
                .finally(() => setPresenterBusy(false));
            }}
            className={barButton}
          >
            {snapshot?.presenterIdentity ? "Someone is presenting" : "Become presenter"}
          </button>
        )}
        <button
          type="button"
          disabled={stagePage == null}
          onClick={() => openPackagePage(stagePage ?? 1)}
          className={barButton}
        >
          Open PDF
        </button>
        {connection === "connected" ? (
          <button
            type="button"
            onClick={() => {
              roomRef.current?.disconnect();
              setConnection("disconnected");
            }}
            className={barButton}
          >
            Leave
          </button>
        ) : null}
      </footer>
      <div ref={audioRef} className="hidden" />
    </div>
  );
}

