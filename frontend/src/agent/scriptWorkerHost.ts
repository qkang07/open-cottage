import type { WorkerRequestWithoutId } from './scriptWorkerProtocol';
import { workspace } from '../workspace/FileSystemWorkspace';

export const handleScriptWorkerRequest = async (
  request: WorkerRequestWithoutId,
): Promise<unknown> => {
  switch (request.type) {
    case 'listFiles':
      return await workspace.listFiles(request.prefix ?? '');
    case 'readFile':
      return await workspace.readFile(request.path);
    case 'exists':
      return await workspace.exists(request.path);
    default: {
      const unknownType = (request as { type?: string }).type ?? 'unknown';
      throw new Error(`Worker 请求必须通过统一工具执行器: ${unknownType}`);
    }
  }
};
