# Code changes

Enable **Code changes** for repository work. Start by naming the target files, expected behavior, constraints, and validation you expect to run. Keep [staged review](./governance) enabled so each proposed write can be inspected.

For a small, localized repair, chat mode can be enough. When the work touches more than a few files, public APIs, routes, or type signatures, switch to [plan mode](./spec) and approve a scope and acceptance criteria before implementation.

Review the actual diff, including new files and generated outputs. The Agent's summary is useful context, but the workspace contents and your validation are the source of truth.
