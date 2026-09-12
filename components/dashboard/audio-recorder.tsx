"use client";
/**
 * Voice notes for the issues log — record on the phone, play back anywhere.
 *
 * Three pieces:
 *  - useAudioRecorder(): MediaRecorder behind a small state machine
 *    (idle → requesting → recording → done), with the reasons it can fail
 *    named so the page can say the right thing (blocked microphone, plain
 *    http, an old browser).
 *  - <RecordControl>: one big button. Tap to record, tap to stop, hear it
 *    back, delete it. Sized for a gloved thumb like the downtime page.
 *  - <SavedClip>: a recording already in Drive. The bytes come through the
 *    GUARDED /api/issues/audio route with a token — an <audio src> cannot
 *    carry a header — so the clip is fetched once, kept as an object URL for
 *    the page's life, and handed to a player.
 *
 * WebM from MediaRecorder reports an infinite duration until it has played
 * through once (a long-standing Chrome quirk), so the player takes the
 * seconds the recorder counted as a hint and trusts the element only when it
 * reports a finite number.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Mic, Pause, Play, Square, Trash2 } from "lucide-react";
import { authedFetch } from "@/lib/authed-fetch";
import {
  AUDIO_BITS_PER_SECOND, MAX_AUDIO_SECONDS, formatSeconds, pickRecordingMime, type AudioRef,
} from "@/lib/issues";

type RecorderStrings = {
  recording: string; tapToStop: string; stopRecording: string; maxHint: string; preview: string;
  deleteRecording: string; rerecord: string; play: string; pause: string; loadingAudio: string;
  cantPlay: string; openInDrive: string; audioLoadFailed: string; voiceNote: string;
  micDenied: string; micInsecure: string; micUnsupported: string; micFailed: string;
};

export type Recording = { blob: Blob; mime: string; seconds: number; url: string };
type RecorderError = "" | "denied" | "insecure" | "unsupported" | "failed";
type RecorderState = "idle" | "requesting" | "recording" | "done";

/* ------------------------------- the hook -------------------------------- */

export function useAudioRecorder(maxSeconds: number = MAX_AUDIO_SECONDS) {
  const [state, setState] = useState<RecorderState>("idle");
  const [error, setError] = useState<RecorderError>("");
  const [seconds, setSeconds] = useState(0);
  const [recording, setRecording] = useState<Recording | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number | null>(null);
  const startedAt = useRef(0);

  const releaseMic = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };
  const stopTimer = () => {
    if (timer.current !== null) { window.clearInterval(timer.current); timer.current = null; }
  };

  const stop = useCallback(() => {
    const r = rec.current;
    if (r && r.state !== "inactive") r.stop();
  }, []);

  const start = useCallback(async () => {
    setError("");
    if (typeof window === "undefined") return;
    if (!window.isSecureContext) { setError("insecure"); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("unsupported"); return;
    }
    const mime = pickRecordingMime((m) => MediaRecorder.isTypeSupported(m));
    if (!mime) { setError("unsupported"); return; }
    setState("requesting");
    let s: MediaStream;
    try {
      s = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const name = (e as DOMException | undefined)?.name ?? "";
      setError(name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError" ? "denied" : "failed");
      setState("idle");
      return;
    }
    stream.current = s;
    let r: MediaRecorder;
    try {
      r = new MediaRecorder(s, { mimeType: mime, audioBitsPerSecond: AUDIO_BITS_PER_SECOND });
    } catch {
      try { r = new MediaRecorder(s); } catch { releaseMic(); setError("unsupported"); setState("idle"); return; }
    }
    chunks.current = [];
    r.ondataavailable = (ev: BlobEvent) => { if (ev.data && ev.data.size > 0) chunks.current.push(ev.data); };
    r.onerror = () => {
      stopTimer(); releaseMic();
      setError("failed"); setState("idle");
    };
    r.onstop = () => {
      stopTimer(); releaseMic();
      const type = r.mimeType || mime;
      const blob = new Blob(chunks.current, { type });
      const secs = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000));
      if (blob.size === 0) { setError("failed"); setState("idle"); return; }
      setRecording((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        return { blob, mime: type, seconds: secs, url: URL.createObjectURL(blob) };
      });
      setState("done");
    };
    rec.current = r;
    startedAt.current = Date.now();
    setSeconds(0);
    try { r.start(1000); } catch { releaseMic(); setError("failed"); setState("idle"); return; }
    setState("recording");
    timer.current = window.setInterval(() => {
      const el = Math.floor((Date.now() - startedAt.current) / 1000);
      setSeconds(el);
      if (el >= maxSeconds) stop();
    }, 250);
  }, [maxSeconds, stop]);

  const reset = useCallback(() => {
    stop(); stopTimer(); releaseMic();
    setRecording((prev) => { if (prev?.url) URL.revokeObjectURL(prev.url); return null; });
    setSeconds(0); setError(""); setState("idle");
  }, [stop]);

  // Leaving the page mid-recording must not leave the microphone on.
  useEffect(() => () => {
    const r = rec.current;
    if (r && r.state !== "inactive") { try { r.stop(); } catch { /* already gone */ } }
    stopTimer(); releaseMic();
  }, []);

  return { state, error, seconds, recording, start, stop, reset };
}
type Recorder = ReturnType<typeof useAudioRecorder>;

/* ------------------------------- the player ------------------------------ */

const iconBtn =
  "shrink-0 inline-flex items-center justify-center rounded-full min-w-11 min-h-11 w-11 h-11 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1 transition-colors";

function Player({
  url, strings, seconds, link, autoPlay,
}: {
  url: string;
  strings: RecorderStrings;
  /** the seconds the recorder counted — used until the element knows better */
  seconds?: number;
  /** the Drive link, offered when this device cannot play the format */
  link?: string;
  autoPlay?: boolean;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(seconds ?? 0);
  const [bad, setBad] = useState(false);

  // Callers key the player by its URL, so a new recording is a new player and
  // nothing here has to be reset. Only the autoplay is an effect.
  useEffect(() => {
    if (autoPlay) ref.current?.play().catch(() => setBad(true));
  }, [autoPlay]);

  const toggle = async () => {
    const a = ref.current;
    if (!a) return;
    if (playing) { a.pause(); return; }
    try { await a.play(); } catch { setBad(true); }
  };
  const known = Number.isFinite(dur) && dur > 0;
  const pct = known ? Math.min(100, (pos / dur) * 100) : 0;

  if (bad) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm text-amber-800">
        <span>{strings.cantPlay}</span>
        {link && <DriveLink href={link} label={strings.openInDrive} />}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 min-w-0">
      <audio
        ref={ref}
        src={url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setPos(0); }}
        onTimeUpdate={(e) => {
          setPos(e.currentTarget.currentTime);
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDur(d);
        }}
        onLoadedMetadata={(e) => { const d = e.currentTarget.duration; if (Number.isFinite(d) && d > 0) setDur(d); }}
        onError={() => setBad(true)}
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? strings.pause : strings.play}
        className={`${iconBtn} ${playing ? "bg-blue-600 text-white" : "bg-blue-50 text-blue-700 hover:bg-blue-100"}`}
      >
        {playing ? <Pause size={18} /> : <Play size={18} className="ms-0.5" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden">
          <div className="h-full bg-blue-500 transition-[width] duration-200" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 text-xs text-gray-500 tabular-nums" dir="ltr">
          <span>{formatSeconds(pos)}{known ? ` / ${formatSeconds(dur)}` : ""}</span>
          {link && <DriveLink href={link} label={strings.openInDrive} small />}
        </div>
      </div>
    </div>
  );
}

function DriveLink({ href, label, small }: { href: string; label: string; small?: boolean }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 text-blue-600 hover:underline ${small ? "text-xs" : "text-sm"}`}
    >
      <ExternalLink size={small ? 11 : 13} />
      {label}
    </a>
  );
}

/* ----------------------------- record control ---------------------------- */

const BIG =
  "w-full min-h-[64px] rounded-2xl border-2 px-4 py-3 text-lg font-semibold transition inline-flex items-center justify-center gap-3 " +
  "active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1";

export function RecordControl({
  recorder, label, strings, disabled,
}: {
  recorder: Recorder;
  /** the idle button's text — «سجّل المشكلة بصوتك» / «سجّل الحل بصوتك» */
  label: string;
  strings: RecorderStrings;
  disabled?: boolean;
}) {
  const { state, error, seconds, recording, start, stop, reset } = recorder;
  const errText =
    error === "denied" ? strings.micDenied
    : error === "insecure" ? strings.micInsecure
    : error === "unsupported" ? strings.micUnsupported
    : error === "failed" ? strings.micFailed
    : "";

  if (state === "recording") {
    return (
      <div className="rounded-2xl border-2 border-red-300 bg-red-50 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-red-600" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-red-800">{strings.recording}</div>
            <div className="text-2xl font-bold tabular-nums text-gray-900" dir="ltr">
              {formatSeconds(seconds)} <span className="text-sm font-normal text-gray-500">/ {formatSeconds(MAX_AUDIO_SECONDS)}</span>
            </div>
          </div>
          <button type="button" onClick={stop} className={`${BIG} w-auto border-red-600 bg-red-600 text-white px-6`}>
            <Square size={18} fill="currentColor" /> {strings.stopRecording}
          </button>
        </div>
        <p className="mt-2 text-xs text-red-700">{strings.tapToStop}</p>
      </div>
    );
  }

  if (state === "done" && recording) {
    return (
      <div className="rounded-2xl border-2 border-green-300 bg-green-50 px-4 py-3">
        <div className="text-xs font-semibold text-green-800 mb-2">{strings.preview}</div>
        <Player key={recording.url} url={recording.url} strings={strings} seconds={recording.seconds} />
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => { reset(); void start(); }}
            className="inline-flex items-center gap-1.5 min-h-11 rounded-xl border-2 border-gray-300 bg-white px-3 text-sm font-semibold text-gray-800 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
          >
            <Mic size={15} /> {strings.rerecord}
          </button>
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1.5 min-h-11 rounded-xl px-3 text-sm font-semibold text-red-700 hover:bg-red-50 active:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
          >
            <Trash2 size={15} /> {strings.deleteRecording}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void start()}
        disabled={disabled || state === "requesting"}
        className={`${BIG} border-red-500 bg-white text-red-700 hover:bg-red-50`}
      >
        <Mic size={22} /> {state === "requesting" ? "…" : label}
      </button>
      <p className="mt-1.5 text-xs text-gray-500">{strings.maxHint}</p>
      {errText && <p className="mt-1.5 text-sm text-red-700">{errText}</p>}
    </div>
  );
}

/* -------------------------------- saved clip ----------------------------- */

// One fetch per recording per page life. The object URL is never revoked on
// purpose: a list re-render must not re-download a clip somebody just heard.
const clipUrls = new Map<string, Promise<string>>();

function loadClip(id: string): Promise<string> {
  let p = clipUrls.get(id);
  if (!p) {
    p = (async () => {
      const res = await authedFetch(`/api/issues/audio?id=${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(String(res.status));
      return URL.createObjectURL(await res.blob());
    })();
    p.catch(() => clipUrls.delete(id));
    clipUrls.set(id, p);
  }
  return p;
}

/**
 * A recording that lives in Drive. Idle: a small pill (tap to fetch and play,
 * nothing downloads until somebody wants to hear it). Ready: the player.
 */
export function SavedClip({
  clip, strings, compact,
}: {
  clip: AudioRef;
  strings: RecorderStrings;
  /** the list's inline pill; the drawer uses the full-width variant */
  compact?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  const load = async () => {
    setState("loading");
    try { setUrl(await loadClip(clip.id)); setState("ready"); }
    catch { setState("error"); }
  };

  if (state === "ready" && url) {
    return <Player url={url} strings={strings} link={clip.url} autoPlay />;
  }
  if (state === "error") {
    return (
      <span className="inline-flex flex-wrap items-center gap-2 text-sm text-red-700">
        {strings.audioLoadFailed}
        <DriveLink href={clip.url} label={strings.openInDrive} small />
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); void load(); }}
      disabled={state === "loading"}
      aria-label={strings.play}
      className={
        compact
          ? "inline-flex items-center gap-1.5 min-h-11 sm:min-h-8 rounded-full border border-blue-200 bg-blue-50 px-3 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
          : "inline-flex items-center gap-2 min-h-11 rounded-xl border-2 border-blue-200 bg-blue-50 px-4 text-sm font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
      }
    >
      {state === "loading"
        ? <span className="w-3.5 h-3.5 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" />
        : <Play size={compact ? 14 : 16} className="ms-0.5" />}
      {state === "loading" ? strings.loadingAudio : strings.voiceNote}
    </button>
  );
}
