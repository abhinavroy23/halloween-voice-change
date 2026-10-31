import { BEDS, LINES, SFX } from '../audio/stage';
import { engine, EngineState } from '../audio/AudioEngine';
import { Slider } from './Slider';

export function StagePanel({ state, onPocket }: { state: EngineState; onPocket: () => void }) {
  const running = state.status === 'running';
  return (
    <section className="stage">
      <div className="row">
        <button className="big vanish" onClick={() => engine.vanish()} disabled={!running || state.muted}>
          🌫️ Vanish
        </button>
        <button className="big pocket" onClick={onPocket} disabled={!running}>
          🌑 Pocket mode
        </button>
      </div>

      <h3>🗣️ Phantom lines</h3>
      <p className="hint">Spoken in the current voice. Tap again to restart.</p>
      <div className="chips">
        {LINES.map((l) => (
          <button key={l.id} className="chip" onClick={() => engine.playLine(l.id)} disabled={!running}>
            {l.text}
          </button>
        ))}
      </div>

      <h3>🎬 Sound effects</h3>
      <div className="sfx-grid">
        {SFX.map((s) => (
          <button key={s.id} className="sfx" onClick={() => engine.playSfx(s.id)} disabled={!running}>
            <span className="sfx-emoji">{s.emoji}</span>
            <span>{s.name}</span>
          </button>
        ))}
      </div>

      <h3>🎵 Background</h3>
      <div className="seg" role="group" aria-label="Background sound">
        {BEDS.map((b) => (
          <button
            key={b.id}
            className={state.bed === b.id ? 'on' : ''}
            onClick={() => engine.setBed(b.id)}
            disabled={!running}
          >
            {b.name}
          </button>
        ))}
      </div>
      <Slider
        label="Background volume"
        value={state.bedVolume}
        min={0}
        max={1}
        step={0.05}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => engine.setBedVolume(v)}
      />
      <p className="hint">The background dips automatically while you or a line are speaking.</p>
    </section>
  );
}
