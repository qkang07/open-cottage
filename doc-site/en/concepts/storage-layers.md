# Site and workspace settings

Open Cottage separates settings that belong to the browser origin from settings that belong to an authorized folder. API keys and provider configuration are browser-local; workspace choices, conversations, attachments, and history belong under the folder's `.cottage/` directory.

This distinction prevents a folder change from silently replacing saved configuration. When a connection or list lookup fails, retain the user's saved value and ask for a deliberate correction instead of falling back to an unrelated default.
