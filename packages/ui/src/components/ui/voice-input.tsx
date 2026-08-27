"use client";

/**
 * VoiceInput — browser-native dictation for any text field.
 *
 * Reuse-first (ADR-065): the recognition engine is adapted from
 * `speech-input.tsx` in vercel/ai-elements (Apache-2.0, Copyright 2023
 * Vercel, Inc. — see NOTICE at repo root). We vendor rather than depend
 * because ai-elements ships as a shadcn-style source registry, not a
 * runtime package, and `speech-input` is not yet published to the
 * registry. Keeping the engine recognisably upstream-shaped so it can be
 * re-synced when it lands.
 *
 * Deltas from upstream, all deliberate:
 *   1. Engine extracted into `useVoiceRecognition` so the button can be
 *      re-skinned per app — `apps/dashboard` ships no Tailwind, so a
 *      class-only button would render unstyled there.
 *   2. Interim transcripts are surfaced. Upstream sets
 *      `interimResults = true` but only ever emits `isFinal` results, so
 *      callers can't show partial text while the user is still speaking.
 *   3. Accessibility. Upstream renders a button with no accessible name.
 *      We add an aria-label, an aria-live status region, and a Ctrl+M
 *      shortcut.
 *   4. Locale defaults to `navigator.language` rather than a hardcoded
 *      "en-US".
 *
 * Zero network cost: this is the browser's own SpeechRecognition. In
 * Chrome/Edge that means Google's speech endpoint; in unsupported
 * browsers the control renders a disabled mic with an explanatory title
 * rather than disappearing silently.
 *
 * NEVER attach this to a password field — see `VoiceField` guard.
 */

import * as React from "react";
import { MicIcon, SquareIcon, Loader2Icon } from "lucide-react";
import { cn } from "../../lib/utils.js";

/* ------------------------------------------------------------------ *
 * Web Speech API types (upstream ai-elements — the DOM lib does not
 * ship these, and we can't add @types packages for a browser-native API)
 * ------------------------------------------------------------------ */

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onstart: ((this: SpeechRecognition, ev: Event) => void) | null;
  onend: ((this: SpeechRecognition, ev: Event) => void) | null;
  onresult:
    | ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void)
    | null;
  onerror:
    | ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void)
    | null;
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

type SpeechWindow = Window &
  typeof globalThis & {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  };

/** `unsupported` renders a disabled mic with an explanatory tooltip. */
export type VoiceRecognitionMode = "speech-recognition" | "unsupported";

export function detectVoiceRecognitionMode(): VoiceRecognitionMode {
  if (typeof window === "undefined") return "unsupported";
  const w = window as SpeechWindow;
  return w.SpeechRecognition || w.webkitSpeechRecognition
    ? "speech-recognition"
    : "unsupported";
}

/** Browser UI language, e.g. "en-GB". Falls back to en-US when unknown. */
export function defaultVoiceLocale(): string {
  if (typeof navigator === "undefined") return "en-US";
  return navigator.language || "en-US";
}

export interface UseVoiceRecognitionOptions {
  /** BCP-47 tag. Defaults to `navigator.language`. */
  lang?: string;
  /** Fires for each settled phrase. */
  onFinalTranscript?: (text: string) => void;
  /** Fires continuously while a phrase is still forming. */
  onInterimTranscript?: (text: string) => void;
  onError?: (error: string) => void;
}

export interface UseVoiceRecognitionResult {
  isListening: boolean;
  /** True once the engine exists and can be started. */
  isReady: boolean;
  mode: VoiceRecognitionMode;
  interimTranscript: string;
  error: string | null;
  start(): void;
  stop(): void;
  toggle(): void;
}

/**
 * Headless dictation engine. Adapted from vercel/ai-elements SpeechInput
 * (Apache-2.0); see the delta list in the file header.
 */
export function useVoiceRecognition(
  options: UseVoiceRecognitionOptions = {}
): UseVoiceRecognitionResult {
  const { lang, onFinalTranscript, onInterimTranscript, onError } = options;

  const [isListening, setIsListening] = React.useState(false);
  const [isReady, setIsReady] = React.useState(false);
  const [interimTranscript, setInterimTranscript] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  // Detect once, lazily — `window` is absent during SSR.
  const [mode] = React.useState<VoiceRecognitionMode>(detectVoiceRecognitionMode);

  const recognitionRef = React.useRef<SpeechRecognition | null>(null);

  // Keep callbacks on refs so re-renders don't tear down the engine
  // mid-utterance (upstream re-created it whenever a prop identity changed).
  const finalRef = React.useRef(onFinalTranscript);
  const interimRef = React.useRef(onInterimTranscript);
  const errorRef = React.useRef(onError);
  finalRef.current = onFinalTranscript;
  interimRef.current = onInterimTranscript;
  errorRef.current = onError;

  React.useEffect(() => {
    if (mode !== "speech-recognition") return;

    const w = window as SpeechWindow;
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang || defaultVoiceLocale();

    recognition.onstart = () => {
      setIsListening(true);
      setError(null);
    };

    recognition.onend = () => {
      setIsListening(false);
      setInterimTranscript("");
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let final = "";
      let interim = "";

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result?.[0]?.transcript ?? "";
        if (result?.isFinal) final += text;
        else interim += text;
      }

      // Delta #2: upstream drops `interim` on the floor.
      setInterimTranscript(interim);
      if (interim) interimRef.current?.(interim);
      if (final) finalRef.current?.(final);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // `aborted` is what a normal stop() looks like — not worth surfacing.
      if (event.error !== "aborted") {
        setError(event.error);
        errorRef.current?.(event.error);
      }
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    setIsReady(true);

    return () => {
      recognition.onstart = null;
      recognition.onend = null;
      recognition.onresult = null;
      recognition.onerror = null;
      try {
        recognition.stop();
      } catch {
        // stop() throws if it was never started; nothing to clean up.
      }
      recognitionRef.current = null;
      setIsReady(false);
    };
  }, [mode, lang]);

  const start = React.useCallback(() => {
    const r = recognitionRef.current;
    if (!r || isListening) return;
    try {
      r.start();
    } catch {
      // Chrome throws InvalidStateError if start() races a pending stop.
    }
  }, [isListening]);

  const stop = React.useCallback(() => {
    const r = recognitionRef.current;
    if (!r) return;
    try {
      r.stop();
    } catch {
      /* already stopped */
    }
  }, []);

  const toggle = React.useCallback(() => {
    if (isListening) stop();
    else start();
  }, [isListening, start, stop]);

  return {
    isListening,
    isReady,
    mode,
    interimTranscript,
    error,
    start,
    stop,
    toggle,
  };
}

/* ------------------------------------------------------------------ *
 * Presentation
 * ------------------------------------------------------------------ */

/**
 * Colours resolve through @caia/ui tokens where they exist and fall back
 * to the literal token values otherwise, so the identical component also
 * renders correctly in `apps/dashboard`, which ships no Tailwind build.
 */
const TOKEN = {
  muted: "hsl(var(--muted-foreground, 215.4 16.3% 46.9%))",
  destructive: "hsl(var(--destructive, 0 84.2% 60.2%))",
  ring: "hsl(var(--ring, 222.2 84% 4.9%))",
} as const;

const PULSE_KEYFRAMES = `
@keyframes caia-voice-pulse {
  0%   { transform: scale(1);   opacity: 0.7; }
  70%  { transform: scale(1.9); opacity: 0;   }
  100% { transform: scale(1.9); opacity: 0;   }
}
@keyframes caia-voice-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .caia-voice-pulse-ring { animation: none !important; opacity: 0.35; }
}
`;

/** Injected once per document; keyframes can't be expressed inline. */
function PulseKeyframes() {
  return <style>{PULSE_KEYFRAMES}</style>;
}


/**
 * Nearest ancestor of the mic that also contains a text control — that
 * element is the mic's "field group" for shortcut-scoping purposes.
 */
function findFieldScope(from: HTMLElement | null): HTMLElement | null {
  let node: HTMLElement | null = from?.parentElement ?? null;
  while (node) {
    if (node.querySelector("input, textarea")) return node;
    node = node.parentElement;
  }
  return null;
}

export interface VoiceInputProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  /** Current field value — dictation is appended to it. */
  value: string;
  /** Receives the new full value. Wire straight to your setState. */
  onValueChange: (next: string) => void;
  /**
   * `append` (default) adds to what's already typed; `replace` overwrites
   * the field on each dictation session.
   */
  writeMode?: "append" | "replace";
  /** BCP-47 tag. Defaults to `navigator.language`. */
  lang?: string;
  /** Field name used in the accessible label, e.g. "message". */
  fieldLabel?: string;
  /** Bind Ctrl+M / Cmd+M to toggle while the field has focus. Default true. */
  shortcut?: boolean;
  /** Surface live partial text to the caller (e.g. a ghost overlay). */
  onInterimChange?: (interim: string) => void;
}

/**
 * A mic toggle that dictates into a controlled text field.
 *
 * Renders nothing but a button — pair it with `VoiceField` to get the
 * standard top-right placement over an input or textarea.
 */
export const VoiceInput = React.forwardRef<HTMLButtonElement, VoiceInputProps>(
  (
    {
      value,
      onValueChange,
      writeMode = "append",
      lang,
      fieldLabel,
      shortcut = true,
      onInterimChange,
      className,
      style,
      ...props
    },
    ref
  ) => {
    const buttonRef = React.useRef<HTMLButtonElement | null>(null);
    React.useImperativeHandle(ref, () => buttonRef.current as HTMLButtonElement);

    // Read the latest value without making the engine callbacks stale.
    const valueRef = React.useRef(value);
    valueRef.current = value;
    const sessionBaseRef = React.useRef<string>("");

    const handleFinal = React.useCallback(
      (text: string) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        const base =
          writeMode === "replace" ? sessionBaseRef.current : valueRef.current;
        const next = base ? `${base.replace(/\s+$/, "")} ${trimmed}` : trimmed;
        sessionBaseRef.current = next;
        onValueChange(next);
      },
      [onValueChange, writeMode]
    );

    const { isListening, isReady, mode, interimTranscript, error, toggle } =
      useVoiceRecognition({
        // Spread-if-present: the package builds with
        // `exactOptionalPropertyTypes`, so an explicit `undefined` is a
        // type error rather than an omission.
        ...(lang ? { lang } : {}),
        ...(onInterimChange ? { onInterimTranscript: onInterimChange } : {}),
        onFinalTranscript: handleFinal,
      });

    // In `replace` mode each session starts from empty and accumulates.
    React.useEffect(() => {
      if (isListening) sessionBaseRef.current = writeMode === "replace" ? "" : value;
      // Only on transition into listening — `value` is intentionally not a dep.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isListening, writeMode]);

    React.useEffect(() => {
      onInterimChange?.(interimTranscript);
    }, [interimTranscript, onInterimChange]);

    // Ctrl+M is scoped to the field this mic belongs to. A page can host
    // several mics (the contact form has three); a window-wide binding
    // would start every one of them at once.
    const rootRef = React.useRef<HTMLSpanElement | null>(null);
    React.useEffect(() => {
      if (!shortcut || mode !== "speech-recognition") return;
      const onKey = (e: KeyboardEvent) => {
        if (!((e.ctrlKey || e.metaKey) && (e.key === "m" || e.key === "M"))) return;
        const active = document.activeElement;
        if (!active) return;
        const scope = findFieldScope(rootRef.current);
        // Fire only when focus is on this mic or inside its field group.
        if (active !== buttonRef.current && !(scope && scope.contains(active))) return;
        e.preventDefault();
        toggle();
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [shortcut, toggle, mode]);

    const unsupported = mode === "unsupported";
    const suffix = fieldLabel ? ` for ${fieldLabel}` : "";
    const label = unsupported
      ? `Voice input is not supported in this browser${suffix}`
      : isListening
        ? `Stop dictating${suffix}`
        : `Dictate${suffix}${shortcut ? " (Ctrl+M)" : ""}`;

    return (
      <>
        <PulseKeyframes />
        <span
          ref={rootRef}
          style={{
            position: "relative",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {isListening ? (
            <span
              aria-hidden="true"
              className="caia-voice-pulse-ring"
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: "9999px",
                border: `2px solid ${TOKEN.destructive}`,
                animation: "caia-voice-pulse 1.8s ease-out infinite",
                pointerEvents: "none",
              }}
            />
          ) : null}

          <button
            ref={buttonRef}
            type="button"
            onClick={toggle}
            disabled={unsupported || !isReady}
            aria-label={label}
            title={label}
            aria-pressed={isListening}
            data-listening={isListening ? "true" : "false"}
            data-testid="voice-input-button"
            className={cn("caia-voice-input", className)}
            style={{
              position: "relative",
              zIndex: 1,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              height: "1.75rem",
              width: "1.75rem",
              borderRadius: "9999px",
              border: "none",
              background: "transparent",
              cursor: unsupported || !isReady ? "not-allowed" : "pointer",
              opacity: unsupported || !isReady ? 0.4 : 1,
              color: isListening ? TOKEN.destructive : TOKEN.muted,
              outlineColor: TOKEN.ring,
              transition: "color 150ms ease",
              ...style,
            }}
            {...props}
          >
            {!isReady && !unsupported ? (
              <Loader2Icon
                aria-hidden="true"
                style={{
                  height: "1rem",
                  width: "1rem",
                  animation: "caia-voice-spin 1s linear infinite",
                }}
              />
            ) : isListening ? (
              <SquareIcon aria-hidden="true" style={{ height: "0.875rem", width: "0.875rem" }} />
            ) : (
              <MicIcon aria-hidden="true" style={{ height: "1rem", width: "1rem" }} />
            )}
          </button>
        </span>

        {/* Screen-reader status. Polite so it never interrupts dictation. */}
        <span
          aria-live="polite"
          role="status"
          data-testid="voice-input-status"
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            padding: 0,
            margin: -1,
            overflow: "hidden",
            clip: "rect(0 0 0 0)",
            whiteSpace: "nowrap",
            borderWidth: 0,
          }}
        >
          {unsupported
            ? "Voice input is not supported in this browser."
            : error
              ? `Voice input error: ${error}.`
              : isListening
                ? "Listening. Speak now."
                : ""}
        </span>
      </>
    );
  }
);
VoiceInput.displayName = "VoiceInput";

export interface VoiceFieldProps {
  /** The input/textarea to overlay. */
  children: React.ReactNode;
  /**
   * Never pass a password field. Set this and the mic is omitted
   * entirely — the guard exists so the rule survives future edits.
   */
  sensitive?: boolean;
  className?: string;
  /** Nudge the mic down for multi-line fields. */
  offsetTop?: string;
}

/**
 * Positions a `VoiceInput` at the top-right of a field.
 *
 * `sensitive` fields (passwords, API keys) render the field alone — voice
 * transcripts are sent to a third-party speech service by the browser, so
 * secrets must never be dictated.
 */
export function VoiceField({
  children,
  sensitive = false,
  className,
  offsetTop = "0.375rem",
  voice,
}: VoiceFieldProps & { voice?: React.ReactNode }) {
  if (sensitive) return <>{children}</>;
  return (
    <span className={cn("caia-voice-field", className)} style={{ position: "relative", display: "block" }}>
      {children}
      <span
        style={{
          position: "absolute",
          top: offsetTop,
          right: "0.375rem",
          display: "inline-flex",
          alignItems: "center",
        }}
      >
        {voice}
      </span>
    </span>
  );
}
