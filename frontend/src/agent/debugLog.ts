export interface DebugLogEntry {
  id: string;
  timestamp: number;
  type: 'request' | 'response' | 'stream_chunk' | 'tool_call' | 'tool_result' | 'error' | 'info';
  direction: 'out' | 'in';
  label: string;
  data: unknown;
}
