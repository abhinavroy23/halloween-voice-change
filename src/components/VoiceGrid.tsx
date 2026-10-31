import { VOICES } from '../audio/voices';

export function VoiceGrid({ voiceId, onSelect }: { voiceId: string; onSelect: (id: string) => void }) {
  return (
    <div className="voice-grid">
      {VOICES.map((v) => (
        <button
          key={v.id}
          className={`voice ${v.id === voiceId ? 'selected' : ''}`}
          onClick={() => onSelect(v.id)}
          aria-pressed={v.id === voiceId}
        >
          <span className="voice-emoji">{v.emoji}</span>
          <span className="voice-name">{v.name}</span>
          <span className="voice-blurb">{v.blurb}</span>
        </button>
      ))}
    </div>
  );
}
