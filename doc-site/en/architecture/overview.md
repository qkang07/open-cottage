# Architecture overview

Open Cottage is a browser-first frontend with two workspace backends: a fixed IndexedDB chat workspace and an authorized local folder. Both use the same Agent and file interface; folder state lives under `.cottage/`, while virtual workspace data stays in this site's browser storage.

The frontend can connect to optional Cottage Service through a unified HTTP API. Cottage Service supplies search, fetching, a browser, screenshots, and web automation, but it is not required for ordinary local-file workflows.

Key implementation boundaries are the active workspace ID and backend, user approval for staged and sensitive mutations, and persistence that distinguishes browser-origin settings from folder-bound data.
