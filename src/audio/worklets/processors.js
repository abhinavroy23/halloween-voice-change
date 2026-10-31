/* global sampleRate, registerProcessor, AudioWorkletProcessor */
// Plain JS on purpose: this file is loaded into the AudioWorklet scope as-is.

const MIN_F0 = 75; // Hz – lowest voice pitch we track
const MAX_F0 = 500; // Hz – highest

/**
 * Real-time YIN pitch tracker on a 4× decimated copy of the signal (cheap enough for phones).
 * Exposes `period` (in full-rate samples) and `voiced`.
 */
class PitchTracker {
  constructor(sr) {
    this.dec = sr > 30000 ? 4 : 2;
    const dsr = sr / this.dec;
    this.minLag = Math.max(2, Math.floor(dsr / MAX_F0));
    this.maxLag = Math.ceil(dsr / MIN_F0);
    this.W = this.maxLag; // integration window
    this.size = 2048;
    this.mask = this.size - 1;
    this.buf = new Float32Array(this.size);
    this.seg = new Float32Array(this.W + this.maxLag);
    this.d = new Float32Array(this.maxLag + 1);
    this.bw = 0;
    this.acc = 0;
    this.accN = 0;
    this.cnt = 0;
    this.hop = 32; // decimated samples between detections (~2.7 ms)
    this.period = Math.round(sr / 120);
    this.voiced = false;
    this.unvoicedRun = 0;
  }

  push(x) {
    this.acc += x;
    if (++this.accN < this.dec) return;
    this.buf[this.bw++ & this.mask] = this.acc / this.dec;
    this.acc = 0;
    this.accN = 0;
    if (++this.cnt >= this.hop) {
      this.cnt = 0;
      this.detect();
    }
  }

  detect() {
    const { W, maxLag, minLag, seg, d, mask, buf } = this;
    const N = W + maxLag;
    const start = this.bw - N;
    let energy = 0;
    for (let j = 0; j < N; j++) {
      const v = buf[(start + j) & mask];
      seg[j] = v;
      energy += v * v;
    }
    if (energy / N < 1e-6) return this.setUnvoiced(); // silence (≈ -60 dBFS)
    // YIN difference + cumulative-mean normalisation
    let running = 0;
    let best = -1;
    let bestVal = 1e9;
    let found = -1;
    for (let tau = 1; tau <= maxLag; tau++) {
      let s = 0;
      for (let j = 0; j < W; j++) {
        const diff = seg[j] - seg[j + tau];
        s += diff * diff;
      }
      running += s;
      const v = running > 0 ? (s * tau) / running : 1;
      d[tau] = v;
      if (tau >= minLag) {
        if (v < bestVal) {
          bestVal = v;
          best = tau;
        }
        if (found < 0 && v < 0.15) found = tau;
        if (found > 0 && tau > found && v > d[tau - 1]) break; // passed the dip
      }
    }
    let tau = best;
    if (found > 0) {
      tau = found;
      while (tau + 1 <= maxLag && d[tau + 1] < d[tau]) tau++;
    }
    if (tau < 0 || d[tau] > 0.3) return this.setUnvoiced();
    // parabolic interpolation
    let t = tau;
    if (tau > 1 && tau < maxLag) {
      const a = d[tau - 1];
      const b = d[tau];
      const c = d[tau + 1];
      const den = a - 2 * b + c;
      if (den > 0) t = tau + (0.5 * (a - c)) / den;
    }
    const p = t * this.dec;
    if (this.voiced && Math.abs(p / this.period - 1) < 0.2) this.period = this.period * 0.5 + p * 0.5;
    else this.period = p;
    this.voiced = true;
    this.unvoicedRun = 0;
  }

  setUnvoiced() {
    // a couple of misses in a row before we drop voicing (avoids flicker)
    if (++this.unvoicedRun > 2) this.voiced = false;
  }
}

/**
 * TD-PSOLA pitch shifter – changes pitch while keeping the vowel "shape" (formants),
 * so shifted speech stays clear. Grains two pitch periods long are cut at pitch marks
 * and re-spaced at period/ratio. Unvoiced sounds (s, t, k…) pass through unshifted.
 * Latency ≈ 2 × longest period ≈ 27 ms.
 */
class Psola extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'semitones', defaultValue: 0, minValue: -24, maxValue: 24, automationRate: 'a-rate' },
      // Formant scale: <1 = bigger/darker vocal tract (e.g. 0.88 = 12% lower resonances), >1 = smaller.
      { name: 'formant', defaultValue: 1, minValue: 0.5, maxValue: 2, automationRate: 'k-rate' },
      // Growl: alternate loud/soft pitch periods (+ a little random shimmer/jitter) →
      // period-doubling roughness like a real growl/vocal fry, at the same formants (no mud).
      { name: 'roughness', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.size = 16384;
    this.mask = this.size - 1;
    this.inBuf = new Float32Array(this.size);
    this.outBuf = new Float32Array(this.size);
    this.tracker = new PitchTracker(sampleRate);
    this.maxT = Math.ceil(sampleRate / MIN_F0);
    this.minT = Math.floor(sampleRate / MAX_F0);
    this.Tu = Math.round(sampleRate * 0.005); // grain half-size for unvoiced sound
    this.L = 2 * this.maxT + 8; // latency
    this.w = 0; // input write time
    this.nextS = 0; // next synthesis grain centre (output time)
    this.lastMark = 0; // last analysis pitch mark (input time)
    this.grainCount = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0] && inputs[0][0];
    const output = outputs[0];
    const out = output[0];
    if (!out) return true;
    if (!(inputs[0] && inputs[0].length)) {
      // nothing connected (voice doesn't use this) → skip the work
      out.fill(0);
      for (let c = 1; c < output.length; c++) output[c].fill(0);
      return true;
    }
    const semis = parameters.semitones;
    const fr = parameters.formant[0];
    const rough = parameters.roughness[0];
    const { inBuf, outBuf, mask, tracker } = this;
    for (let n = 0; n < out.length; n++) {
      const x = input ? input[n] : 0;
      inBuf[this.w & mask] = x;
      tracker.push(x);
      this.w++;
      const o = this.w - this.L;
      const voiced = tracker.voiced;
      const T = voiced ? Math.min(this.maxT, Math.max(this.minT, Math.round(tracker.period))) : this.Tu;

      while (this.nextS - T <= o) {
        const s = Math.round(this.nextS);
        const ratio = Math.pow(2, (semis.length > 1 ? semis[n] : semis[0]) / 12);
        // keep the analysis mark near the synthesis time
        if (this.lastMark > s || this.lastMark < s - 4 * T) this.lastMark = Math.min(s, this.w - T);
        while (this.lastMark + T <= s) {
          let cand = this.lastMark + T;
          if (voiced) {
            // snap to the local waveform peak so grains line up period-to-period
            const r = Math.max(1, Math.floor(T * 0.1));
            let bestJ = cand;
            let bestV = -1e9;
            for (let j = cand - r; j <= cand + r && j <= this.w - T; j++) {
              const v = inBuf[j & mask];
              if (v > bestV) {
                bestV = v;
                bestJ = j;
              }
            }
            cand = bestJ;
          }
          this.lastMark = cand;
        }
        let mark = this.lastMark;
        const reach = Math.ceil(T * fr) + 3;
        if (mark + reach > this.w) mark = this.w - reach;
        let g = voiced ? Math.min(2, Math.max(0.5, 1 / ratio)) : 1;
        if (voiced && rough > 0) {
          const alt = this.grainCount++ & 1 ? 1 - 0.8 * rough : 1;
          g *= alt * (1 + (Math.random() - 0.5) * 0.5 * rough);
        }
        const inv = Math.PI / T;
        if (fr === 1) {
          for (let k = -T; k < T; k++) {
            const pos = s + k;
            if (pos < o) continue;
            const win = 0.5 + 0.5 * Math.cos(k * inv);
            outBuf[pos & mask] += inBuf[(mark + k) & mask] * win * g;
          }
        } else {
          // Read the grain at a different speed: its spectral envelope (formants) scales by fr
          // while the grain spacing – and therefore the pitch – stays as set above.
          for (let k = -T; k < T; k++) {
            const pos = s + k;
            if (pos < o) continue;
            const win = 0.5 + 0.5 * Math.cos(k * inv);
            const xi = mark + k * fr;
            const i0 = Math.floor(xi);
            const f = xi - i0;
            // Catmull-Rom cubic interpolation (linear would dull the highs = muffled)
            const y0 = inBuf[(i0 - 1) & mask];
            const y1 = inBuf[i0 & mask];
            const y2 = inBuf[(i0 + 1) & mask];
            const y3 = inBuf[(i0 + 2) & mask];
            const v = y1 + 0.5 * f * (y2 - y0 + f * (2 * y0 - 5 * y1 + 4 * y2 - y3 + f * (3 * (y1 - y2) + y3 - y0)));
            outBuf[pos & mask] += v * win * g;
          }
        }
        const hop = voiced ? T / ratio : T;
        this.nextS += rough > 0 && voiced ? hop * (1 + (Math.random() - 0.5) * 0.06 * rough) : hop;
      }

      if (o >= 0) {
        out[n] = outBuf[o & mask];
        outBuf[o & mask] = 0;
      } else out[n] = 0;
    }
    for (let c = 1; c < output.length; c++) output[c].set(out);
    return true;
  }
}

/**
 * Granular pitch shifter (two crossfaded read heads on a delay line). Unlike PSOLA it also
 * shifts formants – bigger/darker for monster layers, smaller for a child layer.
 * The grain window is locked to a whole number of detected pitch periods to reduce warble.
 */
class PitchShifter extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'semitones', defaultValue: 0, minValue: -24, maxValue: 24, automationRate: 'a-rate' }];
  }

  constructor() {
    super();
    this.size = 8192;
    this.mask = this.size - 1;
    this.buf = new Float32Array(this.size);
    this.write = 0;
    this.tracker = new PitchTracker(sampleRate);
    this.targetW = Math.round(sampleRate * 0.035);
    this.win = this.targetW;
    this.winSmooth = 1 - Math.exp(-1 / (sampleRate * 0.03));
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
    if (!(inputs[0] && inputs[0].length)) {
      // nothing connected (voice doesn't use this) → skip the work
      out.fill(0);
      for (let c = 1; c < output.length; c++) output[c].fill(0);
      return true;
    }
    const semis = parameters.semitones;
    const tr = this.tracker;
    for (let n = 0; n < out.length; n++) {
      const x = input ? input[n] : 0;
      this.buf[this.write & this.mask] = x;
      tr.push(x);
      // A whole number of pitch periods (~35 ms) so each grain restart lands in phase.
      const target = tr.voiced
        ? tr.period * Math.max(2, Math.round(this.targetW / tr.period))
        : this.targetW;
      this.win += (target - this.win) * this.winSmooth;
      const W = this.win;
      const s = semis.length > 1 ? semis[n] : semis[0];
      const ratio = Math.pow(2, s / 12);
      this.phase += (1 - ratio) / W;
      this.phase -= Math.floor(this.phase);
      const p1 = this.phase;
      const p2 = (p1 + 0.5) % 1;
      const w1 = Math.sin(Math.PI * p1) ** 2;
      out[n] = this.read(p1 * W + 1) * w1 + this.read(p2 * W + 1) * (1 - w1);
      this.write++;
    }
    this.write &= 0x3fffffff;
    for (let c = 1; c < output.length; c++) output[c].set(out);
    return true;
  }
}

/**
 * Noise gate + echo guard.
 * Input 0: mic. Input 1: the app's own speaker output (side-chain).
 * - Below `threshold` → fully closed (silence between words).
 * - Above threshold but not clearly louder than the estimated speaker leak → turned down
 *   by ~30 dB (not muted, so soft word starts/ends survive).
 * - Otherwise open, with a 200 ms hold so word endings aren't clipped.
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
    this.attack = 1 - Math.exp(-1 / (sampleRate * 0.002));
    this.release = 1 - Math.exp(-1 / (sampleRate * 0.1));
    this.holdSamples = Math.round(sampleRate * 0.2);
    this.floor = 0.03; // ≈ -30 dB while the echo guard holds
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0] && inputs[0][0];
    const side = inputs[1] && inputs[1][0];
    const output = outputs[0];
    const out = output[0];
    if (!out) return true;
    const thr = Math.pow(10, parameters.threshold[0] / 20);
    const guard = parameters.guard[0];
    const k = guard > 0 ? Math.pow(10, (-30 + 33 * guard) / 20) : 0;
    for (let n = 0; n < out.length; n++) {
      const x = input ? input[n] : 0;
      const ax = Math.abs(x);
      this.env = ax > this.env ? ax : this.env * this.envCoef + ax * (1 - this.envCoef);
      const as = side ? Math.abs(side[n]) : 0;
      this.sideEnv = as > this.sideEnv ? as : this.sideEnv * this.sideRelease;
      const leak = this.sideEnv * k;
      const open = this.gain > 0.5;
      const need = Math.max(thr, open ? leak * 0.7 : leak);
      if (this.env > need) this.hold = this.holdSamples;
      else if (this.hold > 0) this.hold--;
      const target = this.hold > 0 ? 1 : this.env > thr ? this.floor : 0;
      this.gain += (target - this.gain) * (target > this.gain ? this.attack : this.release);
      out[n] = x * this.gain;
    }
    for (let c = 1; c < output.length; c++) output[c].set(out);
    return true;
  }
}

/**
 * Ducker: turns the reverb/echo returns (input 1, stereo) down while you're speaking
 * (input 0, the gated mic), then lets the ghostly tail swell back in the pauses.
 */
class Ducker extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'depth', defaultValue: 12, minValue: 0, maxValue: 40, automationRate: 'k-rate' }];
  }

  constructor() {
    super();
    this.env = 0;
    this.gain = 1;
    this.envAtt = 1 - Math.exp(-1 / (sampleRate * 0.005));
    this.envRel = 1 - Math.exp(-1 / (sampleRate * 0.15));
    this.duckAtt = 1 - Math.exp(-1 / (sampleRate * 0.02));
    this.duckRel = 1 - Math.exp(-1 / (sampleRate * 0.35));
    this.ref = 0.03; // ≈ -30 dBFS voice = full ducking
  }

  process(inputs, outputs, parameters) {
    const key = inputs[0] && inputs[0][0];
    const sig = inputs[1] || [];
    const output = outputs[0];
    const len = output[0] ? output[0].length : 128;
    const floor = Math.pow(10, -parameters.depth[0] / 20);
    for (let n = 0; n < len; n++) {
      const a = key ? Math.abs(key[n]) : 0;
      this.env += (a - this.env) * (a > this.env ? this.envAtt : this.envRel);
      const amt = Math.min(1, this.env / this.ref);
      const target = 1 - (1 - floor) * amt;
      this.gain += (target - this.gain) * (target < this.gain ? this.duckAtt : this.duckRel);
      for (let c = 0; c < output.length; c++) {
        const ch = sig[c] || sig[0];
        output[c][n] = ch ? ch[n] * this.gain : 0;
      }
    }
    return true;
  }
}

/**
 * Carrier for the Vocoder Demon: a dark, buzzy synth tone that follows your pitch
 * (root + sub-octave + optional fifth). Unvoiced sounds (s, t, k…) switch to noise so
 * consonants stay crisp after vocoding.
 */
class VocoderCarrier extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'semitones', defaultValue: -12, minValue: -36, maxValue: 24, automationRate: 'k-rate' },
      { name: 'chord', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.tracker = new PitchTracker(sampleRate);
    this.f0 = 110;
    this.p1 = 0;
    this.p2 = 0;
    this.p3 = 0;
    this.v = 0;
    this.glide = 1 - Math.exp(-1 / (sampleRate * 0.004));
    this.vSmooth = 1 - Math.exp(-1 / (sampleRate * 0.008));
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0] && inputs[0][0];
    const output = outputs[0];
    const out = output[0];
    if (!out) return true;
    if (!(inputs[0] && inputs[0].length)) {
      // nothing connected (voice doesn't use this) → skip the work
      out.fill(0);
      for (let c = 1; c < output.length; c++) output[c].fill(0);
      return true;
    }
    const semis = parameters.semitones[0];
    const chord = parameters.chord[0];
    const shift = Math.pow(2, semis / 12);
    const tr = this.tracker;
    const blep = (t, dt) => {
      if (t < dt) {
        t /= dt;
        return t + t - t * t - 1;
      }
      if (t > 1 - dt) {
        t = (t - 1) / dt;
        return t * t + t + t + 1;
      }
      return 0;
    };
    for (let n = 0; n < out.length; n++) {
      tr.push(input ? input[n] : 0);
      if (tr.voiced) this.f0 += (sampleRate / tr.period - this.f0) * this.glide;
      this.v += ((tr.voiced ? 1 : 0) - this.v) * this.vSmooth;
      const root = Math.min(1000, Math.max(25, this.f0 * shift));
      const d1 = root / sampleRate;
      const d2 = d1 * 0.5;
      const d3 = d1 * 1.4983;
      this.p1 += d1;
      if (this.p1 >= 1) this.p1 -= 1;
      this.p2 += d2;
      if (this.p2 >= 1) this.p2 -= 1;
      this.p3 += d3;
      if (this.p3 >= 1) this.p3 -= 1;
      const saw =
        2 * this.p1 - 1 - blep(this.p1, d1) +
        0.6 * (2 * this.p2 - 1 - blep(this.p2, d2)) +
        chord * 0.5 * (2 * this.p3 - 1 - blep(this.p3, d3));
      const noise = Math.random() * 2 - 1;
      out[n] = this.v * (saw * 0.45 + noise * 0.08) + (1 - this.v) * noise * 0.7;
    }
    for (let c = 1; c < output.length; c++) output[c].set(out);
    return true;
  }
}

registerProcessor('psola', Psola);
registerProcessor('vocoder-carrier', VocoderCarrier);
registerProcessor('pitch-shifter', PitchShifter);
registerProcessor('noise-gate', NoiseGate);
registerProcessor('ducker', Ducker);
