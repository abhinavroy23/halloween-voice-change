import workletUrl from './worklets/processors.js?url';
import { VoiceGraph } from './graph';
import { applyTweaks, DEFAULT_TWEAKS, Tweaks, Voice, VOICES } from './voices';

export type Status = 'idle' | 'starting' | 'running' | 'error';

/** 'direct' = Web Audio → speaker; 'element' = Web Audio → <audio> element → speaker. */
export type OutputMode = 'direct' | 'element';
/** iOS audio session: 'auto' lets Safari decide, 'play-and-record' forces it. */
export type SessionMode = 'auto' | 'play-and-record';

export interface MicDevice {
  id: string;
  label: string;
}

export interface EngineState {
  status: Status;
  error: string | null;
  devices: MicDevice[];
  deviceId: string; // '' = system default
  activeMicLabel: string;
  voiceId: string;
  tweaks: Record<string, Tweaks>;
  volume: number; // 0–3
  outputMode: OutputMode;
  sessionMode: SessionMode;
  inputGain: number; // 0–4
  gateDb: number; // -80 … -20
  clarity: number; // 0 = spooky … 1 = clearest
  echoGuard: number; // 0 … 1
  echoCancel: boolean; // iPhone's built-in call echo cancellation
  muted: boolean;
  latencyMs: number | null;
  wakeLock: boolean;
}

const STORAGE_KEY = 'ghost-voice-settings-v1';
type Persisted = Pick<
  EngineState,
  | 'deviceId'
  | 'voiceId'
  | 'tweaks'
  | 'volume'
  | 'inputGain'
  | 'gateDb'
  | 'outputMode'
  | 'sessionMode'
  | 'echoGuard'
  | 'echoCancel'
  | 'clarity'
>;

const SETTINGS_VERSION = 2;

function loadSettings(): Partial<Persisted> {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if ((s.version ?? 1) < 2) {
      // v2 clarity rework: new echo-guard scale/default, presets changed so drop old tweaks
      delete s.echoGuard;
      delete s.tweaks;
    }
    return s;
  } catch {
    return {};
  }
}

// Safari 17+: tells iOS we record and play at the same time.
type NavigatorWithAudioSession = Navigator & { audioSession?: { type: string } };

/** Single shared audio engine. React only reads its state and calls its methods. */
export class AudioEngine {
  private state: EngineState;
  private listeners = new Set<() => void>();
  private ctx: AudioContext | null = null;
  private graph: VoiceGraph | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private chaosTimer: number | undefined;
  private wakeLock: WakeLockSentinel | null = null;
  private levelBuf = new Float32Array(1024);
  private outEl: HTMLAudioElement | null = null;
  private streamDest: MediaStreamAudioDestinationNode | null = null;

  constructor() {
    const s = loadSettings();
    this.state = {
      status: 'idle',
      error: null,
      devices: [],
      deviceId: s.deviceId ?? '',
      activeMicLabel: '',
      voiceId: VOICES.some((v) => v.id === s.voiceId) ? s.voiceId! : 'ghost',
      tweaks: s.tweaks ?? {},
      volume: s.volume ?? 1.5,
      outputMode: s.outputMode ?? 'direct',
      sessionMode: s.sessionMode ?? 'auto',
      inputGain: s.inputGain ?? 1,
      gateDb: s.gateDb ?? -50,
      echoGuard: s.echoGuard ?? 0.9,
      clarity: s.clarity ?? 0.5,
      echoCancel: s.echoCancel ?? false,
      muted: false,
      latencyMs: null,
      wakeLock: false,
    };
    navigator.mediaDevices?.addEventListener?.('devicechange', () => void this.refreshDevices());
    document.addEventListener('visibilitychange', () => void this.onVisibility());
  }

  // ---- store plumbing (for useSyncExternalStore) -----------------------------------
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = () => this.state;

  private update(patch: Partial<EngineState>) {
    this.state = { ...this.state, ...patch };
    const { deviceId, voiceId, tweaks, volume, inputGain, gateDb, outputMode, sessionMode, echoGuard, echoCancel, clarity } =
      this.state;
    const persisted: Persisted = {
      deviceId,
      voiceId,
      tweaks,
      volume,
      inputGain,
      gateDb,
      outputMode,
      sessionMode,
      echoGuard,
      echoCancel,
      clarity,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: SETTINGS_VERSION, ...persisted }));
    } catch {
      /* private mode etc. */
    }
    this.listeners.forEach((l) => l());
  }

  // ---- lifecycle -----------------------------------------------------------------
  /** Must be called from a tap (browsers only allow audio after a user gesture). */
  async start() {
    if (this.state.status === 'running' || this.state.status === 'starting') return;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.update({ status: 'error', error: 'Microphone access needs HTTPS and a modern browser (Safari / Chrome).' });
      return;
    }
    this.update({ status: 'starting', error: null });
    try {
      this.applySessionMode();

      const ctx = new AudioContext({ latencyHint: 'interactive' });
      this.ctx = ctx;
      // Resume immediately inside the tap so iOS unlocks audio output.
      const resumed = ctx.resume();
      await ctx.audioWorklet.addModule(workletUrl);
      await resumed;

      this.graph = new VoiceGraph(ctx);
      this.routeOutput();
      this.applyAll();
      ctx.addEventListener('statechange', () => {
        // iOS can "interrupt" the context (calls, Siri, lock). Try to come back.
        if (this.ctx && this.ctx.state !== 'running' && this.state.status === 'running') {
          void this.ctx.resume().catch(() => {});
        }
      });

      await this.openMic(this.state.deviceId);
      this.update({ status: 'running', latencyMs: this.measureLatency() });
      void this.requestWakeLock();
    } catch (e) {
      console.error(e);
      await this.stop();
      this.update({ status: 'error', error: describeError(e) });
    }
  }

  async stop() {
    window.clearInterval(this.chaosTimer);
    this.chaosTimer = undefined;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.source?.disconnect();
    this.source = null;
    this.graph = null;
    this.outEl?.pause();
    if (this.outEl) this.outEl.srcObject = null;
    this.outEl = null;
    this.streamDest = null;
    if (this.ctx) await this.ctx.close().catch(() => {});
    this.ctx = null;
    await this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
    const nav = navigator as NavigatorWithAudioSession;
    if (nav.audioSession) nav.audioSession.type = 'auto';
    this.update({ status: 'idle', latencyMs: null, wakeLock: false, activeMicLabel: '' });
  }

  // ---- microphone ------------------------------------------------------------------
  private async openMic(deviceId: string) {
    const base: MediaTrackConstraints = {
      // Phone-call processing adds delay and mangles effects, so it's off unless the
      // user turns on echo cancellation to fight speaker → mic echo.
      echoCancellation: this.state.echoCancel,
      noiseSuppression: this.state.echoCancel,
      autoGainControl: false,
      channelCount: 1,
    };
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { ...base, deviceId: { exact: deviceId } } : base,
      });
    } catch (e) {
      // Saved device missing (e.g. DJI unplugged): fall back to the default mic.
      if (!deviceId || !(e instanceof DOMException) || !['OverconstrainedError', 'NotFoundError'].includes(e.name)) throw e;
      stream = await navigator.mediaDevices.getUserMedia({ audio: base });
      deviceId = '';
    }

    const old = this.stream;
    this.source?.disconnect();
    this.stream = stream;
    this.source = this.ctx!.createMediaStreamSource(stream);
    this.source.connect(this.graph!.input);
    old?.getTracks().forEach((t) => t.stop());

    const track = stream.getAudioTracks()[0];
    track.addEventListener('ended', () => {
      // Mic unplugged mid-use → switch back to the built-in mic.
      if (this.stream === stream && this.state.status === 'running') void this.selectDevice('');
    });
    this.update({ deviceId, activeMicLabel: track.label || 'Microphone' });
    await this.refreshDevices();
  }

  async selectDevice(deviceId: string) {
    this.update({ deviceId });
    if (this.state.status !== 'running') return;
    try {
      await this.openMic(deviceId);
    } catch (e) {
      this.update({ error: describeError(e) });
    }
  }

  async refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices();
    const devices = all
      .filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
      .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
    this.update({ devices });
  }

  // ---- voices & controls -------------------------------------------------------------
  get voice(): Voice {
    return VOICES.find((v) => v.id === this.state.voiceId) ?? VOICES[0];
  }

  tweaksFor(id: string): Tweaks {
    return this.state.tweaks[id] ?? DEFAULT_TWEAKS;
  }

  selectVoice(voiceId: string) {
    this.update({ voiceId });
    this.applyVoice();
  }

  setTweak<K extends keyof Tweaks>(key: K, value: Tweaks[K]) {
    const id = this.state.voiceId;
    this.update({ tweaks: { ...this.state.tweaks, [id]: { ...this.tweaksFor(id), [key]: value } } });
    this.applyVoice();
  }

  resetTweaks() {
    const tweaks = { ...this.state.tweaks };
    delete tweaks[this.state.voiceId];
    this.update({ tweaks });
    this.applyVoice();
  }

  setVolume(volume: number) {
    this.update({ volume });
    this.graph?.setMaster(this.state.muted ? 0 : volume);
  }

  toggleMute() {
    this.update({ muted: !this.state.muted });
    this.graph?.setMaster(this.state.muted ? 0 : this.state.volume);
  }

  setClarity(clarity: number) {
    this.update({ clarity });
    this.applyVoice();
  }

  setEchoGuard(echoGuard: number) {
    this.update({ echoGuard });
    this.graph?.setEchoGuard(echoGuard);
  }

  /** Re-opens the mic with the iPhone's echo cancellation on/off. */
  async setEchoCancel(echoCancel: boolean) {
    this.update({ echoCancel });
    if (this.state.status !== 'running') return;
    try {
      await this.openMic(this.state.deviceId);
    } catch (e) {
      this.update({ error: describeError(e) });
    }
  }

  setInputGain(inputGain: number) {
    this.update({ inputGain });
    this.graph?.setInputGain(inputGain);
  }

  setGate(gateDb: number) {
    this.update({ gateDb });
    this.graph?.setGateThreshold(gateDb);
  }

  /** Call from a tap: the <audio> element needs a user gesture to start playing. */
  setOutputMode(outputMode: OutputMode) {
    this.update({ outputMode });
    this.routeOutput();
  }

  /** Changing the iOS session type only takes effect on a fresh start, so restart if live. */
  async setSessionMode(sessionMode: SessionMode) {
    this.update({ sessionMode });
    if (this.state.status === 'running') {
      await this.stop();
      await this.start();
    }
  }

  private applySessionMode() {
    const nav = navigator as NavigatorWithAudioSession;
    if (!nav.audioSession) return;
    try {
      nav.audioSession.type = this.state.sessionMode;
    } catch {
      /* unsupported value */
    }
  }

  private routeOutput() {
    const ctx = this.ctx;
    const graph = this.graph;
    if (!ctx || !graph) return;
    graph.output.disconnect();
    if (this.state.outputMode === 'element') {
      if (!this.streamDest) this.streamDest = ctx.createMediaStreamDestination();
      graph.output.connect(this.streamDest);
      if (!this.outEl) {
        this.outEl = new Audio();
        this.outEl.setAttribute('playsinline', '');
        this.outEl.autoplay = true;
      }
      this.outEl.srcObject = this.streamDest.stream;
      this.outEl.volume = 1;
      void this.outEl.play().catch((e) => {
        console.warn('audio element play failed, falling back to direct', e);
        this.update({ outputMode: 'direct' });
        this.routeOutput();
      });
    } else {
      this.outEl?.pause();
      graph.output.connect(ctx.destination);
    }
  }

  testSpeaker() {
    this.graph?.beep();
  }

  /** Current mic level in dBFS (before the gate) – for the level meter. */
  getLevelDb(): number {
    const a = this.graph?.analyser;
    if (!a) return -100;
    a.getFloatTimeDomainData(this.levelBuf);
    let peak = 0;
    for (let i = 0; i < this.levelBuf.length; i++) peak = Math.max(peak, Math.abs(this.levelBuf[i]));
    return peak > 0 ? 20 * Math.log10(peak) : -100;
  }

  private applyAll() {
    if (!this.graph) return;
    this.graph.setInputGain(this.state.inputGain);
    this.graph.setGateThreshold(this.state.gateDb);
    this.graph.setEchoGuard(this.state.echoGuard);
    this.graph.setMaster(this.state.muted ? 0 : this.state.volume);
    this.applyVoice();
  }

  private applyVoice() {
    const graph = this.graph;
    if (!graph) return;
    const params = applyTweaks(this.voice.params, this.tweaksFor(this.state.voiceId));
    graph.apply(params, this.state.clarity);

    window.clearInterval(this.chaosTimer);
    this.chaosTimer = undefined;
    if (params.chaos) {
      // stay within ±5 st of the voice's pitch so words remain understandable
      const jumps = [-5, -3, -1, 0, 2, 4];
      this.chaosTimer = window.setInterval(() => {
        const s = jumps[Math.floor(Math.random() * jumps.length)] + params.pitch;
        graph.setPitch(s, Math.random() < 0.5 ? 0.01 : 0.15);
      }, 450);
    }
  }

  // ---- misc ------------------------------------------------------------------------
  private measureLatency(): number | null {
    if (!this.ctx) return null;
    const out = (this.ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0;
    // + ~27 ms PSOLA pitch shifter + input buffer estimate
    return Math.round((this.ctx.baseLatency + out) * 1000 + 27 + 10);
  }

  private async requestWakeLock() {
    try {
      if (!('wakeLock' in navigator)) return;
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.update({ wakeLock: true });
      this.wakeLock.addEventListener('release', () => this.update({ wakeLock: false }));
    } catch {
      this.update({ wakeLock: false });
    }
  }

  private async onVisibility() {
    if (document.visibilityState !== 'visible' || this.state.status !== 'running') return;
    if (this.ctx?.state !== 'running') await this.ctx?.resume().catch(() => {});
    if (!this.wakeLock || this.wakeLock.released) void this.requestWakeLock();
  }
}

function describeError(e: unknown): string {
  if (e instanceof DOMException) {
    if (e.name === 'NotAllowedError')
      return 'Microphone permission was denied. On iPhone: Settings → Safari → Microphone → Allow, then reload.';
    if (e.name === 'NotFoundError') return 'No microphone found.';
    if (e.name === 'NotReadableError') return 'The microphone is busy in another app. Close it and try again.';
  }
  return e instanceof Error ? e.message : String(e);
}

export const engine = new AudioEngine();
