# Virtual meeting, first release

The first time the board uses this, they join one meeting inside the platform. That meeting supplies participant audio, a shared agenda, document viewing, provisional captions, and outcome confirmation. Minutes V2 still drafts the record from the evidence this meeting stores.

Elapsed time is not a launch gate. The earlier 14–16 week figure was an uncalibrated allowance for one full-time developer. It does not account for AI-assisted implementation or for code that already exists. Ship when the checks in this document pass.

## Locked decisions

- One room. Cameras are optional. One participant per device. Shared-room diarization and NVIDIA Nemotron are later.
- LiveKit Cloud hosts the media. This app does not run the media server.
- The presenter moves the agenda. A different designated person confirms outcomes. Same screen, different controls. There is no private operator console.
- One leaf agenda item is one scrollable shared view. Next and Previous change that item. Opening an attachment does not.
- Navigation clicks are a prior for segmentation. Edge detection still runs, including returns to an earlier item and speech that crosses a click.
- Live captions are provisional. The record is the server recording, the original recognition, and traced corrections.
- A designated person's confirmation is the decision record. The pipeline surfaces a conflict with the transcript. It does not drop the confirmation, and it does not rewrite the original recognition to match it.
- OKF is not a dependency. Vocabulary comes from attendees, agenda titles, package text, and the contact registry.
- The management package-authoring tool is later. The first release prepares the meeting view from the package and agenda this app already extracts, and a person checks that map before the meeting.

## Existing foundations

Adapt these. Do not rebuild them.

| Already in the repo | Use it for |
| --- | --- |
| `meetings_v2_agenda_items.source_pages_json`, `source_text`, `item_number` | The leaf card and its package pages. |
| `BoardPackageViewerDialog` and `MeetingDocumentsDialog` | The attachment drawer. Opening it stays personal unless the presenter explicitly presents it. |
| `lib/meeting-v2/transcript.ts` | The cue shape V2 already stores: `startMs`, `endMs`, `speakerLabel`, `text`. Live recognition should land in that shape, or in a VTT the existing parser accepts. |
| `lib/parsers/vtt.ts` | Parsing and merging consecutive cues by speaker. |
| `docs/meeting-minutes-v2-evidence-pipeline.md` | Stage contracts. Package proposals, prior approvals, and current decisions stay distinct. A package figure overrides a spoken amount only in the existing thousands-truncation case. Minutes prose does not narrate speech-recognition repairs. |
| Submitted clarifications | The pattern for human evidence. Model proposals stay proposals until a person submits them. Outcome confirmations follow that rule. |
| Agenda discussion spans as a list of intervals | Returns and tangents. A navigation click does not replace this. It is another input to it. |

## Out of scope

- A second view that only one person uses while everyone else shares a PDF.
- Asking the property manager to author the package inside this app.
- OKF-derived vocabulary.
- Board-wide popups. Only the designated confirmer sees outcome prompts.
- Voting.
- Automatic tasks created from speech without that confirmation.
- Splitting historical mixed recordings into fake microphone tracks.
- Self-hosting LiveKit.

## Product behavior

### Joining and media

Participants join a LiveKit Cloud room from this app. Each person's published audio is recorded automatically when the room is created (LiveKit auto-egress). The screen shows whether that recording is actually healthy.

A transcription or assistance failure leaves the call and the recording running. A browser crash drops that person's audio until they rejoin. Everyone else continues. Refresh and rejoin restore the current agenda item and the participant's identity. After the room closes, each track file plays and lines up with the agenda clock.

Navigation events, transcript cues, and recordings share one media clock. Do not timestamp clicks with the facilitator's wall clock.

### Agenda

The shared view shows the active leaf: its briefing text and links to the package pages already associated with that item. The presenter can go to the next leaf, the previous leaf, or jump to a named leaf, including an unscheduled discussion. Most meetings can use Next. An unusual turn does not require repeated Previous clicks.

Everyone follows the active item. A participant may open an attachment for themselves. The presenter may present an attachment to everyone. Neither action changes the active item.

For a short window after Next, recognition still prefers the previous item's vocabulary, so the last sentences of that item are not retagged early.

Guests admitted for one item do not receive other items' documents through a drawer.

### Vocabulary and names

Prepare two lists before the call, with aliases:

- Meeting-wide: attendees, relevant absent contacts, property terms, and a short procedural list.
- Active item: contractors, assets, locations, project names, and document terms for that leaf.

Update the active list when the presenter changes items, with the hangover window above. Retrieve extra context only when the discussion leaves the active item. That retrieval is not a third permanent list.

A phrase list is a hint, not a fact. "Stairwell F" may be hinted. "The board previously approved Stairwell F" is background and must not be written into the transcript.

If exactly one attendee is phonetically close to a recognized name, store a traced proposal. If two attendees are close, flag the collision and do not pick one.

### Transcript layers

Keep three layers for the life of the meeting:

1. Original audio, per participant track.
2. Original recognition, with speaker identity from the track and timestamps on the media clock.
3. Traced correction proposals. A later pass may confirm, downgrade, or flag a proposal. It reads the original recognition plus the proposals. It does not rewrite an already cleaned transcript and then clean it again.

Amounts and decision words are never applied silently. They remain proposals until the designated person confirms, edits, or defers them.

### Outcome prompts

Prompt the designated confirmer only when the discussion appears to contain a material outcome that is still unresolved. Stay silent when nothing was decided. Do not prompt on every item. Do not limit the trigger to an unclear decision word: a confident wrong word, or a clear "yes" with an unclear amount or condition, still qualifies.

The prompt states the proposed record and shows the supporting quote beside it:

> Record that the board ratified the Stairwell F repair expenditure of $X, subject to Y?

The confirmer can confirm, edit, or defer. Next still moves the meeting. A deferred or late answer stays attached to the item that produced it.

Each stored confirmation records who submitted it, when, the item, the proposed text, the edited text if any, and the quote. If that confirmation conflicts with the transcript, the minutes pipeline shows the conflict. Silence is not success: missed outcomes are counted as well as inappropriate prompts.

## Implementation slices

Build these in order. Each slice is useful on its own. None of them is a partial product for the board.

### 1. Connect the pieces that already exist

- A LiveKit Cloud room with two participants, auto-egress of each audio track, a visible recording-health state, and a refresh that rejoins the same room.
- One existing agenda item rendered from `source_pages_json` and `source_text`, with its package pages available in the current document viewer. One navigation event stored on the same clock as the audio.
- Timestamped, speaker-attributed text written into `meetings_v2_transcript_segments` (or a VTT that `parseVttToMergedCues` already accepts). Name the exact gap, if any, before changing the minutes pipeline.
- A small labeled-excerpt run of the same recognizer with and without an agenda phrase list, taken from the mixed historical recordings. Record whether the recognizer applied the hints, whether the phrases were the right ones, and whether the remaining errors sit in overlapping speech. This run informs the hint list. It does not, by itself, drop live vocabulary.

### 2. First connected workflow

Join, hear each other, record a track per person, move the active leaf, see attributed provisional text, and pass that evidence into a V2 meeting as transcript segments plus navigation priors. Edge detection still runs.

### 3. Feature-complete for this release

Document drawers that do not change the active item, meeting-wide and per-item vocabulary with the hangover window, phonetic name proposals, the three transcript layers, confirmer-only outcome prompts, presenter-only navigation, guest limits, and recovery after a refresh or a transcription failure.

### 4. Board-ready

The checks below pass on the real interface. A person who will present has joined once before the board night. That rehearsal uses this product, not a second console.

## Accuracy measurements

Use three historical meetings to develop and hold one meeting out. August 12 stays in the development set because its errors are already known. Score the held-out meeting only after the method is fixed.

Historical files are one mixed audio track plus video. Run that audio through a recognizer. Do not diarize it and do not pretend it is separate LiveKit tracks. A miss on the mix is not proof that per-track hints will fail. A hit on the mix is not the live accuracy number. Overlapping speech on the mix is expected to look worse than one track per person.

Report counts and denominators. Four meetings is a small sample.

| Measure | Count | Safeguard |
| --- | --- | --- |
| Place and person names | Correct / labeled, for the bare recognizer, the same run with vocabulary, and the correction pass. Places and attendee names are separate rows. | If hints do not move the count, check hint application, phrase choice, and overlap before changing the approach. |
| Decision words | Correct / labeled, counted apart from names. | These stay proposals until a person confirms them. |
| False corrections | Automatic edits that change an amount or a decision meaning, over edits proposed. | Zero silent edits. The original words stay beside the proposal. |
| Topic placement | Speech time on the correct leaf, and returns to an earlier leaf that were linked back. Baseline is current V2 edge detection on the same transcript. | The click ships as a prior only if wrong-leaf time drops without losing returns. Edge detection stays either way. |
| Prompts | Appropriate prompts / prompts shown (precision), and unresolved outcomes prompted / unresolved outcomes labeled (recall). A prompt with the wrong amount, item, or conditions counts as a miss. Silence on a non-decision counts toward precision. A missed decision counts against recall. | Poor precision or poor recall means the first board night can still use the room and the recording without live prompts. |
| Confirmation conflicts | Conflicts shown / conflicts present, on the scripted session. | A hidden override, or a rewritten original transcript, blocks launch. |

## Board-ready checks

| Check | Pass | Does not need to pass |
| --- | --- | --- |
| Mixed-audio comparison | Counts above are reported, including a note on whether hints were applied and whether errors were overlap. | Separate tracks or reconnects. |
| Short session on the real interface, several devices | People hear each other, talk over each other, move a leaf, refresh and rejoin, and each track file is retrievable. Recording health matches the files. | A full-length package or finished minutes. |
| Longer session on a real-sized package | Recording continues, files play after the room closes, clocks line up, and a heavy attachment opens. | Decision wording. An empty room cannot supply it. |
| Scripted stretch, then minutes | A late return is on the earlier item. A deferred prompt stays on its item. Speech after a reconnect is present. Minutes show the confirmation and any transcript conflict. The original recognition is intact. | That every director will find the join flow obvious. Confirm that once with the presenter. |

## Secrets

LiveKit URL, API key, and API secret stay in local env and the host secret store. They do not go in source, fixtures, or this document. Add the variable names and a short purpose comment to `.env.example` in the same change that first reads them.
