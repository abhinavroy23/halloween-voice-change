import { useEffect, useRef, useState } from 'react';

const HOLD_MS = 2000;

/**
 * Black, touch-proof screen for when the phone is in a pocket/costume. Audio keeps running
 * and the screen stays awake (Safari stops the mic if the phone locks). Hold 2 s to exit.
 */
export function PocketMode({ onExit }: { onExit: () => void }) {
  const [progress, setProgress] = useState(0);
  const start = useRef<number | null>(null);
  const raf = useRef(0);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const tick = () => {
    if (start.current === null) return;
    const p = Math.min(1, (performance.now() - start.current) / HOLD_MS);
    setProgress(p);
    if (p >= 1) {
      start.current = null;
      onExit();
      return;
    }
    raf.current = requestAnimationFrame(tick);
  };
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    if (start.current !== null) return;
    start.current = performance.now();
    raf.current = requestAnimationFrame(tick);
  };
  const up = () => {
    start.current = null;
    cancelAnimationFrame(raf.current);
    setProgress(0);
  };

  return (
    <div
      className="pocket-overlay"
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      onPointerLeave={up}
      onContextMenu={(e) => e.preventDefault()}
      role="button"
      aria-label="Pocket mode. Hold for 2 seconds to unlock."
    >
      <div className="pocket-hint">
        hold 2 s to unlock
        <div className="pocket-bar" style={{ transform: `scaleX(${progress})` }} />
      </div>
    </div>
  );
}
