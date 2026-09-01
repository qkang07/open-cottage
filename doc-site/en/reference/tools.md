# Tool catalog

The available tool set depends on the active model, enabled capability packs, and whether Cottage Service is connected. Core file work is available in the local workspace; specialized document, code, PDF, chart, image, research, and web tools are enabled by their respective packs.

Runtime tool descriptions and approval prompts are authoritative for parameters and risk. For how to choose and enable a capability, see [Capability packs](/en/concepts/capability-packs); for step-by-step user workflows, start with [Get started](/en/guide/introduction).

## Plan mode

| Tool | Purpose |
|------|---------|
| `suggestPlanMode` | Ask the user before switching from chat to the unified plan flow |
| `submitPlan` | Submit a versioned plan with path scope, dependencies, budgets, and acceptance criteria |
| `completePlanStep` / `blockPlanStep` | Record step evidence, or preserve the current state and pause on a blocker |
| `requestPlanRevision` | Request a new revision and require approval again |
| `completePlanRun` / `failPlanRun` | Summarize verification and request completion, or record a terminal failure without discarding changes |
| `dispatchPlanResearch` | Run up to three temporary read-only researchers for a research or verification step |

Legacy Spec messages remain readable and can be copied into a new Plan. The old `suggestSpec` and `submitSpec` tools are not part of the current public plan flow.
