import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the build works at https://<user>.github.io/halloween-voice-change/
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    // Never inline the AudioWorklet as a data: URL (Safari is picky about that).
    assetsInlineLimit: (file) => (file.includes('worklet') || file.includes('processors') ? false : undefined),
  },
});
