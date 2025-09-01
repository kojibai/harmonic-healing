/* ─────────────────────────────────────────────────────────────────────────────
   HarmonicPlayer.tsx –  Φ Exchange • Harmonic Resonance Engine
   MASTER v18.0 — “Instant φ-Lead Entrainment”
   Truth-forward additions over v17:
   • Hard φ-lead (no mic following) with periodic Kai re-lock (ppm gentle)
   • Instant Entrainment Onramp (first 3 breaths, φ-scheduled):
       – Isochronic AM gate at 8 → 5 → 3 Hz (depth slewed in φ% steps)
       – Subtle binaural presence preserved; no spectral overreach
       – Boundary chime (987 Hz micro-ping) for 3–5 breaths (very low level)
       – Haptic pulse (if available) at breath boundaries
       – Visual boundary event dispatch: 'kai-breath-boundary'
   • Entrain Gate inserted pre-master (clickless, fully scheduled in AudioTime)
   • Sacred Silence: still at every 19th breath boundary, on baseWet offset
   • Fixed: no React hooks inside imperative paths; safer IR fetch paths
   • All decisions in φ proportions; safety caps tuned for mobile
────────────────────────────────────────────────────────────────────────────── */
/* eslint-disable no-empty */

import {
  useState,
  useRef,
  useMemo,
  useEffect,
  type ChangeEvent,
  type FC,
  type MutableRefObject,
} from "react";

import FrequencyWaveVisualizer from "./FrequencyWaveVisualizer";
import KaiTurahHarmonicVoice   from "./KaiTurahHarmonicVoice";
import KaiTurahVoiceVisualizer from "./KaiTurahVoiceVisualizer";
import KaiTurahSigil           from "./KaiTurahSigil";
import KaiPhraseOverlay        from "./KaiPhraseOverlay";
import "./HarmonicPlayer.css";
import { createFeedbackFilter } from "../utils/createFeedbackFilter";
import { getSpiralProfile }     from "./SpiralProfiles";

/* ═══════════════════════ GLOBAL TYPES / PATCHES ════════════════════════════ */
declare global {
  interface Window { webkitAudioContext?: typeof AudioContext; }
}

/* ═══════════════════════ SWITCHBOARD (REFINEMENTS) ════════════════════════ */
const REFINEMENTS = {
  // Always-on stability (no spectral change)
  LINEAR_RAMPS: true,
  CLEAR_RESUME_TIMER_ON_STOP: true,
  ABORTABLE_FETCHES: true,
  IR_CACHE: true,
  DC_GUARD_AND_SOFT_LIMIT: true,
  CROSSFADE_MP3_FALLBACK: true,
  FIDELITY_GLOW_FIX: true,
  LOW_END_DEVICE_SHAVE: true,
  BATTERY_AWARENESS: true,
  STEREOPANNER_ON_LOWEND: true,
  PLAY_INLINE: true,
  TYPED_SIGIL: true,

  // Perceptual polish (space/timing; spectrum intact)
  MID_SIDE_WET: true,
  SACRED_SILENCE_MICRO_RESTS: true,
  PAN_LFO_RANDOM_PHASE: true,

  // φ/Fib psychoacoustics (mobile-safe, auto-scaled)
  PHI_BEAT_DRIFT: true,
  FIBONACCI_EARLY_TAPS: true,
  GOLDEN_WIDTH_LFO: true,
  PHI_HAAS_DRY: true,
  PINK_AIR_TAIL: true,
  FIB_EQ_TILT: true,
  GOLDEN_SPIRAL_Y_LFO: true,

  // v18 Entrainment stack
  INSTANT_ENTRAINMENT_ONRAMP: true,
  BOUNDARY_CHIME: true,
  HAPTIC_BOUNDARY: true,
  VISUAL_BOUNDARY_EVENT: true,

  // Optional nudges (OFF by default)
  EASE_MODE: {
    JUST_INTONATION_SNAP: false,
    CRITICAL_BAND_GAIN_SPREAD: false,
    EQUAL_LOUDNESS_AT_LOW_LEVEL: false,
    MICRO_AIR_BED: false,
  }
} as const;

/* ═══════════════════════ HELPERS & CONSTANTS ═══════════════════════════════ */
const PHI  = (1 + Math.sqrt(5)) / 2;
const PHI2 = PHI * PHI;
const PHI_FADE = PHI;

/** golden breath derived from φ (not a hand-tuned constant) */
const BREATH_SEC = 8.472 / PHI;                  // ≈ 5.236 s
const BREATHS_PER_SILENCE = 19 as const;         // ritual silence cycle

const RAMP_MS         = 50;
const MAX_TOTAL_GAIN  = 0.88;
const WET_CAP         = 0.33;
const MASTER_MAX_GAIN = 0.70; // slightly lower for nicer phone transients
const FB_MAX_GAIN     = 0.11;
const IR_SCALE        = 0.33;
const LOWPASS_THRESH  = 48_000;
const LOWPASS_FREQ    = 18_000;

/** v18 Instant Onramp plan (breaths) */
const ONRAMP_BREATHS = 3 as const;         // 3 breaths: 8 → 5 → 3 Hz
const ONRAMP_BEATS   = [8, 5, 3] as const; // Hz
const ONRAMP_DEPTHS  = [0.22, 0.14, 0.08]; // gate depth progression

const mp3Cache = new Map<string, string>();
const irCache  = new Map<string, AudioBuffer>();

const SpiralPresets = [
  { min:  13, max:  21, reverb:  3, delay:  2 },
  { min:  21, max:  34, reverb:  5, delay:  3 },
  { min:  34, max:  55, reverb:  8, delay:  5 },
  { min:  55, max:  89, reverb: 13, delay:  8 },
  { min:  89, max: 144, reverb: 21, delay: 13 },
  { min: 144, max: 233, reverb: 34, delay: 21 },
  { min: 233, max: 377, reverb: 55, delay: 34 },
] as const;

const phrasePresets: Record<string, { reverb: number; delay: number }> = {
  "Shoh Mek":        { reverb: 13, delay:  8 },
  "Mek Ka":          { reverb: 21, delay: 13 },
  "Ka Lah Mah Tor":  { reverb: 34, delay: 21 },
  "Lah Mah Tor Rah": { reverb: 55, delay: 34 },
  "Tha Voh Yah Zu":  { reverb: 89, delay: 55 },
  "Zor Shoh Mek Ka": { reverb:  8, delay:  5 },
  "Rah Voh Lah":     { reverb: 21, delay: 13 },
  "Kai Leh Shoh":    { reverb: 34, delay: 21 },
  "Zeh Mah Kor Lah": { reverb: 55, delay: 34 },
};

const fibonacci = (n: number) => { const s=[1,1]; for(let i=2;i<n;i++) s.push(s[i-1]+s[i-2]); return s; };

const presetFor = (f: number, phrase?: string) =>
  phrasePresets[phrase ?? ""] ??
  SpiralPresets.find(c => f >= c.min && f <= c.max) ??
  { reverb: 3, delay: 2 };

const slug = (t: string) =>
  t.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(" ")[0] || "default";

/* Optional helpers */
const ERB = (f:number) => 24.7*(4.37*f/1000+1);
const withinERB = (f:number, base:number) => Math.abs(f-base) < ERB(base);
const RATIOS = [1, 6/5, 5/4, 4/3, 3/2, 5/3, 8/5] as const;
const snapRatio = (r: number) => RATIOS.reduce((a,b)=>Math.abs(b-r)<Math.abs(a-r)?b:a, RATIOS[0]);

/* ═════════ KAI DYNAMIC REVERB (BREATH + TIME + PHRASE) ═════════════════════ */
const getKaiDynamicReverb = (
  freq: number,
  phrase: string,
  kaiTime: number,
  breathPhase: number,
): number => {
  const freqNorm = Math.min(1, Math.log(freq + 1) / Math.log(377));
  const phrasePreset = (phrasePresets[phrase]?.reverb ?? presetFor(freq, phrase).reverb);
  const phraseNorm = Math.min(1, phrasePreset / 89);

  const stepDuration = BREATH_SEC * 11;
  const kaiNorm = ((kaiTime % stepDuration) / stepDuration);

  const breathNorm = (Math.sin(breathPhase * 2 * Math.PI) + 1) / 2;

  const wPhrase = PHI, wFreq = 1, wBreath = 1/PHI, wKai = 1/PHI2;
  const weightSum = wPhrase + wFreq + wBreath + wKai;

  let blended = (
    phraseNorm * wPhrase + freqNorm * wFreq + breathNorm * wBreath + kaiNorm * wKai
  ) / weightSum;

  const sigmoid = 1 / (1 + Math.exp(-6 * (blended - 0.5)));
  blended = (sigmoid * 0.55) + (Math.sqrt(blended) * 0.45);

  const wet = Math.min(WET_CAP * 0.995, Math.max(0.01, blended * WET_CAP));
  return wet;
};

/* ═══════════════════ INVERSE DELAY (CLARITY GUARD) ═════════════════════════ */
const getAutoDelay = (freq: number, phrase: string, wet: number): number => {
  const basePreset   = phrasePresets[phrase]?.delay ?? presetFor(freq, phrase).delay;
  const baseSeconds  = Math.min(basePreset * 0.01, 1.25);
  const wetRatio     = wet / WET_CAP;
  const factor       = Math.sqrt(1 - wetRatio);
  const seconds      = Math.max(0.02, Math.min(baseSeconds * (0.5 + factor), 1.25));
  return seconds;
};

/* ═══════════════════════ HOOKS ═════════════════════════════════════════════ */
const useKaiPulse = (): MutableRefObject<number> => {
  const ref = useRef(0);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const ac = REFINEMENTS.ABORTABLE_FETCHES ? new AbortController() : undefined;
        const { kai_time } =
          (await fetch("https://klock.kaiturah.com/kai", ac ? { signal: ac.signal } : undefined)
            .then(r => r.json())) as { kai_time?: number };
        if (live && typeof kai_time === "number") ref.current = kai_time;
      } catch (e) { /* optional */ }
    })();
    return () => { live = false; };
  }, []);
  return ref;
};

/* ═══════════════════════ PROP TYPES ════════════════════════════════════════ */
interface HarmonicPlayerProps {
  frequency   : number;
  phrase?     : string;
  binaural?   : boolean;
  enableVoice?: boolean;
  onShowHealingProfile?: (p: ReturnType<typeof getSpiralProfile>) => void;
}

/* Strict Sigil typing */
type SigilProps = { phrase: string; frequency: number; breathPhase?: () => number; };

/* ═══════════════════════ COMPONENT ═════════════════════════════════════════ */
const HarmonicPlayer: FC<HarmonicPlayerProps> = ({
  frequency: initialFreq,
  phrase:    responsePhrase = "Shoh Mek",
  binaural   = true,
  enableVoice= true,
  onShowHealingProfile,
}) => {
  const [audioPhrase, setAudioPhrase] = useState(responsePhrase);
  useEffect(() => setAudioPhrase(responsePhrase), [responsePhrase]);

  const frequency = initialFreq;

  useEffect(() => { onShowHealingProfile?.(getSpiralProfile(frequency)); },
    [frequency, onShowHealingProfile]);

  const kaiPulseRef  = useKaiPulse();
  const [isPlaying, setIsPlaying] = useState(false);
  const [actualSampleRate, setActualSampleRate] = useState<number | null>(null);

  const audioCtxRef     = useRef<AudioContext | null>(null);
  const analyserRef     = useRef<AnalyserNode | null>(null);
  const convolverRef    = useRef<ConvolverNode | null>(null);
  const delayRef        = useRef<DelayNode | null>(null);
  const feedbackGainRef = useRef<GainNode | null>(null);
  const wetGainRef      = useRef<GainNode | null>(null);
  const dryGainRef      = useRef<GainNode | null>(null);
  const masterGainRef   = useRef<GainNode | null>(null);
  const lowpassRef      = useRef<BiquadFilterNode | null>(null);
  const entrainGateRef  = useRef<GainNode | null>(null);

  const oscBankRef      = useRef<
    { osc: OscillatorNode; gain: GainNode; p: PannerNode | StereoPannerNode }[]
  >([]);
  const driftRefs       = useRef<OscillatorNode[]>([]);
  const breathLfoRef    = useRef<OscillatorNode | null>(null);
  const baseFBRef       = useRef<ConstantSourceNode | null>(null);
  const baseWetRef      = useRef<ConstantSourceNode | null>(null);
  const baseDelayRef    = useRef<ConstantSourceNode | null>(null);

  // v18 onramp refs
  const onrampLfoRef        = useRef<OscillatorNode | null>(null);
  const onrampScaleRef      = useRef<GainNode | null>(null);            // 0.5 scale for [-1,1] → [-0.5,0.5]
  const onrampDepthGainRef  = useRef<GainNode | null>(null);            // multiplies 0..1 by depth
  const onrampHalfConstRef  = useRef<ConstantSourceNode | null>(null);  // +0.5
  const onrampBaseConstRef  = useRef<ConstantSourceNode | null>(null);  // (1 - depth)
  const onrampStageRef      = useRef<number>(0);                        // 0..ONRAMP_BREATHS
  const onrampActiveRef     = useRef<boolean>(false);

  const wakeLockRef     = useRef<WakeLockSentinel | null>(null);
  const wakeKeepAlive   = useRef<number | null>(null);
  const mediaReadyRef   = useRef(false);
  const audioRef        = useRef<HTMLAudioElement | null>(null);
  const resumeRetryRef  = useRef<{ attempts: number; timer: number | null }>({ attempts: 0, timer: null });
  const hapticTimersRef = useRef<number[]>([]);

  const [reverbSlider, setReverbSlider] = useState(
    () => getKaiDynamicReverb(frequency, responsePhrase, 0, 0),
  );
  const autoReverbRef = useRef(reverbSlider);

  // Hard φ-lead breath period (never follow mic)
  const breathPeriodRef = useRef(BREATH_SEC);

  /* Low-end & battery awareness */
  const isiOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isLowEndDevice = useMemo(() => {
    const mem = (navigator as any).deviceMemory ?? 4;
    const cores = navigator.hardwareConcurrency ?? 4;
    return REFINEMENTS.LOW_END_DEVICE_SHAVE && (isiOS || mem <= 4 || cores <= 4);
  }, [isiOS]);

  const [batterySaver, setBatterySaver] = useState(false);
  useEffect(() => {
    if (!REFINEMENTS.BATTERY_AWARENESS || !(navigator as any).getBattery) return;
    (navigator as any).getBattery().then((b: any) => {
      const update = () => setBatterySaver(b.dischargingTime !== Infinity || b.level < 0.2);
      update();
      b.addEventListener("levelchange", update);
      b.addEventListener("chargingchange", update);
    }).catch(() => {});
  }, []);

  const perfScale = useMemo(() => (isLowEndDevice || batterySaver ? 0.7 : 1), [isLowEndDevice, batterySaver]);
  const perfScaleRef = useRef(perfScale);
  useEffect(() => { perfScaleRef.current = perfScale; }, [perfScale]);

  /* Linear ramp helper (glitch-proof) */
  const rampParam = (param: AudioParam, target: number, ms: number) => {
    const audio = audioCtxRef.current; if (!audio) return;
    const now = audio.currentTime;
    param.cancelScheduledValues(now);
    if (REFINEMENTS.LINEAR_RAMPS) {
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(target, now + ms / 1000);
    } else {
      param.setTargetAtTime(target, now, ms / 1000);
    }
  };

  const applyReverb = (wetRaw: number) => {
    const wet = Math.min(wetRaw, WET_CAP);
    if (!wetGainRef.current || !dryGainRef.current || !baseWetRef.current) return;
    rampParam(wetGainRef.current.gain, wet, RAMP_MS);
    rampParam(dryGainRef.current.gain, 1 - wet, RAMP_MS);
    rampParam(baseWetRef.current.offset, wet, RAMP_MS);
  };

  const applyDelaySmooth = (seconds: number) => {
    if (!delayRef.current || !baseDelayRef.current) return;
    rampParam(delayRef.current.delayTime, seconds, RAMP_MS);
    rampParam(baseDelayRef.current.offset, seconds, RAMP_MS);
  };

  /* Breath phase */
  const breathAnchorRef = useRef(0);
  const kaiBreathPhase = () => {
    const t = audioCtxRef.current?.currentTime ?? 0;
    const T = breathPeriodRef.current;
    return ((t - breathAnchorRef.current) / T) % 1;
    // 0..1 within the φ breath; boundary events are scheduled at phase 0
  };

  /* Harmonic bucket (trim on low-end) */
  const dyn = useMemo(() => {
    const base =
      frequency <  34 ? { harmonics:  5, offset:  3 } :
      frequency <  89 ? { harmonics:  8, offset:  5 } :
      frequency < 233 ? { harmonics: 13, offset:  8 } :
                        { harmonics: 21, offset: 13 };
    if (!isLowEndDevice && !batterySaver) return base;
    return { harmonics: Math.max(5, Math.round(base.harmonics * 0.8)), offset: base.offset };
  }, [frequency, isLowEndDevice, batterySaver]);

  /* New context (prefer 96k if allowed) */
  const newCtx = (): AudioContext => {
    const Ctx = (window.AudioContext ?? window.webkitAudioContext!) as typeof AudioContext;
    try { return new Ctx({ sampleRate: 96_000, latencyHint: "interactive" }); }
    catch { return new Ctx({ latencyHint: "interactive" }); }
  };

  /* Hard reset */
  const hardReset = () => {
    // stop oscillators/panners
    oscBankRef.current.forEach(({ osc, gain, p }) => {
      try { osc.stop(); }        catch {}
      try { osc.disconnect(); }  catch {}
      try { gain.disconnect(); } catch {}
      try { p.disconnect(); }    catch {}
    });
    oscBankRef.current = [];
    driftRefs.current.forEach(d => { try { d.stop(); } catch {}; try { d.disconnect(); } catch {} });
    driftRefs.current = [];

    // stop breath LFO & bases
    [ breathLfoRef.current, baseFBRef.current, baseWetRef.current, baseDelayRef.current ]
      .forEach(n => { try { n?.stop(); n?.disconnect(); } catch {} });
    breathLfoRef.current = baseFBRef.current = baseWetRef.current = baseDelayRef.current = null;

    // stop onramp stack
    try { onrampLfoRef.current?.stop(); } catch {}
    [onrampLfoRef.current, onrampScaleRef.current, onrampDepthGainRef.current,
     onrampHalfConstRef.current, onrampBaseConstRef.current]
      .forEach(n => { try { n?.disconnect(); } catch {} });
    onrampLfoRef.current = null; onrampScaleRef.current = null; onrampDepthGainRef.current = null;
    onrampHalfConstRef.current = null; onrampBaseConstRef.current = null;
    onrampStageRef.current = 0; onrampActiveRef.current = false;

    // disconnect main graph nodes
    [ analyserRef, convolverRef, delayRef, feedbackGainRef, wetGainRef, dryGainRef, masterGainRef, lowpassRef, entrainGateRef ]
      .forEach(r => { try { r.current?.disconnect(); } catch {}; r.current = null; });

    // clear pending haptic timeouts
    hapticTimersRef.current.forEach(id => clearTimeout(id));
    hapticTimersRef.current = [];
  };

  /* Media Session */
  const setupMediaSession = () => {
    if (mediaReadyRef.current) return;
    const ms = (navigator as any).mediaSession as MediaSession | undefined;
    if (!ms) return;

    const MediaMetadataCtor =
      (window as any).MediaMetadata as | (new (init?: MediaMetadataInit) => MediaMetadata) | undefined;

    if (MediaMetadataCtor) {
      ms.metadata = new MediaMetadataCtor({
        title : `${frequency}Hz Harmonics`,
        artist: "Kai-Turah Resonance Engine",
      });
    }
    ms.setActionHandler?.("play",  () => { void play(); });
    ms.setActionHandler?.("pause", () => stop());
    ms.setActionHandler?.("stop",  () => stop());
    ms.setActionHandler?.("seekto", () => { /* bound to ritual time; no-op */ });
    mediaReadyRef.current = true;
  };

  /* Resume backoff */
  const clearResumeTimer = () => {
    const h = resumeRetryRef.current.timer;
    if (h) { clearTimeout(h); resumeRetryRef.current.timer = null; }
    resumeRetryRef.current.attempts = 0;
  };
  const attemptResume = async (label: string) => {
    const ctx = audioCtxRef.current; if (!ctx) return;
    if (ctx.state !== "running") {
      try { await ctx.resume(); } catch (e) { console.warn(`[AudioContext] resume() threw (${label})`, e); }
    }
    if (ctx.state === "running") { clearResumeTimer(); return; }
    const attempt = ++resumeRetryRef.current.attempts;
    const delay = Math.min(2000, 100 * 2 ** attempt);
    if (resumeRetryRef.current.timer) clearTimeout(resumeRetryRef.current.timer);
    resumeRetryRef.current.timer = window.setTimeout(() => attemptResume("retry-loop"), delay);
  };

  const installGestureResumers = () => {
    const gestures = ["touchstart", "mousedown", "keydown"] as const;
    const handler = () => {
      attemptResume("gesture");
      const ctx = audioCtxRef.current;
      if (ctx?.state === "running") gestures.forEach(ev => document.removeEventListener(ev, handler, true));
    };
    gestures.forEach(ev => document.addEventListener(ev, handler, { passive: true, capture: true }));
    return () => gestures.forEach(ev => document.removeEventListener(ev, handler, true));
  };

  /* STOP */
  const stop = () => {
    if (!isPlaying) return;
    if (REFINEMENTS.CLEAR_RESUME_TIMER_ON_STOP) clearResumeTimer();
    try { wakeLockRef.current?.release(); } catch {}
    if (wakeKeepAlive.current) { clearInterval(wakeKeepAlive.current); wakeKeepAlive.current = null; }
    wakeLockRef.current = null;

    const audio = audioCtxRef.current;
    if (!audio) { hardReset(); setIsPlaying(false); return; }

    const now = audio.currentTime;
    const end = now + PHI_FADE;

    oscBankRef.current.forEach(({ osc, gain }) => {
      rampParam(gain.gain, 0, PHI_FADE * 1000);
      try { osc.stop(end); } catch {}
    });

    const fades = [ masterGainRef.current, wetGainRef.current, dryGainRef.current, feedbackGainRef.current, entrainGateRef.current ];
    fades.forEach(g => g && rampParam(g.gain, 0, PHI_FADE * 1000));

    breathLfoRef.current?.stop(end);
    baseFBRef.current?.stop(end);
    baseWetRef.current?.stop(end);
    baseDelayRef.current?.stop(end);
    driftRefs.current.forEach(d => { try { d.stop(end); } catch {} });

    // stop onramp oscillators gently
    try { onrampLfoRef.current?.stop(end); } catch {}

    // late disconnect
    setTimeout(() => {
      try {
        if (convolverRef.current) {
          try { convolverRef.current.disconnect(); } catch {}
          try { (convolverRef.current as ConvolverNode).buffer = null; } catch {}
        }
        if (wetGainRef.current)  { try { wetGainRef.current.disconnect(); } catch {} }
        if (dryGainRef.current)  { try { dryGainRef.current.disconnect(); } catch {} }
        if (delayRef.current)    { try { delayRef.current.disconnect(); } catch {} }
        if (feedbackGainRef.current) { try { feedbackGainRef.current.disconnect(); } catch {} }
      } catch {}
    }, PHI_FADE * 1000 * 0.9);

    setTimeout(async () => {
      hardReset();
      if (audio.state !== "closed") { try { await audio.close(); } catch {} }
      if (audioCtxRef.current === audio) audioCtxRef.current = null;
    }, (PHI_FADE + 0.25) * 1000);

    setIsPlaying(false);
  };

  /* PLAY */
  const play = async () => {
    if (isPlaying) return;

    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      try { await audioCtxRef.current.close(); } catch {}
    }
    audioCtxRef.current = newCtx();
    const audio = audioCtxRef.current;
    setActualSampleRate(audio.sampleRate);

    if (audio.state === "suspended") await attemptResume("initial");
    setupMediaSession();

    // Wake-lock + fallback keepalive (prevents some iOS idles)
    try { wakeLockRef.current = await navigator.wakeLock?.request?.("screen"); } catch {}
    if (!wakeLockRef.current) {
      wakeKeepAlive.current = window.setInterval(() => { /* keep alive */ }, 30000);
    }

    // Breath sync start — align to Kai boundary
    let kaiTime = kaiPulseRef.current;
    try {
      const ac = REFINEMENTS.ABORTABLE_FETCHES ? new AbortController() : undefined;
      const { kai_time } =
        (await fetch("https://klock.kaiturah.com/kai", ac ? { signal: ac.signal } : undefined).then(r => r.json())) as { kai_time?: number };
      if (typeof kai_time === "number") kaiTime = kai_time;
    } catch {}
    const wait = (BREATH_SEC - (kaiTime % BREATH_SEC)) % BREATH_SEC;
    if (wait > 0.005) await new Promise(r => setTimeout(r, wait * 1000));

    hardReset();
    breathAnchorRef.current = audio.currentTime;
    breathPeriodRef.current = BREATH_SEC; // φ-lead lock

    /* Analyser */
    const analyser = audio.createAnalyser();
    analyser.fftSize = (isLowEndDevice || batterySaver) ? 512 : 1024;
    analyser.smoothingTimeConstant = (isLowEndDevice || batterySaver) ? 0.3 : 0.5;
    analyserRef.current = analyser;

    /* Convolver + delay chain (IR cache + abort) */
    convolverRef.current = audio.createConvolver();
    try {
      const slugged = slug(audioPhrase);
      if (REFINEMENTS.IR_CACHE && irCache.has(slugged)) {
        convolverRef.current.buffer = irCache.get(slugged)!;
      } else {
        const ac = REFINEMENTS.ABORTABLE_FETCHES ? new AbortController() : undefined;
        const irRes = await fetch(`/audio/ir/${slugged}.wav`, ac ? { signal: ac.signal } : undefined);
        if (!irRes.ok) throw new Error(`IR fetch failed: HTTP ${irRes.status}`);
        const type = irRes.headers.get("content-type") ?? "";
        if (!type.includes("audio")) throw new Error(`IR fetch invalid type: ${type}`);
        const irBuf = await irRes.arrayBuffer();
        const decoded = await audio.decodeAudioData(irBuf);
        for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
          const data = decoded.getChannelData(ch);
          for (let i = 0; i < data.length; i++) data[i] *= IR_SCALE;
        }
        if (REFINEMENTS.IR_CACHE) irCache.set(slugged, decoded);
        convolverRef.current.buffer = decoded;
      }
    } catch (e) {
      console.warn(`[IR] fetch failed — dry only (${slug(audioPhrase)}.wav)`, e);
    }

    /* Dynamic Kai baseline */
    const desiredWet  = getKaiDynamicReverb(frequency, responsePhrase, kaiTime, 0);
    const delaySec    = getAutoDelay(frequency, responsePhrase, desiredWet);
    autoReverbRef.current = desiredWet;
    setReverbSlider(desiredWet);

    /* Dry/Wet busses */
    wetGainRef.current = audio.createGain();
    dryGainRef.current = audio.createGain();
    wetGainRef.current.gain.value = desiredWet;
    dryGainRef.current.gain.value = 1 - desiredWet;

    /* Delay/feedback module */
    const { delay: dNode, feedbackGain, connectOutput } = createFeedbackFilter(audio);
    delayRef.current        = dNode;
    feedbackGainRef.current = feedbackGain;
    connectOutput(wetGainRef.current);
    delayRef.current.delayTime.value = delaySec;

    /* Master chain w/ Entrain Gate */
    const mg = audio.createGain(); masterGainRef.current = mg;
    mg.gain.value = MASTER_MAX_GAIN;

    const entrainGate = audio.createGain(); entrainGate.gain.value = 1; // will be modulated in onramp
    entrainGateRef.current = entrainGate;

    let post: AudioNode = analyserRef.current;
    if (audio.sampleRate < LOWPASS_THRESH) {
      const lp = audio.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = LOWPASS_FREQ; lp.Q.value = 0.707;
      lowpassRef.current = lp;
      analyserRef.current.connect(lp);
      post = lp;
    }

    // Optional micro-tilt
    if (REFINEMENTS.FIB_EQ_TILT) {
      const centers = [144, 233, 377, 610, 987]; // Hz
      let eqOut: AudioNode = post;
      centers.forEach((c, i) => {
        const p = audio.createBiquadFilter();
        p.type = "peaking"; p.frequency.value = c;
        p.Q.value = 0.9; p.gain.value = (i % 2 === 0 ? +0.6 : -0.6) * perfScale;
        eqOut.connect(p); eqOut = p;
      });
      post = eqOut;
    }

    // DC guard + limiter, then Entrain Gate → Master
    if (REFINEMENTS.DC_GUARD_AND_SOFT_LIMIT) {
      const hp = audio.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 18; hp.Q.value = 0.707;
      const comp = audio.createDynamicsCompressor();
      comp.threshold.value = -6; comp.knee.value = 24; comp.ratio.value = 1.6;
      comp.attack.value = 0.005; comp.release.value = 0.05;

      post.connect(hp).connect(comp).connect(entrainGate).connect(mg).connect(audio.destination);
    } else {
      post.connect(entrainGate).connect(mg).connect(audio.destination);
    }

    /* Helper curves */
    const cosCurve = (len = 441, max = 1) => {
      const arr = new Float32Array(len);
      for (let i = 0; i < len; i++) arr[i] = max * (1 - Math.cos((i / (len - 1)) * Math.PI)) / 2;
      return arr;
    };

    /* Fibonacci early taps (pre-verb/delay) */
    const createFibTaps = (ctx: AudioContext) => {
      const input = ctx.createGain();
      const out = ctx.createGain();
      const taps = [0.003, 0.005, 0.008, 0.013, 0.021]; // seconds
      taps.forEach((t, i) => {
        const d = ctx.createDelay(); d.delayTime.value = t;
        const g = ctx.createGain();
        g.gain.value = Math.pow(1 / PHI, i + 1) * 0.33 * perfScale; // 0.33, 0.20, …
        input.connect(d).connect(g).connect(out);
      });
      const dryTap = ctx.createGain(); dryTap.gain.value = 0.12 * perfScale;
      input.connect(dryTap).connect(out);
      return { input, out };
    };

    /* Wet routing (M/S with golden width LFO) */
    const routeWetThrough = (wetChain: AudioNode) => {
      if (REFINEMENTS.FIBONACCI_EARLY_TAPS) {
        const taps = createFibTaps(audio);
        wetChain.connect(taps.input);
        wetChain = taps.out;
      }

      if (!REFINEMENTS.MID_SIDE_WET) { wetChain.connect(wetGainRef.current!); return; }

      // Split stereo
      const split = audio.createChannelSplitter(2);
      const L = audio.createGain(); const R = audio.createGain();
      wetChain.connect(split);
      split.connect(L, 0); split.connect(R, 1);

      // Build Mid/Side
      const midSum = audio.createGain(); const sideDiff = audio.createGain();
      const lToMid = audio.createGain(); lToMid.gain.value = 0.5;
      const rToMid = audio.createGain(); rToMid.gain.value = 0.5;
      L.connect(lToMid).connect(midSum);
      R.connect(rToMid).connect(midSum);

      const lToSide = audio.createGain(); lToSide.gain.value = 0.5;
      const rToSide = audio.createGain(); rToSide.gain.value = -0.5;
      L.connect(lToSide).connect(sideDiff);
      R.connect(rToSide).connect(sideDiff);

      // Golden width LFO
      let sideMod: AudioNode = sideDiff;
      let midMod : AudioNode = midSum;

      if (REFINEMENTS.GOLDEN_WIDTH_LFO) {
        const widthOsc = audio.createOscillator();
        widthOsc.frequency.value = 1 / (PHI * 30); // ~48s
        const widthDepth = audio.createGain();
        widthDepth.gain.value = 0.05 * perfScale; // ±0.05
        const bias = audio.createConstantSource(); bias.offset.value = 1.05; // base widen
        const widthMix = audio.createGain();
        widthOsc.connect(widthDepth).connect(widthMix);
        bias.connect(widthMix);
        bias.start(); widthOsc.start();

        const sideGain = audio.createGain();
        const midGain  = audio.createGain();
        widthMix.connect(sideGain.gain);

        const inv = audio.createGain(); inv.gain.value = -0.4;
        const one = audio.createConstantSource(); one.offset.value = 1.0;
        widthMix.connect(inv);
        inv.connect(midGain.gain);
        one.connect(midGain.gain);
        one.start();

        sideDiff.connect(sideGain); midSum.connect(midGain);
        sideMod = sideGain; midMod = midGain;
      }

      // Re-matrix to L/R
      const outL = audio.createGain(); const outR = audio.createGain();
      midMod.connect(outL); midMod.connect(outR);
      sideMod.connect(outL);
      const invSide = audio.createGain(); invSide.gain.value = -1;
      sideMod.connect(invSide).connect(outR);

      const merger = audio.createChannelMerger(2);
      outL.connect(merger, 0, 0);
      outR.connect(merger, 0, 1);
      merger.connect(wetGainRef.current!);
    };

    const routeDryWet = (n: AudioNode) => {
      // φ-Haas on dry
      if (REFINEMENTS.PHI_HAAS_DRY) {
        const split = audio.createChannelSplitter(2);
        const left  = audio.createDelay();  left.delayTime.value  = 0.008 * (isLowEndDevice || batterySaver ? 0.7 : 1);
        const right = audio.createDelay();  right.delayTime.value = 0.013 * (isLowEndDevice || batterySaver ? 0.7 : 1);
        const merge = audio.createChannelMerger(2);
        n.connect(split);
        split.connect(left,  0);
        split.connect(right, 1);
        left.connect(merge,  0, 0);
        right.connect(merge, 0, 1);
        merge.connect(dryGainRef.current!);
      } else {
        n.connect(dryGainRef.current!);
      }

      // Wet chain
      if (!convolverRef.current && !delayRef.current) return;
      const wetBus = audio.createGain();
      n.connect(wetBus);

      let wetChain: AudioNode = wetBus;
      if (convolverRef.current?.buffer) wetChain.connect(convolverRef.current!), wetChain = convolverRef.current!;
      if (delayRef.current)             wetChain.connect(delayRef.current!),     wetChain = delayRef.current!;

      routeWetThrough(wetChain);
    };

    /* Breath LFO — φ-lead (frequency may ppm tweak via re-lock) */
    const lfo = audio.createOscillator(); lfo.type = "sine";
    lfo.frequency.value = 1 / breathPeriodRef.current;

    const depthFB    = audio.createGain(); depthFB.gain.value    = 0.015 * perfScale;
    const depthWet   = audio.createGain(); depthWet.gain.value   = 0.02  * perfScale;
    const depthDelay = audio.createGain(); depthDelay.gain.value = 0.04  * perfScale;

    const baseFB  = audio.createConstantSource(); baseFB.offset.value  = Math.min(0.18, FB_MAX_GAIN);
    const baseWet = audio.createConstantSource(); baseWet.offset.value = desiredWet;
    const baseDly = audio.createConstantSource(); baseDly.offset.value = delaySec;

    baseFB.offset.value = Math.min(baseFB.offset.value, FB_MAX_GAIN);
    feedbackGain.gain.setValueAtTime(Math.min(feedbackGain.gain.value, FB_MAX_GAIN), audio.currentTime);

    lfo.connect(depthFB).connect(feedbackGainRef.current!.gain);
    lfo.connect(depthWet).connect(wetGainRef.current!.gain);
    lfo.connect(depthDelay).connect(delayRef.current!.delayTime);
    baseFB.connect(feedbackGainRef.current!.gain);
    baseWet.connect(wetGainRef.current!.gain);
    baseDly.connect(delayRef.current!.delayTime);

    lfo.start(audio.currentTime + (REFINEMENTS.PAN_LFO_RANDOM_PHASE ? Math.random() * 0.2 : 0));
    baseFB.start(); baseWet.start(); baseDly.start();

    breathLfoRef.current = lfo;
    baseFBRef.current    = baseFB;
    baseWetRef.current   = baseWet;
    baseDelayRef.current = baseDly;

    /* Pink-air tail (1/f, ultra-low, into wet only) */
    if (REFINEMENTS.PINK_AIR_TAIL) {
      const noise = audio.createBufferSource();
      const secs = 4;
      const buf  = audio.createBuffer(1, audio.sampleRate * secs, audio.sampleRate);
      const ch   = buf.getChannelData(0);
      let y0 = 0, y1 = 0, y2 = 0;
      for (let i=0;i<ch.length;i++){
        const w = Math.random()*2 - 1;
        y0 = 0.997*y0 + 0.003*w; y1 = 0.990*y1 + 0.010*w; y2 = 0.970*y2 + 0.030*w;
        ch[i] = (y0 + y1 + y2) / 3;
      }
      noise.buffer = buf; noise.loop = true;
      const nGain = audio.createGain(); nGain.gain.value = 0.0008 * perfScale; // ~-62 dB
      const nDepth = audio.createGain(); nDepth.gain.value = 0.0005 * perfScale;
      breathLfoRef.current?.connect(nDepth).connect(nGain.gain);
      noise.connect(nGain).connect(wetGainRef.current!);
      noise.start();
    }

    /* Spatial builders */
    const half = dyn.offset / 2; // binaural beat (diff = dyn.offset Hz)

    const makeSpatial = (f: number, amp: number, [x,y,z]: [number,number,number]) => {
      const o = audio.createOscillator(); o.type = "sine"; o.frequency.value = f;
      const g = audio.createGain(); g.gain.setValueCurveAtTime(cosCurve(441, amp), audio.currentTime, 2);

      let p: PannerNode | StereoPannerNode;
      const useStereoPanner = REFINEMENTS.STEREOPANNER_ON_LOWEND && (isLowEndDevice || batterySaver || isiOS);
      if (useStereoPanner) {
        p = audio.createStereoPanner(); (p as StereoPannerNode).pan.value = Math.max(-1, Math.min(1, x / 6));
      } else {
        p = audio.createPanner(); (p as PannerNode).panningModel = "HRTF";
        (p as PannerNode).positionX.value = x; (p as PannerNode).positionY.value = y; (p as PannerNode).positionZ.value = z;

        if (REFINEMENTS.GOLDEN_SPIRAL_Y_LFO && !(isLowEndDevice || batterySaver)) {
          const yLfo = audio.createOscillator();
          const yGain = audio.createGain();
          yLfo.frequency.value = 1 / (PHI * 90); // very slow
          yGain.gain.value = 0.5 * perfScale;
          yLfo.connect(yGain).connect((p as PannerNode).positionY);
          yLfo.start(audio.currentTime + (REFINEMENTS.PAN_LFO_RANDOM_PHASE ? Math.random()*0.5 : 0));
          driftRefs.current.push(yLfo);
        }
      }

      const drift  = audio.createOscillator(); const driftG = audio.createGain();
      drift.frequency.value = 0.013; driftG.gain.value = f * 0.021 * perfScale;
      drift.connect(driftG).connect(o.frequency);
      drift.start(audio.currentTime + (REFINEMENTS.PAN_LFO_RANDOM_PHASE ? Math.random() * 0.5 : 0));
      driftRefs.current.push(drift);

      if (p instanceof PannerNode) {
        const pan  = audio.createOscillator(); const panG = audio.createGain();
        pan.frequency.value = 0.008; panG.gain.value = 0.5 * perfScale;
        pan.connect(panG).connect(p.positionX);
        pan.start(audio.currentTime + (REFINEMENTS.PAN_LFO_RANDOM_PHASE ? Math.random() * 0.5 : 0));
        driftRefs.current.push(pan);
      }

      o.connect(g).connect(p);
      routeDryWet(p);
      o.start();

      oscBankRef.current.push({ osc: o, gain: g, p });
    };

    /* Gain normaliser */
    const harmonicGainTotal = {
      over : fibonacci(dyn.harmonics).reduce((sum, _, i) => sum + (0.034 / (i + 1)), 0),
      under: fibonacci(dyn.harmonics).reduce((sum, _, i) => sum + (0.021 / (i + 1)), 0),
    };
    const norm = {
      over : (a: number) => (a / harmonicGainTotal.over)  * (MAX_TOTAL_GAIN / 2),
      under: (a: number) => (a / harmonicGainTotal.under) * (MAX_TOTAL_GAIN / 2),
    };

    // Optional psychoacoustics (OFF by default)
    const usedFreqs: number[] = [];
    const gainSpread = (f:number, g:number) => {
      if (!REFINEMENTS.EASE_MODE.CRITICAL_BAND_GAIN_SPREAD) return g;
      const hit = usedFreqs.find(u => Math.abs(u-f) < ERB(f));
      const out = hit ? g * 0.82 : g;
      if (!hit) usedFreqs.push(f);
      return out;
    };

    fibonacci(dyn.harmonics).forEach((n, i) => {
      let over  = frequency * n;
      let under = frequency / n;

      if (REFINEMENTS.EASE_MODE.JUST_INTONATION_SNAP) {
        if (withinERB(over, frequency))  over  = frequency * snapRatio(n);
        if (withinERB(under, frequency)) under = frequency / snapRatio(n);
      }

      const θ = i * 144 * Math.PI / 180;
      const r = i + 1;
      const pos = [r * Math.cos(θ), r * Math.sin(θ), Math.sin(i * 0.13) * 2] as [number, number, number];

      let ampO = gainSpread(over,  norm.over (0.034 / (i + 1)));
      let ampU = gainSpread(under, norm.under(0.021 / (i + 1)));

      if (over < audio.sampleRate / 2) {
        if (binaural) { makeSpatial(over - half, ampO, [pos[0] - 1, pos[1], pos[2]]); makeSpatial(over + half, ampO, [pos[0] + 1, pos[1], pos[2]]); }
        else          { makeSpatial(over, ampO, pos); }
      }
      if (under > 20) {
        if (binaural) { makeSpatial(under - half, ampU, [-pos[0] - 1, -pos[1] - 0, -pos[2]]); makeSpatial(under + half, ampU, [-pos[0] + 1, -pos[1], -pos[2]]); }
        else          { makeSpatial(under, ampU, [-pos[0], -pos[1], -pos[2]]); }
      }
    });

    // Connect analysis to master
    dryGainRef.current.connect(analyserRef.current);
    wetGainRef.current.connect(analyserRef.current);

    /* v18: build Instant Entrainment Onramp */
    const buildOnramp = () => {
      if (!REFINEMENTS.INSTANT_ENTRAINMENT_ONRAMP || !entrainGateRef.current) return;
      const gate = entrainGateRef.current;
      const lfo = audio.createOscillator(); lfo.type = "sine";
      const scale = audio.createGain(); scale.gain.value = 0.5;           // [-1,1] → [-0.5,0.5]
      const toHalf = audio.createConstantSource(); toHalf.offset.value = 0.5; // +0.5 → [0,1]
      const depthMul = audio.createGain(); depthMul.gain.value = ONRAMP_DEPTHS[0]; // (0..1)*depth
      const base = audio.createConstantSource(); base.offset.value = 1 - ONRAMP_DEPTHS[0]; // 1 - depth

      lfo.frequency.value = ONRAMP_BEATS[0]; // start at 8 Hz
      lfo.connect(scale).connect(depthMul);
      toHalf.connect(depthMul);
      depthMul.connect(gate.gain);
      base.connect(gate.gain);

      toHalf.start(); base.start();
      lfo.start(audio.currentTime + (REFINEMENTS.PAN_LFO_RANDOM_PHASE ? Math.random()*0.1 : 0));

      onrampLfoRef.current = lfo;
      onrampScaleRef.current = scale;
      onrampDepthGainRef.current = depthMul;
      onrampHalfConstRef.current = toHalf;
      onrampBaseConstRef.current = base;
      onrampStageRef.current = 0;
      onrampActiveRef.current = true;
    };

    buildOnramp();

    // Persist state and start
    localStorage.setItem("lastPhrase", audioPhrase);
    onShowHealingProfile?.(getSpiralProfile(frequency));
    setIsPlaying(true);

    attemptResume("post-start");
  };

  /* CLEANUP ON UNMOUNT */
  useEffect(() => stop, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* IR LIVE RELOAD (with cache + abort hygiene) */
  useEffect(() => {
    if (!isPlaying) return;
    const audio = audioCtxRef.current;
    const cv = convolverRef.current;
    if (!audio || !cv) return;

    const ac = REFINEMENTS.ABORTABLE_FETCHES ? new AbortController() : undefined;
    let cancelled = false;

    (async () => {
      try {
        const slugged = slug(audioPhrase);
        if (REFINEMENTS.IR_CACHE && irCache.has(slugged)) {
          if (!cancelled) cv.buffer = irCache.get(slugged)!;
          return;
        }
        const buf = await fetch(`/audio/ir/${slugged}.wav`, ac ? { signal: ac.signal } : undefined).then(r => r.arrayBuffer());
        if (cancelled) return;
        const decoded = await audio.decodeAudioData(buf);
        for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
          const data = decoded.getChannelData(ch);
          for (let i = 0; i < data.length; i++) data[i] *= IR_SCALE;
        }
        if (REFINEMENTS.IR_CACHE) irCache.set(slugged, decoded);
        cv.buffer = decoded;
      } catch (e) {
        if (!cancelled) console.warn("[IR] fetch failed (live reload)", e);
      }
    })();

    return () => { cancelled = true; ac?.abort?.(); };
  }, [audioPhrase, isPlaying]);

  /* Kai Dynamic Reverb reactor */
  useEffect(() => {
    const kaiTime = kaiPulseRef.current;
    const breath  = kaiBreathPhase();
    const wet = getKaiDynamicReverb(frequency, responsePhrase, kaiTime, breath);
    const dly = getAutoDelay(frequency, responsePhrase, wet);
    autoReverbRef.current = wet;
    setReverbSlider(wet);
    if (isPlaying) { applyReverb(wet); applyDelaySmooth(dly); }
  }, [responsePhrase, frequency, isPlaying]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ════════════════ BREATH BOUNDARY LOOP (φ-locked) ════════════════════════
     Sacred Silence at every 19th boundary (base wet dip).
     v18: onramp stage advance, boundary chime, haptic pulse, visual dispatch.
     Gentle Kai re-lock (ppm) once per silence cycle.
  ─────────────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!isPlaying || !REFINEMENTS.SACRED_SILENCE_MICRO_RESTS) return;
    const audio = audioCtxRef.current;
    const baseWet = baseWetRef.current?.offset;
    const lfo     = breathLfoRef.current;
    if (!audio || !baseWet || !lfo) return;

    const cancelHold = (p: AudioParam, t: number) =>
      (p as any).cancelAndHoldAtTime ? (p as any).cancelAndHoldAtTime(t) : p.cancelScheduledValues(t);

    const scheduleSilenceAt = (t0: number) => {
      const p = baseWet;
      const ps = perfScaleRef.current;
      const start = p.value;
      const down  = Math.max(0, start * (0.89 + (1 - ps) * 0.03));

      cancelHold(p, t0);
      p.setValueAtTime(start, t0);
      p.linearRampToValueAtTime(down,       t0 + 3.0);
      p.linearRampToValueAtTime(start,      t0 + 6.5);
    };

    // small boundary chime (first ~5 breaths)
    const boundaryChimeAt = (t0: number) => {
      if (!REFINEMENTS.BOUNDARY_CHIME || !masterGainRef.current) return;
      const g = audio.createGain(); g.gain.value = 0.0;
      const o = audio.createOscillator(); o.type = "sine"; o.frequency.value = 987; // fib anchor
      const end = t0 + 0.18;
      o.connect(g).connect(masterGainRef.current);
      g.gain.setValueAtTime(0.000, t0);
      g.gain.linearRampToValueAtTime(0.02, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.002, end);
      o.start(t0); o.stop(end + 0.02);
      // no refs kept; one-shot
    };

    // haptic boundary pulse
    const hapticAt = (t0: number) => {
      if (!REFINEMENTS.HAPTIC_BOUNDARY || !("vibrate" in navigator)) return;
      const dt = Math.max(0, (t0 - audio.currentTime) * 1000);
      const id = window.setTimeout(() => { try { (navigator as any).vibrate?.(20); } catch {} }, dt);
      hapticTimersRef.current.push(id);
    };

    // gentle Kai re-lock (once per silence cycle)
    const gentleRelockAt = async (tBoundary: number) => {
      try {
        const ac = REFINEMENTS.ABORTABLE_FETCHES ? new AbortController() : undefined;
        const res = await fetch("https://klock.kaiturah.com/kai", ac ? { signal: ac.signal } : undefined);
        const { kai_time } = await res.json() as { kai_time?: number };
        if (typeof kai_time !== "number") return;

        const T_true = BREATH_SEC;
        const T_local = breathPeriodRef.current;

        const dt = tBoundary - audio.currentTime;
        const kaiAtBoundary = kai_time + Math.max(0, dt);
        const kaiPhase = (kaiAtBoundary % T_true);

        let err = kaiPhase;
        if (err > T_true/2) err -= T_true;

        const N = 13; // spread correction across 13 breaths
        const targetPeriod = T_local + (err / N);

        const ppmClamp = (val:number, ref:number, ppm:number) =>
          Math.max(ref * (1 - ppm/1e6), Math.min(ref * (1 + ppm/1e6), val));
        const corrected = ppmClamp(targetPeriod, T_true, 500);

        const fNow = (lfo.frequency as AudioParam).value;
        const fTarget = 1 / corrected;
        const p = lfo.frequency;
        (p as any).cancelAndHoldAtTime ? (p as any).cancelAndHoldAtTime(tBoundary) : p.cancelScheduledValues(tBoundary);
        p.setValueAtTime(fNow, tBoundary);
        p.linearRampToValueAtTime(fTarget, tBoundary + Math.min(1.0, corrected));
        breathPeriodRef.current = corrected;
      } catch {}
    };

    // v18 onramp stage advance at each boundary (first ONRAMP_BREATHS)
    const onrampAdvanceAt = (t0: number, boundaryIndex: number) => {
      if (!onrampActiveRef.current || !entrainGateRef.current) return;
      const stage = onrampStageRef.current;
      if (stage >= ONRAMP_BREATHS) {
        // fade out gate depth over φ seconds, stop LFO
        const depthMul = onrampDepthGainRef.current!;
        const base = onrampBaseConstRef.current!;
        const lfo = onrampLfoRef.current!;
        depthMul.gain.setValueAtTime(depthMul.gain.value, t0);
        depthMul.gain.linearRampToValueAtTime(0.0001, t0 + PHI); // fade to near 0
        base.offset.setValueAtTime(base.offset.value, t0);
        base.offset.linearRampToValueAtTime(1.0, t0 + PHI);
        try { lfo.stop(t0 + PHI + 0.05); } catch {}
        onrampActiveRef.current = false;
        return;
      }

      // Update beat frequency + depths
      const targetBeat = ONRAMP_BEATS[stage];
      const targetDepth = ONRAMP_DEPTHS[stage] * perfScaleRef.current;

      const lfo = onrampLfoRef.current!;
      const depthMul = onrampDepthGainRef.current!;
      const base = onrampBaseConstRef.current!;

      // set beat at boundary (clickless)
      (lfo.frequency as AudioParam).setValueAtTime(targetBeat, t0 + 0.0001);

      // depth slews in φ proportion of a breath
      const slew = Math.min(0.618 * breathPeriodRef.current, 1.0);
      const startD = depthMul.gain.value;
      depthMul.gain.setValueAtTime(startD, t0);
      depthMul.gain.linearRampToValueAtTime(targetDepth, t0 + slew);
      // baseline is 1 - depth
      base.offset.setValueAtTime(base.offset.value, t0);
      base.offset.linearRampToValueAtTime(1 - targetDepth, t0 + slew);

      // boundary chime + haptic + visual event (first few breaths)
      if (REFINEMENTS.BOUNDARY_CHIME && boundaryIndex < 5) boundaryChimeAt(t0);
      if (REFINEMENTS.HAPTIC_BOUNDARY && boundaryIndex < 8) hapticAt(t0);
      if (REFINEMENTS.VISUAL_BOUNDARY_EVENT) {
        const dt = Math.max(0, (t0 - audio.currentTime) * 1000);
        window.setTimeout(() => {
          try { window.dispatchEvent(new CustomEvent("kai-breath-boundary", { detail: { index: boundaryIndex } })); } catch {}
        }, dt);
      }

      onrampStageRef.current = stage + 1;
    };

    let raf = 0;
    let lastIndex = Math.floor((audio.currentTime - breathAnchorRef.current) / breathPeriodRef.current + 1e-6);
    let counter = 0;
    let globalIndex = 0;

    const tick = () => {
      const T = breathPeriodRef.current;
      const idx = Math.floor((audio.currentTime - breathAnchorRef.current) / T + 1e-6);
      if (idx > lastIndex) {
        const step = (idx - lastIndex);
        counter += step; globalIndex += step;
        const tBoundary = breathAnchorRef.current + idx * T;

        // v18 onramp
        onrampAdvanceAt(tBoundary, globalIndex);

        // sacred silence every 19
        if (counter >= BREATHS_PER_SILENCE) {
          scheduleSilenceAt(tBoundary);
          void gentleRelockAt(tBoundary);
          counter = 0;
        }

        lastIndex = idx;
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, REFINEMENTS.SACRED_SILENCE_MICRO_RESTS]);

  /* MP3 PREFETCH & CACHED FALLBACK (abortable) */
  const [prefetchedAudioUrl, setPrefetchedAudioUrl] = useState("");
  useEffect(() => {
    let cancel = false; const ac = REFINEMENTS.ABORTABLE_FETCHES ? new AbortController() : undefined;
    const key = `${frequency}:${audioPhrase}`;
    const fetchAudio = async () => {
      try {
        if (mp3Cache.has(key)) { if (!cancel) setPrefetchedAudioUrl(mp3Cache.get(key)!); return; }
        const res  = await fetch(
          `https://api.kaiturah.com/api/harmonic?frequency=${frequency}&phrase=${encodeURIComponent(slug(audioPhrase))}`,
          ac ? { signal: ac.signal } : undefined
        );
        if (!res.ok) throw new Error(`MP3 HTTP ${res.status}`);
        const blob = await res.blob(); if (cancel) return;
        const objUrl = URL.createObjectURL(blob);
        mp3Cache.set(key, objUrl);
        if (mp3Cache.size > 24) {
          const firstKey = mp3Cache.keys().next().value;
          if (firstKey) { const url = mp3Cache.get(firstKey); if (url) URL.revokeObjectURL(url); mp3Cache.delete(firstKey); }
        }
        setPrefetchedAudioUrl(objUrl);
      } catch (e) { if (!cancel) console.warn("[MP3] fetch failed", e); }
    };
    if (!isPlaying) fetchAudio();
    return () => { cancel = true; ac?.abort?.(); };
  }, [frequency, audioPhrase, isPlaying]);

  /* Visibility crossfade to MP3 (clickless handoff) + intent guard */
  const wasPlayingRef = useRef(false);
  useEffect(() => { wasPlayingRef.current = isPlaying; }, [isPlaying]);

  useEffect(() => {
    const audioEl = audioRef.current; if (!audioEl) return;
    const onVis = () => {
      if (document.hidden && isPlaying && REFINEMENTS.CROSSFADE_MP3_FALLBACK) {
        stop();
        audioEl.src  = prefetchedAudioUrl;
        audioEl.loop = true;
        audioEl.volume = 0;
        audioEl.play().then(() => {
          const fadeUp = () => {
            if (audioEl.volume < 0.999) { audioEl.volume = Math.min(1, audioEl.volume + 0.08); requestAnimationFrame(fadeUp); }
          }; fadeUp();
        }).catch(err => console.warn("[MP3] fallback play failed", err));
      } else {
        if (audioEl.src) {
          const fadeDown = () => {
            if (audioEl.volume > 0.05) { audioEl.volume *= 0.7; requestAnimationFrame(fadeDown); }
            else { audioEl.pause(); audioEl.src = ""; }
          }; fadeDown();
        }
        if (!document.hidden && !isPlaying && wasPlayingRef.current) void play();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [isPlaying, prefetchedAudioUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Context auto-resume listeners while playing */
  useEffect(() => {
    if (!isPlaying) return;
    const offGestures = installGestureResumers();
    const focusHandler = () => attemptResume("window-focus");
    const visHandler = () => { if (!document.hidden) attemptResume("visibility"); };
    window.addEventListener("focus", focusHandler);
    document.addEventListener("visibilitychange", visHandler);
    return () => {
      offGestures();
      window.removeEventListener("focus", focusHandler);
      document.removeEventListener("visibilitychange", visHandler);
    };
  }, [isPlaying]);

  /* Manual reverb override (User Mix) */
  const onReverb = (e: ChangeEvent<HTMLInputElement>) => {
    const wetInput = parseFloat(e.target.value);
    const wet = Math.min(wetInput, WET_CAP);
    setReverbSlider(wet);
    applyReverb(wet);
    applyDelaySmooth(getAutoDelay(frequency, responsePhrase, wet));
  };

  const toggle = () => (isPlaying ? stop() : void play());

  /* Sigil typing */
  const SigilComponent = (REFINEMENTS.TYPED_SIGIL
    ? (KaiTurahSigil as unknown as React.ComponentType<SigilProps>)
    : (KaiTurahSigil as any));

  /* Fidelity glow tick (ensures reactive UI even with ref-based kai pulse) */
  const [glowTick, setGlowTick] = useState(0);
  useEffect(() => {
    if (!REFINEMENTS.FIDELITY_GLOW_FIX || !isPlaying) return;
    const id = window.setInterval(() => setGlowTick(t => (t + 1) % 1_000_000), 1309);
    return () => clearInterval(id);
  }, [isPlaying]);

  const fidelityGlow = useMemo(() => {
    const sr = actualSampleRate ?? 0;
    const base = sr >= 96000 && !isiOS ? "#00FFD1" : sr >= 48000 ? "#FFBB44" : "#FF5555";
    const glowSize = 4 + Math.sin(glowTick * 0.12) * 1.5;
    return `0 0 ${glowSize}px ${base}55, 0 0 ${glowSize * 2}px ${base}22`;
  }, [actualSampleRate, isiOS, glowTick]);

  /* RENDER */
  return (
    <div className="harmonic-player" style={{ position: "relative", overflow: "hidden" }}>
      <label htmlFor="reverbMix" style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.9rem" }}>
        Kai Reverb: <strong>{(autoReverbRef.current * 100).toFixed(1)}%</strong>{" "}
        | User Mix: <strong>{(reverbSlider * 100).toFixed(1)}%</strong>
      </label>
      <input
        id="reverbMix"
        type="range"
        min={0}
        max={WET_CAP}
        step={0.001}
        value={reverbSlider}
        onChange={onReverb}
        style={{ width: "100%", marginBottom: "0.75rem" }}
        aria-label="Reverb mix"
      />

      <select
        value={audioPhrase}
        onChange={e => setAudioPhrase(e.target.value)}
        style={{ marginTop: "0.25rem" }}
        aria-label="Select phrase"
      >
        {Object.keys(phrasePresets).map(p => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>

      <button
        onClick={toggle}
        onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(); } }}
        aria-pressed={isPlaying}
        className={`play-button ${isPlaying ? "playing" : ""}`}
        style={{
          marginTop: "0.75rem",
          padding: "0.5rem 1.25rem",
          fontSize: "0.88rem",
          fontWeight: 600,
          letterSpacing: "0.4px",
          borderRadius: "999px",
          border: "none",
          cursor: "pointer",
          width: "fit-content",
          maxWidth: "90vw",
          whiteSpace: "nowrap",
          transition: "all 0.25s ease-in-out",
          background: isPlaying
            ? "linear-gradient(to right, #ff4477, #ff2200)"
            : "linear-gradient(to right, #00ffd1, #007766)",
          color: "#000",
          boxShadow: isPlaying
            ? "0 0 8px #ff447744, 0 0 16px #ff220033"
            : "0 0 6px #00ffd133, 0 0 12px #00776622",
          textShadow: isPlaying ? "0 0 1px #00000044" : "0 0 1px #00000033",
          transform: isPlaying ? "scale(1.015)" : "scale(1)",
        }}
      >
        {isPlaying ? "Stop Sound" : `Play ${frequency}Hz Harmonics`}
      </button>

      {actualSampleRate && isPlaying && (
        <div
          className={`harmonic-fidelity ${
            actualSampleRate >= 96000 && !isiOS
              ? "full-spectrum"
              : actualSampleRate >= 48000
              ? "standard-spectrum"
              : "limited-spectrum"
          }`}
          title={`Harmonic Fidelity • ${
            actualSampleRate >= 96000 && !isiOS
              ? "96 kHz – Full Spectrum"
              : actualSampleRate >= 48000
              ? "48 kHz – Standard"
              : "44.1 kHz – Limited"
          } • Kai Pulse: ${kaiPulseRef.current ?? "—"}`}
          style={{
            boxShadow: fidelityGlow,
            animation: "breathGlow 5.236s ease-in-out infinite",
            borderRadius: "999px",
            padding: "0.45rem 1rem",
            backdropFilter: "blur(5px)",
            border: "1px solid rgba(255,255,255,0.07)",
            fontFamily: "'Share Tech Mono', monospace",
            fontSize: "0.72rem",
            fontWeight: 500,
            letterSpacing: "0.42px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            zIndex: 1,
            margin: "0.6rem auto 0",
            width: "fit-content",
            maxWidth: "92vw",
            transition: "all 0.2s ease-in-out",
          }}
        >
          <div className="fidelity-pulse" />
          <div className="fidelity-info" style={{ display: "flex", alignItems: "center", gap: "0.4rem", whiteSpace: "nowrap" }}>
            <img
              src={
                actualSampleRate >= 96000 && !isiOS
                  ? "/icons/full-spectrum.svg"
                  : actualSampleRate >= 48000
                  ? "/icons/standard-fidelity.svg"
                  : "/icons/limited-harmonics.svg"
              }
              alt="fidelity icon"
              className="fidelity-icon"
              style={{
                width: "15px", height: "15px",
                filter: actualSampleRate >= 96000 && !isiOS
                  ? "drop-shadow(0 0 3px #00FFD1)"
                  : actualSampleRate >= 48000
                  ? "drop-shadow(0 0 2px #FFBB44)"
                  : "drop-shadow(0 0 2px #FF5555)",
                opacity: 0.85,
              }}
            />
            <span className="fidelity-label" style={{ opacity: 0.9 }}>
              <span className="fidelity-rate" style={{ fontVariantNumeric: "tabular-nums" }}>
                {actualSampleRate >= 96000 && !isiOS ? "96 kHz" : actualSampleRate >= 48000 ? "48 kHz" : "44.1 kHz"}
              </span>{" "}
              —{" "}
              <strong className="fidelity-type" style={{ fontWeight: 600 }}>
                {actualSampleRate >= 96000 && !isiOS ? "Full" : actualSampleRate >= 48000 ? "Standard" : "Limited"}
              </strong>
            </span>
          </div>
          <div className="fidelity-subtext" style={{ fontSize: "0.6rem", opacity: 0.45, letterSpacing: "0.35px", marginTop: "2px" }}>
            Harmonic Fidelity
          </div>
          <div
            className="fidelity-lock"
            style={{
              fontSize: "0.58rem", marginTop: "1px", opacity: 0.7, fontWeight: 600,
              textTransform: "uppercase", letterSpacing: "0.3px",
              color: actualSampleRate >= 96000 && !isiOS ? "#00ffd1aa" : actualSampleRate >= 48000 ? "#ffaa00aa" : "#ff4444aa",
            }}
          >
            {actualSampleRate >= 96000 && !isiOS ? "Perfect Lock" : actualSampleRate >= 48000 ? "Stable" : "Misaligned"}
          </div>
        </div>
      )}

      <FrequencyWaveVisualizer
        frequency={frequency}
        isPlaying={isPlaying}
        analyser={analyserRef.current}
      />

      {enableVoice && (
        <>
          <KaiTurahHarmonicVoice
            phrase={responsePhrase}
            isPlaying={isPlaying}
            breathPhase={kaiBreathPhase}
            breathStartTime={breathAnchorRef.current}
          />
          <KaiTurahVoiceVisualizer
            phrase={responsePhrase}
            isPlaying={isPlaying}
            breathPhase={kaiBreathPhase}
          />
          <KaiPhraseOverlay
            phrase={responsePhrase}
            isPlaying={isPlaying}
            breathPhase={kaiBreathPhase}
          />
        </>
      )}

      <SigilComponent phrase={responsePhrase} frequency={frequency} breathPhase={kaiBreathPhase} />

      <audio
        ref={audioRef}
        style={{ display: "none" }}
        preload="auto"
        playsInline={REFINEMENTS.PLAY_INLINE}
      />
    </div>
  );
};

export default HarmonicPlayer;
