import { getCottageConfig } from '../../config/store';
import { buildSymbolIndex } from './indexer';

let running = false;
let lastError: string | null = null;
let lastCompletedAt: number | null = null;

export const getSymbolIndexBackgroundState = () => ({
  running,
  lastError,
  lastCompletedAt,
});

export const scheduleBackgroundSymbolIndex = (): void => {
  const config = getCottageConfig();
  if (config.codingIndex?.enabled === false) return;
  if (config.codingIndex?.autoOnOpen === false) return;
  if (running) return;
  void startBackgroundSymbolIndex();
};

export const startBackgroundSymbolIndex = async (): Promise<void> => {
  if (running) return;
  running = true;
  lastError = null;
  try {
    await buildSymbolIndex();
    lastCompletedAt = Date.now();
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  } finally {
    running = false;
  }
};
