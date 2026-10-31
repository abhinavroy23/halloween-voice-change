import { VoiceParams } from './voices';
import { getImpulse, makeCrackleBuffer, makeNoiseBuffer } from './impulse';

/**
 * One persistent effect chain, built for clarity. Voices only change parameter values on
 * it (with short ramps), so switching voices never rebuilds nodes and never pops.
 *
 *  mic → gate/echo-guard ┬→ MAIN (PSOLA, keeps vowels) ─────┬──────────────────────── clarity ─┐
 *                        ├→ LAYER (granular + its own grit) ─┤                                   │
 *                        └→ whisper vocoder ─────────────────┴→ ring → drive → comb → tremolo ──┴→ clarity EQ
 *    → voice compressor ┬→ direct ───────────────────────────────────────────┐
 *                       ├→ echo send ──────────────┐                          ├→ volume → limiter → soft clip → speaker
 *                       └→ reverb send (pre-delay) ┴→ EQ → ducker (voice key) ┘
 */
export class VoiceGraph {
  readonly input: GainNode;
  readonly analyser: AnalyserNode;
  readonly master: GainNode;
  /** Final output; the engine routes it to the speaker (directly or via an <audio> element). */
  readonly output: GainNode;

  private ctx: AudioContext | OfflineAudioContext;
  private gate: AudioWorkletNode;
  private psola: AudioWorkletNode;
  private layerShift: AudioWorkletNode;
  private mainGain: GainNode;
  private clarityGain: GainNode;
  private layerClean: GainNode;
  private layerPre: GainNode;
  private layerDist: GainNode;
  private layerLp: BiquadFilterNode;
  private layerGain: GainNode;
  private vibOsc: OscillatorNode;
  private vibDepth: GainNode;
  private whisperOut: GainNode;
  private ringDry: GainNode;
  private ringOsc: OscillatorNode;
  private ringDepth: GainNode;
  private distDry: GainNode;
  private drivePre: GainNode;
  private distWet: GainNode;
  private hp: BiquadFilterNode;
  private mud: BiquadFilterNode;
  private bass: BiquadFilterNode;
  private peak: BiquadFilterNode;
  private presence: BiquadFilterNode;
  private air: BiquadFilterNode;
  private lp: BiquadFilterNode;
  private combDry: GainNode;
  private combDelay: DelayNode;
  private combFb: GainNode;
  private combWet: GainNode;
  private trem: GainNode;
  private tremOsc: OscillatorNode;
  private tremDepth: GainNode;
  private crackleGain: GainNode;
  private echoSend: GainNode;
  private echoDelay: DelayNode;
  private echoFb: GainNode;
  private reverbSend: GainNode;
  private preDelay: DelayNode;
  private reverb: ConvolverNode;
  private reverbReturn: GainNode;
  private ducker: AudioWorkletNode;
  private level: GainNode;
  private reverbSeconds = 0;
  private reverbSwapTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(ctx: AudioContext | OfflineAudioContext) {
    this.ctx = ctx;
    const g = (value = 1) => new GainNode(ctx, { gain: value });
    const mono = { outputChannelCount: [1] };

    // --- input + gate --------------------------------------------------------------
    this.input = g(1);
    const inHp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 70, Q: 0.7 });
    this.analyser = new AnalyserNode(ctx, { fftSize: 1024, smoothingTimeConstant: 0 });
    this.gate = new AudioWorkletNode(ctx, 'noise-gate', { numberOfInputs: 2, ...mono });
    this.input.connect(inHp);
    inHp.connect(this.analyser);
    inHp.connect(this.gate);

    const voiceSum = g(1);
    const eqIn = g(1);

    // --- MAIN voice: formant-preserving pitch shift -----------------------------------
    this.psola = new AudioWorkletNode(ctx, 'psola', mono);
    this.mainGain = g(1);
    this.clarityGain = g(0);
    this.gate.connect(this.psola).connect(this.mainGain).connect(voiceSum);
    this.mainGain.connect(this.clarityGain).connect(eqIn); // clean copy that skips the weird FX

    // --- character LAYER: formant-shifting pitch + its own distortion ------------------
    this.layerShift = new AudioWorkletNode(ctx, 'pitch-shifter', mono);
    const layerSum = g(1);
    this.layerClean = g(1);
    this.layerPre = g(1);
    const layerShaper = new WaveShaperNode(ctx, { curve: tanhCurve(), oversample: '2x' });
    this.layerDist = g(0);
    this.layerLp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 3000, Q: 0.6 });
    this.layerGain = g(0);
    this.gate.connect(this.layerShift);
    this.layerShift.connect(this.layerClean).connect(layerSum);
    this.layerShift.connect(this.layerPre).connect(layerShaper).connect(this.layerDist).connect(layerSum);
    layerSum.connect(this.layerLp).connect(this.layerGain).connect(voiceSum);

    this.vibOsc = new OscillatorNode(ctx, { frequency: 5 });
    this.vibDepth = g(0);
    this.vibOsc.connect(this.vibDepth);
    this.vibDepth.connect(this.psola.parameters.get('semitones')!);
    this.vibDepth.connect(this.layerShift.parameters.get('semitones')!);
    this.vibOsc.start();

    // --- whisper vocoder --------------------------------------------------------------
    this.whisperOut = g(0);
    this.buildVocoder(this.gate, this.whisperOut);
    this.whisperOut.connect(voiceSum);

    // --- ring modulator -----------------------------------------------------------
    const ringOut = g(1);
    this.ringDry = g(1);
    const ringWet = g(0);
    this.ringOsc = new OscillatorNode(ctx, { frequency: 50 });
    this.ringDepth = g(0);
    this.ringOsc.connect(this.ringDepth).connect(ringWet.gain);
    this.ringOsc.start();
    voiceSum.connect(this.ringDry).connect(ringOut);
    voiceSum.connect(ringWet).connect(ringOut);

    // --- main distortion (radio etc.) ---------------------------------------------
    const distOut = g(1);
    this.distDry = g(1);
    this.drivePre = g(1);
    const shaper = new WaveShaperNode(ctx, { curve: tanhCurve(), oversample: '2x' });
    this.distWet = g(0);
    ringOut.connect(this.distDry).connect(distOut);
    ringOut.connect(this.drivePre).connect(shaper).connect(this.distWet).connect(distOut);

    // --- comb filter --------------------------------------------------------------
    const combOut = g(1);
    this.combDry = g(1);
    this.combDelay = new DelayNode(ctx, { maxDelayTime: 0.05, delayTime: 0.008 });
    this.combFb = g(0);
    this.combWet = g(0);
    distOut.connect(this.combDry).connect(combOut);
    distOut.connect(this.combDelay);
    this.combDelay.connect(this.combFb).connect(this.combDelay);
    this.combDelay.connect(this.combWet).connect(combOut);

    // --- tremolo ------------------------------------------------------------------
    this.trem = g(1);
    this.tremOsc = new OscillatorNode(ctx, { frequency: 4 });
    this.tremDepth = g(0);
    this.tremOsc.connect(this.tremDepth).connect(this.trem.gain);
    this.tremOsc.start();
    combOut.connect(this.trem).connect(eqIn);

    // --- clarity EQ ---------------------------------------------------------------
    this.hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 120, Q: 0.7 });
    this.mud = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 300, Q: 1, gain: -3 });
    this.bass = new BiquadFilterNode(ctx, { type: 'lowshelf', frequency: 150, gain: 0 });
    this.peak = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 1500, Q: 1.2, gain: 0 });
    this.presence = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 3000, Q: 0.9, gain: 4 });
    this.air = new BiquadFilterNode(ctx, { type: 'highshelf', frequency: 8000, gain: 2 });
    this.lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 16000, Q: 0.7 });
    eqIn
      .connect(this.hp)
      .connect(this.mud)
      .connect(this.bass)
      .connect(this.peak)
      .connect(this.presence)
      .connect(this.air)
      .connect(this.lp);

    // --- voice compressor BEFORE the effects (tails stay quiet, words stay up front) ---
    const voiceComp = new DynamicsCompressorNode(ctx, {
      threshold: -28,
      knee: 6,
      ratio: 3.5,
      attack: 0.003,
      release: 0.12,
    });
    const voiceOut = g(3.5); // ≈ +11 dB makeup
    this.lp.connect(voiceComp).connect(voiceOut);

    const mix = g(1);
    voiceOut.connect(mix);

    // --- radio crackle ------------------------------------------------------------
    const crackle = new AudioBufferSourceNode(ctx, { buffer: makeCrackleBuffer(ctx), loop: true });
    this.crackleGain = g(0);
    crackle.connect(this.crackleGain).connect(mix);
    crackle.start();

    // --- echo + reverb sends → EQ → ducker ------------------------------------------
    const fx = g(1);
    this.echoSend = g(0);
    this.echoDelay = new DelayNode(ctx, { maxDelayTime: 2, delayTime: 0.3 });
    const echoTone = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 3500 });
    this.echoFb = g(0);
    voiceOut.connect(this.echoSend).connect(this.echoDelay);
    this.echoDelay.connect(echoTone).connect(this.echoFb).connect(this.echoDelay);
    this.echoDelay.connect(fx);

    this.reverbSend = g(0);
    this.preDelay = new DelayNode(ctx, { maxDelayTime: 0.2, delayTime: 0.05 });
    this.reverb = new ConvolverNode(ctx);
    this.reverbReturn = g(1);
    voiceOut.connect(this.reverbSend).connect(this.preDelay).connect(this.reverb).connect(this.reverbReturn).connect(fx);
    this.echoDelay.connect(this.reverbSend); // echoes also get reverb

    const fxHp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 250, Q: 0.7 });
    const fxLp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 6000, Q: 0.7 });
    this.ducker = new AudioWorkletNode(ctx, 'ducker', { numberOfInputs: 2, outputChannelCount: [2] });
    this.gate.connect(this.ducker, 0, 0); // key: your (gated) voice
    fx.connect(fxHp).connect(fxLp).connect(this.ducker, 0, 1);
    this.ducker.connect(mix);

    // --- output -------------------------------------------------------------------
    this.level = g(1);
    this.master = g(1);
    const limiter = new DynamicsCompressorNode(ctx, {
      threshold: -2,
      knee: 0,
      ratio: 20,
      attack: 0.001,
      release: 0.08,
    });
    const clipper = new WaveShaperNode(ctx, { curve: softClipCurve() });
    this.output = g(1);
    mix.connect(this.level).connect(this.master).connect(limiter).connect(clipper).connect(this.output);

    // Echo guard side-chain: what we send to the speaker → gate input 1.
    // (Web Audio needs a DelayNode inside any loop; 3 ms is negligible.)
    const sideDelay = new DelayNode(ctx, { maxDelayTime: 0.05, delayTime: 0.003 });
    this.output.connect(sideDelay).connect(this.gate, 0, 1);
  }

  /** Channel vocoder: the voice's band envelopes shape bands of white noise → whisper. */
  private buildVocoder(src: AudioNode, dest: AudioNode) {
    const ctx = this.ctx;
    const noise = new AudioBufferSourceNode(ctx, { buffer: makeNoiseBuffer(ctx), loop: true });
    noise.start();
    const rect = new Float32Array(1025);
    for (let i = 0; i < rect.length; i++) rect[i] = Math.abs(i / 512 - 1);
    const bands = 16;
    const lo = 180;
    const hi = 7500;
    const makeup = new GainNode(ctx, { gain: 6 });
    makeup.connect(dest);
    for (let b = 0; b < bands; b++) {
      const f = lo * Math.pow(hi / lo, b / (bands - 1));
      const analysis = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: f, Q: 6 });
      const abs = new WaveShaperNode(ctx, { curve: rect });
      const smooth = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 35 });
      const carrierBand = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: f, Q: 6 });
      const vca = new GainNode(ctx, { gain: 0 });
      src.connect(analysis).connect(abs).connect(smooth).connect(vca.gain);
      noise.connect(carrierBand).connect(vca).connect(makeup);
    }
  }

  private set(param: AudioParam, value: number, t = 0.04) {
    param.cancelScheduledValues(this.ctx.currentTime);
    param.setTargetAtTime(value, this.ctx.currentTime, t);
  }

  setGateThreshold(db: number) {
    this.set(this.gate.parameters.get('threshold')!, db, 0.01);
  }

  /** 0 = off … 1 = strongest echo guard. */
  setEchoGuard(amount: number) {
    this.set(this.gate.parameters.get('guard')!, amount, 0.01);
  }

  setInputGain(gain: number) {
    this.set(this.input.gain, gain);
  }

  setMaster(gain: number) {
    this.set(this.master.gain, gain, 0.02);
  }

  /** Used by poltergeist mode to jump pitch around. */
  setPitch(semitones: number, t = 0.03) {
    this.set(this.psola.parameters.get('semitones')!, semitones, t);
  }

  /**
   * @param clarity 0 = full spooky … 1 = clearest. Blends a clean copy of the main voice
   * past the weird effects, turns the reverb/echo sends down and ducks them harder.
   */
  apply(p: VoiceParams, clarity: number) {
    const isPlain = p.whisper === 0 && p.ringMix === 0 && p.combMix === 0 && p.distMix === 0 && p.layer === 0;
    this.setPitch(p.pitch);
    this.set(this.mainGain.gain, p.main);
    this.set(this.clarityGain.gain, isPlain ? 0 : clarity * 0.8);
    this.set(this.layerShift.parameters.get('semitones')!, p.layerPitch);
    this.set(this.layerGain.gain, p.layer);
    const layerMix = Math.min(1, p.layerDrive * 2);
    this.set(this.layerClean.gain, 1 - layerMix);
    // Grit without a huge boost to quiet sounds (quiet speaker leak shouldn't get amplified).
    const pre = 1 + p.layerDrive * 12;
    this.set(this.layerPre.gain, pre);
    this.set(this.layerDist.gain, (layerMix * 0.7) / Math.sqrt(pre * 3));
    this.set(this.layerLp.frequency, p.layerTone);
    this.set(this.vibOsc.frequency, p.vibratoRate);
    this.set(this.vibDepth.gain, p.vibratoDepth);
    this.set(this.whisperOut.gain, p.whisper);

    this.set(this.ringOsc.frequency, p.ringFreq);
    this.set(this.ringDry.gain, 1 - p.ringMix);
    this.set(this.ringDepth.gain, p.ringMix * 1.6);

    this.set(this.drivePre.gain, 1 + p.drive * 25);
    this.set(this.distDry.gain, 1 - p.distMix);
    this.set(this.distWet.gain, p.distMix * (0.5 / (0.3 + p.drive)) * 0.6);

    this.set(this.combDry.gain, 1 - p.combMix * 0.5);
    this.set(this.combDelay.delayTime, p.combMs / 1000);
    this.set(this.combFb.gain, p.combMix > 0 ? p.combFeedback : 0);
    this.set(this.combWet.gain, p.combMix);

    this.set(this.tremOsc.frequency, p.tremoloRate);
    this.set(this.trem.gain, 1 - p.tremoloDepth / 2);
    this.set(this.tremDepth.gain, p.tremoloDepth / 2);

    this.set(this.hp.frequency, p.highpass);
    this.set(this.bass.gain, p.bass);
    this.set(this.peak.frequency, p.peakFreq);
    this.set(this.peak.gain, p.peakGain);
    this.set(this.presence.gain, p.presence);
    this.set(this.air.gain, p.air);
    this.set(this.lp.frequency, p.lowpass);

    this.set(this.crackleGain.gain, p.crackle);

    const sendScale = 1 - clarity * 0.5;
    this.set(this.echoSend.gain, p.echoMix * sendScale);
    this.set(this.echoDelay.delayTime, p.echoTime, 0.1);
    this.set(this.echoFb.gain, Math.min(0.85, p.echoFeedback));
    this.set(this.preDelay.delayTime, p.preDelay);
    this.set(this.ducker.parameters.get('depth')!, p.duck + clarity * 8);

    this.set(this.level.gain, p.level);
    this.setReverb(p.reverbMix * sendScale * 1.3, p.reverbSeconds);
  }

  private setReverb(send: number, seconds: number) {
    if (seconds === this.reverbSeconds || send === 0) {
      clearTimeout(this.reverbSwapTimer);
      this.set(this.reverbSend.gain, send);
      return;
    }
    // Swapping a convolver buffer clicks, so fade the send out, swap, fade back in.
    clearTimeout(this.reverbSwapTimer);
    this.set(this.reverbReturn.gain, 0, 0.02);
    this.set(this.reverbSend.gain, send);
    const swap = () => {
      this.reverb.buffer = getImpulse(this.ctx, seconds);
      this.reverbSeconds = seconds;
      this.set(this.reverbReturn.gain, 1, 0.08);
    };
    if (this.ctx instanceof OfflineAudioContext) swap();
    else this.reverbSwapTimer = setTimeout(swap, 90);
  }

  /** Short beep straight to the output stage to check the speaker. */
  beep() {
    const t = this.ctx.currentTime;
    const osc = new OscillatorNode(this.ctx, { frequency: 660 });
    const env = new GainNode(this.ctx, { gain: 0 });
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.4, t + 0.02);
    env.gain.setValueAtTime(0.4, t + 0.3);
    env.gain.linearRampToValueAtTime(0, t + 0.4);
    osc.connect(env).connect(this.level);
    osc.start(t);
    osc.stop(t + 0.45);
  }
}

/** Transparent below ~-3 dBFS, rounds off anything the limiter lets through. */
function softClipCurve() {
  const n = 4096;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    c[i] = a < 0.7 ? x : Math.sign(x) * (0.7 + 0.29 * Math.tanh((a - 0.7) / 0.29));
  }
  return c;
}

function tanhCurve() {
  const n = 2048;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = Math.tanh(((i / (n - 1)) * 2 - 1) * 3);
  return c;
}
