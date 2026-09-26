# Virtual meeting, first release

The first board meeting on this product happens inside the condo platform. LiveKit Cloud carries audio and video. This app owns the agenda, the documents, the capture record, and the handoff into Meeting Minutes V2.

The customer for this release is this board. Property management can be asked to use it. Other boards, several conferencing products, and a future commercial product do not change the scope. Daily and 100ms are not the foundation. Self-hosting LiveKit is possible later and is not a requirement now.

Elapsed time is not a launch gate. The 14–16 week chart is retired. It was written before the room slice below existed, and it mixed implementation with validation. This document separates those.

## What already exists

Committed on `main` as the virtual meeting room slice. Extend it. Do not replace the join path, the room name, or the navigation table.

| Piece | Behavior today |
| --- | --- |
| `lib/livekit/config.ts` | Reads `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET`. Builds auto track egress to S3 only when bucket, access key, and secret are all set. |
| `joinLiveRoom` | Creates `v2-{meetingId}` once. A later join returns that room, so a refresh does not start a second recording. Egress is omitted when no bucket is set, because Cloud would otherwise reject the join. |
| `meetings_v2_live_sessions` | One row per meeting. `mediaStartedAt` is the time that row was inserted. |
| `recordLiveNavigation` | Stores the leaf id and `mediaOffsetMs`, computed on the server as elapsed time since `mediaStartedAt`. The click is not stored as the facilitator's wall clock. |
| `LiveMeetingRoom` | Join, hear remote audio, microphone on or off, recording badge, one leaf of `source_text`, and a jump list. Previous, Next, jump, and unscheduled discussion are enabled only for the presenter. Page buttons open `BoardPackageViewerDialog` for that person. Present sends the page to everyone else and does not change the leaf. An unchecked leaf-to-page map is a room notice; the room still opens. |
| Recording badge | Capture health from `assessCaptureHealth`: every publishing microphone must match a live track egress, a failed read or a missing bucket is critical, and failed egress is critical unless a gap row covers it. |
| Cue shape | `liveCuesToMergedCues` matches the VTT cues V2 already parses. Rows are not inserted. `LIVE_TRANSCRIPT_INSERT_GAP` records why: a second transcript artifact would be read as the historical transcript, and no recognizer is connected. |
| Tests | `scripts/test-meeting-v2-live-room.ts` covers the clock, leaf order, egress configuration, badge collapse, and the decision not to insert live cues. |

Also reused, and not rebuilt: agenda leaves and `source_pages_json` from package extraction, `BoardPackageViewerDialog`, `lib/parsers/vtt.ts`, and the Minutes V2 stage contracts in `docs/meeting-minutes-v2-evidence-pipeline.md`.

## Gaps in that slice

These are the reasons the current badge is not the capture requirement below.

- A publishing microphone can still lack a file if egress status lags. The grace period is a starting value of 20 seconds in code. That number still has to be measured in a live room.
- `mediaStartedAt` is still the database insert. After the room closes, the file start is stored as a clock delta. Navigation offsets are not corrected until that delta is judged large.
- There is still no separate facilitator role. The unchecked map notice and the capture warning are visible to every participant, so the facilitator sees them.
- Speech recognition is a sentence on the page. Nothing is recorded as original recognition or as a correction.
- Next is only navigation. It does not confirm a decision. Confirmation does not exist yet.

## Locked product behavior

- One room. Cameras optional. One person per device.
- One scrollable view per leaf. The presenter uses Next, Previous, or jump, including an unscheduled discussion. Everyone else follows the active leaf.
- Opening a document is a drawer or modal. It does not change the active leaf. A personal open stays personal. Present-to-everyone is a separate presenter action.
- A person checks the leaf-to-page map before the meeting. The room can still open if the check is incomplete, and the facilitator sees that it is incomplete.
- Vocabulary is meeting-wide plus the active leaf, with a short hangover on the previous leaf after Next. OKF is not a source.
- Navigation markers are a prior. A content pass still assigns returns, tangents, and speech that crosses a click. Edge detection stays.
- A designated person, not the presenter, confirms outcomes. The prompt shows a proposed statement and the quote. Confirm, edit, or defer. Next never means approved or ratified. A late answer stays on the item that produced it.
- Original audio, original recognition, and traced corrections stay separate. Amounts and decision words are never applied silently.
- Minutes V2 drafts from that evidence. A human confirmation is evidence with an author and a time. The pipeline shows a conflict with the transcript. It does not drop the confirmation, and it does not rewrite the original recognition.

## Out of scope

- A bot inside Teams, Meet, or Zoom, and any other conferencing vendor.
- Self-hosting the media server.
- Package authoring for management.
- OKF vocabulary.
- Shared-room diarization and NVIDIA Nemotron.
- Board-wide popups, voting, and tasks created from speech without a confirmation.
- Rebuilding the committed join, egress configuration, or navigation table.

## Capture, distinct from the call

People being able to hear each other is not evidence that the meeting is being preserved. Transcription and recording fail independently. Recording is started by LiveKit egress when the room is created, not by the recognizer.

### Degraded: transcription failed, audio is verified

Acceptable. Live captions and outcome suggestions may stop. The facilitator sees a specific transcription failure. Egress keeps running. Recovery retries recognition from the stored audio for the affected interval without inserting a second copy of audio that was already captured. Minutes can be produced afterward from that audio.

### Critical: capture failed, or capture cannot be shown

Not acceptable, even when the room is still connected. This includes: egress failed, aborted, or hit a limit; a publishing microphone has no matching egress after a short grace period; the status read failed; the bucket is not configured; a room was created before the bucket existed and therefore has no egress until it is recreated. The facilitator gets a full-width warning, not a small badge. Substantive business should stop until capture is restored or the gap is explicitly accepted.

The recovery actions are pause substantive business, restore capture, or switch to the backup. The backup in this release is not another product. It is a facilitator action stored on the meeting: capture is interrupted, and any discussion after that mark is absent until capture is healthy again. This app does not join Teams to fill the hole.

### A gap already happened

Store the interval: start and end on the media clock, which tracks or participants were missing, and how that was detected. Minutes for that interval are incomplete. The draft says so. Nothing generates the missing discussion. A person may add a clarification, stored as their statement, separate from the transcript. That note does not become original recognition.

### How health is verified

Do not infer health from the WebRTC connection, from "Connected" on the page, or from the room existing.

While the meeting is open, healthy capture means all of the following, read from LiveKit egress and from who is publishing a microphone:

1. The egress list was read successfully just now.
2. Every publishing microphone has a matching track egress in `starting`, `active`, or `ending`.
3. That match appeared within a bounded grace period after the track was published.
4. No egress for this room is `failed`, `aborted`, or `limit` unless a gap row already covers that failure.

Anything short of that is critical, including a failed status read.

After the room closes, recoverable capture means all of the following:

1. Each expected track egress is `complete`.
2. The object is in the configured bucket and can be opened.
3. Its duration covers the time that microphone was publishing, minus disclosed gaps.
4. A person can play it, and its start lines up with `mediaStartedAt` closely enough that navigation offsets land on the right speech. Measure and store that delta. Do not assume it is zero. The current offset is server elapsed time since the session row, not the file's first sample.

Transcription health is a second indicator. It is never folded into the capture indicator, and a transcription error must not stop or restart egress.

## Architecture

```text
LiveMeetingRoom (existing)
  join / navigate  ->  meetings_v2_live_sessions
                   ->  meetings_v2_live_navigation_events
  livekit-client   ->  LiveKit Cloud room v2-{meetingId}

LiveKit auto track egress (existing, when S3 env is set)
  -> object storage
  -> EgressClient.listEgress
  -> capture ledger matched to publishing microphones
  -> facilitator warning: healthy, degraded, or critical

Recognizer (not built), separate process
  -> original recognition cues
  -> does not call egress and does not write meetings_v2_transcript_segments

Correction pass (not built)
  -> proposals beside the original cues

Minutes V2
  -> reads a chosen transcript source, navigation priors, confirmations, and gap rows
  -> does not treat a live artifact as the historical transcript by accident
```

The recognizer reads stored audio, or a live stream that can die without touching egress. The first board night can run recognition after the meeting if live captions are down, provided capture stayed healthy.

## Work

Sizes are relative to the room slice already shipped, for this repo with AI-assisted implementation. They are not a schedule and not a launch gate.

### Implementation

| Work | Size against the shipped room slice | Notes |
| --- | --- | --- |
| Capture ledger, per-microphone match, critical warning, gap rows, post-meeting file check | Shipped in code | Extends the recording state. Does not replace join or egress configuration. Grace is 20 seconds until a live room measures it. Validation rehearsals below are still open. |
| Presenter-only Next, Previous, and jump. Pre-meeting map check. Present-to-everyone versus personal open. | Shipped in code | The first claim holds the presenter role until that person releases it. Followers see the leaf and a presented page on the room poll. The map check is stored on the meeting, not the session, so it does not start the media clock. |
| Recognizer, meeting-wide and active-item vocabulary, three stored layers | Larger than that slice, and only after a recognizer is chosen | Must be unable to stop egress. Must not insert into the historical transcript artifact. |
| Content pass over navigation markers, confirmations, gap disclosure in the draft | About that slice | Adapt span intervals, clarifications, and the V2 stage contracts. Do not add a second minutes pipeline. |

### Validation

These are rehearsals, not features. Generating the code does not complete them.

- Two devices publish audio. Stop the recognizer. Egress stays active, and both files play afterward with no duplicate audio from the retry.
- Remove or reject the bucket, or force an egress failure. The facilitator warning is unmistakable while people can still hear each other. A gap row exists. The draft does not call that interval complete.
- Status read fails. The room shows critical, not amber "Unknown".
- Refresh rejoins the same room and does not start a second egress for the same track.
- A scripted return, a deferred confirmation, and a reconnect. Minutes show the confirmation, any transcript conflict, and the original recognition unchanged.
- The historical mixed recordings still score vocabulary with and without hints. That score informs the hint list. It does not prove live per-track accuracy, and one weak run does not drop hints until hint application, phrase choice, and overlap have been checked. Report counts and denominators, including prompt precision and recall.

### Unresolved risks

These can add work. They are not estimated as weeks.

- Egress status can lag the moment a track is published. The grace period has to be long enough to avoid false critical alarms and short enough that a real miss is not silent. That number comes from a live room, not from the SDK types.
- The file timeline may not match `mediaStartedAt`. If the measured delta is large, navigation offsets need a stored correction. That is a change to the clock, done only after the delta is measured.
- No recognizer is selected. Phrase-list support differs by vendor. The room does not wait on that choice for capture.
- Prompt precision may be too poor for the first night. The room and the recording still launch. Live prompts can stay off. Recall is still reported so silence is not treated as success.
- A room created before the bucket was set never gains egress. Recovery is everyone leaving and opening it again, which the badge already states. The critical warning has to say that in the meeting, not only in the empty-room detail.

## Acceptance

The first board night requires:

- Presenter moves leaves. Other participants do not. Documents open without changing the leaf.
- The map was checked, or the facilitator can see that it was not.
- Capture meets the in-meeting rules above for the whole substantive session, or every exception is a stored gap.
- Afterward, files play, durations cover publishing time minus gaps, and the clock delta is recorded.
- A transcription outage during a healthy recording does not stop egress and does not block minutes.
- A capture outage cannot be ignored, and the resulting minutes name the missing interval.
- Original recognition is intact. Confirmations have an author. Conflicts are visible. Next did not write a decision.
- Returns and tangents can land on an earlier leaf without erasing the navigation history.

## Secrets

LiveKit and egress credentials stay in local env and the host secret store. Names and purpose comments are already in `.env.local.example`. Do not put values in source, fixtures, or this document.
