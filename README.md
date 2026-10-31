# 👻 Ghost Voice – Halloween voice changer

Takes your voice from a microphone (built-in or a DJI Mic plugged into the phone), turns it into a ghost voice in real time, and plays it through the phone speaker. It's a static React site that runs entirely in the browser, with no server.

## Voices
Clean (test) · Classic Ghost · Demon · Possessed · Whisper Wraith · Creepy Child · Voice from Beyond · Crypt Echo · Haunted Machine · Poltergeist. Each one has Pitch / Reverb / Echo / Grit tuning sliders, and your changes are saved on the phone.

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
`src/audio/AudioEngine.ts` (mic, lifecycle) → `src/audio/graph.ts` (one persistent Web Audio chain: noise gate → pitch shifters / whisper vocoder → ring mod → distortion → EQ → comb → tremolo → echo + reverb → limiter). The pitch shifter and noise gate are AudioWorklets in `src/audio/worklets/processors.js`. Voices are just parameter sets in `src/audio/voices.ts`.
