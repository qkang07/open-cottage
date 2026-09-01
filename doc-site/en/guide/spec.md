# Plan complex work

Plan mode is for work that needs agreement before execution: multi-file changes, a larger research report, a new public interface, or anything with several dependencies. It turns the discussion into a proposed scope, steps, risks, and acceptance criteria that you can approve before the Agent acts.

Use the plan to make the intended output, allowed files, review points, and recovery expectations explicit. Once approved, ordinary non-destructive writes inside that scope can run as one batch without per-file prompts. Deletes, moves, external side effects, path expansion, and budget changes still stop for separate approval.

The approval summary shows allowed paths, budgets, steps, and the split between functional, structural, and human verification before you approve. Use **Request changes** for natural-language feedback; the full provider and dependency form remains available as an advanced editor.

When trusted functional verification is unavailable, the completion screen lists what remains uncovered and uses **Accept unverified items and complete** instead of implying that verification passed. The Plan center lists active, paused, completed, and archived plans for the current workspace and requires an explicit choice if more than one active plan is found.

For small, well-defined requests, [chat mode](./chat) is faster. For the review stage after work has been proposed, see [Review and approve changes](./governance).
