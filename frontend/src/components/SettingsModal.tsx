import { useState, useEffect } from 'react';
import { authService } from '../services/authService';
import { accountService } from '../services/accountService';
import { realtimeService } from '../services/realtimeService';
import { credentialService } from '../services/credentialService';
import { useStore } from '../store/useStore';
import { DatabaseTab } from './settings/DatabaseTab';
import { SoundTab } from './settings/SoundTab';
import { ShortcutsTab } from './settings/ShortcutsTab';
import { RecordingTab } from './settings/RecordingTab';
import { Modal } from './shared/Modal';

const DEFAULT_BASE_URL = 'https://api.topstepx.com';

type SettingsTab = 'datafeed' | 'database' | 'sound' | 'shortcuts' | 'recording';

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'datafeed', label: 'Data Feed' },
  { id: 'database', label: 'Database' },
  { id: 'sound', label: 'Sound' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'recording', label: 'Recording' },
];

const DATA_FEED_PROVIDERS = [
  { id: 'topstepx', label: 'TopstepX by ProjectX' },
];

const INPUT_CLS = 'w-full bg-(--color-input) border border-(--color-border) rounded-lg text-xs text-(--color-text-bright) placeholder-(--color-text-dim) focus:outline-none focus:border-(--color-accent)/50 transition-all disabled:opacity-50';

export function SettingsModal() {
  const { settingsOpen, setSettingsOpen, connected, baseUrl, setConnected, setAccounts, conditionServerUrl, setConditionServerUrl, rememberCredentials, setRememberCredentials } = useStore();

  const [tab, setTab] = useState<SettingsTab>('datafeed');
  const [provider, setProvider] = useState('topstepx');
  const [userName, setUserName] = useState('');
  const [apiKey, setApiKey]     = useState('');
  const [url, setUrl]           = useState(baseUrl || DEFAULT_BASE_URL);
  const [condUrl, setCondUrl]    = useState(conditionServerUrl);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  // Sync url fields when store values change
  useEffect(() => { setUrl(baseUrl || DEFAULT_BASE_URL); }, [baseUrl]);
  useEffect(() => { setCondUrl(conditionServerUrl); }, [conditionServerUrl]);

  // Load saved credentials from encrypted backend storage when modal opens
  useEffect(() => {
    if (settingsOpen && rememberCredentials) {
      credentialService.load().then((creds) => {
        if (creds) {
          setUserName(creds.userName);
          setApiKey(creds.apiKey);
        }
      }).catch(() => {}); // silent — user can re-enter manually
    }
  }, [settingsOpen]);

  if (!settingsOpen) return null;

  async function handleConnect() {
    setError(null);
    setLoading(true);
    try {
      await authService.connect(userName.trim(), apiKey.trim(), url.trim() || undefined);
      const status = await authService.getStatus();
      setConnected(true, status.baseUrl);
      if (rememberCredentials) {
        await credentialService.save(userName.trim(), apiKey.trim());
      }
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
      await realtimeService.disconnect();
      await authService.disconnect();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Disconnect failed');
    } finally {
      // Always clean up state — even if one service threw, the connection is torn down
      setConnected(false);
      setAccounts([]);
      setLoading(false);
    }
  }

  return (
    <Modal onClose={() => setSettingsOpen(false)} backdropClassName="!items-start" className="w-[480px] max-h-[85vh] flex flex-col rounded-2xl bg-(--color-surface) border border-(--color-border) shadow-2xl overflow-hidden" style={{ marginTop: '8vh' }}>
        {/* Header */}
        <div className="border-b border-(--color-border)/30" style={{ padding: '18px 24px 0 24px' }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
            <h2 className="text-sm font-semibold text-white">Settings</h2>
            <button
              onClick={() => setSettingsOpen(false)}
              className="flex items-center justify-center rounded-full hover:bg-(--color-border)/30 transition-colors"
              style={{ width: 32, height: 32 }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Tabs */}
          <div className="flex" style={{ gap: 2 }}>
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`text-xs font-medium transition-colors relative cursor-pointer ${
                  tab === t.id
                    ? 'text-white'
                    : 'text-(--color-text-muted) hover:text-(--color-text)'
                }`}
                style={{ padding: '8px 16px' }}
              >
                {t.label}
                {tab === t.id && (
                  <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-(--color-accent) rounded-full" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1">
          {tab === 'datafeed' && (
            <>
              <div style={{ padding: '20px 24px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                  {/* Provider selector */}
                  <div>
                    <div className="text-[11px] font-medium text-(--color-text-muted) uppercase tracking-wider" style={{ marginBottom: 12 }}>Provider</div>
                    <select
                      value={provider}
                      onChange={(e) => setProvider(e.target.value)}
                      disabled={connected || loading}
                      className={INPUT_CLS}
                      style={{ padding: '10px 14px', appearance: 'none', cursor: 'pointer' }}
                    >
                      {DATA_FEED_PROVIDERS.map((p) => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Status pill */}
                  <div className="flex items-center" style={{ gap: 8 }}>
                    <span
                      className={`inline-block w-2 h-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-400'}`}
                    />
                    <span className="text-xs text-(--color-text-muted)">
                      {connected ? `Connected · ${baseUrl}` : 'Disconnected'}
                    </span>
                  </div>

                  {/* Connection Fields */}
                  <div>
                    <div className="text-[11px] font-medium text-(--color-text-muted) uppercase tracking-wider" style={{ marginBottom: 12 }}>Credentials</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <label className="block">
                        <span className="block text-[11px] text-(--color-text-muted)" style={{ marginBottom: 6 }}>Username</span>
                        <input
                          type="text"
                          value={userName}
                          onChange={(e) => setUserName(e.target.value)}
                          disabled={connected || loading}
                          placeholder="your-projectx-username"
                          className={INPUT_CLS}
                          style={{ padding: '10px 14px' }}
                        />
                      </label>

                      <label className="block">
                        <span className="block text-[11px] text-(--color-text-muted)" style={{ marginBottom: 6 }}>API Key</span>
                        <input
                          type="password"
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                          disabled={connected || loading}
                          placeholder="••••••••••••••••"
                          className={INPUT_CLS}
                          style={{ padding: '10px 14px' }}
                        />
                      </label>

                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={rememberCredentials}
                          onChange={(e) => {
                            const on = e.target.checked;
                            setRememberCredentials(on);
                            if (!on) {
                              credentialService.clear().catch(() => {});
                            }
                          }}
                          className="accent-(--color-accent)"
                        />
                        <span className="text-[11px] text-(--color-text-muted)">Remember credentials</span>
                      </label>

                      <label className="block">
                        <span className="block text-[11px] text-(--color-text-muted)" style={{ marginBottom: 6 }}>Gateway URL</span>
                        <input
                          type="text"
                          value={url}
                          onChange={(e) => setUrl(e.target.value)}
                          disabled={connected || loading}
                          placeholder={DEFAULT_BASE_URL}
                          className={INPUT_CLS}
                          style={{ padding: '10px 14px' }}
                        />
                      </label>
                    </div>
                  </div>

                  {/* Condition Server — always editable */}
                  <div>
                    <div className="text-[11px] font-medium text-(--color-text-muted) uppercase tracking-wider" style={{ marginBottom: 12 }}>Condition Server</div>
                    <label className="block">
                      <span className="block text-[11px] text-(--color-text-muted)" style={{ marginBottom: 6 }}>Server URL</span>
                      <input
                        type="text"
                        value={condUrl}
                        onChange={(e) => setCondUrl(e.target.value)}
                        onBlur={() => setConditionServerUrl(condUrl.trim())}
                        placeholder="http://localhost:3001"
                        className={INPUT_CLS}
                        style={{ padding: '10px 14px' }}
                      />
                      <span className="block text-[10px] text-(--color-text-dim)" style={{ marginTop: 6 }}>Defaults to localhost:3001 (local backend). Set a remote URL for server mode.</span>
                    </label>
                  </div>

                  {/* Error */}
                  {error && (
                    <p className="text-xs text-(--color-error) bg-(--color-error)/10 rounded-lg text-center" style={{ padding: '10px 16px' }}>{error}</p>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="flex justify-between items-center border-t border-(--color-border)/30" style={{ padding: '16px 24px' }}>
                <div />
                <div className="flex items-center" style={{ gap: 10 }}>
                  <button
                    onClick={() => setSettingsOpen(false)}
                    className="text-xs text-(--color-text-muted) hover:text-white transition-colors"
                    style={{ padding: '8px 16px' }}
                  >
                    Cancel
                  </button>

                  {connected ? (
                    <button
                      onClick={handleDisconnect}
                      disabled={loading}
                      className="text-xs font-medium rounded-lg bg-(--color-error)/20 text-(--color-error) hover:bg-(--color-error)/30 transition-all disabled:opacity-50"
                      style={{ padding: '8px 24px' }}
                    >
                      {loading ? 'Disconnecting...' : 'Disconnect'}
                    </button>
                  ) : (
                    <button
                      onClick={handleConnect}
                      disabled={loading || !userName || !apiKey}
                      className="text-xs font-medium rounded-lg bg-(--color-accent)/20 text-(--color-accent-text) hover:bg-(--color-accent)/30 transition-all disabled:opacity-50"
                      style={{ padding: '8px 24px' }}
                    >
                      {loading ? 'Connecting...' : 'Connect'}
                    </button>
                  )}
                </div>
              </div>
            </>
          )}

          {tab === 'database' && <DatabaseTab />}
          {tab === 'sound' && <SoundTab />}
          {tab === 'shortcuts' && <ShortcutsTab />}
          {tab === 'recording' && <RecordingTab />}
        </div>
    </Modal>
  );
}
