import { useState } from 'react';
import { pickLogsDirectory } from '../../services/monitor/logWriter';
import { Z, FONT_SIZE, RADIUS } from '../../constants/layout';

interface IndexEntry {
  date: string;
  sessionFile: string;
  summary: string;
}

interface Props {
  onClose: () => void;
}

async function parseIndex(dir: FileSystemDirectoryHandle): Promise<IndexEntry[]> {
  try {
    const fh = await dir.getFileHandle('index.log', { create: false });
    const file = await fh.getFile();
    const text = await file.text();
    const entries: IndexEntry[] = [];
    for (const line of text.split('\n')) {
      const m = line.match(/^(\d{4}-\d{2}-\d{2})\s+(session_\S+)\s+(.+)$/);
      if (m) entries.push({ date: m[1], sessionFile: m[2], summary: m[3] });
    }
    return entries.reverse();
  } catch { return []; }
}

async function readFile(dir: FileSystemDirectoryHandle, name: string): Promise<string> {
  try {
    const fh = await dir.getFileHandle(name, { create: false });
    const file = await fh.getFile();
    return file.text();
  } catch { return ''; }
}

export function ReportView({ onClose }: Props) {
  const [dir, setDir] = useState<FileSystemDirectoryHandle | null>(null);
  const [entries, setEntries] = useState<IndexEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);

  const openDir = async () => {
    setLoading(true);
    const handle = await pickLogsDirectory();
    if (handle) {
      setDir(handle);
      const parsed = await parseIndex(handle);
      setEntries(parsed);
    }
    setLoading(false);
  };

  const loadSession = async (entry: IndexEntry) => {
    if (!dir) return;
    setLoading(true);
    setSelected(entry.sessionFile);
    const text = await readFile(dir, entry.sessionFile);
    setContent(text);
    setLoading(false);
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'var(--color-backdrop)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: Z.MODAL + 1,
    }}>
      <div style={{
        background: 'var(--color-panel)',
        border: '1px solid var(--color-border)',
        borderRadius: RADIUS.PILL,
        width: 780,
        maxHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: '1px solid var(--color-border)',
        }}>
          <span style={{ fontSize: FONT_SIZE.BASE, fontWeight: 600, color: 'var(--color-text)' }}>
            Session Reports
          </span>
          <button
            onClick={onClose}
            className="transition-colors hover:text-(--color-text-bright) active:opacity-75"
            style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: FONT_SIZE.XL }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Sidebar */}
          <div style={{
            width: 220,
            borderRight: '1px solid var(--color-border)',
            overflow: 'auto',
            padding: '8px 0',
          }}>
            {!dir ? (
              <button
                onClick={openDir}
                disabled={loading}
                style={{
                  margin: '8px 12px',
                  padding: '6px 12px',
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: RADIUS.XL,
                  color: 'var(--color-text)',
                  fontSize: FONT_SIZE.SM,
                  cursor: 'pointer',
                  width: 'calc(100% - 24px)',
                  transition: 'background var(--transition-fast)',
                }}
                className="hover:bg-(--color-hover-toolbar) active:opacity-75"
              >
                {loading ? 'Opening…' : 'Open logs folder'}
              </button>
            ) : entries.length === 0 ? (
              <div style={{ padding: '12px', fontSize: FONT_SIZE.SM, color: 'var(--color-text-muted)' }}>
                No sessions in this folder
              </div>
            ) : (
              entries.map((e) => (
                <button
                  key={e.sessionFile}
                  onClick={() => loadSession(e)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    background: selected === e.sessionFile ? 'var(--color-surface)' : 'none',
                    border: 'none',
                    padding: '7px 14px',
                    cursor: 'pointer',
                    transition: 'background var(--transition-fast)',
                  }}
                  className="hover:bg-(--color-hover-row) active:opacity-75"
                >
                  <div style={{ fontSize: FONT_SIZE.SM, fontWeight: 600, color: 'var(--color-text)' }}>{e.date}</div>
                  <div style={{ fontSize: FONT_SIZE.XS, color: 'var(--color-text-muted)', marginTop: 2 }}>{e.summary}</div>
                </button>
              ))
            )}
          </div>

          {/* Content */}
          <div style={{ flex: 1, overflow: 'auto', padding: '14px 16px' }}>
            {loading ? (
              <div style={{ fontSize: FONT_SIZE.SM, color: 'var(--color-text-muted)' }}>Loading…</div>
            ) : content ? (
              <pre style={{
                fontSize: FONT_SIZE.SM,
                color: 'var(--color-text)',
                lineHeight: 1.7,
                whiteSpace: 'pre-wrap',
                margin: 0,
                fontFamily: 'var(--font-family)',
              }}>
                {content}
              </pre>
            ) : (
              <div style={{ fontSize: FONT_SIZE.SM, color: 'var(--color-text-muted)' }}>
                Select a session from the list
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
