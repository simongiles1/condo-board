"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";

import { BoardPackageViewerDialog } from "@/components/BoardPackageViewerDialog";
import type { LiveRoomSnapshot } from "@/lib/meeting-v2/live-agenda";
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
  unknown: "border-amber-200 bg-amber-50 text-amber-900",
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
  const [packagePage, setPackagePage] = useState<number | null>(null);
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
          setSnapshot((current) =>
            current ? { ...current, recording: payload.recording } : payload,
          );
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

  async function moveTo(agendaItemId: string) {
    setNavBusy(true);
    setJoinError(null);
    try {
      const response = await fetch(`/api/v2/meetings/${meetingId}/live/navigate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agendaItemId }),
      });
      const payload = (await response.json().catch(() => null)) as
        | (LiveRoomSnapshot & { error?: string })
        | null;
      if (!response.ok || !payload || payload.error) {
        throw new Error(payload?.error ?? "Could not store the navigation event.");
      }
      setSnapshot(payload);
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : "Could not store the navigation event.");
    } finally {
      setNavBusy(false);
    }
  }

  const active =
    snapshot?.leaves.find((leaf) => leaf.id === snapshot.activeAgendaItemId) ?? null;
  const activeIndex = active
    ? snapshot?.leaves.findIndex((leaf) => leaf.id === active.id) ?? -1
    : -1;
  const marked = snapshot?.navigation.filter((event) => event.agendaItemId === active?.id).at(-1);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-4">
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
          {snapshot ? (
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
        {active ? (
          <>
            <h2 className="mt-2 text-lg font-semibold text-slate-900">
              {active.itemNumber ? `${active.itemNumber} ` : ""}
              {active.title}
            </h2>
            <p className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap text-sm text-slate-700">
              {active.sourceText?.trim() || "No package text is stored for this item."}
            </p>
            {active.sourcePages.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {active.sourcePages.map((page) => (
                  <button
                    key={page}
                    type="button"
                    onClick={() => setPackagePage(page)}
                    className="rounded-md border border-slate-200 px-2.5 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Page {page}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-500">No package pages are linked to this item.</p>
            )}
            <p className="mt-3 text-sm text-slate-500">
              {marked
                ? `Marked on the media clock at ${formatMediaClock(marked.mediaOffsetMs)}.`
                : "Not marked on the media clock yet."}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={navBusy || !snapshot?.roomName || activeIndex <= 0}
                onClick={() => {
                  const previous = snapshot?.leaves[activeIndex - 1];
                  if (previous) void moveTo(previous.id);
                }}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-800 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={navBusy || !snapshot?.roomName}
                onClick={() => void moveTo(active.id)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-800 disabled:opacity-40"
              >
                Mark on clock
              </button>
              <button
                type="button"
                disabled={
                  navBusy ||
                  !snapshot?.roomName ||
                  activeIndex < 0 ||
                  activeIndex >= snapshot.leaves.length - 1
                }
                onClick={() => {
                  const next = snapshot?.leaves[activeIndex + 1];
                  if (next) void moveTo(next.id);
                }}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </>
        ) : (
          <p className="mt-2 text-sm text-slate-600">
            {snapshot
              ? "This meeting has no agenda leaves yet."
              : "Loading the agenda."}
          </p>
        )}
        <p className="mt-4 text-sm text-slate-500">Speech recognition is not connected.</p>
      </div>

      {packagePage != null ? (
        <BoardPackageViewerDialog
          open
          meetingId={meetingId}
          initialPage={packagePage}
          onClose={() => setPackagePage(null)}
        />
      ) : null}
    </div>
  );
}
