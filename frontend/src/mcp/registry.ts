/**
 * MCP Registry - 管理多个 MCP Server 连接
 */

import type { CottageTool } from '@/agent/runtime/tool';
import type { McpServerConfig } from '../config/constants';
import type { ProviderSecrets } from '../config/secrets';
import { McpClient, type McpConnectionStatus } from './client';
import { mcpToolToCottage } from './toolAdapter';

export interface McpServerStatus {
  id: string;
  name: string;
  url: string;
  status: McpConnectionStatus;
  toolCount: number;
  error: string | null;
}

class McpRegistryImpl {
  private clients = new Map<string, McpClient>();

  /** 设置 secrets 引用（由外部加载后注入） */
  private secrets: ProviderSecrets = {};

  setSecrets(secrets: ProviderSecrets): void {
    this.secrets = secrets;
  }

  /** 获取已启用的 server 列表及状态 */
  getServerStatuses(): McpServerStatus[] {
    const statuses: McpServerStatus[] = [];
    for (const [id, client] of this.clients) {
      statuses.push({
        id,
        name: client.getServerInfo()?.name ?? id,
        url: '', // will be filled by caller if needed
        status: client.getStatus(),
        toolCount: client.getTools().length,
        error: client.getLastError(),
      });
    }
    return statuses;
  }

  /** 连接一个 MCP server */
  async connectServer(config: McpServerConfig): Promise<void> {
    // 如果已连接，先断开
    this.disconnectServer(config.id);

    const mcpSecrets = this.secrets.mcp ?? {};
    const token = mcpSecrets[config.id]?.token;

    const client = new McpClient({
      url: config.url,
      authHeader: config.authHeader,
      token,
      timeoutMs: 30_000,
      onConnectionFail: 'disable-server',
    });

    this.clients.set(config.id, client);
    await client.connect();
  }

  /** 断开 server */
  disconnectServer(id: string): void {
    const client = this.clients.get(id);
    if (client) {
      client.disconnect();
      this.clients.delete(id);
    }
  }

  /** 断开所有 */
  disconnectAll(): void {
    for (const [id] of this.clients) {
      this.disconnectServer(id);
    }
  }

  /** 获取已连接且有工具的 server IDs */
  enabledServerIds(): string[] {
    return [...this.clients.entries()]
      .filter(([_, client]) => client.getStatus() === 'connected')
      .map(([id]) => id);
  }

  /** 获取所有已启用 server 的 Cottage 工具 */
  getAllTools(): CottageTool[] {
    const tools: CottageTool[] = [];

    for (const [serverId, client] of this.clients) {
      if (client.getStatus() !== 'connected') continue;

      for (const mcpTool of client.getTools()) {
        const tool = mcpToolToCottage(
          serverId,
          mcpTool,
          (name, args) => client.invokeTool(name, args),
        );
        tools.push(tool);
      }
    }

    return tools;
  }

  /** 获取指定 server 的工具列表 */
  getServerTools(serverId: string): CottageTool[] {
    const client = this.clients.get(serverId);
    if (!client || client.getStatus() !== 'connected') return [];

    return client.getTools().map((mcpTool) =>
      mcpToolToCottage(
        serverId,
        mcpTool,
        (name, args) => client.invokeTool(name, args),
      ),
    );
  }

  /** 连接多个 server（并行） */
  async connectServers(configs: McpServerConfig[]): Promise<void> {
    const enabled = configs.filter((c) => c.enabled !== false);
    await Promise.allSettled(enabled.map((c) => this.connectServer(c)));
  }

  /** 测试单个 server 连接 */
  async testServer(config: McpServerConfig): Promise<boolean> {
    const mcpSecrets = this.secrets.mcp ?? {};
    const token = mcpSecrets[config.id]?.token;

    const client = new McpClient({
      url: config.url,
      authHeader: config.authHeader,
      token,
      timeoutMs: 10_000,
      maxRetries: 1,
      onConnectionFail: 'disable-server',
    });

    try {
      return await client.testConnection();
    } finally {
      client.disconnect();
    }
  }
}

/** 全局 MCP Registry 单例 */
export const mcpRegistry = new McpRegistryImpl();
