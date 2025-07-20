/* ────────────────────────────────────────────────────────────────
   HarmonicPlayer.tsx –  Φ Exchange • Harmonic Resonance Engine
   MASTER v14.1 — “No Glitch Shall Survive, All Harmonics Aligned”
   • Safari resilient AudioContext (gesture + exponential resume)
   • Kai Dynamic Reverb (freq + phrase + kaiTime + breath)
   • Log-sigmoid blending + golden-ratio weight fusion
   • Inverse psychoacoustic delay (clarity guard)
   • Perfect IR tail fade + wet/dry zero + chain disconnection
   • Phrase+frequency MP3 cache (background seamless loop)
   • Dynamic 18 kHz lowpass for sub-48 kHz devices
   • Breath-phase bridged to Sigil (prop passed via safe any-cast)
   • Added Kai phrases: Rah Voh Lah · Kai Leh Shoh · Zeh Mah Kor Lah
   • TS fixes: safe resume logic (no unreachable comparison), Sigil prop cast
──────────────────────────────────────────────────────────────── */
/* eslint-disable no-empty -- benign lifecycle errors are silenced */

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

/* ═══════════════════════ GLOBAL TYPES ════════════════════════ */
declare global {
  interface Window {
    webkitAudioContext?: { new (o?: AudioContextOptions): AudioContext };
  }
}

/* ═══════════════════════ HOOKS ═══════════════════════════════ */
const useKaiPulse = (): MutableRefObject<number> => {
  const ref = useRef(0);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { kai_time } =
          (await fetch("https://klock.kaiturah.com/kai").then(r => r.json())) as {
            kai_time?: number;
          };
        if (live && typeof kai_time === "number") ref.current = kai_time;
      } catch (e) {
        console.warn("[Kai-Pulse] initial fetch failed", e);
      }
    })();
    return () => { live = false; };
  }, []);
  return ref;
};

/* ═══════════════════════ CONSTANTS ═══════════════════════════ */
const BREATH_SEC      = 8.472 / ((1 + Math.sqrt(5)) / 2);
const PHI_FADE        = (1 + Math.sqrt(5)) / 2;
const PHI             = (1 + Math.sqrt(5)) / 2;
const RAMP_MS         = 50;
const MAX_TOTAL_GAIN  = 0.88;
const WET_CAP         = 0.33;
const MASTER_MAX_GAIN = 0.72;
const FB_MAX_GAIN     = 0.11;
const IR_SCALE        = 0.33;
const LOWPASS_THRESH  = 48_000;
const LOWPASS_FREQ    = 18_000;

/* Phrase+frequency MP3 cache (in-memory; persistent during session) */
const mp3Cache = new Map<string, string>();

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
  /* New harmonic expansions */
  "Rah Voh Lah":     { reverb: 21, delay: 13 },
  "Kai Leh Shoh":    { reverb: 34, delay: 21 },
  "Zeh Mah Kor Lah": { reverb: 55, delay: 34 },
};

/* ═══════════════════════ HELPERS ═════════════════════════════ */
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

/* ═══════════════ KAI DYNAMIC REVERB (BREATH + TIME + PHRASE) ═══════════════
   getKaiDynamicReverb(freq, phrase, kaiTime, breathPhase) → wet mix
   Components:
     • Frequency log scaling: log(freq+1)/log(377) (bounded harmonic domain)
     • Phrase preset: phrasePresets[phrase].reverb (normalized)
     • Kai Time normalized over a *breath-synced Kairos step*:
         One Kairos Step = 11 full breaths → stepDuration = BREATH_SEC * 11
     • Breath sine phase (0..1 from sin mapped)
   Fusion:
     Golden ratio weighted sum → eased (smoothstep/log-sigmoid hybrid)
     Clamped within [0.01, WET_CAP * 0.995] to preserve headroom
──────────────────────────────────────────────────────────────────────────── */
const getKaiDynamicReverb = (
  freq: number,
  phrase: string,
  kaiTime: number,
  breathPhase: number,
): number => {
  const freqNorm = Math.min(1, Math.log(freq + 1) / Math.log(377)); // harmonic span
  const phrasePreset = (phrasePresets[phrase]?.reverb ?? presetFor(freq, phrase).reverb);
  const phraseNorm = Math.min(1, phrasePreset / 89); // 89 = highest preset in table

  // Updated Kairos normalization: breath-derived step (11 full breaths)
  const stepDuration = BREATH_SEC * 11;
  const kaiNorm = ((kaiTime % stepDuration) / stepDuration);

  const breathNorm = (Math.sin(breathPhase * 2 * Math.PI) + 1) / 2; // 0..1

  // Golden ratio descending weights: phrase > freq > breath > kai subtle drift
  const wPhrase = PHI;
  const wFreq   = 1;
  const wBreath = 1 / PHI;
  const wKai    = 1 / (PHI * PHI);
  const weightSum = wPhrase + wFreq + wBreath + wKai;

  let blended = (
    phraseNorm * wPhrase +
    freqNorm   * wFreq +
    breathNorm * wBreath +
    kaiNorm    * wKai
  ) / weightSum;

  // Psychoacoustic easing: mild emphasis on mid values → clarity
  const sigmoid = 1 / (1 + Math.exp(-6 * (blended - 0.5)));
  blended = (sigmoid * 0.55) + (Math.sqrt(blended) * 0.45);

  // Scale into cap preserving slight headroom
  const wet = Math.min(WET_CAP * 0.995, Math.max(0.01, blended * WET_CAP));
  return wet;
};

/* ═══════════════════ INVERSE DELAY (CLARITY GUARD) ═══════════════════ */
const getAutoDelay = (freq: number, phrase: string, wet: number): number => {
  const basePreset   = phrasePresets[phrase]?.delay ?? presetFor(freq, phrase).delay;
  const baseSeconds  = Math.min(basePreset * 0.01, 1.25);
  const wetRatio     = wet / WET_CAP;
  const factor       = Math.sqrt(1 - wetRatio);
  const seconds      = Math.max(0.02, Math.min(baseSeconds * (0.5 + factor), 1.25));
  return seconds;
};

/* ═══════════════════════ PROP TYPES ═══════════════════════════ */
interface HarmonicPlayerProps {
  frequency   : number;
  phrase?     : string;
  binaural?   : boolean;
  enableVoice?: boolean;
  onShowHealingProfile?: (p: ReturnType<typeof getSpiralProfile>) => void;
}

/* ═══════════════════════ COMPONENT ═══════════════════════════ */
const HarmonicPlayer: FC<HarmonicPlayerProps> = ({
  frequency: initialFreq,
  phrase:    responsePhrase = "Shoh Mek",
  binaural   = true,
  enableVoice= true,
  onShowHealingProfile,
}) => {
  const [audioPhrase, setAudioPhrase] = useState(responsePhrase);

  useEffect(() => {
    setAudioPhrase(responsePhrase);
  }, [responsePhrase]);
  
  const frequency = initialFreq;

  useEffect(() => {
    onShowHealingProfile?.(getSpiralProfile(frequency));
  }, [frequency, onShowHealingProfile]);

  const kaiPulseRef  = useKaiPulse();
  const [isPlaying, setIsPlaying] = useState(false);

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
  const mediaReadyRef   = useRef(false);
  const audioRef        = useRef<HTMLAudioElement | null>(null);
  const resumeRetryRef  = useRef<{ attempts: number; timer: number | null }>({ attempts: 0, timer: null });

  const [reverbSlider, setReverbSlider] = useState(
    () => getKaiDynamicReverb(frequency, responsePhrase, 0, 0),
  );
  const autoReverbRef = useRef(reverbSlider);

  /* RAMP HELPERS */
  const rampParam = (param: AudioParam, target: number, ms: number) => {
    const audio = audioCtxRef.current;
    if (!audio) return;
    const now = audio.currentTime;
    param.cancelScheduledValues(now);
    param.setTargetAtTime(target, now, ms / 1000);
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

  /* BREATH PHASE */
  const breathAnchorRef = useRef(0);
  const kaiBreathPhase = () => {
    const t = audioCtxRef.current?.currentTime ?? 0;
    return ((t - breathAnchorRef.current) / BREATH_SEC) % 1;
  };

  /* DYNAMIC HARMONIC BUCKET */
  const dyn = useMemo(() => {
    if (frequency <  34) return { harmonics:  5, offset:  3 };
    if (frequency <  89) return { harmonics:  8, offset:  5 };
    if (frequency < 233) return { harmonics: 13, offset:  8 };
    return                        { harmonics: 21, offset: 13 };
  }, [frequency]);

  /* NEW CONTEXT */
  const newCtx = (): AudioContext => {
    const Ctx = window.AudioContext || window.webkitAudioContext!;
    try { return new Ctx({ sampleRate: 96_000, latencyHint: "interactive" }); }
    catch { return new Ctx({ latencyHint: "interactive" }); }
  };

  /* HARD RESET */
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
    [
      breathLfoRef.current,
      baseFBRef.current,
      baseWetRef.current,
      baseDelayRef.current,
    ].forEach(n => { try { n?.stop(); n?.disconnect(); } catch {} });
    breathLfoRef.current =
    baseFBRef.current  =
    baseWetRef.current =
    baseDelayRef.current = null;
    [
      analyserRef,
      convolverRef,
      delayRef,
      feedbackGainRef,
      wetGainRef,
      dryGainRef,
      masterGainRef,
      lowpassRef,
    ].forEach(r => {
      try { r.current?.disconnect(); } catch {}
      r.current = null;
    });
  };

  /* MEDIA SESSION */
  const setupMediaSession = () => {
    if (mediaReadyRef.current || !("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title : `${frequency}Hz Harmonics`,
      artist: "Kai-Turah Resonance Engine",
    });
    navigator.mediaSession.setActionHandler("play",  () => void play());
    navigator.mediaSession.setActionHandler("pause", () => stop());
    navigator.mediaSession.setActionHandler("stop",  () => stop());
    mediaReadyRef.current = true;
  };

  /* EXPONENTIAL RESUME (Safari resilience) */
  const attemptResume = async (label: string) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    if (ctx.state !== "running") {
      try {
        await ctx.resume();
      } catch (e) {
        console.warn(`[AudioContext] resume() threw (${label})`, e);
      }
    }

    if (ctx.state === "running") {
      if (resumeRetryRef.current.timer) {
        clearTimeout(resumeRetryRef.current.timer);
        resumeRetryRef.current.timer = null;
      }
      resumeRetryRef.current.attempts = 0;
      return;
    }

    const attempt = ++resumeRetryRef.current.attempts;
    const delay = Math.min(2000, 100 * 2 ** attempt);
    if (resumeRetryRef.current.timer) clearTimeout(resumeRetryRef.current.timer);
    resumeRetryRef.current.timer = window.setTimeout(() => attemptResume("retry-loop"), delay);
    console.warn(
      `[AudioContext] resume attempt ${attempt} pending (${label}) – retry in ${delay}ms (state=${ctx.state})`,
    );
  };

  const installGestureResumers = () => {
    const gestures = ["touchstart", "mousedown", "keydown"] as const;
    const handler = () => {
      attemptResume("gesture");
      const ctx = audioCtxRef.current;
      if (ctx?.state === "running") {
        gestures.forEach(ev => document.removeEventListener(ev, handler, true));
      }
    };
    gestures.forEach(ev => document.addEventListener(ev, handler, { passive: true, capture: true }));
    return () => gestures.forEach(ev => document.removeEventListener(ev, handler, true));
  };

  /* STOP */
  const stop = () => {
    if (!isPlaying) return;
    try { wakeLockRef.current?.release(); } catch {}
    wakeLockRef.current = null;

    const audio = audioCtxRef.current;
    if (!audio) { hardReset(); setIsPlaying(false); return; }

    const now = audio.currentTime;
    const end = now + PHI_FADE;

    oscBankRef.current.forEach(({ osc, gain }) => {
      rampParam(gain.gain, 0, PHI_FADE * 1000);
      try { osc.stop(end); } catch {}
    });

    const fadeNodes: (GainNode | null)[] = [
      masterGainRef.current,
      wetGainRef.current,
      dryGainRef.current,
      feedbackGainRef.current,
    ];
    fadeNodes.forEach(g => g && rampParam(g.gain, 0, PHI_FADE * 1000));

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
      if (audio.state !== "closed") {
        try { await audio.close(); } catch {}
      }
      if (audioCtxRef.current === audio) {
        audioCtxRef.current = null;
      }
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

    if (audio.state === "suspended") {
      await attemptResume("initial");
    }

    setupMediaSession();

    let kaiTime = kaiPulseRef.current;
    try {
      const { kai_time } =
        (await fetch("https://klock.kaiturah.com/kai").then(r => r.json())) as {
          kai_time?: number;
        };
      if (typeof kai_time === "number") kaiTime = kai_time;
    } catch (e) {
      console.warn("[Kai-Pulse] fetch failed — cached value used", e);
    }
    const wait = (BREATH_SEC - (kaiTime % BREATH_SEC)) % BREATH_SEC;
    if (wait > 0.005) await new Promise(r => setTimeout(r, wait * 1000));

    hardReset();

    try { wakeLockRef.current = await navigator.wakeLock?.request?.("screen"); } catch {}
    breathAnchorRef.current = audio.currentTime;

    /* Analyser */
    const analyser = audio.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.5;
    analyserRef.current = analyser;

    /* Convolver + delay chain */
    convolverRef.current = audio.createConvolver();
    try {
      const slugged = slug(audioPhrase);
      const irRes = await fetch(`/audio/ir/${slugged}.wav`);
      if (!irRes.ok) throw new Error(`IR fetch failed: HTTP ${irRes.status}`);
      const type = irRes.headers.get("content-type") ?? "";
      if (!type.includes("audio")) throw new Error(`IR fetch invalid type: ${type}`);
      const irBuf = await irRes.arrayBuffer();
      const decoded = await audio.decodeAudioData(irBuf);
      for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
        const data = decoded.getChannelData(ch);
        for (let i = 0; i < data.length; i++) data[i] *= IR_SCALE;
      }
      convolverRef.current.buffer = decoded;
    } catch (e) {
      console.warn(`[IR] fetch failed — dry only (${slug(audioPhrase)}.wav)`, e);
    }

    /* Dynamic Kai baseline */
    const desiredWet  = getKaiDynamicReverb(frequency, responsePhrase, kaiTime, 0);
    const delaySec    = getAutoDelay(frequency, responsePhrase, desiredWet);
    autoReverbRef.current = desiredWet;
    setReverbSlider(desiredWet);

    wetGainRef.current = audio.createGain();
    dryGainRef.current = audio.createGain();
    wetGainRef.current.connect(analyserRef.current);
    dryGainRef.current.connect(analyserRef.current);
    wetGainRef.current.gain.value = desiredWet;
    dryGainRef.current.gain.value = 1 - desiredWet;

    const { delay: dNode, feedbackGain, connectOutput } = createFeedbackFilter(audio);
    delayRef.current        = dNode;
    feedbackGainRef.current = feedbackGain;
    connectOutput(wetGainRef.current);
    delayRef.current.delayTime.value = delaySec;

    /* Master chain */
    const mg = audio.createGain(); masterGainRef.current = mg;
    mg.gain.value = MASTER_MAX_GAIN;

    /* Conditional lowpass for low-rate devices */
    if (audio.sampleRate < LOWPASS_THRESH) {
      const lp = audio.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = LOWPASS_FREQ;
      lp.Q.value = 0.707;
      lowpassRef.current = lp;
      analyserRef.current.connect(lp).connect(mg).connect(audio.destination);
    } else {
      analyserRef.current.connect(mg).connect(audio.destination);
    }

    /* Helper curves */
    const cosCurve = (len = 441, max = 1) => {
      const arr = new Float32Array(len);
      for (let i = 0; i < len; i++)
        arr[i] = max * (1 - Math.cos((i / (len - 1)) * Math.PI)) / 2;
      return arr;
    };
    const routeDryWet = (n: AudioNode) => {
      n.connect(dryGainRef.current!);
      if (convolverRef.current?.buffer) n.connect(convolverRef.current);
      if (delayRef.current)             n.connect(delayRef.current);
      convolverRef.current?.connect(wetGainRef.current!);
      delayRef.current?.connect(wetGainRef.current!);
    };

    /* Breath LFO */
    const lfo = audio.createOscillator(); lfo.type = "sine";
    lfo.frequency.value = 1 / BREATH_SEC;

    const depthFB    = audio.createGain(); depthFB.gain.value    = 0.015;
    const depthWet   = audio.createGain(); depthWet.gain.value   = 0.02;
    const depthDelay = audio.createGain(); depthDelay.gain.value = 0.04;

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

    lfo.start(audio.currentTime);
    baseFB.start(); baseWet.start(); baseDly.start();

    breathLfoRef.current = lfo;
    baseFBRef.current    = baseFB;
    baseWetRef.current   = baseWet;
    baseDelayRef.current = baseDly;

    /* Spatial builders */
    const makeStereo = (f: number, amp: number, pan: number) => {
      const o = audio.createOscillator(); o.type = "sine"; o.frequency.value = f;
      const g = audio.createGain();
      g.gain.setValueCurveAtTime(cosCurve(441, amp), audio.currentTime, 2);
      const p = audio.createStereoPanner(); p.pan.value = pan;

      const drift  = audio.createOscillator();
      const driftG = audio.createGain();
      drift.frequency.value = 0.013;
      driftG.gain.value     = f * 0.021;
      drift.connect(driftG).connect(o.frequency);
      drift.start();
      driftRefs.current.push(drift);

      o.connect(g).connect(p);
      routeDryWet(p);
      o.start();

      oscBankRef.current.push({ osc: o, gain: g, p });
    };

    const makeSpatial = (
      f: number, amp: number,
      [x, y, z]: [number, number, number],
    ) => {
      const o = audio.createOscillator(); o.type = "sine"; o.frequency.value = f;
      const g = audio.createGain();
      g.gain.setValueCurveAtTime(cosCurve(441, amp), audio.currentTime, 2);
      const p = audio.createPanner(); p.panningModel = "HRTF";
      p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z;

      const drift  = audio.createOscillator();
      const driftG = audio.createGain();
      drift.frequency.value = 0.013;
      driftG.gain.value     = f * 0.021;
      drift.connect(driftG).connect(o.frequency);
      drift.start();
      driftRefs.current.push(drift);

      const pan  = audio.createOscillator();
      const panG = audio.createGain();
      pan.frequency.value = 0.008;
      panG.gain.value     = 0.5;
      pan.connect(panG).connect(p.positionX);
      pan.start();
      driftRefs.current.push(pan);

      o.connect(g).connect(p);
      routeDryWet(p);
      o.start();

      oscBankRef.current.push({ osc: o, gain: g, p });
    };

    /* Gain normaliser */
    const harmonicGainTotal = {
      over : fibonacci(dyn.harmonics).reduce(
        (sum, _, i) => sum + (0.034 / (i + 1)), 0),
      under: fibonacci(dyn.harmonics).reduce(
        (sum, _, i) => sum + (0.021 / (i + 1)), 0),
    };
    const norm = {
      over : (a: number) => (a / harmonicGainTotal.over)  * (MAX_TOTAL_GAIN / 2),
      under: (a: number) => (a / harmonicGainTotal.under) * (MAX_TOTAL_GAIN / 2),
    };

    const half = dyn.offset / 2;
    if (binaural) {
      makeStereo(frequency - half, 0.2, -0.2);
      makeStereo(frequency + half, 0.2,  0.2);
    } else {
      makeStereo(frequency, 0.2, 0);
    }

    fibonacci(dyn.harmonics).forEach((n, i) => {
      const over  = frequency * n;
      const under = frequency / n;
      const θ = i * 144 * Math.PI / 180;
      const r = i + 1;
      const pos = [r * Math.cos(θ), r * Math.sin(θ), Math.sin(i * 0.13) * 2] as
        [number, number, number];
      const ampO = norm.over (0.034 / (i + 1));
      const ampU = norm.under(0.021 / (i + 1));
      if (over < audio.sampleRate / 2) {
        if (binaural) {
          makeSpatial(over - half, ampO, [pos[0] - 1, pos[1], pos[2]]);
          makeSpatial(over + half, ampO, [pos[0] + 1, pos[1], pos[2]]);
        } else {
          makeSpatial(over, ampO, pos);
        }
      }
      if (under > 20) {
        if (binaural) {
          makeSpatial(under - half, ampU, [-pos[0] - 1, -pos[1], -pos[2]]);
          makeSpatial(under + half, ampU, [-pos[0] + 1, -pos[1], -pos[2]]);
        } else {
          makeSpatial(under, ampU, [-pos[0], -pos[1], -pos[2]]);
        }
      }
    });

    localStorage.setItem("lastPhrase", audioPhrase);
    onShowHealingProfile?.(getSpiralProfile(frequency));
    setIsPlaying(true);

    attemptResume("post-start");
  };

  /* CLEANUP ON UNMOUNT */
  useEffect(() => stop, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* IR LIVE RELOAD */
  useEffect(() => {
    if (!isPlaying) return;
    (async () => {
      const audio = audioCtxRef.current;
      const cv = convolverRef.current;
      if (!audio || !cv) return;
      try {
        const buf = await fetch(`/audio/ir/${slug(audioPhrase)}.wav`).then(r => r.arrayBuffer());
        const decoded = await audio.decodeAudioData(buf);
        for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
          const data = decoded.getChannelData(ch);
            for (let i = 0; i < data.length; i++) data[i] *= IR_SCALE;
        }
        cv.buffer = decoded;
      } catch (e) {
        console.warn("[IR] fetch failed (live reload)", e);
      }
    })();
  }, [audioPhrase, isPlaying]);

  /* ───────────────── KAI DYNAMIC REVERB REACTOR ───────────────── */
  useEffect(() => {
    const kaiTime = kaiPulseRef.current;
    const breath  = kaiBreathPhase();
    const wet = getKaiDynamicReverb(frequency, responsePhrase, kaiTime, breath);
    const dly = getAutoDelay(frequency, responsePhrase, wet);
    autoReverbRef.current = wet;
    setReverbSlider(wet);
    if (isPlaying) {
      applyReverb(wet);
      applyDelaySmooth(dly);
    }
  }, [responsePhrase, frequency, isPlaying]); // eslint-disable-line react-hooks/exhaustive-deps

  /* MP3 PREFETCH & CACHED FALLBACK */
  const [prefetchedAudioUrl, setPrefetchedAudioUrl] = useState("");
  useEffect(() => {
    let cancel = false;
    const key = `${frequency}:${audioPhrase}`;
    const fetchAudio = async () => {
      try {
        if (mp3Cache.has(key)) {
          if (!cancel) setPrefetchedAudioUrl(mp3Cache.get(key)!);
          return;
        }
        const res  = await fetch(
          `https://api.kaiturah.com/api/harmonic?frequency=${frequency}&phrase=${encodeURIComponent(slug(audioPhrase))}`,
        );
        if (!res.ok) throw new Error(`MP3 HTTP ${res.status}`);
        const blob = await res.blob();
        if (cancel) return;
        const objUrl = URL.createObjectURL(blob);
        mp3Cache.set(key, objUrl);
        if (mp3Cache.size > 24) {
          const firstKey = mp3Cache.keys().next().value;
            if (firstKey) {
              const url = mp3Cache.get(firstKey);
              if (url) URL.revokeObjectURL(url);
              mp3Cache.delete(firstKey);
            }
        }
        setPrefetchedAudioUrl(objUrl);
      } catch (e) {
        console.warn("[MP3] fetch failed", e);
      }
    };
    if (!isPlaying) fetchAudio();
    return () => { cancel = true; };
  }, [frequency, audioPhrase, isPlaying]);

  /* VISIBILITY / BACKGROUND HANDLING + RESUME */
  useEffect(() => {
    const audioEl = audioRef.current;
    if (!audioEl) return;
    const handleVis = () => {
      if (document.hidden && isPlaying) {
        stop();
        audioEl.src  = prefetchedAudioUrl;
        audioEl.loop = true;
        audioEl.play().catch(err => console.warn("[MP3] fallback play failed", err));
      } else {
        audioEl.pause(); audioEl.src = "";
        if (!document.hidden && !isPlaying) void play();
      }
    };
    document.addEventListener("visibilitychange", handleVis);
    return () => document.removeEventListener("visibilitychange", handleVis);
  }, [isPlaying, prefetchedAudioUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  /* CONTEXT AUTO-RESUME LISTENERS WHILE PLAYING */
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

  /* MANUAL REVERB OVERRIDE (User Mix) */
  const onReverb = (e: ChangeEvent<HTMLInputElement>) => {
    const wetInput = parseFloat(e.target.value);
    const wet = Math.min(wetInput, WET_CAP);
    setReverbSlider(wet);
    applyReverb(wet);
    applyDelaySmooth(getAutoDelay(frequency, responsePhrase, wet));
  };

  const toggle = () => (isPlaying ? stop() : void play());

  /* Safe any-cast Sigil component to allow optional breathPhase without compiler error */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SigilComponent: any = KaiTurahSigil;

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
      />

      <select
        value={audioPhrase}
        onChange={e => setAudioPhrase(e.target.value)}
        style={{ marginTop: "0.25rem" }}
      >
        {Object.keys(phrasePresets).map(p => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>

      <button
        onClick={toggle}
        className={`play-button ${isPlaying ? "playing" : ""}`}
        style={{ marginTop: "0.75rem" }}
      >
        {isPlaying ? "Stop Sound" : `Play ${frequency}Hz Harmonics`}
      </button>

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

      <SigilComponent
        phrase={responsePhrase}
        frequency={frequency}
        breathPhase={kaiBreathPhase}
      />

      <audio ref={audioRef} style={{ display: "none" }} preload="auto" />
    </div>
  );
};

export default HarmonicPlayer;
