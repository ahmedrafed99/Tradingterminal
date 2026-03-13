/**
 * Audio notification service for order fill events.
 * Preloads .mp3 voice clips from /sounds/ and exposes a simple play() API.
 * Settings (enabled, volume) are persisted in localStorage.
 */

const STORAGE_KEY = 'sound-settings';

export type SoundName = 'order_filled' | 'target_filled' | 'stop_filled';

interface SoundSettings {
  enabled: boolean;
  volume: number; // 0–1
}

const DEFAULT_SETTINGS: SoundSettings = { enabled: true, volume: 0.8 };

class AudioService {
  private audioElements = new Map<SoundName, HTMLAudioElement>();
  private settings: SoundSettings;

  constructor() {
    this.settings = this.loadSettings();
    this.preload();
  }

  private loadSettings(): SoundSettings {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_SETTINGS.enabled,
          volume: typeof parsed.volume === 'number' ? parsed.volume : DEFAULT_SETTINGS.volume,
        };
      }
    } catch { /* ignore */ }
    return { ...DEFAULT_SETTINGS };
  }

  private saveSettings(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
  }

  private preload(): void {
    const sounds: SoundName[] = ['order_filled', 'target_filled', 'stop_filled'];
    for (const name of sounds) {
      const audio = new Audio(`/sounds/${name}.mp3`);
      audio.preload = 'auto';
      audio.volume = this.settings.volume;
      this.audioElements.set(name, audio);
    }
  }

  play(name: SoundName): void {
    if (!this.settings.enabled) return;
    const audio = this.audioElements.get(name);
    if (!audio) return;
    // Reset to start so rapid replays work
    audio.currentTime = 0;
    audio.volume = this.settings.volume;
    audio.play().catch(() => {
      // Browser may block autoplay until user interaction — silently ignore
    });
  }

  getEnabled(): boolean {
    return this.settings.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.settings.enabled = enabled;
    this.saveSettings();
  }

  getVolume(): number {
    return this.settings.volume;
  }

  setVolume(volume: number): void {
    this.settings.volume = Math.max(0, Math.min(1, volume));
    for (const audio of this.audioElements.values()) {
      audio.volume = this.settings.volume;
    }
    this.saveSettings();
  }
}

export const audioService = new AudioService();
