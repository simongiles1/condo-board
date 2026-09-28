"use client";

import { useEffect, useRef, useState } from "react";

export type CaptionStatus = "idle" | "listening" | "unsupported" | "error";

type SpeechResultEvent = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

type BrowserRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  grammars: SpeechGrammarList | null;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type GrammarCtor = new () => {
  addFromString: (grammar: string, weight: number) => void;
};

type SpeechWindow = Window & {
  SpeechRecognition?: new () => BrowserRecognition;
  webkitSpeechRecognition?: new () => BrowserRecognition;
  SpeechGrammarList?: GrammarCtor;
  webkitSpeechGrammarList?: GrammarCtor;
};

function grammarForPhrases(phrases: string[]): SpeechGrammarList | null {
  const ctor =
    (window as SpeechWindow).SpeechGrammarList ?? (window as SpeechWindow).webkitSpeechGrammarList;
  if (!ctor || phrases.length === 0) return null;
  const escaped = phrases.map((phrase) => phrase.replace(/[\\;=|*+]/g, " ").trim()).filter(Boolean);
  if (escaped.length === 0) return null;
  const grammar = `#JSGF V1.0; grammar hints; public <hint> = ${escaped.join(" | ")} ;`;
  const list = new ctor();
  list.addFromString(grammar, 1);
  return list as SpeechGrammarList;
}

/**
 * Sets a speech grammar when the browser accepts one.
 * Chromium throws if the value cannot convert to SpeechGrammarList, including null, so a rejection leaves the property unset and captions still start.
 */
export function applySpeechGrammar(
  recognition: { grammars: SpeechGrammarList | null },
  grammar: SpeechGrammarList | null,
): void {
  if (!grammar) return;
  try {
    recognition.grammars = grammar;
  } catch {
    // Chromium's grammars setter throws for a JSGF list and for null
    // ("Failed to convert value to 'SpeechGrammarList'"). Leave the default unset.
  }
}

/**
 * Transcribes this device's microphone in the browser.
 * Phrase hints are passed when the browser accepts a grammar. A failure here does not touch LiveKit egress.
 */
export function useLiveSpeechRecognition(input: {
  enabled: boolean;
  phrases: string[];
  onFinal: (text: string, durationMs: number) => void;
}): { status: CaptionStatus; interim: string; detail: string | null } {
  const [status, setStatus] = useState<CaptionStatus>("idle");
  const [interim, setInterim] = useState("");
  const [detail, setDetail] = useState<string | null>(null);
  const { enabled, onFinal, phrases } = input;
  const phraseKey = phrases.join("\n");
  const phrasesRef = useRef(phrases);
  phrasesRef.current = phrases;

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      setInterim("");
      setDetail(null);
      return;
    }

    const ctor =
      (window as SpeechWindow).SpeechRecognition ??
      (window as SpeechWindow).webkitSpeechRecognition;
    if (!ctor) {
      setStatus("unsupported");
      setDetail("This browser cannot caption the microphone. Audio recording is unchanged.");
      return;
    }

    let stopped = false;
    let startedAt = 0;
    const recognition = new ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    applySpeechGrammar(recognition, grammarForPhrases(phrasesRef.current));
    recognition.onresult = (event) => {
      let pending = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript ?? "";
        if (!result?.isFinal) {
          pending += transcript;
          continue;
        }
        const durationMs = startedAt > 0 ? Math.max(200, Date.now() - startedAt) : 1500;
        startedAt = 0;
        onFinal(transcript, durationMs);
      }
      if (pending && startedAt === 0) startedAt = Date.now();
      setInterim(pending.trim());
    };
    recognition.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      if (event.error === "not-allowed") {
        setStatus("error");
        setDetail("Microphone captions were blocked. Recording is unchanged.");
        stopped = true;
        return;
      }
      setStatus("error");
      setDetail("Captions stopped. Recording is unchanged.");
    };
    recognition.onend = () => {
      if (stopped) return;
      try {
        recognition.start();
        setStatus("listening");
      } catch {
        setStatus("error");
        setDetail("Captions stopped. Recording is unchanged.");
      }
    };

    try {
      recognition.start();
      setStatus("listening");
      setDetail(null);
    } catch {
      setStatus("error");
      setDetail("Captions could not start. Recording is unchanged.");
    }

    return () => {
      stopped = true;
      recognition.onend = null;
      try {
        recognition.stop();
      } catch {
        // stop() throws if recognition never reached the started state.
      }
    };
  }, [enabled, onFinal, phraseKey]);

  return { status, interim, detail };
}
