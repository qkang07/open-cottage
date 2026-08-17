import type { StoredMessage } from '../agent/messages';
import type { ChatComponent } from './components';
import type { ToolCallInteraction } from './toolCallInteraction';

/** 将旧版旁路 components[] 合并进 StoredToolCall.interaction（一次性迁移） */
export function mergeLegacyComponentsIntoHistory(
  history: StoredMessage[],
  components: readonly ChatComponent[],
): StoredMessage[] {
  if (!components.length) return history;
  const byCallId = new Map<string, ToolCallInteraction>();
  for (const c of components) {
    if (c.kind === 'tool_approval') {
      byCallId.set(c.linkedCallId, {
        kind: 'tool_approval',
        status: c.status === 'pending' ? 'pending' : c.status === 'cancelled' ? 'cancelled' : 'resolved',
        message: c.payload.message,
        decision: c.decision,
      });
    } else if (c.kind === 'ask_user') {
      byCallId.set(c.linkedCallId, {
        kind: 'ask_user',
        status: c.status === 'pending' ? 'pending' : c.status === 'cancelled' ? 'cancelled' : 'resolved',
        question: c.payload.question,
        options: c.payload.options,
        decision: c.decision,
      });
    }
  }
  if (byCallId.size === 0) return history;

  return history.map((msg) => {
    if (msg.role !== 'assistant' || !msg.toolCalls?.length) return msg;
    let changed = false;
    const toolCalls = msg.toolCalls.map((call) => {
      const interaction = byCallId.get(call.id);
      if (!interaction || call.interaction) return call;
      changed = true;
      return { ...call, interaction };
    });
    return changed ? { ...msg, toolCalls } : msg;
  });
}
