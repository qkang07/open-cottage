# What is Open Cottage?

Open Cottage is a browser-first Agent. Start immediately in a persistent chat workspace backed by IndexedDB, or authorize a local folder when you want to work with existing material. Both modes provide the same file, preview, chat, and review interface.

It is designed for work where the result must be inspectable: ask in natural language, reference files with `@`, let the Agent use the capabilities you enabled, then preview and review the changed files before accepting them.

## Choose the working boundary

- The Agent can access only the folder you explicitly authorize.
- Files remain in that folder. Workspace state is stored under `.cottage/` so it can be backed up with the project.
- The fixed chat workspace needs no folder permission. Its conversations, settings, and generated files stay in this site's IndexedDB, and its logical size is shown at the lower left.
- Clearing the chat workspace from Workspace settings, or clearing this site's browser data, permanently removes that virtual data.
- API keys remain in browser-local storage rather than being written to the workspace.

For a first task, continue to [Five-minute setup](./first-setup). For where data and settings live, see [Workspaces](/en/concepts/workspace) and [Your data stays local](/en/concepts/local-data).
