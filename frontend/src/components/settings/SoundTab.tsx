import { useState } from 'react';
import { audioService, type SoundName } from '../../services/audioService';
import { SECTION_LABEL } from '../../constants/styles';

const SOUNDS: { name: SoundName; label: string }[] = [
  { name: 'order_filled', label: 'Entry Filled' },
  { name: 'target_filled', label: 'Target Filled' },
  { name: 'stop_filled', label: 'Stop Filled' },
];

export function SoundTab() {
  const [enabled, setEnabled] = useState(audioService.getEnabled());
  const [volume, setVolume] = useState(audioService.getVolume());

  function handleToggle() {
    const next = !enabled;
    setEnabled(next);
    audioService.setEnabled(next);
  }

  function handleVolume(e: React.ChangeEvent<HTMLInputElement>) {
    const v = parseFloat(e.target.value);
    setVolume(v);
    audioService.setVolume(v);
  }

  function handleTest(name: SoundName) {
    // Temporarily force-enable so the test plays even if disabled
    const wasEnabled = audioService.getEnabled();
    if (!wasEnabled) audioService.setEnabled(true);
    audioService.play(name);
    if (!wasEnabled) audioService.setEnabled(false);
  }

  return (
    <div style={{ padding: '20px 32px 24px' }}>
      {/* ENABLE / DISABLE */}
      <div className="flex items-center justify-between" style={{ marginBottom: 20 }}>
        <span className={SECTION_LABEL}>Voice Notifications</span>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <span className={`text-[11px] ${enabled ? 'text-(--color-buy)' : 'text-(--color-text-dim)'}`}>
            {enabled ? 'On' : 'Off'}
          </span>
          <div
            onClick={handleToggle}
            className={`relative rounded-full cursor-pointer transition-colors ${enabled ? 'bg-(--color-accent)' : 'bg-(--color-input)'}`}
            style={{ width: 36, height: 20 }}
          >
            <div
              className="absolute top-0.5 rounded-full transition-all bg-white"
              style={{
                width: 16,
                height: 16,
                left: enabled ? 18 : 2,
              }}
            />
          </div>
        </label>
      </div>

      {/* VOLUME */}
      <div style={{ marginBottom: 24, opacity: enabled ? 1 : 0.4, transition: 'opacity 0.2s' }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
          <span className="text-xs text-(--color-text-muted)">Volume</span>
          <span className="text-[10px] text-(--color-text-dim)">
            {Math.round(volume * 100)}%
          </span>
        </div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          onChange={handleVolume}
          disabled={!enabled}
          className="w-full accent-(--color-accent)"
          style={{ height: 4 }}
        />
      </div>

      {/* DIVIDER */}
      <div className="border-t border-(--color-border)" style={{ marginBottom: 20 }} />

      {/* SOUND LIST WITH TEST BUTTONS */}
      <div style={{ marginBottom: 8 }}>
        <span className={SECTION_LABEL}>Sounds</span>
      </div>

      <div className="rounded-lg overflow-hidden border border-(--color-border)">
        {SOUNDS.map((s, i) => (
          <div
            key={s.name}
            className="flex items-center justify-between transition-colors"
            style={{
              padding: '10px 12px',
              borderTop: i > 0 ? '1px solid var(--color-border)' : undefined,
            }}
          >
            <div>
              <div className="text-xs text-(--color-text)">{s.label}</div>
              <div className="text-[10px] text-(--color-text-dim)">{s.name}.m4a</div>
            </div>
            <button
              onClick={() => handleTest(s.name)}
              className="text-[11px] font-medium rounded-lg text-white bg-(--color-accent) hover:bg-(--color-accent-hover) transition-colors"
              style={{ padding: '5px 14px' }}
            >
              Test
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
