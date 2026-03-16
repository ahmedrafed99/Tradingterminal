import { useState, useEffect, useRef, useCallback } from 'react';
import { recordingService, type RecordingState, type RecordingOptions } from './RecordingService';

export function useRecording() {
  const [state, setState] = useState<RecordingState>(recordingService.state);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef(0);

  useEffect(() => {
    return recordingService.onChange(() => {
      setState(recordingService.state);
    });
  }, []);

  // Elapsed timer — ticks every second while recording
  useEffect(() => {
    if (state === 'recording') {
      const tick = () => {
        setElapsed(Math.floor((Date.now() - recordingService.startTime) / 1000));
      };
      tick();
      timerRef.current = window.setInterval(tick, 1000);
      return () => clearInterval(timerRef.current);
    } else {
      setElapsed(0);
    }
  }, [state]);

  const start = useCallback(async (chartId: string, options?: RecordingOptions) => {
    return recordingService.startRecording(chartId, options);
  }, []);

  const stop = useCallback(() => {
    return recordingService.stopRecording();
  }, []);

  return {
    isRecording: state === 'recording',
    elapsed,
    start,
    stop,
  };
}
