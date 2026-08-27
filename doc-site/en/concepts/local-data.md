# Your data stays local

Open Cottage is a frontend application. The fixed chat workspace stores conversations, settings, attachments, generated files, and optional history in this site's IndexedDB; its logical size is shown at the lower left. Clearing the workspace or this site's browser data permanently removes it.

When you authorize a folder, work files remain there and workspace state is stored beneath `.cottage/`. Back up that directory with the project when you want to preserve its local history and context. Virtual data is not silently copied into a folder workspace.

Provider API keys are stored in the browser's IndexedDB for the app origin, not in the workspace. Requests to a model are sent to the provider you configure. Optional Cottage Service is a separate endpoint that you explicitly connect.
