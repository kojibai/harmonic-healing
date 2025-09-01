/* ─────────────────────────────────────────────────────────────────────────────
   HarmonicPlayer.tsx –  Φ Exchange • Harmonic Resonance Engine
   MASTER v16.0 — “All Φ/Fib Psychoacoustics, Mobile-Safe”
   Pure-truth refinements:
   • Golden drift of binaural beat (+φ breath pacing)
   • Fibonacci early reflection taps before verb/delay
   • Mid/Side wet with golden width LFO (energy-safe)
   • φ-Haas micro-delays on the dry path (presence)
   • Breath-gated pink-air tail (1/f bed, ultra-low)
   • Fibonacci EQ micro-tilt windows (±0.6 dB)
   • Golden-spiral spatial Y-drift (gated on low-end)
   • Device-aware scaling so nothing overpowers mobiles
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
/* Only add the minimal vendor-prefixed AudioContext. Do NOT redeclare DOM types. */
declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
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

  // New φ/Fib psychoacoustics (mobile-safe, auto-scaled)
  PHI_BEAT_DRIFT: true,           // golden glides on binaural beat
  FIBONACCI_EARLY_TAPS: true,     // early reflections at {3,5,8,13,21} ms
  GOLDEN_WIDTH_LFO: true,         // slow width breath on wet M/S
  PHI_HAAS_DRY: true,             // subtle dry Haas for presence
  PINK_AIR_TAIL: true,            // ultra-low pink bed into wet
  FIB_EQ_TILT: true,              // ±0.6 dB Fibonacci windows
  GOLDEN_SPIRAL_Y_LFO: true,      // slow vertical drift of HRTF

  // Optional spectral nudges (OFF by default)
  EASE_MODE: {
    JUST_INTONATION_SNAP: false,
    CRITICAL_BAND_GAIN_SPREAD: false,
    EQUAL_LOUDNESS_AT_LOW_LEVEL: false,
    MICRO_AIR_BED: false,
    BREATH_LOCK_VIA_MIC: false,
  }
} as const;

/* ═══════════════════════ HELPERS & CONSTANTS ═══════════════════════════════ */
const PHI  = (1 + Math.sqrt(5)) / 2;
const PHI_FADE = PHI;
const BREATH_SEC      = 8.472 / PHI; // golden breath derived from φ, not an approximate constant
const RAMP_MS         = 50;
const MAX_TOTAL_GAIN  = 0.88;
const WET_CAP         = 0.33;
const MASTER_MAX_GAIN = 0.72;
const FB_MAX_GAIN     = 0.11;
const IR_SCALE        = 0.33;
const LOWPASS_THRESH  = 48_000;
const LOWPASS_FREQ    = 18_000;

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

const fibonacci = (n: number) => {
  const seq = [1, 1];
  for (let i = 2; i < n; i++) seq.push(seq[i - 1] + seq[i - 2]);
  return seq;
};

const presetFor = (f: number, phrase?: string) =>
  phrasePresets[phrase ?? ""] ??
  SpiralPresets.find(c => f >= c.min && f <= c.max) ??
  { reverb: 3, delay: 2 };

const slug = (t: string) =>
  t.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(" ")[0] || "default";

/* Optional psychoacoustic helpers (kept OFF unless toggled) */
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

  const wPhrase = PHI, wFreq = 1, wBreath = 1/PHI, wKai = 1/(PHI*PHI);
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
      } catch (e) {
        console.warn("[Kai-Pulse] initial fetch failed", e);
      }
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

/* Strict Sigil typing (no runtime change) */
type SigilProps = {
  phrase: string;
  frequency: number;
  breathPhase?: () => number;
};

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
  const oscBankRef      = useRef<
    { osc: OscillatorNode; gain: GainNode; p: PannerNode | StereoPannerNode }[]
  >([]);
  const driftRefs       = useRef<OscillatorNode[]>([]);
  const breathLfoRef    = useRef<OscillatorNode | null>(null);
  const baseFBRef       = useRef<ConstantSourceNode | null>(null);
  const baseWetRef      = useRef<ConstantSourceNode | null>(null);
  const baseDelayRef    = useRef<ConstantSourceNode | null>(null);
  const wakeLockRef     = useRef<WakeLockSentinel | null>(null);
  const wakeKeepAlive   = useRef<number | null>(null);
  const mediaReadyRef   = useRef(false);
  const audioRef        = useRef<HTMLAudioElement | null>(null);
  const resumeRetryRef  = useRef<{ attempts: number; timer: number | null }>({ attempts: 0, timer: null });

  const [reverbSlider, setReverbSlider] = useState(
    () => getKaiDynamicReverb(frequency, responsePhrase, 0, 0),
  );
  const autoReverbRef = useRef(reverbSlider);

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
    return ((t - breathAnchorRef.current) / BREATH_SEC) % 1;
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
    oscBankRef.current.forEach(({ osc, gain, p }) => {
      try { osc.stop(); }        catch {}
      try { osc.disconnect(); }  catch {}
      try { gain.disconnect(); } catch {}
      try { p.disconnect(); }    catch {}
    });
    oscBankRef.current = [];
    driftRefs.current.forEach(d => {
      try { d.stop(); }       catch {}
      try { d.disconnect(); } catch {}
    });
    driftRefs.current = [];
    [ breathLfoRef.current, baseFBRef.current, baseWetRef.current, baseDelayRef.current ]
      .forEach(n => { try { n?.stop(); n?.disconnect(); } catch {} });
    breathLfoRef.current = baseFBRef.current = baseWetRef.current = baseDelayRef.current = null;
    [ analyserRef, convolverRef, delayRef, feedbackGainRef, wetGainRef, dryGainRef, masterGainRef, lowpassRef ]
      .forEach(r => { try { r.current?.disconnect(); } catch {}; r.current = null; });
  };

  /* Media Session */
  const setupMediaSession = () => {
    if (mediaReadyRef.current) return;

    // Some browsers don’t implement Media Session; guard safely.
    const ms = (navigator as any).mediaSession as MediaSession | undefined;
    if (!ms) return;

    // Some browsers may not expose MediaMetadata constructor; guard safely.
    const MediaMetadataCtor =
      (window as any).MediaMetadata as
        | (new (init?: MediaMetadataInit) => MediaMetadata)
        | undefined;

    if (MediaMetadataCtor) {
      ms.metadata = new MediaMetadataCtor({
        title : `${frequency}Hz Harmonics`,
        artist: "Kai-Turah Resonance Engine",
      });
    }

    ms.setActionHandler?.("play",  () => { void play(); });
    ms.setActionHandler?.("pause", () => stop());
    ms.setActionHandler?.("stop",  () => stop());
    ms.setActionHandler?.("seekto", () => { /* no-op */ });

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
    console.warn(`[AudioContext] resume attempt ${attempt} pending (${label}) – retry in ${delay}ms (state=${ctx.state})`);
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

    const fades = [ masterGainRef.current, wetGainRef.current, dryGainRef.current, feedbackGainRef.current ];
    fades.forEach(g => g && rampParam(g.gain, 0, PHI_FADE * 1000));

    breathLfoRef.current?.stop(end);
    baseFBRef.current?.stop(end);
    baseWetRef.current?.stop(end);
    baseDelayRef.current?.stop(end);
    driftRefs.current.forEach(d => { try { d.stop(end); } catch {} });

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

    // Breath sync start — align to Kai Pulse boundary from klock
    let kaiTime = kaiPulseRef.current;
    try {
      const ac = REFINEMENTS.ABORTABLE_FETCHES ? new AbortController() : undefined;
      const { kai_time } =
        (await fetch("https://klock.kaiturah.com/kai", ac ? { signal: ac.signal } : undefined).then(r => r.json())) as { kai_time?: number };
      if (typeof kai_time === "number") kaiTime = kai_time;
    } catch (e) { console.warn("[Kai-Pulse] fetch failed — cached value used", e); }
    const wait = (BREATH_SEC - (kaiTime % BREATH_SEC)) % BREATH_SEC;
    if (wait > 0.005) await new Promise(r => setTimeout(r, wait * 1000));

    hardReset();
    breathAnchorRef.current = audio.currentTime;

    /* Analyser */
    const analyser = audio.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.5;
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

    /* Master chain (+conditional lowpass) */
    const mg = audio.createGain(); masterGainRef.current = mg;
    mg.gain.value = MASTER_MAX_GAIN;

    let post: AudioNode = analyserRef.current;
    if (audio.sampleRate < LOWPASS_THRESH) {
      const lp = audio.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = LOWPASS_FREQ; lp.Q.value = 0.707;
      lowpassRef.current = lp;
      analyserRef.current.connect(lp);
      post = lp;
    }

    /* Fibonacci EQ micro-tilt (±0.6 dB, broad) */
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

    /* DC guard + soft limit (+ optional equal-loudness) */
    if (REFINEMENTS.DC_GUARD_AND_SOFT_LIMIT) {
      const hp = audio.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 18; hp.Q.value = 0.707;
      const comp = audio.createDynamicsCompressor();
      comp.threshold.value = -3; comp.knee.value = 20; comp.ratio.value = 2;
      comp.attack.value = 0.005; comp.release.value = 0.05;

      let tilt: BiquadFilterNode | null = null, air: BiquadFilterNode | null = null;
      if (REFINEMENTS.EASE_MODE.EQUAL_LOUDNESS_AT_LOW_LEVEL) {
        tilt = audio.createBiquadFilter(); tilt.type = "lowshelf"; tilt.frequency.value = 180; tilt.gain.value = 0;
        air  = audio.createBiquadFilter(); air.type  = "highshelf"; air.frequency.value = 6000; air.gain.value = 0;
      }

      if (tilt && air) { post.connect(hp).connect(comp).connect(tilt).connect(air).connect(mg).connect(audio.destination); }
      else { post.connect(hp).connect(comp).connect(mg).connect(audio.destination); }
    } else {
      post.connect(mg).connect(audio.destination);
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
      // dry passthrough to preserve transients slightly
      const dryTap = ctx.createGain(); dryTap.gain.value = 0.12 * perfScale;
      input.connect(dryTap).connect(out);
      return { input, out };
    };

    /* Wet routing (M/S with golden width LFO) */
    const routeWetThrough = (wetChain: AudioNode) => {
      // Fibonacci early taps before main wet
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

      // Golden width LFO: modulate Side gently, compensate Mid slightly
      let sideMod: AudioNode = sideDiff;
      let midMod : AudioNode = midSum;

      if (REFINEMENTS.GOLDEN_WIDTH_LFO) {
        const widthOsc = audio.createOscillator();
        widthOsc.frequency.value = 1 / (PHI * 30); // one cycle ~48s
        const widthDepth = audio.createGain();
        widthDepth.gain.value = 0.05 * perfScale; // ±0.05
        const bias = audio.createConstantSource(); bias.offset.value = 1.05; // base widen
        const widthMix = audio.createGain();
        widthOsc.connect(widthDepth).connect(widthMix);
        bias.connect(widthMix);
        bias.start(); widthOsc.start();

        const sideGain = audio.createGain();
        const midGain  = audio.createGain();
        // Side = widthMix; Mid inverse tilt (keep energy stable)
        widthMix.connect(sideGain.gain);
        // Mid gain ~= 1 - (width-1)*0.4
        const inv = audio.createGain(); inv.gain.value = -0.4;
        const one = audio.createConstantSource(); one.offset.value = 1.0;
        widthMix.connect(inv);
        inv.connect(midGain.gain);
        one.connect(midGain.gain);
        one.start();

        sideDiff.connect(sideGain); midSum.connect(midGain);
        sideMod = sideGain; midMod = midGain;
      }

      // Re-matrix to L/R: L' = M + S, R' = M - S
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
      // φ-Haas on dry (presence without smear)
      if (REFINEMENTS.PHI_HAAS_DRY) {
        const split = audio.createChannelSplitter(2);
        const left  = audio.createDelay();  left.delayTime.value  = 0.008 * (isLowEndDevice || batterySaver ? 0.7 : 1); // 8 ms
        const right = audio.createDelay();  right.delayTime.value = 0.013 * (isLowEndDevice || batterySaver ? 0.7 : 1); // 13 ms
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

    /* Breath LFO */
    const lfo = audio.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 1 / BREATH_SEC;
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
    const half = dyn.offset / 2; // used for binaural beat spacing

    const makeStereo = (f: number, amp: number, pan: number, beatHalf = 0) => {
      const o = audio.createOscillator(); o.type = "sine"; o.frequency.value = f;
      const g = audio.createGain(); g.gain.setValueCurveAtTime(cosCurve(441, amp), audio.currentTime, 2);
      const p = audio.createStereoPanner(); p.pan.value = pan;

      // Slow pitch drift
      const drift  = audio.createOscillator(); const driftG = audio.createGain();
      drift.frequency.value = 0.013; driftG.gain.value = f * 0.021 * perfScale;
      drift.connect(driftG).connect(o.frequency);
      drift.start(audio.currentTime + (REFINEMENTS.PAN_LFO_RANDOM_PHASE ? Math.random() * 0.5 : 0));
      driftRefs.current.push(drift);

      // Golden binaural-beat drift (±15% of half)
      if (REFINEMENTS.PHI_BEAT_DRIFT && beatHalf > 0) {
        const sign = pan < 0 ? -1 : 1;
        const beatBase = audio.createConstantSource(); beatBase.offset.value = sign * (beatHalf);
        const beatLfo = audio.createOscillator(); beatLfo.type = "sine";
        beatLfo.frequency.value = 1 / (PHI * PHI * 60); // ~1.618 min cycle
        const beatDepth = audio.createGain(); beatDepth.gain.value = sign * (beatHalf * 0.15 * perfScale);
        beatLfo.connect(beatDepth).connect(o.frequency);
        beatBase.connect(o.frequency);
        beatBase.start();
        beatLfo.start(audio.currentTime + (REFINEMENTS.PAN_LFO_RANDOM_PHASE ? Math.random()*0.5 : 0));
        driftRefs.current.push(beatLfo);
      }

      o.connect(g).connect(p);
      routeDryWet(p);
      o.start();

      oscBankRef.current.push({ osc: o, gain: g, p });
    };

    const makeSpatial = (f: number, amp: number, [x,y,z]: [number,number,number]) => {
      const o = audio.createOscillator(); o.type = "sine"; o.frequency.value = f;
      const g = audio.createGain(); g.gain.setValueCurveAtTime(cosCurve(441, amp), audio.currentTime, 2);

      let p: PannerNode | StereoPannerNode;
      if (REFINEMENTS.STEREOPANNER_ON_LOWEND && (isLowEndDevice || batterySaver || isiOS || !audio.createPanner)) {
        p = audio.createStereoPanner(); (p as StereoPannerNode).pan.value = Math.max(-1, Math.min(1, x / 6));
      } else {
        p = audio.createPanner(); (p as PannerNode).panningModel = "HRTF";
        (p as PannerNode).positionX.value = x; (p as PannerNode).positionY.value = y; (p as PannerNode).positionZ.value = z;

        // Golden spiral Y-drift (skip on low-end)
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
        if (binaural) { makeSpatial(under - half, ampU, [-pos[0] - 1, -pos[1], -pos[2]]); makeSpatial(under + half, ampU, [-pos[0] + 1, -pos[1], -pos[2]]); }
        else          { makeSpatial(under, ampU, [-pos[0], -pos[1], -pos[2]]); }
      }
    });

    // NOTE: Sacred Silence trigger moved to a breath-synced effect below.
    // (No time-based setTimeout scheduling remains here.)
    // Connect analysis to master
    dryGainRef.current.connect(analyserRef.current);
    wetGainRef.current.connect(analyserRef.current);

    localStorage.setItem("lastPhrase", audioPhrase);
    onShowHealingProfile?.(getSpiralProfile(frequency));
    setIsPlaying(true);

    attemptResume("post-start");
  };

  /* CLEANUP ON UNMOUNT */
  useEffect(() => stop, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* IR LIVE RELOAD (with cache) */
  useEffect(() => {
    if (!isPlaying) return;
    (async () => {
      const audio = audioCtxRef.current;
      const cv = convolverRef.current;
      if (!audio || !cv) return;
      try {
        const slugged = slug(audioPhrase);
        if (REFINEMENTS.IR_CACHE && irCache.has(slugged)) {
          cv.buffer = irCache.get(slugged)!;
          return;
        }
        const ac = REFINEMENTS.ABORTABLE_FETCHES ? new AbortController() : undefined;
        const buf = await fetch(`/audio/ir/${slugged}.wav`, ac ? { signal: ac.signal } : undefined).then(r => r.arrayBuffer());
        const decoded = await audio.decodeAudioData(buf);
        for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
          const data = decoded.getChannelData(ch);
          for (let i = 0; i < data.length; i++) data[i] *= IR_SCALE;
        }
        if (REFINEMENTS.IR_CACHE) irCache.set(slugged, decoded);
        cv.buffer = decoded;
      } catch (e) {
        console.warn("[IR] fetch failed (live reload)", e);
      }
    })();
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

  /* ═════════════════ SACRED SILENCE — BREATH-SYNCED (EVERY 19 PULSES) ══════
     Triggers a wet-mix dip exactly after every 19th complete Kai breath cycle.
     No setTimeout/setInterval; detection is via breath index from golden timing.
  ========================================================================= */
  useEffect(() => {
    if (!isPlaying || !REFINEMENTS.SACRED_SILENCE_MICRO_RESTS) return;
    const audio = audioCtxRef.current;
    const wetParam = wetGainRef.current?.gain;
    if (!audio || !wetParam) return;

    let raf = 0;
    let lastIndex = Math.floor((audio.currentTime - breathAnchorRef.current) / BREATH_SEC + 1e-6);
    let counter = 0;

    const triggerSacredSilence = () => {
      const now = audio.currentTime;
      const g = wetParam;
      const ps = perfScaleRef.current;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      // Dip down smoothly, then back up — all scheduled in AudioContext time.
      g.linearRampToValueAtTime(Math.max(0, g.value * (0.89 + (1 - ps) * 0.03)), now + 3.0);
      g.linearRampToValueAtTime(Math.max(0.0001, g.value),                   now + 6.5);
    };

    const tick = () => {
      const idx = Math.floor((audio.currentTime - breathAnchorRef.current) / BREATH_SEC + 1e-6);
      if (idx > lastIndex) {
        counter += (idx - lastIndex);   // catch-up if frames skipped
        if (counter >= 19) {
          triggerSacredSilence();       // run immediately after the 19th *ends*
          counter = 0;                  // reset for next ritual cycle
        }
        lastIndex = idx;
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, REFINEMENTS.SACRED_SILENCE_MICRO_RESTS]); // breath-synced; uses perfScaleRef internally

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

  /* Visibility crossfade to MP3 (clickless handoff) */
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
        if (!document.hidden && !isPlaying) void play();
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
