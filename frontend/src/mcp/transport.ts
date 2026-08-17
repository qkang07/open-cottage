/**
 * MCP Streamable HTTP Transport
 *
 * 实现 MCP 协议的 HTTP 传输层（Streamable HTTP + SSE 支持）。
 */

export interface McpJsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface McpJsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  isError?: boolean;
}

export interface McpTransportOptions {
  url: string;
  /** 鉴权 header 名，默认 Authorization */
  authHeader?: string;
  /** 鉴权 token */
  token?: string;
  /** 请求超时 ms，默认 30s */
  timeoutMs?: number;
}

let requestIdCounter = 0;
const nextId = () => ++requestIdCounter;

/**
 * MCP Streamable HTTP Transport 类
 * 通过 POST 请求实现 JSON-RPC 通信
 */
export class McpStreamableHttpTransport {
  private url: string;
  private headers: Record<string, string>;
  private timeoutMs: number;
  private sessionId: string | null = null;

  constructor(options: McpTransportOptions) {
    this.url = options.url.replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.headers = {
      'Content-Type': 'application/json',
    };
    if (options.token) {
      const headerName = options.authHeader ?? 'Authorization';
      this.headers[headerName] = options.token.startsWith('Bearer ')
        ? options.token
        : `Bearer ${options.token}`;
    }
  }

  /** 发送 JSON-RPC 请求 */
  private async send(method: string, params?: Record<string, unknown>): Promise<McpJsonRpcResponse> {
    const id = nextId();
    const body: McpJsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: {
          ...this.headers,
          ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new McpTransportError(
          `MCP request failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ''}`,
          res.status,
        );
      }

      // 保存 session ID
      const sessionHeader = res.headers.get('Mcp-Session-Id');
      if (sessionHeader) {
        this.sessionId = sessionHeader;
      }

      const contentType = res.headers.get('content-type') ?? '';

      // SSE 响应解析
      if (contentType.includes('text/event-stream')) {
        return await this.parseSSEResponse(res, id);
      }

      // 普通 JSON 响应
      const json = (await res.json()) as McpJsonRpcResponse;
      return json;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 解析 SSE 响应，提取对应 ID 的结果 */
  private async parseSSEResponse(
    res: Response,
    requestId: string | number,
  ): Promise<McpJsonRpcResponse> {
    const reader = res.body?.getReader();
    if (!reader) {
      throw new McpTransportError('SSE response has no body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data) as McpJsonRpcResponse;
            if (parsed.id === requestId) {
              reader.cancel();
              return parsed;
            }
          } catch {
            // 忽略非 JSON 行
          }
        }
      }
    }

    throw new McpTransportError('SSE stream ended without matching response');
  }

  /** 初始化连接 */
  async initialize(): Promise<{
    protocolVersion: string;
    capabilities: Record<string, unknown>;
    serverInfo: { name: string; version?: string };
  }> {
    const response = await this.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'open-cottage', version: '1.0.0' },
    });

    if (response.error) {
      throw new McpTransportError(
        `Initialize failed: ${response.error.message}`,
        response.error.code,
      );
    }

    // 发送 initialized 通知
    await this.notify('notifications/initialized');

    return response.result as {
      protocolVersion: string;
      capabilities: Record<string, unknown>;
      serverInfo: { name: string; version?: string };
    };
  }

  /** 获取工具列表 */
  async listTools(): Promise<McpToolDefinition[]> {
    const response = await this.send('tools/list');
    if (response.error) {
      throw new McpTransportError(
        `tools/list failed: ${response.error.message}`,
        response.error.code,
      );
    }
    const result = response.result as { tools: McpToolDefinition[] };
    return result.tools ?? [];
  }

  /** 调用工具 */
  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const response = await this.send('tools/call', { name, arguments: args });
    if (response.error) {
      throw new McpTransportError(
        `tools/call "${name}" failed: ${response.error.message}`,
        response.error.code,
      );
    }
    return response.result as McpToolResult;
  }

  /** 发送通知（无需响应） */
  private async notify(method: string, params?: Record<string, unknown>): Promise<void> {
    const body = {
      jsonrpc: '2.0' as const,
      method,
      params,
    };

    await fetch(this.url, {
      method: 'POST',
      headers: {
        ...this.headers,
        ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
      },
      body: JSON.stringify(body),
    }).catch(() => {
      // 通知失败不阻塞
    });
  }

  /** 获取 session ID */
  getSessionId(): string | null {
    return this.sessionId;
  }
}

export class McpTransportError extends Error {
  code?: number;
  constructor(message: string, code?: number) {
    super(message);
    this.name = 'McpTransportError';
    this.code = code;
  }
}
