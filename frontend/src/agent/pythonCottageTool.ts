/**
 * Python Cottage Tool
 *
 * 将 Pyodide runPython 封装为 CottageStructuredTool，供 Agent 调用。
 */

import { z } from 'zod';
import { CottageStructuredTool } from '@/agent/runtime/tool';
import { runPythonInWorker, PythonExecutionError } from './runPython';

const PYTHON_TOOL_DESCRIPTION = `在浏览器内 Pyodide（WebAssembly）环境执行 Python 代码。
支持 numpy、pandas、scipy、matplotlib 等常用库。
注意：
- 无网络访问权限
- 无文件系统（只有内存虚拟 FS）
- 最后一个表达式的值将作为返回结果
- stdout/stderr 也会被捕获返回
- 执行有超时限制（默认 120s）`;

class PythonCottageTool extends CottageStructuredTool {
  name = 'runPython';
  description = PYTHON_TOOL_DESCRIPTION;
  schema = z.object({
    code: z.string().describe('要执行的 Python 代码'),
  });

  async call(input: { code: string }): Promise<string> {
    try {
      const result = await runPythonInWorker(input.code);

      const parts: string[] = [];
      if (result.stdout) parts.push(`[stdout]\n${result.stdout}`);
      if (result.stderr) parts.push(`[stderr]\n${result.stderr}`);
      if (result.result) parts.push(`[result]\n${result.result}`);

      return parts.length ? parts.join('\n\n') : '(no output)';
    } catch (error) {
      if (error instanceof PythonExecutionError) {
        const parts: string[] = [`[error] ${error.message}`];
        if (error.stdout) parts.push(`[stdout]\n${error.stdout}`);
        if (error.stderr) parts.push(`[stderr]\n${error.stderr}`);
        return parts.join('\n\n');
      }
      const msg = error instanceof Error ? error.message : String(error);
      return `[error] ${msg}`;
    }
  }
}

/**
 * 创建 Python Cottage 工具实例
 */
export const createPythonCottageTool = (): CottageStructuredTool =>
  new PythonCottageTool();
