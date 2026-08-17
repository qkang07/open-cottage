import type { CottageServiceClient } from '../cottageService/client';
import type { ScriptToolInvoker } from './runScript';

export const STREAMING_TOOL_NAMES = new Set([
  'runScript',
  'fetchWebPage',
  'generateImage',
  'editImage',
]);

export type ToolStreamChunk =
  | { type: 'delta'; text: string }
  | { type: 'done'; value: unknown };

export interface ToolStreamContext {
  cottageServiceClient?: CottageServiceClient;
  cottageServiceCapabilities?: string[];
  /** cottage.* SDK 的工具执行桥（runScript 脚本内调用 agent 工具） */
  scriptToolInvoker?: ScriptToolInvoker;
  /** 当前正在执行的工具 callId（供脚本桥将 cottage.* 子调用归属到宿主 runScript） */
  currentCallId?: string;
}

export const supportsToolStream = (toolName: string): boolean =>
  STREAMING_TOOL_NAMES.has(toolName);
