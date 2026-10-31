import { VoiceParams } from './voices';
import { getImpulse, makeCrackleBuffer, makeNoiseBuffer } from './impulse';

/**
 * One persistent effect chain. Voices only change parameter values on it (with short
 * ramps), so switching voices never rebuilds nodes and never pops.
 *
 *  input → gate ┬─ dry ──────────────┐
 *               ├─ pitch A ──────────┤
 *               ├─ pitch B ──────────┼→ ring mod → distortion → tone EQ → comb → tremolo ┬→ dry ───┐
 *               └─ whisper vocoder ──┘                                                   ├→ echo ──┼→ level → limiter → master → speaker
 *                                                                                        └→ reverb ┘
 */
export class VoiceGraph {
  readonly input: GainNode;
  readonly analyser: AnalyserNode;
  readonly master: GainNode;

  private ctx: AudioContext;
  private gate: AudioWorkletNode;
  private dry: GainNode;
  private pitchA: AudioWorkletNode;
  private pitchB: AudioWorkletNode;
  private gainA: GainNode;
  private gainB: GainNode;
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
  private lp: BiquadFilterNode;
  private shelf: BiquadFilterNode;
  private peak: BiquadFilterNode;
  private combDry: GainNode;
  private combDelay: DelayNode;
  private combFb: GainNode;
  private combWet: GainNode;
  private trem: GainNode;
  private tremOsc: OscillatorNode;
  private tremDepth: GainNode;
  private crackleGain: GainNode;
  private fxDry: GainNode;
  private echoDelay: DelayNode;
  private echoFb: GainNode;
  private echoWet: GainNode;
  private reverb: ConvolverNode;
  private reverbWet: GainNode;
  private level: GainNode;
  private reverbSeconds = 0;
  private reverbSwapTimer: number | undefined;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    const g = (value = 1) => new GainNode(ctx, { gain: value });

    // --- input + gate --------------------------------------------------------------
    this.input = g(1);
    const inHp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 70, Q: 0.7 });
    this.analyser = new AnalyserNode(ctx, { fftSize: 1024, smoothingTimeConstant: 0 });
    this.gate = new AudioWorkletNode(ctx, 'noise-gate', { outputChannelCount: [1] });
    this.input.connect(inHp);
    inHp.connect(this.analyser);
    inHp.connect(this.gate);

    const voiceSum = g(1);

    // --- voice sources -----------------------------------------------------------
    this.dry = g(0);
    this.gate.connect(this.dry).connect(voiceSum);

    this.pitchA = new AudioWorkletNode(ctx, 'pitch-shifter', { outputChannelCount: [1] });
    this.pitchB = new AudioWorkletNode(ctx, 'pitch-shifter', { outputChannelCount: [1] });
    this.gainA = g(0);
    this.gainB = g(0);
    this.gate.connect(this.pitchA).connect(this.gainA).connect(voiceSum);
    this.gate.connect(this.pitchB).connect(this.gainB).connect(voiceSum);

    this.vibOsc = new OscillatorNode(ctx, { frequency: 5 });
    this.vibDepth = g(0);
    this.vibOsc.connect(this.vibDepth);
    this.vibDepth.connect(this.pitchA.parameters.get('semitones')!);
    this.vibDepth.connect(this.pitchB.parameters.get('semitones')!);
    this.vibOsc.start();

    this.whisperOut = g(0);
    this.buildVocoder(this.gate, this.whisperOut);
    this.whisperOut.connect(voiceSum);

    // --- ring modulator -----------------------------------------------------------
    const ringOut = g(1);
    this.ringDry = g(1);
    const ringWet = g(0); // gain driven by the oscillator → x(t)·sin(ωt)
    this.ringOsc = new OscillatorNode(ctx, { frequency: 50 });
    this.ringDepth = g(0);
    this.ringOsc.connect(this.ringDepth).connect(ringWet.gain);
    this.ringOsc.start();
    voiceSum.connect(this.ringDry).connect(ringOut);
    voiceSum.connect(ringWet).connect(ringOut);

    // --- distortion ---------------------------------------------------------------
    const distOut = g(1);
    this.distDry = g(1);
    this.drivePre = g(1);
    const shaper = new WaveShaperNode(ctx, { curve: tanhCurve(), oversample: '2x' });
    this.distWet = g(0);
    ringOut.connect(this.distDry).connect(distOut);
    ringOut.connect(this.drivePre).connect(shaper).connect(this.distWet).connect(distOut);

    // --- tone ---------------------------------------------------------------------
    this.hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 90, Q: 0.7 });
    this.lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 12000, Q: 0.7 });
    this.shelf = new BiquadFilterNode(ctx, { type: 'lowshelf', frequency: 150, gain: 0 });
    this.peak = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 1500, Q: 1.2, gain: 0 });
    distOut.connect(this.hp).connect(this.lp).connect(this.shelf).connect(this.peak);

    // --- comb filter --------------------------------------------------------------
    const combOut = g(1);
    this.combDry = g(1);
    this.combDelay = new DelayNode(ctx, { maxDelayTime: 0.05, delayTime: 0.008 });
    this.combFb = g(0);
    this.combWet = g(0);
    this.peak.connect(this.combDry).connect(combOut);
    this.peak.connect(this.combDelay);
    this.combDelay.connect(this.combFb).connect(this.combDelay);
    this.combDelay.connect(this.combWet).connect(combOut);

    // --- tremolo ------------------------------------------------------------------
    this.trem = g(1);
    this.tremOsc = new OscillatorNode(ctx, { frequency: 4 });
    this.tremDepth = g(0);
    this.tremOsc.connect(this.tremDepth).connect(this.trem.gain);
    this.tremOsc.start();
    combOut.connect(this.trem);

    const fxIn = this.trem;

    // --- radio crackle ------------------------------------------------------------
    const crackle = new AudioBufferSourceNode(ctx, { buffer: makeCrackleBuffer(ctx), loop: true });
    this.crackleGain = g(0);
    crackle.connect(this.crackleGain);
    crackle.start();

    // --- echo + reverb ------------------------------------------------------------
    const out = g(1);
    this.fxDry = g(1);
    fxIn.connect(this.fxDry).connect(out);
    this.crackleGain.connect(out);

    this.echoDelay = new DelayNode(ctx, { maxDelayTime: 2, delayTime: 0.3 });
    const echoTone = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 3500 });
    this.echoFb = g(0);
    this.echoWet = g(0);
    fxIn.connect(this.echoDelay);
    this.echoDelay.connect(echoTone).connect(this.echoFb).connect(this.echoDelay);
    this.echoDelay.connect(this.echoWet).connect(out);

    this.reverb = new ConvolverNode(ctx, { disableNormalization: false });
    this.reverbWet = g(0);
    fxIn.connect(this.reverb).connect(this.reverbWet).connect(out);
    this.echoWet.connect(this.reverb); // echoes also get reverb

    // --- output -------------------------------------------------------------------
    this.level = g(1);
    const limiter = new DynamicsCompressorNode(ctx, {
      threshold: -8,
      knee: 0,
      ratio: 20,
      attack: 0.002,
      release: 0.12,
    });
    this.master = g(1);
    out.connect(this.level).connect(limiter).connect(this.master).connect(ctx.destination);
  }

  /** Channel vocoder: the voice's band envelopes shape bands of white noise → whisper. */
  private buildVocoder(src: AudioNode, dest: AudioNode) {
    const ctx = this.ctx;
    const noise = new AudioBufferSourceNode(ctx, { buffer: makeNoiseBuffer(ctx), loop: true });
    noise.start();
    const rect = new Float32Array(1025);
    for (let i = 0; i < rect.length; i++) rect[i] = Math.abs((i / 512) - 1);
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

  setInputGain(gain: number) {
    this.set(this.input.gain, gain);
  }

  setMaster(gain: number) {
    this.set(this.master.gain, gain, 0.02);
  }

  /** Used by poltergeist mode to jump pitch around. */
  setPitchA(semitones: number, t = 0.03) {
    this.set(this.pitchA.parameters.get('semitones')!, semitones, t);
  }

  apply(p: VoiceParams) {
    this.set(this.dry.gain, p.dry);
    this.setPitchA(p.pitchA);
    this.set(this.pitchB.parameters.get('semitones')!, p.pitchB);
    this.set(this.gainA.gain, p.pitchAGain);
    this.set(this.gainB.gain, p.pitchBGain);
    this.set(this.vibOsc.frequency, p.vibratoRate);
    this.set(this.vibDepth.gain, p.vibratoDepth);
    this.set(this.whisperOut.gain, p.whisper);

    this.set(this.ringOsc.frequency, p.ringFreq);
    this.set(this.ringDry.gain, 1 - p.ringMix);
    this.set(this.ringDepth.gain, p.ringMix * 1.6);

    this.set(this.drivePre.gain, 1 + p.drive * 25);
    this.set(this.distDry.gain, 1 - p.distMix);
    this.set(this.distWet.gain, p.distMix * (0.5 / (0.3 + p.drive)) * 0.6);

    this.set(this.hp.frequency, p.highpass);
    this.set(this.lp.frequency, p.lowpass);
    this.set(this.shelf.gain, p.bassBoost);
    this.set(this.peak.frequency, p.peakFreq);
    this.set(this.peak.gain, p.peakGain);

    this.set(this.combDry.gain, 1 - p.combMix * 0.5);
    this.set(this.combDelay.delayTime, p.combMs / 1000);
    this.set(this.combFb.gain, p.combMix > 0 ? p.combFeedback : 0);
    this.set(this.combWet.gain, p.combMix);

    this.set(this.tremOsc.frequency, p.tremoloRate);
    this.set(this.trem.gain, 1 - p.tremoloDepth / 2);
    this.set(this.tremDepth.gain, p.tremoloDepth / 2);

    this.set(this.crackleGain.gain, p.crackle);

    this.set(this.fxDry.gain, 1 - Math.min(0.7, p.reverbMix * 0.6));
    this.set(this.echoDelay.delayTime, p.echoTime, 0.1);
    this.set(this.echoFb.gain, Math.min(0.85, p.echoFeedback));
    this.set(this.echoWet.gain, p.echoMix);

    this.set(this.level.gain, p.level);
    this.setReverb(p.reverbMix, p.reverbSeconds);
  }

  private setReverb(mix: number, seconds: number) {
    const wet = mix * 1.4;
    if (seconds === this.reverbSeconds || mix === 0) {
      window.clearTimeout(this.reverbSwapTimer);
      this.set(this.reverbWet.gain, wet);
      return;
    }
    // Swapping a convolver buffer clicks, so fade the wet path out, swap, fade back in.
    window.clearTimeout(this.reverbSwapTimer);
    this.set(this.reverbWet.gain, 0, 0.02);
    this.reverbSwapTimer = window.setTimeout(() => {
      this.reverb.buffer = getImpulse(this.ctx, seconds);
      this.reverbSeconds = seconds;
      this.set(this.reverbWet.gain, wet, 0.08);
    }, 90);
  }

  /** Short beep straight to the limiter to check the speaker. */
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

function tanhCurve() {
  const n = 2048;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = Math.tanh(((i / (n - 1)) * 2 - 1) * 3);
  return c;
}
