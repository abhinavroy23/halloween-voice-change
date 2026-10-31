/**
 * Every voice is a set of numbers for the fixed chain in graph.ts.
 *
 * Clarity rules the presets follow:
 * - Your words always come from the MAIN voice (PSOLA: shifts pitch but keeps vowel shape),
 *   kept within about ±5 semitones.
 * - Monster/child character comes from a quieter LAYER underneath (granular shifter that
 *   also moves formants), and distortion only goes on that layer.
 * - Reverb/echo are sends with pre-delay and are ducked while you speak.
 * - Presence (2.5–4 kHz) up, mud (300 Hz) down, no harsh low-pass on the voice.
 */
export interface VoiceParams {
  /** Main voice: formant-preserving pitch shift (semitones) and level. */
  pitch: number;
  main: number;
  /** Character layer: formant-shifting pitch (semitones), level, distortion, tone. */
  layerPitch: number;
  layer: number;
  layerDrive: number; // 0–1
  layerTone: number; // low-pass Hz on the layer
  /** Vibrato on both voices. */
  vibratoRate: number;
  vibratoDepth: number; // semitones
  /** Whisper vocoder (voice → breathy noise). */
  whisper: number;
  /** Ring modulator. */
  ringFreq: number;
  ringMix: number;
  /** Distortion on the main voice (keep small). */
  drive: number;
  distMix: number;
  /** Tone. */
  highpass: number;
  lowpass: number;
  bass: number; // dB low shelf 150 Hz
  presence: number; // dB @ 3 kHz
  air: number; // dB high shelf 8 kHz
  peakFreq: number; // extra character peak
  peakGain: number;
  /** Metallic comb filter. */
  combMix: number;
  combMs: number;
  combFeedback: number;
  /** Tremolo. */
  tremoloRate: number;
  tremoloDepth: number;
  /** Echo (send). */
  echoTime: number;
  echoFeedback: number;
  echoMix: number;
  /** Reverb (send). */
  reverbMix: number;
  reverbSeconds: number;
  preDelay: number; // seconds
  /** How far reverb/echo duck while you talk (dB). */
  duck: number;
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
  pitch: 0,
  main: 1,
  layerPitch: 0,
  layer: 0,
  layerDrive: 0,
  layerTone: 3000,
  vibratoRate: 5,
  vibratoDepth: 0,
  whisper: 0,
  ringFreq: 50,
  ringMix: 0,
  drive: 0,
  distMix: 0,
  highpass: 120,
  lowpass: 16000,
  bass: 0,
  presence: 4,
  air: 2,
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
  preDelay: 0.05,
  duck: 12,
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
    highpass: 80,
    presence: 2,
    air: 1,
  }),
  v('ghost', 'Classic Ghost', '👻', 'Hollow, floating, distant', {
    pitch: -2,
    layerPitch: 12,
    layer: 0.12,
    layerTone: 9000,
    vibratoRate: 0.6,
    vibratoDepth: 0.25,
    whisper: 0.2,
    highpass: 150,
    presence: 5,
    air: 4,
    tremoloRate: 0.5,
    tremoloDepth: 0.12,
    reverbMix: 0.5,
    reverbSeconds: 3,
    preDelay: 0.06,
    echoTime: 0.42,
    echoFeedback: 0.25,
    echoMix: 0.12,
    duck: 14,
  }),
  v('demon', 'Demon', '😈', 'Deep, gravelly, from below', {
    pitch: -5,
    layerPitch: -12,
    layer: 0.65,
    layerDrive: 0.5,
    layerTone: 1800,
    highpass: 70,
    bass: 3,
    presence: 5,
    air: 1,
    reverbMix: 0.25,
    reverbSeconds: 1.4,
    preDelay: 0.03,
    duck: 10,
    level: 0.9,
  }),
  v('possessed', 'Possessed', '🫥', 'Two voices at once, one not yours', {
    pitch: 0,
    layerPitch: -12,
    layer: 0.75,
    layerDrive: 0.3,
    layerTone: 2200,
    ringFreq: 30,
    ringMix: 0.15,
    highpass: 90,
    presence: 4,
    reverbMix: 0.3,
    reverbSeconds: 2.2,
    duck: 12,
    level: 0.9,
  }),
  v('wraith', 'Whisper Wraith', '🌬️', 'Breathy whisper all around you', {
    main: 0.35,
    whisper: 1,
    highpass: 250,
    presence: 5,
    air: 3,
    reverbMix: 0.45,
    reverbSeconds: 2.5,
    echoTime: 0.28,
    echoFeedback: 0.3,
    echoMix: 0.18,
    duck: 10,
    level: 1.4,
  }),
  v('child', 'Creepy Child', '👧', 'Small voice, empty nursery', {
    pitch: 4,
    main: 0.45,
    layerPitch: 5,
    layer: 0.85,
    layerTone: 12000,
    vibratoRate: 5.5,
    vibratoDepth: 0.1,
    highpass: 200,
    presence: 3,
    air: 3,
    reverbMix: 0.3,
    reverbSeconds: 1.5,
    duck: 10,
  }),
  v('beyond', 'Voice from Beyond', '📻', 'Haunted radio transmission', {
    pitch: -1,
    vibratoRate: 0.3,
    vibratoDepth: 0.3,
    drive: 0.35,
    distMix: 0.4,
    highpass: 350,
    lowpass: 4500,
    presence: 3,
    air: 0,
    peakFreq: 1800,
    peakGain: 5,
    tremoloRate: 6,
    tremoloDepth: 0.1,
    crackle: 0.025,
    reverbMix: 0.12,
    reverbSeconds: 1,
    duck: 8,
    level: 1.1,
  }),
  v('crypt', 'Crypt Echo', '🕳️', 'Calling out from a deep tomb', {
    pitch: -3,
    highpass: 110,
    presence: 4,
    air: 1,
    echoTime: 0.32,
    echoFeedback: 0.45,
    echoMix: 0.35,
    reverbMix: 0.45,
    reverbSeconds: 4,
    preDelay: 0.07,
    duck: 14,
  }),
  v('machine', 'Haunted Machine', '🤖', 'Metallic, cursed animatronic', {
    pitch: -2,
    ringFreq: 90,
    ringMix: 0.35,
    combMix: 0.35,
    combMs: 6,
    combFeedback: 0.6,
    highpass: 150,
    presence: 3,
    reverbMix: 0.15,
    reverbSeconds: 1.2,
    duck: 8,
  }),
  v('poltergeist', 'Poltergeist', '🌀', 'Unstable, jumping, unpredictable', {
    pitch: -3,
    chaos: true,
    vibratoRate: 3,
    vibratoDepth: 0.3,
    highpass: 150,
    presence: 4,
    tremoloRate: 9,
    tremoloDepth: 0.2,
    echoTime: 0.18,
    echoFeedback: 0.35,
    echoMix: 0.25,
    reverbMix: 0.35,
    reverbSeconds: 2.2,
    duck: 12,
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
  const boost = (base: number, mult: number, extra: number) =>
    Math.min(1, base * mult + (mult > 1 && base === 0 ? (mult - 1) * extra : 0));
  return {
    ...p,
    pitch: p.pitch + t.pitch,
    reverbMix: boost(p.reverbMix, t.reverb, 0.5),
    echoMix: boost(p.echoMix, t.echo, 0.4),
    // Grit goes mostly on the layer so the main voice stays clear.
    layerDrive: Math.min(1, p.layerDrive + t.grit),
    layer: p.layer > 0 ? p.layer : t.grit * 0.5,
    layerPitch: p.layer > 0 ? p.layerPitch + t.pitch : -12 + t.pitch,
    layerTone: p.layer > 0 ? p.layerTone : 2000,
    drive: Math.min(1, p.drive + t.grit * 0.3),
    distMix: Math.min(1, p.distMix + t.grit * 0.2),
  };
}
