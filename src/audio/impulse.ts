/** Generated audio buffers (no files to download). */

const impulseCache = new Map<number, AudioBuffer>();

/** Stereo reverb impulse: decaying noise that gets darker over time. */
export function getImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const cached = impulseCache.get(seconds);
  if (cached) return cached;
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // one-pole lowpass whose cutoff falls over time → natural darkening tail
      const k = 0.9 - 0.75 * t;
      lp = lp * (1 - k) + (Math.random() * 2 - 1) * k;
      const predelay = i < rate * 0.012 ? 0 : 1;
      d[i] = lp * Math.pow(1 - t, 2.2) * predelay;
    }
  }
  impulseCache.set(seconds, buf);
  return buf;
}

export function makeNoiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** Sparse pops + faint hiss, like an old radio. */
export function makeCrackleBuffer(ctx: BaseAudioContext): AudioBuffer {
  const len = ctx.sampleRate * 3;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    let s = (Math.random() * 2 - 1) * 0.08;
    if (Math.random() < 0.0008) s += (Math.random() * 2 - 1) * 1.0;
    d[i] = s;
  }
  return buf;
}
