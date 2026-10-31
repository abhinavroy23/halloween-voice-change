import { useSyncExternalStore } from 'react';
import { engine } from '../audio/AudioEngine';

export function useAudioEngine() {
  const state = useSyncExternalStore(engine.subscribe, engine.getState);
  return { state, engine };
}
