# Five-minute setup

## 1. Open a workspace

Open the app in desktop Chrome or Edge, choose **Open folder**, and select an existing project or material folder. Confirm that it is the folder you intend to let the Agent work in.

## 2. Configure a model

Open **Settings → Models**, add a provider and API key, then select a model. The key is stored in this browser only. If the provider cannot return a model list, keep your configuration and enter the model name yourself rather than replacing it with a default.

## 3. Enable only the needed capabilities

Start with the built-in file capabilities. In **Settings → Capabilities**, enable an Office, code, PDF, chart, image, research, tidy-up, or web-automation pack only when the task needs it. Search, dynamic-page fetching, screenshots, and browser interaction additionally require [Cottage Service](/en/concepts/cottage-service-concepts).

## 4. Run and review a first task

State the objective, desired output location, and constraints. For example: “Read `brief.md`, create `draft.md`, and do not modify any other files.” Use `@` to attach workspace files to the conversation, then review the tool calls, previews, and staged diff before accepting changes.

Next: [the main interface](./ui), [chatting with the Agent](./chat), or [reviewing changes](./governance).
