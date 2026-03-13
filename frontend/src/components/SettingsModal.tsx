import { useState, useEffect } from 'react';
import { authService } from '../services/authService';
import { accountService } from '../services/accountService';
import { useStore } from '../store/useStore';
import { TabButton } from './shared/TabButton';
import { DatabaseTab } from './settings/DatabaseTab';
import { SoundTab } from './settings/SoundTab';
import { Modal } from './shared/Modal';
import { INPUT_DARK } from '../constants/styles';

const DEFAULT_BASE_URL = 'https://api.topstepx.com';

type SettingsTab = 'api' | 'database' | 'sound';

export function SettingsModal() {
  const { settingsOpen, setSettingsOpen, connected, baseUrl, setConnected, setAccounts, conditionServerUrl, setConditionServerUrl } = useStore();

  const [tab, setTab] = useState<SettingsTab>('api');
  const [userName, setUserName] = useState('');
  const [apiKey, setApiKey]     = useState('');
  const [url, setUrl]           = useState(baseUrl || DEFAULT_BASE_URL);
  const [condUrl, setCondUrl]    = useState(conditionServerUrl);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  // Sync url fields when store values change
  useEffect(() => { setUrl(baseUrl || DEFAULT_BASE_URL); }, [baseUrl]);
  useEffect(() => { setCondUrl(conditionServerUrl); }, [conditionServerUrl]);

  if (!settingsOpen) return null;

  async function handleConnect() {
    setError(null);
    setLoading(true);
    try {
      await authService.connect(userName.trim(), apiKey.trim(), url.trim() || undefined);
      const status = await authService.getStatus();
      setConnected(true, status.baseUrl);
      const accounts = await accountService.searchAccounts();
      setAccounts(accounts);
      setSettingsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleDisconnect() {
    setError(null);
    setLoading(true);
    try {
      await authService.disconnect();
      setConnected(false);
      setAccounts([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Disconnect failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal onClose={() => setSettingsOpen(false)} className="w-[460px] rounded-xl bg-(--color-surface) border border-(--color-border) shadow-2xl">
        {/* Header */}
        <div className="border-b border-(--color-border)" style={{ padding: '16px 32px 0 32px' }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
            <h2 className="text-sm font-medium text-(--color-text)">Settings</h2>
            <button
              onClick={() => setSettingsOpen(false)}
              className="text-(--color-text-muted) hover:text-white transition-colors p-1 rounded hover:bg-(--color-hover-toolbar)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="flex items-center gap-1" style={{ height: 36 }}>
            <TabButton label="API" active={tab === 'api'} onClick={() => setTab('api')} />
            <TabButton label="Database" active={tab === 'database'} onClick={() => setTab('database')} />
            <TabButton label="Sound" active={tab === 'sound'} onClick={() => setTab('sound')} />
          </div>
        </div>

        {/* Body */}
        {tab === 'api' && (
          <>
            <div className="space-y-4" style={{ padding: '24px 32px' }}>
              {/* Status pill */}
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block w-2 h-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-400'}`}
                />
                <span className="text-xs text-(--color-text-muted)">
                  {connected ? `Connected · ${baseUrl}` : 'Disconnected'}
                </span>
              </div>

              {/* Fields — only editable when disconnected */}
              <div className="space-y-3">
                <label className="block">
                  <span className="block text-xs text-(--color-text-muted) mb-1">Username</span>
                  <input
                    type="text"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    disabled={connected || loading}
                    placeholder="your-projectx-username"
                    className={INPUT_DARK}
                    style={{ padding: '10px 14px' }}
                  />
                </label>

                <label className="block">
                  <span className="block text-xs text-(--color-text-muted) mb-1">API Key</span>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    disabled={connected || loading}
                    placeholder="••••••••••••••••"
                    className={INPUT_DARK}
                    style={{ padding: '10px 14px' }}
                  />
                </label>

                <label className="block">
                  <span className="block text-xs text-(--color-text-muted) mb-1">Gateway URL</span>
                  <input
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    disabled={connected || loading}
                    placeholder={DEFAULT_BASE_URL}
                    className={INPUT_DARK}
                    style={{ padding: '10px 14px' }}
                  />
                </label>
              </div>

              {/* Condition Server — always editable */}
              <div className="space-y-3 border-t border-(--color-border)" style={{ paddingTop: 16 }}>
                <label className="block">
                  <span className="block text-xs text-(--color-text-muted) mb-1">Condition Server URL</span>
                  <input
                    type="text"
                    value={condUrl}
                    onChange={(e) => setCondUrl(e.target.value)}
                    onBlur={() => setConditionServerUrl(condUrl.trim())}
                    placeholder="http://localhost:3001"
                    className={INPUT_DARK}
                    style={{ padding: '10px 14px' }}
                  />
                  <span className="block text-[10px] text-(--color-text-dim) mt-1">Defaults to localhost:3001 (local backend). Set a remote URL for server mode.</span>
                </label>
              </div>

              {/* Error */}
              {error && (
                <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{error}</p>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 border-t border-(--color-border)" style={{ padding: '20px 32px' }}>
              <button
                onClick={() => setSettingsOpen(false)}
                className="text-sm text-(--color-text-muted) hover:text-white border border-(--color-border) hover:border-(--color-text-dim) rounded-lg transition-colors" style={{ padding: '8px 18px' }}
              >
                Cancel
              </button>

              {connected ? (
                <button
                  onClick={handleDisconnect}
                  disabled={loading}
                  className="text-sm font-medium rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-50" style={{ padding: '8px 18px' }}
                >
                  {loading ? 'Disconnecting…' : 'Disconnect'}
                </button>
              ) : (
                <button
                  onClick={handleConnect}
                  disabled={loading || !userName || !apiKey}
                  className="text-sm font-medium rounded-lg bg-(--color-accent) text-white hover:bg-(--color-accent-hover) transition-colors disabled:opacity-50" style={{ padding: '8px 18px' }}
                >
                  {loading ? 'Connecting…' : 'Connect'}
                </button>
              )}
            </div>
          </>
        )}

        {tab === 'database' && <DatabaseTab />}
        {tab === 'sound' && <SoundTab />}
    </Modal>
  );
}
