/** Every voice is just a set of numbers for the fixed effect chain in graph.ts. */
export interface VoiceParams {
  /** Unprocessed voice level (0–1). */
  dry: number;
  /** Pitch-shifted voice A. */
  pitchA: number; // semitones
  pitchAGain: number;
  /** Pitch-shifted voice B (layered for "possessed" double voices). */
  pitchB: number;
  pitchBGain: number;
  /** Vibrato on both pitch voices. */
  vibratoRate: number; // Hz
  vibratoDepth: number; // semitones
  /** Whisper vocoder (voice → breathy noise). */
  whisper: number;
  /** Ring modulator (robotic / metallic). */
  ringFreq: number;
  ringMix: number;
  /** Distortion. */
  drive: number; // 0–1
  distMix: number;
  /** Tone shaping. */
  highpass: number; // Hz
  lowpass: number; // Hz
  bassBoost: number; // dB low shelf @ 150 Hz
  peakFreq: number;
  peakGain: number; // dB
  /** Metallic comb filter. */
  combMix: number;
  combMs: number;
  combFeedback: number;
  /** Tremolo (volume wobble). */
  tremoloRate: number;
  tremoloDepth: number; // 0–1
  /** Echo. */
  echoTime: number; // seconds
  echoFeedback: number;
  echoMix: number;
  /** Reverb. */
  reverbMix: number;
  reverbSeconds: number;
  /** Faint radio crackle. */
  crackle: number;
  /** Random pitch jumps (poltergeist). */
  chaos: boolean;
  /** Output trim so all voices are roughly equally loud. */
  level: number;
}

export interface Voice {
  id: string;
  name: string;
  emoji: string;
  blurb: string;
  params: VoiceParams;
}

export const BASE: VoiceParams = {
  dry: 0,
  pitchA: 0,
  pitchAGain: 1,
  pitchB: 0,
  pitchBGain: 0,
  vibratoRate: 5,
  vibratoDepth: 0,
  whisper: 0,
  ringFreq: 50,
  ringMix: 0,
  drive: 0,
  distMix: 0,
  highpass: 90,
  lowpass: 12000,
  bassBoost: 0,
  peakFreq: 1500,
  peakGain: 0,
  combMix: 0,
  combMs: 8,
  combFeedback: 0.6,
  tremoloRate: 4,
  tremoloDepth: 0,
  echoTime: 0.3,
  echoFeedback: 0.3,
  echoMix: 0,
  reverbMix: 0,
  reverbSeconds: 2,
  crackle: 0,
  chaos: false,
  level: 1,
};

const v = (id: string, name: string, emoji: string, blurb: string, p: Partial<VoiceParams>): Voice => ({
  id,
  name,
  emoji,
  blurb,
  params: { ...BASE, ...p },
});

export const VOICES: Voice[] = [
  v('clean', 'Clean', '🎤', 'No effect – use to test mic & speaker', {
    pitchAGain: 0,
    dry: 1,
    highpass: 60,
  }),
  v('ghost', 'Classic Ghost', '👻', 'Hollow, floating, distant', {
    pitchA: -3,
    vibratoRate: 0.7,
    vibratoDepth: 0.35,
    highpass: 180,
    lowpass: 6500,
    peakFreq: 2500,
    peakGain: 3,
    tremoloRate: 0.5,
    tremoloDepth: 0.25,
    reverbMix: 0.65,
    reverbSeconds: 4,
    echoTime: 0.42,
    echoFeedback: 0.25,
    echoMix: 0.15,
    level: 1.1,
  }),
  v('demon', 'Demon', '😈', 'Deep, gravelly, from below', {
    pitchA: -9,
    pitchB: -12,
    pitchBGain: 0.5,
    drive: 0.55,
    distMix: 0.45,
    highpass: 50,
    lowpass: 5000,
    bassBoost: 8,
    reverbMix: 0.3,
    reverbSeconds: 1.6,
    level: 0.7,
  }),
  v('possessed', 'Possessed', '🫥', 'Two voices at once, one not yours', {
    dry: 0.55,
    pitchA: -12,
    pitchAGain: 0.85,
    ringFreq: 33,
    ringMix: 0.35,
    drive: 0.3,
    distMix: 0.25,
    bassBoost: 4,
    reverbMix: 0.35,
    reverbSeconds: 2.5,
    level: 0.95,
  }),
  v('wraith', 'Whisper Wraith', '🌬️', 'Breathy whisper all around you', {
    pitchA: 0,
    pitchAGain: 0.12,
    whisper: 1,
    highpass: 300,
    lowpass: 9000,
    reverbMix: 0.55,
    reverbSeconds: 3.5,
    echoTime: 0.28,
    echoFeedback: 0.3,
    echoMix: 0.2,
    level: 2.6,
  }),
  v('child', 'Creepy Child', '👧', 'Small voice, empty nursery', {
    pitchA: 5,
    pitchB: 5.15,
    pitchBGain: 0.35,
    vibratoRate: 5.5,
    vibratoDepth: 0.12,
    highpass: 220,
    peakFreq: 3000,
    peakGain: 3,
    reverbMix: 0.4,
    reverbSeconds: 1.8,
    level: 1,
  }),
  v('beyond', 'Voice from Beyond', '📻', 'Haunted radio transmission', {
    pitchA: -1,
    vibratoRate: 0.3,
    vibratoDepth: 0.5,
    drive: 0.6,
    distMix: 0.6,
    highpass: 450,
    lowpass: 3000,
    peakFreq: 1400,
    peakGain: 8,
    tremoloRate: 7,
    tremoloDepth: 0.2,
    crackle: 0.04,
    reverbMix: 0.15,
    reverbSeconds: 1,
    level: 1.2,
  }),
  v('crypt', 'Crypt Echo', '🕳️', 'Calling out from a deep tomb', {
    pitchA: -4,
    highpass: 120,
    lowpass: 4500,
    bassBoost: 3,
    echoTime: 0.36,
    echoFeedback: 0.55,
    echoMix: 0.5,
    reverbMix: 0.6,
    reverbSeconds: 5,
    level: 1,
  }),
  v('machine', 'Haunted Machine', '🤖', 'Metallic, cursed animatronic', {
    pitchA: -2,
    ringFreq: 90,
    ringMix: 0.7,
    combMix: 0.6,
    combMs: 6,
    combFeedback: 0.75,
    highpass: 150,
    reverbMix: 0.2,
    reverbSeconds: 1.2,
    level: 0.9,
  }),
  v('poltergeist', 'Poltergeist', '🌀', 'Unstable, jumping, unpredictable', {
    pitchA: -5,
    chaos: true,
    vibratoRate: 3,
    vibratoDepth: 0.4,
    highpass: 150,
    tremoloRate: 9,
    tremoloDepth: 0.35,
    echoTime: 0.18,
    echoFeedback: 0.4,
    echoMix: 0.3,
    reverbMix: 0.45,
    reverbSeconds: 2.5,
    level: 1,
  }),
];

/** The user-tweakable knobs, applied on top of a preset. */
export interface Tweaks {
  pitch: number; // semitone offset
  reverb: number; // multiplier 0–2
  echo: number; // multiplier 0–2
  grit: number; // added distortion 0–1
}

export const DEFAULT_TWEAKS: Tweaks = { pitch: 0, reverb: 1, echo: 1, grit: 0 };

export function applyTweaks(p: VoiceParams, t: Tweaks): VoiceParams {
  return {
    ...p,
    pitchA: p.pitchA + t.pitch,
    pitchB: p.pitchB + t.pitch,
    // Clean voice: a pitch tweak should still be audible, so blend in pitch voice.
    ...(p.dry === 1 && t.pitch !== 0 ? { dry: 0, pitchAGain: 1 } : {}),
    reverbMix: Math.min(1, p.reverbMix * t.reverb + (t.reverb > 1 && p.reverbMix === 0 ? (t.reverb - 1) * 0.5 : 0)),
    echoMix: Math.min(1, p.echoMix * t.echo + (t.echo > 1 && p.echoMix === 0 ? (t.echo - 1) * 0.4 : 0)),
    drive: Math.min(1, p.drive + t.grit),
    distMix: Math.min(1, p.distMix + t.grit),
  };
}
