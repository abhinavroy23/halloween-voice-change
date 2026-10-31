/**
 * Phantom stage: pre-made spoken lines, synthesized sound effects and background beds.
 * Everything except the lines is generated in the browser (no audio files).
 */
import type { VoiceGraph } from './graph';

type Ctx = AudioContext | OfflineAudioContext;

// ---------------------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------------------

export interface Line {
  id: string;
  text: string;
}

/** Original lines (generated offline with the Flite speech engine, see public/lines). */
export const LINES: Line[] = [
  { id: 'welcome', text: 'Welcome… to my opera house.' },
  { id: 'waiting', text: 'I have been waiting… for you.' },
  { id: 'not-come', text: 'You should not… have come here.' },
  { id: 'mask', text: 'Do not look… behind the mask.' },
  { id: 'disturb', text: 'Who dares… disturb my stage?' },
  { id: 'everywhere', text: 'I am everywhere… and nowhere.' },
  { id: 'leave', text: 'Leave… while you still can.' },
  { id: 'sing', text: 'Sing… for me.' },
  { id: 'soul', text: 'Your soul… belongs to the stage now.' },
  { id: 'show', text: 'The show must go on… forever.' },
  { id: 'bravo', text: 'Bravo… bravo.' },
  { id: 'trick', text: 'Trick… or treat?' },
  { id: 'halloween', text: 'Happy Halloween… if you survive it.' },
  { id: 'laugh', text: 'Ha. Ha. Ha. Ha. Haaa.' },
];

export type SfxId = 'organ' | 'toccata' | 'thunder' | 'bell' | 'whoosh' | 'chandelier' | 'creak';

export const SFX: { id: SfxId; name: string; emoji: string }[] = [
  { id: 'organ', name: 'Organ stab', emoji: '🎹' },
  { id: 'toccata', name: 'Toccata', emoji: '🎼' },
  { id: 'thunder', name: 'Thunder', emoji: '⛈️' },
  { id: 'bell', name: 'Bell toll', emoji: '🔔' },
  { id: 'chandelier', name: 'Chandelier', emoji: '💥' },
  { id: 'creak', name: 'Door creak', emoji: '🚪' },
  { id: 'whoosh', name: 'Whoosh', emoji: '💨' },
];

export type BedId = 'off' | 'organ' | 'musicbox' | 'ambience';

export const BEDS: { id: BedId; name: string }[] = [
  { id: 'off', name: 'Off' },
  { id: 'organ', name: '🎹 Organ' },
  { id: 'musicbox', name: '🎶 Music box' },
  { id: 'ambience', name: '🌫️ Haunted' },
];

// ---------------------------------------------------------------------------------------
// Small synthesis helpers
// ---------------------------------------------------------------------------------------

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

let noiseCache: AudioBuffer | null = null;
function noiseBuffer(ctx: Ctx) {
  if (noiseCache && noiseCache.sampleRate === ctx.sampleRate) return noiseCache;
  const len = ctx.sampleRate * 2;
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  noiseCache = b;
  return b;
}

function noise(ctx: Ctx, t: number, dur: number) {
  const src = new AudioBufferSourceNode(ctx, { buffer: noiseBuffer(ctx), loop: true });
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur + 0.1);
  return src;
}

let organWave: PeriodicWave | null = null;
let organCtx: Ctx | null = null;
/** Pipe-organ tone: 8' + 4' + 2⅔' + 2' style harmonics. */
function getOrganWave(ctx: Ctx) {
  if (organWave && organCtx === ctx) return organWave;
  const amps = [0, 1, 0.7, 0.35, 0.4, 0.08, 0.18, 0, 0.12];
  const real = new Float32Array(amps.length);
  const imag = new Float32Array(amps);
  organWave = ctx.createPeriodicWave(real, imag);
  organCtx = ctx;
  return organWave;
}

/** One organ pipe (with a 16' sub an octave below and a slightly detuned chorus rank). */
function organNote(ctx: Ctx, dest: AudioNode, freq: number, t: number, dur: number, vel = 0.25, attack = 0.04) {
  const env = new GainNode(ctx, { gain: 0 });
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(vel, t + attack);
  env.gain.setValueAtTime(vel, t + Math.max(attack, dur));
  env.gain.setTargetAtTime(0, t + Math.max(attack, dur), 0.12);
  env.connect(dest);
  const wave = getOrganWave(ctx);
  const end = t + dur + 1;
  const a = new OscillatorNode(ctx, { frequency: freq });
  a.setPeriodicWave(wave);
  const b = new OscillatorNode(ctx, { frequency: freq, detune: 4 });
  b.setPeriodicWave(wave);
  const sub = new OscillatorNode(ctx, { type: 'sine', frequency: freq / 2 });
  const bg = new GainNode(ctx, { gain: 0.5 });
  const sg = new GainNode(ctx, { gain: 0.6 });
  a.connect(env);
  b.connect(bg).connect(env);
  sub.connect(sg).connect(env);
  for (const o of [a, b, sub]) {
    o.start(t);
    o.stop(end);
  }
}

/** Struck-metal tone with inharmonic partials (bells, music box tines, chandelier pings). */
function strike(
  ctx: Ctx,
  dest: AudioNode,
  t: number,
  freq: number,
  partials: [ratio: number, amp: number, decay: number][],
  vel: number,
) {
  for (const [r, a, d] of partials) {
    const o = new OscillatorNode(ctx, { type: 'sine', frequency: freq * r });
    const e = new GainNode(ctx, { gain: 0 });
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(a * vel, t + 0.004);
    e.gain.setTargetAtTime(0, t + 0.004, d / 4);
    o.connect(e).connect(dest);
    o.start(t);
    o.stop(t + d * 1.5 + 0.1);
  }
}

const BELL: [number, number, number][] = [
  [0.5, 0.6, 7],
  [1, 1, 5],
  [1.19, 0.5, 3.5],
  [1.5, 0.35, 3],
  [2, 0.3, 2.5],
  [2.51, 0.2, 1.8],
  [3.01, 0.14, 1.4],
  [4.17, 0.1, 0.9],
];

// ---------------------------------------------------------------------------------------
// Sound effects
// ---------------------------------------------------------------------------------------

export function playSfx(ctx: Ctx, dest: AudioNode, id: SfxId, when = ctx.currentTime + 0.02): number {
  const t = when;
  switch (id) {
    case 'organ': {
      // Diminished-seventh stab over a low D: the classic "phantom at the organ" chord.
      for (const n of [38, 50, 53, 56, 59, 62, 65]) organNote(ctx, dest, midi(n), t, 2.2, 0.1, 0.02);
      return 3.5;
    }
    case 'toccata':
      return toccata(ctx, dest, t);
    case 'thunder': {
      const crack = noise(ctx, t, 0.4);
      const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 700 });
      const ce = new GainNode(ctx, { gain: 0 });
      ce.gain.setValueAtTime(0.6, t);
      ce.gain.setTargetAtTime(0, t + 0.01, 0.08);
      crack.connect(hp).connect(ce).connect(dest);
      const rumble = noise(ctx, t, 6);
      const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 220, Q: 0.5 });
      const lp2 = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 400 });
      const re = new GainNode(ctx, { gain: 0 });
      re.gain.setValueAtTime(0, t);
      let time = t + 0.05;
      let level = 1.5;
      while (time < t + 5.5) {
        const v = level * (0.4 + Math.random() * 0.6);
        re.gain.linearRampToValueAtTime(v, time);
        time += 0.04 + Math.random() * 0.12;
        level *= 0.93;
      }
      re.gain.linearRampToValueAtTime(0, t + 6);
      rumble.connect(lp).connect(lp2).connect(re).connect(dest);
      return 6;
    }
    case 'bell': {
      for (let i = 0; i < 3; i++) strike(ctx, dest, t + i * 2.6, 196, BELL, 0.28);
      return 9;
    }
    case 'whoosh': {
      const n = noise(ctx, t, 1.6);
      const bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 250, Q: 1.8 });
      bp.frequency.setValueAtTime(250, t);
      bp.frequency.exponentialRampToValueAtTime(2600, t + 0.55);
      bp.frequency.exponentialRampToValueAtTime(220, t + 1.5);
      const e = new GainNode(ctx, { gain: 0 });
      e.gain.setValueAtTime(0, t);
      e.gain.linearRampToValueAtTime(1.1, t + 0.5);
      e.gain.linearRampToValueAtTime(0, t + 1.5);
      n.connect(bp).connect(e).connect(dest);
      return 1.6;
    }
    case 'chandelier': {
      const n = noise(ctx, t, 2.5);
      const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 5000 });
      const e = new GainNode(ctx, { gain: 0 });
      e.gain.setValueAtTime(0.6, t);
      e.gain.setTargetAtTime(0, t + 0.01, 0.12);
      n.connect(lp).connect(e).connect(dest);
      const glass = noise(ctx, t, 3);
      const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 6000 });
      const ge = new GainNode(ctx, { gain: 0 });
      ge.gain.setValueAtTime(0.25, t);
      ge.gain.setTargetAtTime(0, t + 0.05, 0.6);
      glass.connect(hp).connect(ge).connect(dest);
      for (let i = 0; i < 45; i++) {
        const dt = Math.pow(Math.random(), 2.2) * 2.2;
        const f = 1800 + Math.random() * 5500;
        strike(ctx, dest, t + dt, f, [[1, 1, 0.25 + Math.random() * 0.9], [2.76, 0.4, 0.2]], 0.06 * (1 - dt / 2.6));
      }
      return 3.5;
    }
    case 'creak': {
      // Stick-slip friction: a train of irregular clicks through wood-like resonances.
      const sr = ctx.sampleRate;
      const dur = 1.9;
      const buf = ctx.createBuffer(1, Math.floor(sr * dur), sr);
      const d = buf.getChannelData(0);
      let pos = 0;
      while (pos < d.length) {
        const u = pos / d.length;
        const rate = 35 + 110 * Math.sin(Math.PI * Math.min(1, u * 1.3)) + Math.random() * 25;
        const amp = Math.sin(Math.PI * u) * (0.6 + Math.random() * 0.4);
        d[pos] = amp;
        if (pos + 1 < d.length) d[pos + 1] = -amp * 0.5;
        pos += Math.max(2, Math.round((sr / rate) * (0.8 + Math.random() * 0.4)));
      }
      const src = new AudioBufferSourceNode(ctx, { buffer: buf });
      const out = new GainNode(ctx, { gain: 18 });
      for (const [f, q, a] of [
        [650, 8, 1],
        [1450, 12, 0.7],
        [2900, 9, 0.4],
      ]) {
        const bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: f, Q: q });
        const ga = new GainNode(ctx, { gain: a });
        src.connect(bp).connect(ga).connect(out);
      }
      out.connect(dest);
      src.start(t);
      return dur;
    }
  }
}

/**
 * Opening of Bach's Toccata and Fugue in D minor (public domain), simplified:
 * three falling mordent phrases in octaves, a low D pedal, a rising diminished chord
 * and the resolution to D minor.
 */
function toccata(ctx: Ctx, dest: AudioNode, t0: number): number {
  let t = t0;
  const vel = 0.13;
  const play = (n: number, dur: number, hold = dur) => {
    organNote(ctx, dest, midi(n), t, hold, vel, 0.015);
    organNote(ctx, dest, midi(n - 12), t, hold, vel * 0.8, 0.015);
    t += dur;
  };
  const rest = (d: number) => (t += d);
  const phrase = (top: number, tail: number[]) => {
    play(top, 0.09);
    play(top - 2, 0.09);
    play(top, 0.95, 0.9);
    rest(0.3);
    tail.forEach((n, i) => (i === tail.length - 1 ? play(n, 1.4, 1.3) : play(n, i === tail.length - 2 ? 0.55 : 0.13)));
    rest(0.5);
  };
  // A G A … G F E D C# D (in octaves), then lower
  phrase(81, [79, 77, 76, 74, 73, 74]);
  phrase(69, [64, 65, 61, 62]);
  phrase(57, [55, 53, 52, 50, 49, 50]);
  // low D pedal + rising diminished seventh, then D minor
  const pedalStart = t;
  organNote(ctx, dest, midi(26), pedalStart, 5.4, 0.2, 0.05);
  organNote(ctx, dest, midi(38), pedalStart, 5.4, 0.15, 0.05);
  [49, 52, 55, 58, 61, 64, 67, 70].forEach((n, i) => organNote(ctx, dest, midi(n), pedalStart + i * 0.16, 3.2 - i * 0.16, 0.09, 0.02));
  const res = pedalStart + 3.3;
  for (const n of [50, 53, 57, 62, 65]) organNote(ctx, dest, midi(n), res, 2.1, 0.11, 0.03);
  return res + 3.5 - t0;
}

// ---------------------------------------------------------------------------------------
// Background beds (loop until stopped)
// ---------------------------------------------------------------------------------------

interface Bed {
  stop(): void;
}

function startBed(ctx: Ctx, dest: AudioNode, id: Exclude<BedId, 'off'>): Bed {
  const out = new GainNode(ctx, { gain: 0 });
  out.connect(dest);
  out.gain.setTargetAtTime(1, ctx.currentTime, 0.8);
  let next = ctx.currentTime + 0.1;
  let step = 0;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const sources: AudioScheduledSourceNode[] = [];
  let tick: () => void = () => {};

  if (id === 'organ') {
    // Slow, dark D-minor progression: Dm – B♭ – Gm – A.
    const chords = [
      [38, 50, 53, 57],
      [34, 46, 50, 53],
      [31, 43, 46, 50],
      [33, 45, 49, 52],
    ];
    tick = () => {
      while (next < ctx.currentTime + 2) {
        for (const n of chords[step % chords.length]) organNote(ctx, out, midi(n), next, 7.2, 0.07, 1.6);
        next += 8;
        step++;
      }
    };
  } else if (id === 'musicbox') {
    // Original slow waltz in A minor, slightly detuned like an old music box.
    const melody = [81, 84, 88, 86, 84, 83, 84, 81, 76, 80, 83, 88, 89, 88, 86, 84, 83, 81, 83, 80, 76, 81, 0, 0];
    const beat = 0.46;
    tick = () => {
      while (next < ctx.currentTime + 1.5) {
        const n = melody[step % melody.length];
        if (n) {
          const detune = 1 + (Math.random() - 0.5) * 0.008 + Math.sin(step * 0.13) * 0.004;
          strike(ctx, out, next, midi(n) * detune, [[1, 1, 1.4], [3, 0.25, 0.4], [6.1, 0.08, 0.15]], 0.12);
          if (step % 3 === 0) strike(ctx, out, next, (midi(n) / 4) * detune, [[1, 1, 1.6], [3, 0.2, 0.4]], 0.07);
        }
        next += step % melody.length === melody.length - 1 ? beat * 4 : beat;
        step++;
      }
    };
  } else {
    // Haunted ambience: wind, a slow heartbeat and the odd creak.
    const wind = new AudioBufferSourceNode(ctx, { buffer: noiseBuffer(ctx), loop: true });
    const bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 500, Q: 1.6 });
    const lfo = new OscillatorNode(ctx, { frequency: 0.07 });
    const lfoAmt = new GainNode(ctx, { gain: 300 });
    lfo.connect(lfoAmt).connect(bp.frequency);
    const wg = new GainNode(ctx, { gain: 0.15 });
    const lfo2 = new OscillatorNode(ctx, { frequency: 0.11 });
    const lfo2Amt = new GainNode(ctx, { gain: 0.08 });
    lfo2.connect(lfo2Amt).connect(wg.gain);
    wind.connect(bp).connect(wg).connect(out);
    for (const s of [wind, lfo, lfo2]) {
      s.start();
      sources.push(s);
    }
    let nextCreak = ctx.currentTime + 6 + Math.random() * 8;
    tick = () => {
      while (next < ctx.currentTime + 1.5) {
        for (const [dt, v] of [
          [0, 0.3],
          [0.28, 0.2],
        ]) {
          const o = new OscillatorNode(ctx, { frequency: 52 });
          const e = new GainNode(ctx, { gain: 0 });
          e.gain.setValueAtTime(0, next + dt);
          e.gain.linearRampToValueAtTime(v, next + dt + 0.01);
          e.gain.setTargetAtTime(0, next + dt + 0.02, 0.06);
          o.connect(e).connect(out);
          o.start(next + dt);
          o.stop(next + dt + 0.4);
        }
        next += 1.25;
      }
      if (ctx.currentTime > nextCreak - 1) {
        const g = new GainNode(ctx, { gain: 0.25 });
        g.connect(out);
        playSfx(ctx, g, 'creak', nextCreak);
        nextCreak += 10 + Math.random() * 14;
      }
    };
  }

  tick();
  const interval = setInterval(tick, 400);
  return {
    stop() {
      clearInterval(interval);
      timers.forEach(clearTimeout);
      const now = ctx.currentTime;
      out.gain.cancelScheduledValues(now);
      out.gain.setTargetAtTime(0, now, 0.4);
      setTimeout(() => {
        sources.forEach((s) => {
          try {
            s.stop();
          } catch {
            /* already stopped */
          }
        });
        out.disconnect();
      }, 2500);
    },
  };
}

// ---------------------------------------------------------------------------------------
// Stage controller
// ---------------------------------------------------------------------------------------

export class Stage {
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private currentLine: AudioBufferSourceNode | null = null;
  private bed: Bed | null = null;

  constructor(
    private ctx: AudioContext,
    private graph: VoiceGraph,
  ) {
    // Preload the lines in the background so the first tap plays instantly.
    LINES.forEach((l) => void this.load(l.id));
  }

  private load(id: string) {
    let p = this.buffers.get(id);
    if (!p) {
      p = fetch(`./lines/${id}.mp3`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((b) => this.ctx.decodeAudioData(b))
        .catch((e) => {
          console.warn('line failed to load', id, e);
          this.buffers.delete(id);
          return null;
        });
      this.buffers.set(id, p);
    }
    return p;
  }

  /** Plays a line through the current voice's effects. */
  async playLine(id: string) {
    const buf = await this.load(id);
    if (!buf) return;
    this.stopLine();
    const src = new AudioBufferSourceNode(this.ctx, { buffer: buf });
    const g = new GainNode(this.ctx, { gain: 0.45 });
    src.connect(g).connect(this.graph.clipIn);
    src.start();
    src.onended = () => {
      if (this.currentLine === src) this.currentLine = null;
    };
    this.currentLine = src;
  }

  stopLine() {
    try {
      this.currentLine?.stop();
    } catch {
      /* already stopped */
    }
    this.currentLine = null;
  }

  sfx(id: SfxId) {
    this.graph.holdHall(20); // connect the hall before the sound starts
    const dur = playSfx(this.ctx, this.graph.sfxIn, id);
    this.graph.holdHall(dur);
  }

  setBed(id: BedId) {
    this.bed?.stop();
    this.bed = id === 'off' ? null : startBed(this.ctx, this.graph.bedIn, id);
    if (id === 'off') {
      this.graph.setBedActive(false);
      this.graph.holdHall(3); // let the fading bed's reverb tail finish
    } else this.graph.setBedActive(true);
  }

  dispose() {
    this.stopLine();
    this.bed?.stop();
    this.bed = null;
    this.graph.setBedActive(false);
  }
}
