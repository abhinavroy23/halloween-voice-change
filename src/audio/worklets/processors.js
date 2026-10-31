/* global sampleRate, registerProcessor, AudioWorkletProcessor */
// Plain JS on purpose: this file is loaded into the AudioWorklet scope as-is.

/**
 * Low-latency granular pitch shifter (two crossfaded read heads on a delay line).
 * Latency ≈ half the window (~20 ms). `semitones` is a-rate so an LFO can be
 * connected to it for vibrato.
 */
class PitchShifter extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'semitones', defaultValue: 0, minValue: -24, maxValue: 24, automationRate: 'a-rate' }];
  }

  constructor() {
    super();
    this.size = 8192; // power of two ring buffer
    this.mask = this.size - 1;
    this.buf = new Float32Array(this.size);
    this.write = 0;
    this.win = Math.round(sampleRate * 0.04); // 40 ms grain window
    this.phase = 0;
  }

  read(delay) {
    const pos = this.write - delay;
    const i = Math.floor(pos);
    const f = pos - i;
    const a = this.buf[i & this.mask];
    const b = this.buf[(i + 1) & this.mask];
    return a + (b - a) * f;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0] && inputs[0][0];
    const output = outputs[0];
    const out = output[0];
    if (!out) return true;
    const semis = parameters.semitones;
    const W = this.win;
    for (let n = 0; n < out.length; n++) {
      this.buf[this.write & this.mask] = input ? input[n] : 0;
      const s = semis.length > 1 ? semis[n] : semis[0];
      const ratio = Math.pow(2, s / 12);
      this.phase += (1 - ratio) / W;
      this.phase -= Math.floor(this.phase); // wrap to [0,1)
      const p1 = this.phase;
      const p2 = (p1 + 0.5) % 1;
      // sin² windows offset by half a period sum to 1
      const w1 = Math.sin(Math.PI * p1) ** 2;
      const w2 = 1 - w1;
      out[n] = this.read(p1 * W + 1) * w1 + this.read(p2 * W + 1) * w2;
      this.write++;
    }
    this.write &= 0x3fffffff;
    for (let c = 1; c < output.length; c++) output[c].set(out);
    return true;
  }
}

/**
 * Noise gate with hold + smooth attack/release. Keeps the speaker silent between words.
 *
 * Echo guard: input 1 is the app's own speaker output (side-chain). Its envelope is held
 * for ~0.5 s (covers Bluetooth delay + room tail) and scaled by `guard` into an estimate
 * of how loud the speaker leaks into the mic. The gate only opens for sound clearly louder
 * than that leak – i.e. your voice up close – so the speaker's own echo can't loop back.
 */
class NoiseGate extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -50, minValue: -100, maxValue: 0, automationRate: 'k-rate' },
      // 0 = off; 0.01…1 → leak factor -30 dB … +3 dB (log-scaled)
      { name: 'guard', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.env = 0;
    this.gain = 0;
    this.hold = 0;
    this.sideEnv = 0;
    this.envCoef = Math.exp(-1 / (sampleRate * 0.01));
    this.sideRelease = Math.exp(-1 / (sampleRate * 0.5));
    this.attack = 1 - Math.exp(-1 / (sampleRate * 0.003));
    this.release = 1 - Math.exp(-1 / (sampleRate * 0.12));
    this.holdSamples = Math.round(sampleRate * 0.12);
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0] && inputs[0][0];
    const side = inputs[1] && inputs[1][0];
    const output = outputs[0];
    const out = output[0];
    if (!out) return true;
    const thr = Math.pow(10, parameters.threshold[0] / 20);
    const guard = parameters.guard[0];
    // guard 0 → off; 0.01…1 → leak factor -30 dB … +3 dB
    const k = guard > 0 ? Math.pow(10, (-30 + 33 * guard) / 20) : 0;
    for (let n = 0; n < out.length; n++) {
      const x = input ? input[n] : 0;
      const ax = Math.abs(x);
      this.env = ax > this.env ? ax : this.env * this.envCoef + ax * (1 - this.envCoef);
      const as = side ? Math.abs(side[n]) : 0;
      this.sideEnv = as > this.sideEnv ? as : this.sideEnv * this.sideRelease;
      const leak = this.sideEnv * k;
      // Opening needs to beat the full leak estimate; staying open 70% of it,
      // so quieter syllables mid-sentence don't chop but echo can't hold it open.
      const need = this.gain > 0.5 ? Math.max(thr, leak * 0.7) : Math.max(thr, leak);
      if (this.env > need) this.hold = this.holdSamples;
      else if (this.hold > 0) this.hold--;
      const target = this.hold > 0 ? 1 : 0;
      this.gain += (target - this.gain) * (target > this.gain ? this.attack : this.release);
      out[n] = x * this.gain;
    }
    for (let c = 1; c < output.length; c++) output[c].set(out);
    return true;
  }
}

registerProcessor('pitch-shifter', PitchShifter);
registerProcessor('noise-gate', NoiseGate);
