# Model providers and API keys

Add a provider in **Settings → Models**, enter its base URL and API key when required, then select or enter the model name. Keep the provider you configured when discovery fails; a failed model-list request should not replace it with a default.

API keys are stored in the browser's local IndexedDB, not in the workspace folder. Moving to a different browser or device therefore requires configuring keys again, unless you deliberately use a proxy or another provider-side arrangement.

Model presets can be shared at the site level while workspace choices travel with a folder. See [Models, presets, and API keys](/en/concepts/models-and-keys) for the conceptual model.
