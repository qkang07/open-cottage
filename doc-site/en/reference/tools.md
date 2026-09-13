# Tool catalog

The available tool set depends on the active model, enabled capability packs, and whether Cottage Service is connected. Core file work is available in the local workspace; specialized document, code, PDF, chart, image, research, and web tools are enabled by their respective packs.

Runtime tool descriptions and approval prompts are authoritative for parameters and risk. For how to choose and enable a capability, see [Capability packs](/en/concepts/capability-packs); for step-by-step user workflows, start with [Get started](/en/guide/introduction).

The Office pack keeps historical inputs and V2 semantic layouts, and adds V3 through `version: 3` plus `pipeline: "html-layout"`. V3 runs a constrained HTML/CSS browser layout, measures the DOM, converts it to a `PresentationScene`, and emits an editable native PPTX. It supports dynamic page sizes, six themes, reusable modules (including matrices, funnels, roadmaps, hierarchies, image stories, and chart insights), and explicit `draftOnly`/`sourceDraftId` sidecars under `.cottage/presentations/<draftId>/`. Only explicitly decorative elements may be locally rasterized; core content must stay editable.

Use `readPresentation(includeElements=true)` to retrieve stable element IDs, bounds, text, and table/chart summaries. `includeStyleProfile/includeLayouts/includeMasters/includeSourceManifest` opt into page, theme, master/layout, and source-draft analysis. Reference modes are `content-only`, `inspiration`, `match-style`, and `native-template`. `editPresentation` edits common objects and slide order in place, preserves untouched OOXML parts, and reports `sourceManifestStatus`; unsupported PowerPoint objects remain read-only. Preview offers design, element-structure, and export-structure views and remains approximate HTML/SVG rendering.

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
