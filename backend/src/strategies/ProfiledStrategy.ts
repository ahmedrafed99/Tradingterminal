import type { ILiveStrategy, LiveStrategyConfig, LiveStrategyInfo } from './ILiveStrategy';

interface Profile {
  id: string;
  name: string;
  description: string;
}

/**
 * Wraps any ILiveStrategy and overrides its identity (id / name / description)
 * so the same underlying implementation can be registered multiple times under
 * different names.
 */
export class ProfiledStrategy implements ILiveStrategy {
  onBroadcast: ((info: LiveStrategyInfo) => void) | undefined;

  constructor(private profile: Profile, private inner: ILiveStrategy) {
    // Intercept broadcasts from the inner strategy and patch the identity fields.
    this.inner.onBroadcast = (info) => {
      this.onBroadcast?.(this._patch(info));
    };
  }

  get id(): string { return this.profile.id; }
  get name(): string { return this.profile.name; }
  get description(): string { return this.profile.description; }

  start(config: LiveStrategyConfig): Promise<void> {
    return this.inner.start(config);
  }

  stop(): Promise<void> {
    return this.inner.stop();
  }

  getInfo(): LiveStrategyInfo {
    return this._patch(this.inner.getInfo());
  }

  private _patch(info: LiveStrategyInfo): LiveStrategyInfo {
    return { ...info, id: this.profile.id, name: this.profile.name, description: this.profile.description };
  }
}