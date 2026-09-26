"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";

import { BoardPackageViewerDialog } from "@/components/BoardPackageViewerDialog";
import {
  leafStepTarget,
  navigationAllowed,
  packagePageToOpen,
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
  const [personalPage, setPersonalPage] = useState<number | null>(null);
  const [dismissedPresentedPage, setDismissedPresentedPage] = useState<number | null>(null);
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

  async function moveTo(target: { agendaItemId: string } | { unscheduled: true }) {
    setNavBusy(true);
    setJoinError(null);
    try {
      await postSnapshot(
        `/api/v2/meetings/${meetingId}/live/navigate`,
        "unscheduled" in target ? { unscheduled: true } : { agendaItemId: target.agendaItemId },
      );
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : "Could not store the navigation event.");
    } finally {
      setNavBusy(false);
    }
  }

  const viewerIsPresenter = navigationAllowed(
    snapshot?.presenterIdentity ?? null,
    selfIdentity ?? "",
  );
  const active = snapshot?.activeUnscheduled
    ? null
    : (snapshot?.leaves.find((leaf) => leaf.id === snapshot.activeAgendaItemId) ?? null);
  const previousLeafId = snapshot
    ? leafStepTarget(snapshot.leaves, snapshot.navigation, -1)
    : null;
  const nextLeafId = snapshot ? leafStepTarget(snapshot.leaves, snapshot.navigation, 1) : null;
  const marked = snapshot?.activeUnscheduled
    ? snapshot.navigation.filter((event) => event.unscheduled).at(-1)
    : snapshot?.navigation.filter((event) => event.agendaItemId === active?.id).at(-1);
  const openPackage = packagePageToOpen({
    personalPage,
    presentedPage: snapshot?.presentedPage ?? null,
    viewerIsPresenter,
    dismissedPresentedPage,
  });

  useEffect(() => {
    if (snapshot?.presentedPage == null) setDismissedPresentedPage(null);
  }, [snapshot?.presentedPage]);

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

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-4">
      {critical && snapshot ? (
        <div role="alert" className="rounded-2xl border border-rose-300 bg-rose-50 px-4 py-4 text-rose-950">
          <p className="text-base font-semibold">Critical: capture is not healthy</p>
          <p className="mt-2 text-sm">{snapshot.recording.detail}</p>
          {snapshot.captureGaps.length > 0 ? (
            <ul className="mt-3 space-y-1 text-sm">
              {snapshot.captureGaps.map((gap) => (
                <li key={gap.id}>
                  Gap from {formatMediaClock(gap.startOffsetMs)}
                  {gap.endOffsetMs == null ? "" : ` to ${formatMediaClock(gap.endOffsetMs)}`}
                  {gap.participantIdentity ? ` · ${gap.participantIdentity}` : ""}
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
      <Link
        href={`/operations/meetings/v2/${meetingId}`}
        className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900"
      >
        <span>&larr;</span>
        Back to meeting
      </Link>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Live room</h1>
            <p className="mt-1 text-sm text-slate-500">
              {connection === "connected"
                ? "Connected"
                : connection === "connecting"
                  ? "Connecting"
                  : connection === "disconnected"
                    ? "Disconnected"
                    : "Not connected"}
              {people.length > 0 ? ` · ${people.length} in the room` : ""}
            </p>
          </div>
          {snapshot && !critical ? (
            <span
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${HEALTH_CLASS[snapshot.recording.state]}`}
            >
              {snapshot.recording.label}
            </span>
          ) : null}
        </div>
        {snapshot ? (
          <p className="mt-3 text-sm text-slate-600">{snapshot.recording.detail}</p>
        ) : null}
        {loadError ? <p className="mt-3 text-sm text-rose-700">{loadError}</p> : null}
        {joinError ? <p className="mt-3 text-sm text-rose-700">{joinError}</p> : null}
        {micError ? <p className="mt-3 text-sm text-amber-800">{micError}</p> : null}

        <div className="mt-4 flex flex-wrap gap-2">
          {connection !== "connected" ? (
            <button
              type="button"
              onClick={() => void join()}
              disabled={connection === "connecting" || snapshot?.configured === false}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              {connection === "connecting" ? "Joining…" : "Join room"}
            </button>
          ) : null}
          {micError && connection === "connected" ? (
            <button
              type="button"
              onClick={() => void roomRef.current?.localParticipant.setMicrophoneEnabled(true).then(() => {
                setMicError(null);
                if (roomRef.current) refreshPeople(roomRef.current);
              }).catch((error: unknown) => {
                setMicError(error instanceof Error ? error.message : "Microphone permission was denied.");
              })}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-800"
            >
              Turn microphone on
            </button>
          ) : null}
        </div>

        {people.length > 0 ? (
          <ul className="mt-4 space-y-1 text-sm text-slate-700">
            {people.map((person) => (
              <li key={person.identity}>
                {person.name}
                <span className="text-slate-400">
                  {person.microphone ? " · mic on" : " · mic off"}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <div ref={audioRef} className="hidden" />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Agenda</p>
        {snapshot && !snapshot.pageMap.checkedAt ? (
          <div role="status" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-amber-950">
            <p className="text-sm font-semibold">The leaf-to-page map has not been checked.</p>
            <p className="mt-1 text-sm">
              The room can still open. Confirm each item&apos;s pages before substantive business.
            </p>
            {snapshot.pageMap.leavesWithoutPages.length > 0 ? (
              <ul className="mt-2 list-disc pl-5 text-sm">
                {snapshot.pageMap.leavesWithoutPages.map((leaf) => (
                  <li key={leaf.id}>
                    {leaf.itemNumber ? `${leaf.itemNumber} ` : ""}
                    {leaf.title} has no package pages.
                  </li>
                ))}
              </ul>
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
              className="mt-3 rounded-lg bg-amber-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              {mapBusy ? "Recording…" : "Record map check"}
            </button>
          </div>
        ) : snapshot?.pageMap.checkedAt ? (
          <p className="mt-3 text-sm text-slate-500">
            Leaf-to-page map checked
            {snapshot.pageMap.checkedByName ? ` by ${snapshot.pageMap.checkedByName}` : ""}.
          </p>
        ) : null}
        {snapshot ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {viewerIsPresenter ? (
              <button
                type="button"
                disabled={presenterBusy || connection !== "connected"}
                onClick={() => {
                  setPresenterBusy(true);
                  setJoinError(null);
                  void postSnapshot(`/api/v2/meetings/${meetingId}/live/presenter`, {
                    action: "release",
                  })
                    .catch((error: unknown) => {
                      setJoinError(
                        error instanceof Error ? error.message : "Could not stop presenting.",
                      );
                    })
                    .finally(() => setPresenterBusy(false));
                }}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-800 disabled:opacity-40"
              >
                {presenterBusy ? "Updating…" : "Stop presenting"}
              </button>
            ) : snapshot.presenterIdentity ? (
              <p className="text-sm text-slate-600">
                Presenter: {snapshot.presenterDisplayName || "Someone else"}. Only the presenter
                moves the agenda.
              </p>
            ) : (
              <button
                type="button"
                disabled={presenterBusy || connection !== "connected"}
                onClick={() => {
                  setPresenterBusy(true);
                  setJoinError(null);
                  void postSnapshot(`/api/v2/meetings/${meetingId}/live/presenter`, {
                    action: "claim",
                  })
                    .catch((error: unknown) => {
                      setJoinError(
                        error instanceof Error ? error.message : "Could not become the presenter.",
                      );
                    })
                    .finally(() => setPresenterBusy(false));
                }}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
              >
                {presenterBusy ? "Updating…" : "Become presenter"}
              </button>
            )}
          </div>
        ) : null}
        {snapshot && (snapshot.activeUnscheduled || active) ? (
          <>
            <h2 className="mt-2 text-lg font-semibold text-slate-900">
              {snapshot.activeUnscheduled
                ? "Unscheduled discussion"
                : `${active?.itemNumber ? `${active.itemNumber} ` : ""}${active?.title ?? ""}`}
            </h2>
            {snapshot.activeUnscheduled ? (
              <p className="mt-3 text-sm text-slate-600">
                This discussion is not an agenda item. The leaf does not change until the presenter
                jumps back.
              </p>
            ) : (
              <p className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap text-sm text-slate-700">
                {active?.sourceText?.trim() || "No package text is stored for this item."}
              </p>
            )}
            {active && active.sourcePages.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {active.sourcePages.map((page) => (
                  <span key={page} className="inline-flex gap-1">
                    <button
                      type="button"
                      onClick={() => setPersonalPage(page)}
                      className="rounded-md border border-slate-200 px-2.5 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Page {page}
                    </button>
                    {viewerIsPresenter ? (
                      <button
                        type="button"
                        disabled={navBusy}
                        onClick={() => {
                          setNavBusy(true);
                          setJoinError(null);
                          void postSnapshot(`/api/v2/meetings/${meetingId}/live/present`, { page })
                            .then(() => setPersonalPage(page))
                            .catch((error: unknown) => {
                              setJoinError(
                                error instanceof Error
                                  ? error.message
                                  : "Could not present that page.",
                              );
                            })
                            .finally(() => setNavBusy(false));
                        }}
                        className="rounded-md border border-slate-900 px-2.5 py-1 text-sm font-medium text-slate-900 disabled:opacity-40"
                      >
                        Present
                      </button>
                    ) : null}
                  </span>
                ))}
              </div>
            ) : snapshot.activeUnscheduled ? null : (
              <p className="mt-3 text-sm text-slate-500">No package pages are linked to this item.</p>
            )}
            {viewerIsPresenter && snapshot.presentedPage != null ? (
              <button
                type="button"
                disabled={navBusy}
                onClick={() => {
                  setNavBusy(true);
                  setJoinError(null);
                  void postSnapshot(`/api/v2/meetings/${meetingId}/live/present`, { page: null })
                    .catch((error: unknown) => {
                      setJoinError(
                        error instanceof Error ? error.message : "Could not stop presenting that page.",
                      );
                    })
                    .finally(() => setNavBusy(false));
                }}
                className="mt-3 text-sm font-medium text-slate-600 underline"
              >
                Stop showing page {snapshot.presentedPage} to everyone
              </button>
            ) : null}
            {!viewerIsPresenter && snapshot.presentedPage != null ? (
              <p className="mt-3 text-sm text-slate-600">
                The presenter is showing page {snapshot.presentedPage}.
              </p>
            ) : null}
            <p className="mt-3 text-sm text-slate-500">
              {marked
                ? `Marked on the media clock at ${formatMediaClock(marked.mediaOffsetMs)}.`
                : "Not marked on the media clock yet."}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!viewerIsPresenter || navBusy || !snapshot.roomName || !previousLeafId}
                onClick={() => {
                  if (previousLeafId) void moveTo({ agendaItemId: previousLeafId });
                }}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-800 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={!viewerIsPresenter || navBusy || !snapshot.roomName}
                onClick={() => {
                  if (snapshot.activeUnscheduled) void moveTo({ unscheduled: true });
                  else if (active) void moveTo({ agendaItemId: active.id });
                }}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-800 disabled:opacity-40"
              >
                Mark on clock
              </button>
              <button
                type="button"
                disabled={!viewerIsPresenter || navBusy || !snapshot.roomName || !nextLeafId}
                onClick={() => {
                  if (nextLeafId) void moveTo({ agendaItemId: nextLeafId });
                }}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
              >
                Next
              </button>
            </div>
            {snapshot.leaves.length > 0 || viewerIsPresenter ? (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Jump</p>
                <ul className="mt-2 max-h-48 space-y-1 overflow-auto">
                  {snapshot.leaves.map((leaf) => {
                    const current = !snapshot.activeUnscheduled && leaf.id === active?.id;
                    return (
                      <li key={leaf.id}>
                        <button
                          type="button"
                          disabled={!viewerIsPresenter || navBusy || !snapshot.roomName}
                          onClick={() => void moveTo({ agendaItemId: leaf.id })}
                          className={`w-full rounded-md px-2 py-1 text-left text-sm disabled:opacity-70 ${
                            current ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50"
                          }`}
                        >
                          {leaf.itemNumber ? `${leaf.itemNumber} ` : ""}
                          {leaf.title}
                        </button>
                      </li>
                    );
                  })}
                  <li>
                    <button
                      type="button"
                      disabled={!viewerIsPresenter || navBusy || !snapshot.roomName}
                      onClick={() => void moveTo({ unscheduled: true })}
                      className={`w-full rounded-md px-2 py-1 text-left text-sm disabled:opacity-70 ${
                        snapshot.activeUnscheduled
                          ? "bg-slate-900 text-white"
                          : "text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      Unscheduled discussion
                    </button>
                  </li>
                </ul>
              </div>
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-sm text-slate-600">
            {snapshot ? "This meeting has no agenda leaves yet." : "Loading the agenda."}
          </p>
        )}
        {snapshot && snapshot.captureFiles.some((file) => file.playable) ? (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Recordings</p>
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {snapshot.captureFiles
                .filter((file) => file.playable)
                .map((file) => (
                  <li key={file.trackId}>
                    <a
                      className="font-medium text-slate-900 underline"
                      href={`/api/v2/meetings/${meetingId}/live/capture/${encodeURIComponent(file.trackId)}`}
                    >
                      Play {file.participantIdentity}
                    </a>
                    {file.clockDeltaMs != null
                      ? ` · file starts ${file.clockDeltaMs} ms from the media clock`
                      : ""}
                  </li>
                ))}
            </ul>
          </div>
        ) : null}
        <p className="mt-4 text-sm text-slate-500">Speech recognition is not connected.</p>
      </div>

      {openPackage.page != null ? (
        <BoardPackageViewerDialog
          open
          meetingId={meetingId}
          initialPage={openPackage.page}
          onClose={() => {
            if (openPackage.source === "presented" && openPackage.page != null) {
              setDismissedPresentedPage(openPackage.page);
            }
            setPersonalPage(null);
          }}
        />
      ) : null}
    </div>
  );
}
