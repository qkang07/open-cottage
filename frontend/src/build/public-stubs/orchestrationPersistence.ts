import type {
  OrchestrationState,
  SerializedOrchestration,
} from '../../orchestrator/types';

export const loadOrchestration = async (
  _orchestrationId: string,
): Promise<SerializedOrchestration | null> => null;

export const listActiveOrchestrations = async (): Promise<OrchestrationState[]> => [];

