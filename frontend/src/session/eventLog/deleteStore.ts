import { COTTAGE_DIR } from '../../config/constants';
import {
  chatSessionFile,
  legacyTraceFile,
  sessionEventsFile,
  traceFile,
} from '../../config/constants';
import { workspace } from '../../workspace/FileSystemWorkspace';

/** 删除会话相关的事件日志与旧快照/trace 文件 */
export const deleteSessionStoreFiles = async (sessionId: string): Promise<void> => {
  if (!workspace.isOpen) return;
  const relatives = [
    sessionEventsFile(sessionId),
    chatSessionFile(sessionId),
    traceFile(sessionId),
    legacyTraceFile(sessionId),
  ];
  for (const relative of relatives) {
    try {
      await workspace.deleteFile(`${COTTAGE_DIR}/${relative}`);
    } catch {
      // ignore
    }
  }
};
