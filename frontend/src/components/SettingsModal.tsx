import { useState, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { authService } from '../services/authService';
import { accountService } from '../services/accountService';
import { realtimeService } from '../services/realtimeService';
import { credentialService } from '../services/credentialService';
import type { CredentialProfile } from '../services/credentialService';
import { useStore } from '../store/useStore';
import type { ConnectionProfile } from '../store/slices/connectionSlice';
import { DatabaseTab } from './settings/DatabaseTab';
import { SoundTab } from './settings/SoundTab';
import { ShortcutsTab } from './settings/ShortcutsTab';
import { RecordingTab } from './settings/RecordingTab';
import { CopyTradingTab } from './settings/CopyTradingTab';
import { TradingTab } from './settings/TradingTab';
import { Modal } from './shared/Modal';
import { Checkbox } from './shared/Checkbox';
import { Button } from './shared/Button';

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

const INPUT_CLS = 'w-full bg-(--color-input) border border-(--color-border) rounded-lg text-sm text-(--color-text-bright) placeholder-(--color-text-dim) focus:outline-none focus:border-(--color-accent)/50 transition-all disabled:opacity-50';

export function SettingsModal() {
  const {
    settingsOpen, setSettingsOpen, settingsInitialTab, setSettingsInitialTab,
    connections, addConnection, removeConnection, updateConnection,
    setAccounts,
    conditionServerUrl, setConditionServerUrl,
    rememberCredentials, setRememberCredentials,
  } = useStore(useShallow((s) => ({
    settingsOpen: s.settingsOpen,
    setSettingsOpen: s.setSettingsOpen,
    settingsInitialTab: s.settingsInitialTab,
    setSettingsInitialTab: s.setSettingsInitialTab,
    connections: s.connections,
    addConnection: s.addConnection,
    removeConnection: s.removeConnection,
    updateConnection: s.updateConnection,
    setAccounts: s.setAccounts,
    conditionServerUrl: s.conditionServerUrl,
    setConditionServerUrl: s.setConditionServerUrl,
    rememberCredentials: s.rememberCredentials,
    setRememberCredentials: s.setRememberCredentials,
  })));

  const [tab, setTab] = useState<SettingsTab>('datafeed');
  const [condUrl, setCondUrl] = useState(conditionServerUrl);
  const [addOpen, setAddOpen] = useState(false);

  // Add-connection form state
  const [newUserName, setNewUserName] = useState('');
  const [newApiKey, setNewApiKey]     = useState('');
  const [newLabel, setNewLabel]       = useState('');
  const [newUrl, setNewUrl]           = useState(DEFAULT_BASE_URL);
  const [adding, setAdding]           = useState(false);
  const [addError, setAddError]       = useState<string | null>(null);

  // Per-connection action loading state
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  useEffect(() => { setCondUrl(conditionServerUrl); }, [conditionServerUrl]);

  useEffect(() => {
    if (settingsOpen && settingsInitialTab) {
      setTab(settingsInitialTab as SettingsTab);
      setSettingsInitialTab(null);
    }
  }, [settingsOpen, settingsInitialTab]);

  if (!settingsOpen) return null;

  function resetAddForm() {
    setNewUserName('');
    setNewApiKey('');
    setNewLabel('');
    setNewUrl(DEFAULT_BASE_URL);
    setAddError(null);
    setAddOpen(false);
  }

  async function handleConnect() {
    setAddError(null);
    setAdding(true);
    const id = newUserName.trim();
    updateConnection(id, { status: 'connecting' });
    addConnection({ id, userName: id, label: newLabel.trim() || undefined, baseUrl: newUrl.trim() || DEFAULT_BASE_URL, status: 'connecting' });
    try {
      await authService.connect(id, newApiKey.trim(), newUrl.trim() || undefined);
      updateConnection(id, { status: 'connected' });
      if (rememberCredentials) {
        const profile: CredentialProfile = { id, userName: id, apiKey: newApiKey.trim(), baseUrl: newUrl.trim() || DEFAULT_BASE_URL, label: newLabel.trim() || undefined };
        await credentialService.save(profile);
      }
      const accounts = await accountService.searchAccounts();
      setAccounts(accounts);
      resetAddForm();
    } catch (err) {
      updateConnection(id, { status: 'error', errorMessage: err instanceof Error ? err.message : 'Connection failed' });
      setAddError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setAdding(false);
    }
  }

  async function handleDisconnect(conn: ConnectionProfile) {
    setActionLoading((p) => ({ ...p, [conn.id]: true }));
    try {
      await authService.disconnect(conn.id);
      // Only close the browser WS if no other connections remain
      const remaining = connections.filter((c) => c.id !== conn.id && c.status === 'connected');
      if (remaining.length === 0) {
        await realtimeService.disconnect().catch(() => {});
      }
    } catch { /* ignore */ } finally {
      removeConnection(conn.id);
      const accounts = await accountService.searchAccounts().catch(() => []);
      setAccounts(accounts);
      setActionLoading((p) => ({ ...p, [conn.id]: false }));
    }
  }

  async function handleReconnect(conn: ConnectionProfile) {
    setActionLoading((p) => ({ ...p, [conn.id]: true }));
    updateConnection(conn.id, { status: 'connecting', errorMessage: undefined });
    try {
      const profiles = await credentialService.loadAll();
      const saved = profiles.find((p) => p.id === conn.id);
      if (!saved) throw new Error('No saved credentials for this connection');
      await authService.connect(saved.userName, saved.apiKey, saved.baseUrl);
      updateConnection(conn.id, { status: 'connected', errorMessage: undefined });
      const accounts = await accountService.searchAccounts();
      setAccounts(accounts);
    } catch (err) {
      updateConnection(conn.id, { status: 'error', errorMessage: err instanceof Error ? err.message : 'Failed' });
    } finally {
      setActionLoading((p) => ({ ...p, [conn.id]: false }));
    }
  }

  async function handleRemove(conn: ConnectionProfile) {
    setActionLoading((p) => ({ ...p, [conn.id]: true }));
    try {
      if (conn.status === 'connected') {
        await authService.disconnect(conn.id).catch(() => {});
      }
      await credentialService.remove(conn.id).catch(() => {});
    } finally {
      removeConnection(conn.id);
      const accounts = await accountService.searchAccounts().catch(() => []);
      setAccounts(accounts);
      setActionLoading((p) => ({ ...p, [conn.id]: false }));
    }
  }

  return (
    <Modal
      onClose={() => setSettingsOpen(false)}
      backdropClassName="!items-start"
      className="w-screen h-screen flex flex-col bg-(--color-surface) border-x border-(--color-border) shadow-2xl overflow-hidden"
      style={{ marginTop: 0 }}
      title="Settings"
      headerStyle={{ padding: '12px 24px' }}
    >

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
          <div className="overflow-y-auto flex-1 scrollbar-thin">

            {tab === 'datafeed' && (
              <div style={{ padding: '24px 32px', maxWidth: 720 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

                  {/* Connections list */}
                  <div>
                    <div className="text-xs font-medium text-(--color-text) uppercase tracking-wider" style={{ marginBottom: 12 }}>Connections</div>

                    {connections.length === 0 ? (
                      <p className="text-sm text-(--color-text-dim)" style={{ padding: '12px 0' }}>No connections. Add one below.</p>
                    ) : (
                      <div className="border border-(--color-border) rounded-lg overflow-hidden">
                        {connections.map((conn, i) => {
                          const isLast = i === connections.length - 1;
                          const busy = actionLoading[conn.id] ?? false;
                          const dotCls = conn.status === 'connected'
                            ? 'bg-emerald-400'
                            : conn.status === 'connecting'
                            ? 'bg-yellow-400 animate-pulse'
                            : conn.status === 'error'
                            ? 'bg-red-400'
                            : 'bg-(--color-text-dim)';
                          return (
                            <div
                              key={conn.id}
                              className={`flex items-center gap-3 ${!isLast ? 'border-b border-(--color-border)' : ''}`}
                              style={{ padding: '10px 14px' }}
                            >
                              <span className={`shrink-0 w-2 h-2 rounded-full ${dotCls}`} />
                              <div className="flex-1 min-w-0">
                                <span className="text-sm text-(--color-text-bright) font-medium">
                                  {conn.label ? `${conn.label}` : conn.userName}
                                  {conn.label && <span className="text-(--color-text-dim) font-normal"> ({conn.userName})</span>}
                                </span>
                                <span className="text-xs text-(--color-text-dim) ml-3">{conn.baseUrl.replace('https://', '')}</span>
                                {conn.errorMessage && (
                                  <span className="text-xs text-(--color-error) ml-3">{conn.errorMessage}</span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {conn.status === 'connected' ? (
                                  <Button variant="ghost" tone="danger" onClick={() => handleDisconnect(conn)} disabled={busy}>
                                    {busy ? '…' : 'Disconnect'}
                                  </Button>
                                ) : (
                                  <Button variant="ghost" onClick={() => handleReconnect(conn)} disabled={busy}>
                                    {busy ? '…' : 'Connect'}
                                  </Button>
                                )}
                                <Button variant="ghost" tone="danger" onClick={() => handleRemove(conn)} disabled={busy} style={{ padding: '4px 8px' }}>
                                  ✕
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Add Connection toggle */}
                  <div>
                    {!addOpen ? (
                      <Button variant="ghost" onClick={() => setAddOpen(true)}>
                        + Add Connection
                      </Button>
                    ) : (
                      <div className="border border-(--color-border) rounded-lg" style={{ padding: '20px' }}>
                        <div className="text-xs font-medium text-(--color-text) uppercase tracking-wider" style={{ marginBottom: 14 }}>New Connection</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                          <label className="block">
                            <span className="block text-xs text-(--color-text-medium)" style={{ marginBottom: 6 }}>Username</span>
                            <input
                              type="text"
                              value={newUserName}
                              onChange={(e) => setNewUserName(e.target.value)}
                              disabled={adding}
                              placeholder="your-projectx-username"
                              className={INPUT_CLS}
                              style={{ padding: '10px 14px' }}
                            />
                          </label>
                          <label className="block">
                            <span className="block text-xs text-(--color-text-medium)" style={{ marginBottom: 6 }}>API Key</span>
                            <input
                              type="password"
                              value={newApiKey}
                              onChange={(e) => setNewApiKey(e.target.value)}
                              disabled={adding}
                              placeholder="••••••••••••••••"
                              className={INPUT_CLS}
                              style={{ padding: '10px 14px' }}
                            />
                          </label>
                          <label className="block">
                            <span className="block text-xs text-(--color-text-medium)" style={{ marginBottom: 6 }}>Label <span className="text-(--color-text-dim)">(optional)</span></span>
                            <input
                              type="text"
                              value={newLabel}
                              onChange={(e) => setNewLabel(e.target.value)}
                              disabled={adding}
                              placeholder="50K Combine"
                              className={INPUT_CLS}
                              style={{ padding: '10px 14px' }}
                            />
                          </label>
                          <label className="block">
                            <span className="block text-xs text-(--color-text-medium)" style={{ marginBottom: 6 }}>Gateway URL</span>
                            <input
                              type="text"
                              value={newUrl}
                              onChange={(e) => setNewUrl(e.target.value)}
                              disabled={adding}
                              placeholder={DEFAULT_BASE_URL}
                              className={INPUT_CLS}
                              style={{ padding: '10px 14px' }}
                            />
                          </label>
                        </div>
                        <div style={{ marginBottom: 14 }}>
                          <Checkbox
                            checked={rememberCredentials}
                            onChange={(on) => setRememberCredentials(on)}
                            label="Remember credentials"
                            className="text-xs"
                          />
                        </div>
                        <div className="flex items-center justify-end" style={{ gap: 10 }}>
                          <button
                            onClick={resetAddForm}
                            disabled={adding}
                            className="text-sm text-(--color-text-muted) hover:text-white transition-colors"
                            style={{ padding: '8px 16px' }}
                          >
                            Cancel
                          </button>
                          <Button
                            variant="filled"
                            onClick={handleConnect}
                            disabled={adding || !newUserName || !newApiKey}
                          >
                            {adding ? 'Connecting…' : 'Connect'}
                          </Button>
                        </div>
                        {addError && (
                          <p className="text-xs text-(--color-error) bg-(--color-error)/10 rounded-lg" style={{ padding: '10px 16px', marginTop: 12 }}>{addError}</p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Condition server URL */}
                  <div>
                    <div className="text-xs font-medium text-(--color-text) uppercase tracking-wider" style={{ marginBottom: 10 }}>Condition Server</div>
                    <label className="block" style={{ maxWidth: 340 }}>
                      <span className="block text-xs text-(--color-text-medium)" style={{ marginBottom: 6 }}>URL</span>
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
                    <span className="block text-[11px] text-(--color-text-muted)" style={{ marginTop: 6 }}>Defaults to localhost:3001. Set a remote URL for server mode.</span>
                  </div>

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
        </div>
      </div>
    </Modal>
  );
}
