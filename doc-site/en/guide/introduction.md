# What is Open Cottage?

Open Cottage is a browser-first Agent that works in a local folder you choose. Chrome or Edge supplies the interface and directory permission; the existing folder remains the workspace for material, generated files, conversations, and workspace settings.

It is designed for work where the result must be inspectable: ask in natural language, reference files with `@`, let the Agent use the capabilities you enabled, then preview and review the changed files before accepting them.

## The working boundary

- The Agent can access only the folder you explicitly authorize.
- Files remain in that folder. Workspace state is stored under `.cottage/` so it can be backed up with the project.
- API keys remain in browser-local storage rather than being written to the workspace.

For a first task, continue to [Five-minute setup](./first-setup). For where data and settings live, see [Workspaces](/en/concepts/workspace) and [Your data stays local](/en/concepts/local-data).
