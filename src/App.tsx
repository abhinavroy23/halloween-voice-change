import { useEffect, useState } from 'react';
import { useAudioEngine } from './hooks/useAudioEngine';
import { VoiceGrid } from './components/VoiceGrid';
import { DevicePicker } from './components/DevicePicker';
import { LevelMeter } from './components/LevelMeter';
import { Slider } from './components/Slider';

const signed = (v: number) => (v > 0 ? `+${v}` : `${v}`);
const pctFmt = (v: number) => `${Math.round(v * 100)}%`;

export default function App() {
  const { state, engine } = useAudioEngine();
  const [showTune, setShowTune] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const running = state.status === 'running';
  const voice = engine.voice;
  const tweaks = engine.tweaksFor(state.voiceId);

  useEffect(() => {
    void engine.refreshDevices();
  }, [engine]);

  return (
    <div className="app">
      <header>
        <h1>
          <span aria-hidden>👻</span> Ghost Voice
        </h1>
        {running && (
          <span className="status">
            <span className="dot" /> LIVE{state.latencyMs ? ` · ~${state.latencyMs} ms` : ''}
          </span>
        )}
      </header>

      {!running ? (
        <section className="start">
          <button className="big start-btn" onClick={() => void engine.start()} disabled={state.status === 'starting'}>
            {state.status === 'starting' ? 'Summoning…' : 'Tap to Summon 🕯️'}
          </button>
          <p className="hint">
            Allow microphone access. Start with <b>Clean</b> at low volume to check the speaker, then pick a ghost.
          </p>
          {state.error && <p className="error">{state.error}</p>}
        </section>
      ) : (
        <section className="live">
          <div className="row">
            <button className={`big mute ${state.muted ? 'on' : ''}`} onClick={() => engine.toggleMute()}>
              {state.muted ? '🔇 Muted' : '🔊 On'}
            </button>
            <button className="big stop" onClick={() => void engine.stop()}>
              ⏹ Stop
            </button>
          </div>
          <LevelMeter gateDb={state.gateDb} active={running} />
          <Slider
            label="Volume"
            value={state.volume}
            min={0}
            max={3}
            step={0.05}
            format={pctFmt}
            onChange={(v) => engine.setVolume(v)}
          />
          <Slider
            label="Clarity  (spooky ↔ crystal clear)"
            value={state.clarity}
            min={0}
            max={1}
            step={0.05}
            format={pctFmt}
            onChange={(v) => engine.setClarity(v)}
          />
          {state.error && <p className="error">{state.error}</p>}
        </section>
      )}

      <h2>
        {voice.emoji} {voice.name}
      </h2>
      <VoiceGrid voiceId={state.voiceId} onSelect={(id) => engine.selectVoice(id)} />

      <details open={showTune} onToggle={(e) => setShowTune((e.target as HTMLDetailsElement).open)}>
        <summary>🧪 Voice Lab: tune “{voice.name}”</summary>
        <p className="hint">Changes are saved on this phone for this voice. Tune by ear on your real mic and speaker.</p>
        <Slider label="Pitch" value={tweaks.pitch} min={-12} max={12} step={1} format={(v) => `${signed(v)} st`} onChange={(v) => engine.setTweak('pitch', v)} />
        <Slider
          label="Size  (bigger ↔ smaller)"
          value={tweaks.size}
          min={0.7}
          max={1.3}
          step={0.01}
          format={(v) => (v === 1 ? 'preset' : v < 1 ? `${Math.round((1 - v) * 100)}% bigger` : `${Math.round((v - 1) * 100)}% smaller`)}
          onChange={(v) => engine.setTweak('size', v)}
        />
        <Slider label="Growl" value={tweaks.growl} min={0} max={1} step={0.05} format={pctFmt} onChange={(v) => engine.setTweak('growl', v)} />
        <Slider label="Grit" value={tweaks.grit} min={0} max={1} step={0.05} format={pctFmt} onChange={(v) => engine.setTweak('grit', v)} />
        <Slider
          label="Darkness  (brighter ↔ darker)"
          value={tweaks.darkness}
          min={-1}
          max={1}
          step={0.05}
          format={(v) => (v === 0 ? 'preset' : `${signed(Math.round(v * 100))}%`)}
          onChange={(v) => engine.setTweak('darkness', v)}
        />
        <Slider label="Reverb" value={tweaks.reverb} min={0} max={2} step={0.05} format={pctFmt} onChange={(v) => engine.setTweak('reverb', v)} />
        <Slider label="Echo" value={tweaks.echo} min={0} max={2} step={0.05} format={pctFmt} onChange={(v) => engine.setTweak('echo', v)} />
        <button className="small wide" onClick={() => engine.resetTweaks()}>
          Reset this voice
        </button>
      </details>

      <details open={showSetup} onToggle={(e) => setShowSetup((e.target as HTMLDetailsElement).open)}>
        <summary>🎙️ Microphone & setup</summary>
        <DevicePicker
          devices={state.devices}
          deviceId={state.deviceId}
          activeLabel={state.activeMicLabel}
          running={running}
          onSelect={(id) => void engine.selectDevice(id)}
          onRefresh={() => void engine.refreshDevices()}
        />
        <Slider
          label="Mic gain"
          value={state.inputGain}
          min={0}
          max={4}
          step={0.05}
          format={(v) => `${v.toFixed(2)}×`}
          onChange={(v) => engine.setInputGain(v)}
        />
        <Slider
          label="Silence gate"
          value={state.gateDb}
          min={-80}
          max={-20}
          step={1}
          format={(v) => `${v} dB`}
          onChange={(v) => engine.setGate(v)}
        />
        <h3>🔁 Echo / feedback</h3>
        <Slider
          label="Echo guard"
          value={state.echoGuard}
          min={0}
          max={1}
          step={0.05}
          format={(v) => (v === 0 ? 'Off' : pctFmt(v))}
          onChange={(v) => engine.setEchoGuard(v)}
        />
        <p className="hint">
          Turns the mic down when it's only hearing the speaker. Raise it if you hear repeating echoes; lower it if your voice
          cuts out.
        </p>
        <div className="seg" role="group" aria-label="iPhone echo cancellation">
          <span>iPhone echo cancellation (strong, may lower volume)</span>
          <button className={!state.echoCancel ? 'on' : ''} onClick={() => void engine.setEchoCancel(false)}>
            Off
          </button>
          <button className={state.echoCancel ? 'on' : ''} onClick={() => void engine.setEchoCancel(true)}>
            On
          </button>
        </div>
        <p className="hint">
          The orange line on the meter is the gate. Sound below it is muted, so the speaker stays quiet when you're not
          talking. Raise it if you hear hiss or feedback.
        </p>
        <h3>🔈 Too quiet?</h3>
        <p className="hint">
          iPhone lowers playback while a website uses the mic. Turn the phone volume all the way up, then try these
          (test with the beep and your voice):
        </p>
        <div className="seg" role="group" aria-label="Output route">
          <span>Output route</span>
          <button className={state.outputMode === 'direct' ? 'on' : ''} onClick={() => engine.setOutputMode('direct')}>
            Direct
          </button>
          <button className={state.outputMode === 'element' ? 'on' : ''} onClick={() => engine.setOutputMode('element')}>
            Media player
          </button>
        </div>
        <div className="seg" role="group" aria-label="iPhone audio mode">
          <span>iPhone audio mode</span>
          <button className={state.sessionMode === 'auto' ? 'on' : ''} onClick={() => void engine.setSessionMode('auto')}>
            Auto
          </button>
          <button
            className={state.sessionMode === 'play-and-record' ? 'on' : ''}
            onClick={() => void engine.setSessionMode('play-and-record')}
          >
            Play &amp; record
          </button>
        </div>
        <button className="small wide" onClick={() => engine.testSpeaker()} disabled={!running}>
          🔔 Test speaker beep
        </button>
        <ul className="tips">
          <li>Biggest echo fix: put the speaker behind you or low on your body, facing away from the DJI mic.</li>
          <li>Clip the DJI mic close to your mouth and lower Mic gain, so your voice is much louder than the speaker.</li>
          <li>Turn on the DJI Mic Mini's noise cancelling (in the DJI Mimo app) to reduce room/speaker pickup.</li>
          <li>Shorter Reverb/Echo in “Tune” means less tail for the mic to re-catch.</li>
          <li>Use the phone volume buttons for overall loudness; avoid Bluetooth speakers (they add a delay).</li>
          <li>Add to Home Screen (Share → Add to Home Screen) for a fullscreen app.</li>
          <li>Screen stays awake while live{state.wakeLock ? ' ✓' : ''}. Keep this tab in front.</li>
        </ul>
      </details>
      <footer>Happy Halloween 🎃</footer>
    </div>
  );
}
