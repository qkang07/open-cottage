import type { PlanRepository } from './repository';
import type { PlanDefinition, PlanEvent, PlanManifest, PlanRun } from './types';

export interface PlanUiProjectionAdapter {
  project(definition: PlanDefinition, run: PlanRun): void;
  persistChat(): void | Promise<void>;
}

/**
 * Thin UI boundary. It never constructs PlanRun state; it commits a Runner
 * transition and projects the committed state into chat/Pinia.
 */
export class PlanUiController {
  constructor(
    private readonly repository: PlanRepository,
    private readonly adapter: PlanUiProjectionAdapter,
  ) {}

  async commit(
    definition: PlanDefinition,
    run: PlanRun,
    event: PlanEvent,
    manifest?: PlanManifest,
  ): Promise<PlanRun> {
    const stored = await this.repository.commit({ definition, run, event, manifest });
    this.adapter.project(stored.definition, stored.run);
    await this.adapter.persistChat();
    return stored.run;
  }
}
