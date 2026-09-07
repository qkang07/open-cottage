import { describe, expect, it } from 'vitest';
import { CORE_AGENT_EVAL_SCENARIOS } from './scenarios';
import { evalSelectionFromEnv, selectAgentEvalScenarios } from './selection';

describe('eval scenario selection', () => {
  it('parses comma-separated environment filters', () => {
    expect(evalSelectionFromEnv({
      COTTAGE_EVAL_SCENARIOS: 'chat-text-only, chat-write-file ',
      COTTAGE_EVAL_TAGS: ' staging,recovery',
    })).toEqual({
      scenarioIds: ['chat-text-only', 'chat-write-file'],
      tags: ['staging', 'recovery'],
    });
  });

  it('combines exact ids with any matching tag', () => {
    const selected = selectAgentEvalScenarios(CORE_AGENT_EVAL_SCENARIOS, {
      scenarioIds: ['staging-stop-restore-approve', 'staging-discard-keeps-disk'],
      tags: ['restore'],
    });
    expect(selected.map((scenario) => scenario.id)).toEqual([
      'staging-stop-restore-approve',
    ]);
  });
});
