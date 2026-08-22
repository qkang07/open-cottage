# Architecture overview

Open Cottage is a browser-first frontend that works with an authorized local folder. The browser provides the UI, directory permission, and browser-local configuration; the folder stores task files and workspace state under `.cottage/`.

The frontend can connect to optional Cottage Service through a unified HTTP API. Cottage Service supplies search, fetching, a browser, screenshots, and web automation, but it is not required for ordinary local-file workflows.

Key implementation boundaries are the workspace file boundary, user approval for staged and sensitive mutations, and persistence that distinguishes browser-origin settings from folder-bound data.
