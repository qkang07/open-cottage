type Listener = () => void;

export const subscribeIndexActivity = (_listener: Listener): (() => void) => () => {};
export const isMainThreadFullIndexing = (): boolean => false;
export const isIncrementalIndexing = (): boolean => false;
export const getIncrementalIndexDetail = (): string | null => null;
export const isIndexing = (): boolean => false;
export const abortIndexing = (): void => {};
export const resetIndexWorker = (): void => {};

