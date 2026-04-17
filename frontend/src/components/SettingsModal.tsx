import { useState, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { authService } from '../services/authService';
import { accountService } from '../services/accountService';
import { realtimeService } from '../services/realtimeService';
import { credentialService } from '../services/credentialService';
import { useStore } from '../store/useStore';
import { DatabaseTab } from './settings/DatabaseTab';
import { SoundTab } from './settings/SoundTab';
import { ShortcutsTab } from './settings/ShortcutsTab';
import { RecordingTab } from './settings/RecordingTab';
import { CopyTradingTab } from './settings/CopyTradingTab';
import { TradingTab } from './settings/TradingTab';
import { Modal } from './shared/Modal';
import { CustomSelect } from './shared/CustomSelect';

const DEFAULT_BASE_URL = 'https://api.topstepx.com';

type SettingsTab = 'datafeed' | 'database' | 'sound' | 'shortcuts' | 'recording' | 'copytrading' | 'trading';

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'datafeed', label: 'Data Feed' },
  { id: 'database', label: 'Database' },
  { id: 'sound', label: 'Sound' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'recording', label: 'Recording' },
  { id: 'copytrading', label: 'Copy Trading' },
  { id: 'trading', label: 'Trading' },
];

const DATA_FEED_PROVIDERS = [
  { id: 'topstepx', label: 'TopstepX by ProjectX' },
];

const INPUT_CLS = 'w-full bg-(--color-input) border border-(--color-border) rounded-lg text-sm text-(--color-text-bright) placeholder-(--color-text-dim) focus:outline-none focus:border-(--color-accent)/50 transition-all disabled:opacity-50';

export function SettingsModal() {
  const { settingsOpen, setSettingsOpen, connected, baseUrl, setConnected, setAccounts, conditionServerUrl, setConditionServerUrl, rememberCredentials, setRememberCredentials } = useStore(useShallow((s) => ({
    settingsOpen: s.settingsOpen,
    setSettingsOpen: s.setSettingsOpen,
    connected: s.connected,
    baseUrl: s.baseUrl,
    setConnected: s.setConnected,
    setAccounts: s.setAccounts,
    conditionServerUrl: s.conditionServerUrl,
    setConditionServerUrl: s.setConditionServerUrl,
    rememberCredentials: s.rememberCredentials,
    setRememberCredentials: s.setRememberCredentials,
  })));

  const [tab, setTab] = useState<SettingsTab>('datafeed');
  const [provider, setProvider] = useState('topstepx');
  const [userName, setUserName] = useState('');
  const [apiKey, setApiKey]     = useState('');
  const [url, setUrl]           = useState(baseUrl || DEFAULT_BASE_URL);
  const [condUrl, setCondUrl]    = useState(conditionServerUrl);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => { setUrl(baseUrl || DEFAULT_BASE_URL); }, [baseUrl]);
  useEffect(() => { setCondUrl(conditionServerUrl); }, [conditionServerUrl]);

  useEffect(() => {
    if (settingsOpen && rememberCredentials) {
      credentialService.load().then((creds) => {
        if (creds) {
          setUserName(creds.userName);
          setApiKey(creds.apiKey);
        }
      }).catch(() => {});
    }
  }, [settingsOpen]);

  if (!settingsOpen) return null;

  async function handleConnect() {
    setError(null);
    setLoading(true);
    try {
      await authService.connect(userName.trim(), apiKey.trim(), url.trim() || undefined);
      setConnected(true, url.trim() || undefined);
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
      setConnected(false);
      setAccounts([]);
      setLoading(false);
    }
  }

  return (
    <Modal
      onClose={() => setSettingsOpen(false)}
      backdropClassName="!items-start"
      className="w-screen h-screen flex flex-col bg-(--color-surface) border-x border-(--color-border) shadow-2xl overflow-hidden"
      style={{ marginTop: 0 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-(--color-border)/30 shrink-0" style={{ padding: '16px 24px' }}>
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

      {/* Body: sidebar + content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="border-r border-(--color-border)/30 shrink-0 overflow-y-auto" style={{ width: 180, padding: '12px 8px' }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`w-full text-left text-sm font-medium rounded-lg transition-colors cursor-pointer ${
                tab === t.id
                  ? 'bg-(--color-accent)/15 text-white'
                  : 'text-(--color-text) hover:text-white hover:bg-(--color-border)/20'
              }`}
              style={{ padding: '8px 12px', marginBottom: 2 }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="overflow-y-auto flex-1">

            {tab === 'datafeed' && (
              <div style={{ padding: '24px 32px', maxWidth: 720 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

                  {/* Provider + Status row */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'end' }}>
                    <div>
                      <div className="text-xs font-medium text-(--color-text) uppercase tracking-wider" style={{ marginBottom: 10 }}>Provider</div>
                      <CustomSelect
                        value={provider}
                        options={DATA_FEED_PROVIDERS.map((p) => ({ value: p.id, label: p.label }))}
                        onChange={(v) => setProvider(v)}
                        disabled={connected || loading}
                        style={{ width: '100%' }}
                      />
                    </div>
                    <div className="flex items-center" style={{ gap: 8, paddingBottom: 10 }}>
                      <span className={`inline-block w-2 h-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-400'}`} />
                      <span className="text-sm text-(--color-text)">
                        {connected ? 'Connected' : 'Disconnected'}
                      </span>
                    </div>
                  </div>

                  {/* Credentials — 2-col */}
                  <div>
                    <div className="text-xs font-medium text-(--color-text) uppercase tracking-wider" style={{ marginBottom: 10 }}>Credentials</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <label className="block">
                        <span className="block text-xs text-(--color-text-medium)" style={{ marginBottom: 6 }}>Username</span>
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
                        <span className="block text-xs text-(--color-text-medium)" style={{ marginBottom: 6 }}>API Key</span>
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
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer select-none" style={{ marginTop: 10 }}>
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
                      <span className="text-xs text-(--color-text)">Remember credentials</span>
                    </label>
                  </div>

                  {/* URLs — 2-col */}
                  <div>
                    <div className="text-xs font-medium text-(--color-text) uppercase tracking-wider" style={{ marginBottom: 10 }}>Endpoints</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <label className="block">
                        <span className="block text-xs text-(--color-text-medium)" style={{ marginBottom: 6 }}>Gateway URL</span>
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
                      <label className="block">
                        <span className="block text-xs text-(--color-text-medium)" style={{ marginBottom: 6 }}>Condition Server URL</span>
                        <input
                          type="text"
                          value={condUrl}
                          onChange={(e) => setCondUrl(e.target.value)}
                          onBlur={() => setConditionServerUrl(condUrl.trim())}
                          placeholder="http://localhost:3001"
                          className={INPUT_CLS}
                          style={{ padding: '10px 14px' }}
                        />
                      </label>
                    </div>
                    <span className="block text-[11px] text-(--color-text-muted)" style={{ marginTop: 6 }}>Condition server defaults to localhost:3001. Set a remote URL for server mode.</span>
                  </div>

                  {error && (
                    <p className="text-xs text-(--color-error) bg-(--color-error)/10 rounded-lg" style={{ padding: '10px 16px' }}>{error}</p>
                  )}
                </div>
              </div>
            )}

            {tab !== 'datafeed' && (
              <div style={{ maxWidth: 720, padding: '24px 32px' }}>
                {tab === 'database' && <DatabaseTab />}
                {tab === 'sound' && <SoundTab />}
                {tab === 'shortcuts' && <ShortcutsTab />}
                {tab === 'recording' && <RecordingTab />}
                {tab === 'copytrading' && <CopyTradingTab />}
                {tab === 'trading' && <TradingTab />}
              </div>
            )}
          </div>

          {/* Footer — only for datafeed tab */}
          {tab === 'datafeed' && (
            <div className="flex justify-end items-center border-t border-(--color-border)/30 shrink-0" style={{ padding: '14px 32px', gap: 10 }}>
              <button
                onClick={() => setSettingsOpen(false)}
                className="text-sm text-(--color-text-muted) hover:text-white transition-colors"
                style={{ padding: '8px 16px' }}
              >
                Cancel
              </button>
              {connected ? (
                <button
                  onClick={handleDisconnect}
                  disabled={loading}
                  className="text-sm font-medium rounded-lg bg-(--color-error)/20 text-(--color-error) hover:bg-(--color-error)/30 transition-all disabled:opacity-50"
                  style={{ padding: '8px 24px' }}
                >
                  {loading ? 'Disconnecting...' : 'Disconnect'}
                </button>
              ) : (
                <button
                  onClick={handleConnect}
                  disabled={loading || !userName || !apiKey}
                  className="text-sm font-medium rounded-lg bg-(--color-accent)/20 text-(--color-accent-text) hover:bg-(--color-accent)/30 transition-all disabled:opacity-50"
                  style={{ padding: '8px 24px' }}
                >
                  {loading ? 'Connecting...' : 'Connect'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
