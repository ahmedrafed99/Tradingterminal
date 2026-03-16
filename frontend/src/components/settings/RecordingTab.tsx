import { useState, useEffect } from 'react';
import { loadDirectoryHandle, pickDirectory, clearDirectoryHandle, getReadyDirectoryHandle } from '../chart/recording/directoryHandle';

const MIC_KEY = 'recording-mic-enabled';

export function RecordingTab() {
  const [folderName, setFolderName] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [micEnabled, setMicEnabled] = useState(() => localStorage.getItem(MIC_KEY) === 'true');

  useEffect(() => {
    loadDirectoryHandle().then((h) => {
      setFolderName(h?.name ?? null);
    });
  }, []);

  async function handleChooseFolder() {
    setPicking(true);
    const handle = await pickDirectory();
    if (handle) {
      setFolderName(handle.name);
    }
    setPicking(false);
  }

  async function handleClearFolder() {
    await clearDirectoryHandle();
    setFolderName(null);
  }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Storage folder */}
        <div>
          <div className="text-[11px] font-medium text-(--color-text-muted) uppercase tracking-wider" style={{ marginBottom: 12 }}>
            Storage Location
          </div>
          <div className="flex items-center" style={{ gap: 10 }}>
            <div
              className="flex-1 bg-(--color-input) border border-(--color-border) rounded-lg text-xs"
              style={{ padding: '10px 14px' }}
            >
              {folderName ? (
                <span className="text-(--color-text-bright)">{folderName}</span>
              ) : (
                <span className="text-(--color-text-dim)">No folder selected</span>
              )}
            </div>
            <button
              onClick={handleChooseFolder}
              disabled={picking}
              className="text-xs font-medium rounded-lg bg-(--color-surface) border border-(--color-border) text-(--color-text) hover:bg-(--color-hover-row) transition-all disabled:opacity-50 whitespace-nowrap"
              style={{ padding: '10px 14px' }}
            >
              {picking ? 'Opening...' : folderName ? 'Change Folder' : 'Choose Folder'}
            </button>
            {folderName && (
              <button
                onClick={handleClearFolder}
                className="text-xs text-(--color-text-muted) hover:text-(--color-error) transition-colors"
                style={{ padding: '10px 6px' }}
                title="Clear folder selection"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          {!folderName && (
            <span className="block text-[10px] text-(--color-warning)" style={{ marginTop: 6 }}>
              Choose a folder to enable recording. Recordings will be saved as .webm files.
            </span>
          )}
          {folderName && (
            <span className="block text-[10px] text-(--color-text-dim)" style={{ marginTop: 6 }}>
              Recordings are saved directly to this folder. No backend involved.
            </span>
          )}
        </div>

        {/* Microphone */}
        <div>
          <div className="text-[11px] font-medium text-(--color-text-muted) uppercase tracking-wider" style={{ marginBottom: 12 }}>
            Audio
          </div>
          <label className="flex items-center cursor-pointer" style={{ gap: 10 }}>
            <input
              type="checkbox"
              checked={micEnabled}
              onChange={(e) => {
                setMicEnabled(e.target.checked);
                localStorage.setItem(MIC_KEY, String(e.target.checked));
              }}
              className="accent-(--color-accent)"
            />
            <span className="text-xs text-(--color-text)">Record microphone audio</span>
          </label>
          <span className="block text-[10px] text-(--color-text-dim)" style={{ marginTop: 6 }}>
            When enabled, your mic input will be included in recordings. Browser will ask for permission on first use.
          </span>
        </div>
      </div>
    </div>
  );
}
