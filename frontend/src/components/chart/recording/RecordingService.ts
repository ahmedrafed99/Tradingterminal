import { getChartEntry } from '../screenshot/chartRegistry';
import { paintOverlays } from '../screenshot/paintOverlays';
import { getReadyDirectoryHandle, pickDirectory } from './directoryHandle';

export type RecordingState = 'idle' | 'recording';

export interface RecordingOptions {
  withMic?: boolean;
}

const MAX_DURATION_MS = 60 * 60 * 1000; // 60 min auto-stop safeguard

class RecordingService {
  private _state: RecordingState = 'idle';
  private _startTime = 0;
  private _chartId = '';
  private _recorder: MediaRecorder | null = null;
  private _writable: FileSystemWritableFileStream | null = null;
  private _writeError: Error | null = null;
  private _rafId = 0;
  private _compositeCanvas: HTMLCanvasElement | null = null;
  private _micStream: MediaStream | null = null;
  private _autoStopTimer = 0;
  private _dirHandle: FileSystemDirectoryHandle | null = null;
  private _listeners = new Set<() => void>();

  get state(): RecordingState { return this._state; }
  get startTime(): number { return this._startTime; }

  /** Subscribe to state changes. Returns unsubscribe fn. */
  onChange(fn: () => void): () => void {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of this._listeners) fn();
  }

  async startRecording(chartId: string, options: RecordingOptions = {}): Promise<boolean> {
    if (this._state === 'recording') return false;

    // Get or prompt for directory handle
    let dirHandle = await getReadyDirectoryHandle();
    if (!dirHandle) {
      dirHandle = await pickDirectory();
      if (!dirHandle) return false;
    }
    this._dirHandle = dirHandle;

    const entry = getChartEntry(chartId);
    if (!entry?.containerEl) return false;

    const container = entry.containerEl;
    const canvases = container.querySelectorAll('canvas');
    if (canvases.length === 0) return false;

    // Open file for streaming writes immediately
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `recording-${timestamp}.webm`;
    try {
      const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
      this._writable = await fileHandle.createWritable();
    } catch (err) {
      console.error('[Recording] Failed to open file for writing:', err);
      return false;
    }

    // Size the composite to the full container (includes price + time scales)
    const composite = document.createElement('canvas');
    composite.width = container.clientWidth * devicePixelRatio;
    composite.height = container.clientHeight * devicePixelRatio;
    this._compositeCanvas = composite;

    const ctx = composite.getContext('2d')!;
    this._writeError = null;
    this._chartId = chartId;

    // rAF loop — draw all canvases at their positions + overlays
    const loop = () => {
      const currentEntry = getChartEntry(chartId);
      const el = currentEntry?.containerEl;
      if (!el || !currentEntry) {
        this._rafId = requestAnimationFrame(loop);
        return;
      }

      const w = el.clientWidth * devicePixelRatio;
      const h = el.clientHeight * devicePixelRatio;
      if (composite.width !== w || composite.height !== h) {
        composite.width = w;
        composite.height = h;
      }

      ctx.clearRect(0, 0, composite.width, composite.height);

      // Draw every canvas within the chart container at its correct position
      const containerRect = el.getBoundingClientRect();
      const allCanvases = el.querySelectorAll('canvas');
      for (const c of allCanvases) {
        const r = c.getBoundingClientRect();
        const x = (r.left - containerRect.left) * devicePixelRatio;
        const y = (r.top - containerRect.top) * devicePixelRatio;
        ctx.drawImage(c, x, y);
      }

      // Paint overlays on the plot area (scale for DPR so text renders at correct size)
      const dpr = devicePixelRatio;
      const plotWidth = currentEntry.chart.timeScale().width() * dpr;
      ctx.save();
      ctx.scale(dpr, dpr);
      paintOverlays(ctx, currentEntry, plotWidth, composite.height, { showPositions: true });
      ctx.restore();

      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);

    // Stream the composite canvas → MediaRecorder
    const videoStream = composite.captureStream(30);
    const combinedStream = new MediaStream(videoStream.getVideoTracks());

    // Optionally add mic audio
    if (options.withMic) {
      try {
        this._micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        for (const track of this._micStream.getAudioTracks()) {
          combinedStream.addTrack(track);
        }
      } catch {
        this._micStream = null;
      }
    }

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm;codecs=vp8';

    this._recorder = new MediaRecorder(combinedStream, { mimeType, videoBitsPerSecond: 2_500_000 });
    this._recorder.ondataavailable = (e) => {
      if (e.data.size > 0 && this._writable && !this._writeError) {
        this._writable.write(e.data).catch((err) => {
          this._writeError = err;
          console.error('[Recording] Write failed:', err);
        });
      }
    };
    this._recorder.start(1000);

    this._startTime = Date.now();
    this._state = 'recording';

    this._autoStopTimer = window.setTimeout(() => {
      this.stopRecording();
    }, MAX_DURATION_MS);

    this.notify();
    return true;
  }

  async stopRecording(): Promise<void> {
    if (this._state !== 'recording' || !this._recorder) return;

    cancelAnimationFrame(this._rafId);
    clearTimeout(this._autoStopTimer);

    if (this._micStream) {
      for (const track of this._micStream.getTracks()) track.stop();
      this._micStream = null;
    }

    // Wait for MediaRecorder to flush final chunks
    await new Promise<void>((resolve) => {
      this._recorder!.onstop = () => resolve();
      this._recorder!.stop();
    });

    // Close the file stream
    if (this._writable) {
      try {
        await this._writable.close();
      } catch (err) {
        console.error('[Recording] Failed to close file:', err);
      }
      this._writable = null;
    }

    if (this._writeError) {
      console.error('[Recording] Recording had write errors — file may be incomplete');
      this._writeError = null;
    }

    this._recorder = null;
    this._compositeCanvas = null;
    // Keep _dirHandle alive so next recording doesn't need re-pick
    this._state = 'idle';
    this._chartId = '';
    this.notify();
  }
}

export const recordingService = new RecordingService();
