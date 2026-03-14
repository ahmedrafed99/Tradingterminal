import { useEffect, useRef, useState } from 'react';
import { audioService, type SoundName } from '../../services/audioService';

const SECTION_TITLE = 'text-[11px] font-medium text-(--color-text-muted) uppercase tracking-wider';

const SOUNDS: { name: SoundName; label: string }[] = [
  { name: 'order_filled', label: 'Entry Filled' },
  { name: 'target_filled', label: 'Target Filled' },
  { name: 'stop_filled', label: 'Stop Filled' },
  { name: 'position_closed', label: 'Position Closed' },
];

export function SoundTab() {
  const [enabled, setEnabled] = useState(audioService.getEnabled());
  const [volume, setVolume] = useState(audioService.getVolume());
  const [expanded, setExpanded] = useState<SoundName | null>(null);
  const [, forceUpdate] = useState(0);

  // Re-render when clips change (add/remove)
  useEffect(() => {
    return audioService.onChange(() => forceUpdate(n => n + 1));
  }, []);

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
            <span className={SECTION_TITLE}>Voice Lines</span>
          </div>

          <div className="rounded-lg overflow-hidden border border-white/[0.06] bg-(--color-input)">
            {SOUNDS.map((s, i) => (
              <SoundCategory
                key={s.name}
                name={s.name}
                label={s.label}
                isFirst={i === 0}
                expanded={expanded === s.name}
                onToggle={() => setExpanded(expanded === s.name ? null : s.name)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Per-category expandable section ────────────────────────────────

function SoundCategory({
  name,
  label,
  isFirst,
  expanded,
  onToggle,
}: {
  name: SoundName;
  label: string;
  isFirst: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const clips = audioService.getClips(name);
  const count = clips.length;
  const hasCustom = clips.some(c => c.id !== undefined);

  async function handleFiles(files: FileList | File[]) {
    const audioFiles = Array.from(files).filter(f => f.type.startsWith('audio/'));
    if (audioFiles.length === 0) return;
    await audioService.addClips(name, audioFiles);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  }

  return (
    <div
      style={{ borderTop: !isFirst ? '1px solid rgba(255,255,255,0.06)' : undefined }}
    >
      {/* Header row */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between transition-colors hover:bg-white/[0.03] cursor-pointer"
        style={{ padding: '10px 12px' }}
      >
        <div className="text-left">
          <div className="text-xs text-white">{label}</div>
          <div className="text-[11px] text-(--color-text-muted)">
            {count} voice line{count !== 1 ? 's' : ''}
            {!hasCustom && ' (default)'}
          </div>
        </div>
        <svg
          width="14" height="14" viewBox="0 0 14 14" fill="none"
          className="transition-transform"
          style={{
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            opacity: 0.4,
          }}
        >
          <path d="M3.5 5.25L7 8.75L10.5 5.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Expanded panel */}
      {expanded && (
        <div
          style={{ padding: '0 12px 12px' }}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          {/* Clip list */}
          <div className="flex flex-col" style={{ gap: 2, marginBottom: 8 }}>
            {clips.map((clip, idx) => (
              <div
                key={clip.id ?? `default-${idx}`}
                className="group flex items-center justify-between rounded transition-colors"
                style={{
                  padding: '6px 8px',
                  borderLeft: idx === 0 ? '3px solid var(--color-warning)' : '3px solid transparent',
                  background: idx === 0 ? 'rgba(240,168,48,0.06)' : undefined,
                }}
              >
                <span className="text-[11px] text-(--color-text-muted) truncate" style={{ maxWidth: 220 }}>
                  {clip.name}
                </span>
                <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity" style={{ gap: 4 }}>
                  {/* Play button */}
                  <button
                    type="button"
                    onClick={() => {
                      const wasEnabled = audioService.getEnabled();
                      if (!wasEnabled) audioService.setEnabled(true);
                      audioService.playClip(name, idx);
                      if (!wasEnabled) audioService.setEnabled(false);
                    }}
                    className="rounded transition-colors hover:bg-white/[0.08]"
                    style={{ padding: '3px 5px' }}
                    title="Play"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M3 2L10 6L3 10V2Z" fill="var(--color-text-muted)" />
                    </svg>
                  </button>
                  {/* Delete button (only for uploaded clips) */}
                  {clip.id !== undefined && (
                    <button
                      type="button"
                      onClick={() => audioService.removeClip(name, clip.id!)}
                      className="rounded transition-colors hover:bg-white/[0.08]"
                      style={{ padding: '3px 5px' }}
                      title="Remove"
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M3 3L9 9M9 3L3 9" stroke="var(--color-sell)" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Upload drop zone / button */}
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            multiple
            className="hidden"
            onChange={e => {
              if (e.target.files) handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full rounded-lg border border-dashed transition-colors cursor-pointer"
            style={{
              padding: '10px 0',
              borderColor: dragOver ? 'var(--color-accent)' : 'rgba(255,255,255,0.1)',
              background: dragOver ? 'rgba(91,141,239,0.08)' : 'transparent',
            }}
          >
            <div className="flex flex-col items-center" style={{ gap: 2 }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ opacity: 0.4 }}>
                <path d="M8 3V11M4 7L8 3L12 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M3 13H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <span className="text-[10px] text-(--color-text-dim)">
                Drop audio files or <span className="text-(--color-accent) hover:underline">click to upload</span>
              </span>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
