# 👻 Ghost Voice – Halloween voice changer

Takes your voice from a microphone (built-in or a DJI Mic plugged into the phone), turns it into a ghost voice in real time, and plays it through the phone speaker. It's a static React site that runs entirely in the browser, with no server.

## Voices
Clean (test) · Classic Ghost · Demon · Vocoder Demon · Possessed · Whisper Wraith · Creepy Child · Voice from Beyond · Crypt Echo · Haunted Machine · Poltergeist. Each one can be tuned in the **Voice Lab** (Pitch, Size, Growl, Grit, Darkness, Reverb, Echo), and your changes are saved on the phone.

## Using it on iPhone
1. Open the site in Safari, tap **Tap to Summon**, and allow the microphone.
2. Start on **Clean** at low volume to check the speaker, then pick a voice.
3. DJI Mic: plug the receiver into the iPhone, open **Microphone & setup**, tap ↻ and choose it.
4. Raise **Silence gate** if you hear hiss or feedback. Keep the speaker facing away from the mic.
5. Optional: Share → **Add to Home Screen** for fullscreen.

## Develop
```bash
npm install
npm run dev      # mic needs HTTPS on a phone, so test phones on the deployed site
npm run build
```

## Deploy (GitHub Pages)
Repo **Settings → Pages → Source: GitHub Actions**. Every push to `main` builds and deploys via `.github/workflows/deploy.yml`.

## How it works
`src/audio/AudioEngine.ts` (mic, lifecycle, settings) → `src/audio/graph.ts`, one persistent Web Audio chain built for clarity:

- **Main voice**: TD-PSOLA pitch shifter (keeps vowel formants, so shifted speech stays understandable) with formant scaling (Size) and period-doubling roughness (Growl)
- **Character layer** underneath: PSOLA with formant shift (monsters) or granular shifter (ghost/child), time-aligned with the main voice, with its own distortion
- Whisper vocoder and a synth vocoder (pitch-tracked dark carrier, time-aligned), ring mod, comb and tremolo, then a **clarity EQ** (mud cut, presence and air boost) and the **voice compressor**
- Reverb and echo as sends with **pre-delay**, EQ'd, and **ducked** while you speak
- **Clarity** slider blends a clean copy of the main voice past the weird effects
- Gate with **echo guard** (side-chained to the speaker output) stops speaker-to-mic loops, then a limiter and soft clip

Worklets (pitch tracker, PSOLA, granular shifter, gate, ducker) live in `src/audio/worklets/processors.js`. Voices are just parameter sets in `src/audio/voices.ts`.
