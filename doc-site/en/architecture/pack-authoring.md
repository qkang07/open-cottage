# Author a Capability Pack

A Capability Pack contributes a focused set of tools and instructions for a task domain. Design it around a clear user outcome, narrow permissions, explicit inputs and outputs, and safe failure behavior. Do not make a pack depend on a reference-only third-party source tree.

Register the pack in the project's own pack system, document its prerequisites and approval behavior, and ensure it works consistently wherever capability configuration is exposed. User-facing installation and enablement are described in [Install external capabilities](/en/packs/external).

Keep generated or destructive actions behind the normal workspace, staging, and approval boundaries. A pack should preserve user configuration rather than silently replacing it when a dependency or connection fails.
