# Security

The active workspace is the Agent's file boundary. A chat workspace is isolated in this site's IndexedDB; a folder workspace is limited to the directory you authorize. Choose the boundary carefully, and give a task an explicit output path and no-change constraints where practical.

Clearing the virtual workspace or this site's browser data permanently removes its chats, settings, and generated files. Folder workspace state remains under `.cottage/` in the folder. Neither mode automatically uploads workspace data to an Open Cottage server.

Review tool activity, previews, and staged diffs before applying results. Sensitive actions must be explicitly allowed or rejected. These controls make changes inspectable; they do not remove the need for ordinary backups, source control, or careful review of generated content.

Model requests go to the provider you configure. API keys stay in your browser. Optional Cottage Service is a separate service you choose to connect for browser and web capabilities; protect and deploy it appropriately.
