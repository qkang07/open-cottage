# Workspaces and local data

Each authorized folder is a workspace. A Git repository, a document collection, and a customer-delivery folder can each have their own workspace. Changing folders changes the conversations and workspace configuration associated with that work; site-level settings may still be shared by the same browser origin.

Workspace-specific state is stored in `.cottage/`. Include it when you back up or move important work that should retain its sessions, attachments, and configuration. Do not treat this application state as a substitute for your normal source-control or backup practice.

For the exact distinction between shared and folder-bound settings, see [Site and workspace settings](/en/concepts/storage-layers).
