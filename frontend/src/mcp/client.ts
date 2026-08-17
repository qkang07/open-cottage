/**
 * MCP Client - 单 server 连接管理
 */

import {
  McpStreamableHttpTransport,
  McpTransportError,
  type McpToolDefinition,
  type McpToolResult,
  type McpTransportOptions,
} from './transport';

export type McpConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

export interface McpClientOptions extends McpTransportOptions {
  /** 连接失败时的策略 */
  onConnectionFail?: 'disable-server' | 'retry';
  /** 重连最大尝试次数，默认 3 */
  maxRetries?: number;
}

export interface McpServerInfo {
  name: string;
  version?: string;
  protocolVersion?: string;
}

export class McpClient {
  private transport: McpStreamableHttpTransport | null = null;
  private options: McpClientOptions;
  private status: McpConnectionStatus = 'disconnected';
  private cachedTools: McpToolDefinition[] = [];
  private serverInfo: McpServerInfo | null = null;
  private lastError: string | null = null;

  constructor(options: McpClientOptions) {
    this.options = options;
  }

  /** 获取连接状态 */
  getStatus(): McpConnectionStatus {
    return this.status;
  }

  /** 获取缓存的工具列表 */
  getTools(): McpToolDefinition[] {
    return this.cachedTools;
  }

  /** 获取服务器信息 */
  getServerInfo(): McpServerInfo | null {
    return this.serverInfo;
  }

  /** 获取最后错误 */
  getLastError(): string | null {
    return this.lastError;
  }

  /** 连接到 MCP 服务器 */
  async connect(): Promise<void> {
    if (this.status === 'connected') return;

    this.status = 'connecting';
    this.lastError = null;

    const maxRetries = this.options.maxRetries ?? 3;
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        this.transport = new McpStreamableHttpTransport({
          url: this.options.url,
          authHeader: this.options.authHeader,
          token: this.options.token,
          timeoutMs: this.options.timeoutMs,
        });

        const initResult = await this.transport.initialize();
        this.serverInfo = {
          name: initResult.serverInfo.name,
          version: initResult.serverInfo.version,
          protocolVersion: initResult.protocolVersion,
        };

        // 获取并缓存工具列表
        this.cachedTools = await this.transport.listTools();
        this.status = 'connected';
        return;
      } catch (error) {
        attempt++;
        const msg = error instanceof Error ? error.message : String(error);
        this.lastError = msg;

        if (
          attempt >= maxRetries ||
          this.options.onConnectionFail === 'disable-server'
        ) {
          this.status = 'error';
          this.transport = null;
          throw new McpTransportError(
            `MCP connection failed after ${attempt} attempt(s): ${msg}`,
          );
        }

        // 重试前等待
        await sleep(1000 * attempt);
      }
    }
  }

  /** 断开连接 */
  disconnect(): void {
    this.transport = null;
    this.status = 'disconnected';
    this.cachedTools = [];
    this.serverInfo = null;
    this.lastError = null;
  }

  /** 刷新工具列表 */
  async refreshTools(): Promise<McpToolDefinition[]> {
    if (!this.transport || this.status !== 'connected') {
      throw new McpTransportError('Not connected');
    }
    this.cachedTools = await this.transport.listTools();
    return this.cachedTools;
  }

  /** 调用工具 */
  async invokeTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<McpToolResult> {
    if (!this.transport || this.status !== 'connected') {
      throw new McpTransportError('Not connected to MCP server');
    }

    try {
      return await this.transport.callTool(name, args);
    } catch (error) {
      // 连接失败时标记状态
      if (error instanceof McpTransportError && error.code && error.code >= 500) {
        this.status = 'error';
        this.lastError = error.message;
      }
      throw error;
    }
  }

  /** 测试连接（轻量级 ping） */
  async testConnection(): Promise<boolean> {
    try {
      if (this.status !== 'connected') {
        await this.connect();
      }
      return this.status === 'connected';
    } catch {
      return false;
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
