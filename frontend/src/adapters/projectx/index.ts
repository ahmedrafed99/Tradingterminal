import type { RealtimeAdapter } from '../types';
import { ProjectXRealtimeAdapter } from './realtimeAdapter';

export function createProjectXRealtimeAdapter(): RealtimeAdapter {
  return new ProjectXRealtimeAdapter();
}
