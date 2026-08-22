# Your data stays local

Open Cottage is a frontend application. Your work files stay in the folder you select, and workspace state is stored beneath `.cottage/` in that folder. Back up that directory with the project when you want to preserve its local history and context.

Provider API keys are stored in the browser's IndexedDB for the app origin, not in the workspace. Requests to a model are sent to the provider you configure. Optional Cottage Service is a separate endpoint that you explicitly connect.
