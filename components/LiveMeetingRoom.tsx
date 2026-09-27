"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";

import { BoardPackageViewerDialog } from "@/components/BoardPackageViewerDialog";
import {
  navigationAllowed,
  stageMove,
  stagePackagePage,
  type LiveRoomSnapshot,
} from "@/lib/meeting-v2/live-agenda";
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

const HEALTH_CLASS: Record<RecordingHealthState, string> = {
  unconfigured: "border-amber-200 bg-amber-50 text-amber-900",
  waiting: "border-amber-200 bg-amber-50 text-amber-900",
  recording: "border-emerald-200 bg-emerald-50 text-emerald-900",
  failed: "border-rose-200 bg-rose-50 text-rose-900",
  finished: "border-slate-200 bg-slate-100 text-slate-700",
  unknown: "border-rose-200 bg-rose-50 text-rose-900",
};

/**
 * LiveKit room, recording health, and one shared agenda leaf for a V2 meeting.
 */
export function LiveMeetingRoom({ meetingId }: { meetingId: string }) {
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
  const [packageOpen, setPackageOpen] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);
  const roomRef = useRef<Room | null>(null);
  const audioRef = useRef<HTMLDivElement>(null);
  const autoJoined = useRef(false);

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
    setSnapshot(payload.snapshot);
    await connectRoom(payload);
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
    if (!snapshot?.configured || !snapshot.roomName || autoJoined.current) return;
    autoJoined.current = true;
    void join();
  }, [join, snapshot?.configured, snapshot?.roomName]);

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

  async function stepStage(direction: -1 | 1) {
    if (!snapshot) return;
    const move = stageMove({
      leaves: snapshot.leaves,
      navigation: snapshot.navigation,
      presentedPage: snapshot.presentedPage,
      direction,
    });
    if (!move) return;
    if (move.kind === "page") {
      setNavBusy(true);
      setJoinError(null);
      try {
        await postSnapshot(`/api/v2/meetings/${meetingId}/live/present`, { page: move.page });
      } catch (error) {
        setJoinError(error instanceof Error ? error.message : "Could not change the shared page.");
      } finally {
        setNavBusy(false);
      }
      return;
    }
    await moveTo({ agendaItemId: move.agendaItemId, page: move.page });
  }

  const viewerIsPresenter = navigationAllowed(
    snapshot?.presenterIdentity ?? null,
    selfIdentity ?? "",
  );
  const active = snapshot?.activeUnscheduled
    ? null
    : (snapshot?.leaves.find((leaf) => leaf.id === snapshot.activeAgendaItemId) ?? null);
  const stagePage = stagePackagePage(
    snapshot?.activeUnscheduled
      ? { kind: "unscheduled" }
      : active
        ? { kind: "leaf", agendaItemId: active.id }
        : null,
    active?.sourcePages ?? [],
    snapshot?.presentedPage ?? null,
  );
  const stageExtract = extractPages.find((page) => page.pageNumber === stagePage) ?? null;
  const canStepBack = snapshot
    ? stageMove({
        leaves: snapshot.leaves,
        navigation: snapshot.navigation,
        presentedPage: snapshot.presentedPage,
        direction: -1,
      }) != null
    : false;
  const canStepForward = snapshot
    ? stageMove({
        leaves: snapshot.leaves,
        navigation: snapshot.navigation,
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

  const critical = snapshot?.recording.severity === "critical";
  const interrupted = snapshot?.captureGaps.find((gap) => gap.acceptedAt) ?? null;
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
    <div className="flex min-h-screen flex-col bg-slate-950">
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
        {snapshot && !critical ? (
          <span
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${HEALTH_CLASS[snapshot.recording.state]}`}
          >
            {snapshot.recording.label}
          </span>
        ) : (
          <span />
        )}
      </header>

      {critical && snapshot ? (
        <div role="alert" className="mx-4 mb-3 rounded-2xl border border-rose-300 bg-rose-50 px-4 py-4 text-rose-950">
          <p className="text-base font-semibold">Critical: capture is not healthy</p>
          <p className="mt-2 text-sm">{snapshot.recording.detail}</p>
          {snapshot.captureGaps.length > 0 ? (
            <ul className="mt-3 space-y-1 text-sm">
              {snapshot.captureGaps.map((gap) => (
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

      {snapshot && !snapshot.pageMap.checkedAt ? (
        <div role="status" className="mx-4 mb-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-amber-950">
          <p className="text-sm font-semibold">The leaf-to-page map has not been checked.</p>
          {snapshot.pageMap.leavesWithoutPages.length > 0 ? (
            <p className="mt-1 text-sm">
              {snapshot.pageMap.leavesWithoutPages.length} item
              {snapshot.pageMap.leavesWithoutPages.length === 1 ? "" : "s"} have no package pages.
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

      <main className="mx-4 mb-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white text-slate-900 shadow-sm">
        <div className="border-b border-slate-200 px-6 py-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            {snapshot?.activeUnscheduled ? "Unscheduled" : "Shared package"}
            {stagePage != null ? ` · Page ${stagePage}` : ""}
          </p>
          <h1 className="mt-1 text-2xl font-semibold">
            {snapshot?.activeUnscheduled
              ? "Unscheduled discussion"
              : active
                ? `${active.itemNumber ? `${active.itemNumber} ` : ""}${active.title}`
                : "Live room"}
          </h1>
          {stageExtract?.pageHeading ? (
            <p className="mt-1 text-sm text-slate-500">{stageExtract.pageHeading}</p>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
          {snapshot?.activeUnscheduled ? (
            <p className="text-slate-600">
              This discussion is not an agenda item. Next and Previous return to the package.
            </p>
          ) : stageExtract?.extractedText.trim() ? (
            <p className="whitespace-pre-wrap text-base leading-7 text-slate-800">
              {stageExtract.extractedText}
            </p>
          ) : (
            <p className="text-slate-500">
              {stagePage == null
                ? "This item has no package page."
                : `No extracted text is stored for page ${stagePage}.`}
            </p>
          )}
        </div>
      </main>

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
        <div className="relative">
          <button
            type="button"
            disabled={!viewerIsPresenter || navBusy || !snapshot?.roomName}
            onClick={() => setJumpOpen((open) => !open)}
            className={barButton}
          >
            Agenda
          </button>
          {jumpOpen && snapshot ? (
            <ul className="absolute bottom-12 left-0 z-10 max-h-64 w-80 overflow-auto rounded-xl border border-slate-200 bg-white p-1 text-slate-900 shadow-lg">
              {snapshot.leaves.map((leaf) => (
                <li key={leaf.id}>
                  <button
                    type="button"
                    className={`w-full rounded-lg px-2 py-1.5 text-left text-sm ${
                      !snapshot.activeUnscheduled && leaf.id === active?.id
                        ? "bg-slate-900 text-white"
                        : "hover:bg-slate-50"
                    }`}
                    onClick={() => {
                      setJumpOpen(false);
                      void moveTo({ agendaItemId: leaf.id, page: leaf.sourcePages[0] ?? null });
                    }}
                  >
                    {leaf.itemNumber ? `${leaf.itemNumber} ` : ""}
                    {leaf.title}
                  </button>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  className="w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50"
                  onClick={() => {
                    setJumpOpen(false);
                    void moveTo({ unscheduled: true });
                  }}
                >
                  Unscheduled discussion
                </button>
              </li>
            </ul>
          ) : null}
        </div>
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
          onClick={() => setPackageOpen(true)}
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
      {packageOpen && stagePage != null ? (
        <BoardPackageViewerDialog
          open
          meetingId={meetingId}
          initialPage={stagePage}
          onClose={() => setPackageOpen(false)}
        />
      ) : null}
    </div>
  );
}

