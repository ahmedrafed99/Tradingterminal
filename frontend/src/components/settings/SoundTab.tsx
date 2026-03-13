import { useState } from 'react';
import { audioService, type SoundName } from '../../services/audioService';

const SECTION_TITLE = 'text-[11px] font-medium text-(--color-text-muted) uppercase tracking-wider';

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
    const wasEnabled = audioService.getEnabled();
    if (!wasEnabled) audioService.setEnabled(true);
    audioService.play(name);
    if (!wasEnabled) audioService.setEnabled(false);
  }

  return (
    <div style={{ padding: '20px 24px 24px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        {/* ENABLE / DISABLE */}
        <div className="flex items-center justify-between">
          <span className={SECTION_TITLE}>Voice Notifications</span>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <span className={`text-[11px] ${enabled ? 'text-(--color-buy)' : 'text-(--color-text-dim)'}`}>
              {enabled ? 'On' : 'Off'}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              onClick={handleToggle}
              className="relative rounded-full cursor-pointer transition-colors"
              style={{
                width: 40,
                height: 22,
                background: enabled ? 'var(--color-accent)' : 'var(--color-hover-toolbar)',
              }}
            >
              <span
                className="absolute rounded-full bg-white transition-all"
                style={{
                  width: 18,
                  height: 18,
                  top: 2,
                  left: enabled ? 20 : 2,
                }}
              />
            </button>
          </label>
        </div>

        {/* VOLUME */}
        <div style={{ opacity: enabled ? 1 : 0.4, transition: 'opacity 0.2s' }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
            <span className="text-[11px] text-(--color-text-muted)">Volume</span>
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

        {/* SOUNDS */}
        <div>
          <div style={{ marginBottom: 12 }}>
            <span className={SECTION_TITLE}>Sounds</span>
          </div>

          <div className="rounded-lg overflow-hidden border border-white/[0.06]">
            {SOUNDS.map((s, i) => (
              <div
                key={s.name}
                className="flex items-center justify-between transition-colors hover:bg-white/[0.03]"
                style={{
                  padding: '10px 12px',
                  borderTop: i > 0 ? '1px solid rgba(255,255,255,0.06)' : undefined,
                }}
              >
                <div>
                  <div className="text-xs text-white">{s.label}</div>
                  <div className="text-[10px] text-(--color-text-dim)">{s.name}.m4a</div>
                </div>
                <button
                  onClick={() => handleTest(s.name)}
                  className="text-[11px] font-medium rounded-lg bg-(--color-accent)/20 text-[#5b8def] hover:bg-(--color-accent)/30 transition-all"
                  style={{ padding: '5px 14px' }}
                >
                  Test
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
