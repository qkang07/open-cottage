import type { AgentEvalScenario } from './types';

export interface AgentEvalSelection {
  scenarioIds: string[];
  tags: string[];
}

const splitFilter = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export const evalSelectionFromEnv = (
  env: Record<string, string | undefined> = process.env,
): AgentEvalSelection => ({
  scenarioIds: splitFilter(env.COTTAGE_EVAL_SCENARIOS),
  tags: splitFilter(env.COTTAGE_EVAL_TAGS),
});

export const selectAgentEvalScenarios = (
  scenarios: readonly AgentEvalScenario[],
  selection: AgentEvalSelection,
): AgentEvalScenario[] => {
  const scenarioIds = new Set(selection.scenarioIds);
  const tags = new Set(selection.tags);
  return scenarios.filter((scenario) => {
    if (scenarioIds.size > 0 && !scenarioIds.has(scenario.id)) return false;
    if (tags.size > 0 && !(scenario.tags ?? []).some((tag) => tags.has(tag))) {
      return false;
    }
    return true;
  });
};
