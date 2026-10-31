import { useEffect, useRef } from 'react';
import { engine } from '../audio/AudioEngine';

const MIN_DB = -80;
const pct = (db: number) => Math.max(0, Math.min(1, (db - MIN_DB) / -MIN_DB));

/** Mic level with the gate threshold marked. Drawn on canvas, outside React renders. */
export function LevelMeter({ gateDb, active }: { gateDb: number; active: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const g = canvas.getContext('2d')!;
    let raf = 0;
    let shown = MIN_DB;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth * dpr;
      const h = canvas.clientHeight * dpr;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const db = active ? engine.getLevelDb() : MIN_DB;
      shown = db > shown ? db : shown - 1.2; // fast up, slow fall
      const open = shown > gateDb;
      g.clearRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fillRect(0, 0, w, h);
      g.fillStyle = open ? '#8bff9a' : '#6b5d85';
      g.fillRect(0, 0, w * pct(shown), h);
      g.fillStyle = '#ff9a3c';
      g.fillRect(w * pct(gateDb) - dpr, 0, 2 * dpr, h);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [gateDb, active]);

  return <canvas ref={ref} className="meter" aria-label="Microphone level" />;
}
