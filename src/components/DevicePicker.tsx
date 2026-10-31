import { MicDevice } from '../audio/AudioEngine';

interface Props {
  devices: MicDevice[];
  deviceId: string;
  activeLabel: string;
  running: boolean;
  onSelect: (id: string) => void;
  onRefresh: () => void;
}

export function DevicePicker({ devices, deviceId, activeLabel, running, onSelect, onRefresh }: Props) {
  return (
    <div className="device">
      <div className="row">
        <select value={deviceId} onChange={(e) => onSelect(e.target.value)} aria-label="Microphone">
          <option value="">Default microphone</option>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
        <button className="small" onClick={onRefresh} title="Refresh microphones">
          ↻
        </button>
      </div>
      <p className="hint">
        {running ? <>Listening on: <b>{activeLabel}</b>.</> : 'Start to see all microphones.'} Plugged in the DJI receiver?
        Tap ↻ and pick it.
      </p>
    </div>
  );
}
