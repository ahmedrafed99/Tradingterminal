import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store/useStore';
import { CustomSelect } from '../shared/CustomSelect';

const SECTION_TITLE = 'text-xs font-medium text-(--color-text) uppercase tracking-wider';

export function CopyTradingTab() {
  const {
    accounts, copyEnabled, copyMasterAccountId, copyFollowerIds,
    setCopyEnabled, setCopyMasterAccountId, setCopyFollowerIds,
  } = useStore(useShallow((s) => ({
    accounts: s.accounts,
    copyEnabled: s.copyEnabled,
    copyMasterAccountId: s.copyMasterAccountId,
    copyFollowerIds: s.copyFollowerIds,
    setCopyEnabled: s.setCopyEnabled,
    setCopyMasterAccountId: s.setCopyMasterAccountId,
    setCopyFollowerIds: s.setCopyFollowerIds,
  })));

  const [selectedMaster, setSelectedMaster] = useState<string>(copyMasterAccountId ?? accounts[0]?.id ?? '');
  const [selectedFollower, setSelectedFollower] = useState<string>(copyFollowerIds[0] ?? '');

  const followerOptions = accounts
    .filter((a) => a.id !== selectedMaster)
    .map((a) => ({ value: a.id, label: a.name }));

  function handleMasterChange(accountId: string) {
    setSelectedMaster(accountId);
    // Clear follower if it's the same as new master
    if (selectedFollower === accountId) setSelectedFollower('');
    setCopyMasterAccountId(accountId);
    if (copyEnabled) {
      const newFollower = selectedFollower === accountId ? '' : selectedFollower;
      setCopyFollowerIds(newFollower ? [newFollower] : []);
    }
  }

  function handleFollowerChange(accountId: string) {
    setSelectedFollower(accountId);
    setCopyFollowerIds([accountId]);
  }

  function handleToggle() {
    const newEnabled = !copyEnabled;
    setCopyEnabled(newEnabled);
    if (newEnabled) {
      setCopyMasterAccountId(selectedMaster);
      setCopyFollowerIds(selectedFollower ? [selectedFollower] : []);
    }
  }

  const canEnable = selectedMaster && selectedFollower && selectedMaster !== selectedFollower;

  const accountOptions = accounts.map((a) => ({
    value: a.id,
    label: a.name,
  }));

  return (
    <div style={{ padding: '20px 24px 24px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {accounts.length < 2 && (
          <p className="text-xs text-(--color-text-muted) bg-(--color-border)/20 rounded-lg text-center" style={{ padding: '10px 16px' }}>
            Copy trading requires at least 2 connected accounts.
          </p>
        )}

        {accounts.length >= 2 && (
          <>
            {/* MASTER ACCOUNT */}
            <div>
              <div className={SECTION_TITLE} style={{ marginBottom: 10 }}>Master Account</div>
              <CustomSelect
                value={selectedMaster}
                options={accountOptions}
                onChange={handleMasterChange}
                style={{ width: '100%' }}
              />
              <p className="text-[11px] text-(--color-text-muted)" style={{ marginTop: 6 }}>
                Trades on this account will be copied to the follower.
              </p>
            </div>

            {/* FOLLOWER ACCOUNT */}
            <div>
              <div className={SECTION_TITLE} style={{ marginBottom: 10 }}>Follower Account</div>
              {followerOptions.length > 0 ? (
                <CustomSelect
                  value={selectedFollower}
                  options={followerOptions}
                  onChange={handleFollowerChange}
                  style={{ width: '100%' }}
                />
              ) : (
                <p className="text-xs text-(--color-text-muted)">Select a master account first.</p>
              )}
              <p className="text-[11px] text-(--color-text-muted)" style={{ marginTop: 6 }}>
                This account will mirror all trades from the master.
              </p>
            </div>

            {/* ENABLE / DISABLE */}
            <div className="flex items-center justify-between">
              <div>
                <div className={SECTION_TITLE}>Status</div>
                <span className="text-sm text-(--color-text)" style={{ marginTop: 4, display: 'block' }}>
                  {copyEnabled ? 'Active' : 'Inactive'}
                </span>
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <span className={`text-xs ${copyEnabled ? 'text-(--color-buy)' : 'text-(--color-text-muted)'}`}>
                  {copyEnabled ? 'On' : 'Off'}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={copyEnabled}
                  onClick={handleToggle}
                  disabled={!canEnable && !copyEnabled}
                  className="relative inline-flex items-center rounded-full transition-colors disabled:opacity-50"
                  style={{
                    width: 36,
                    height: 20,
                    background: copyEnabled ? 'var(--color-buy)' : 'var(--color-border)',
                  }}
                >
                  <span
                    className="block rounded-full bg-white transition-transform"
                    style={{
                      width: 16,
                      height: 16,
                      transform: copyEnabled ? 'translateX(18px)' : 'translateX(2px)',
                    }}
                  />
                </button>
              </label>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
