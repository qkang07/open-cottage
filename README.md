# Open Cottage

[English](README.md) · [简体中文](README.zh-CN.md)

> **Turn natural-language intent into reviewable, approvable, and verifiable results—inside your own folders.**

Open Cottage is a browser-first Agent for local folders. Open an existing folder as a workspace in Chrome or Edge, configure a model, and let the Agent read, create, or change files within that boundary. Preview, diff, and confirmation steps keep the result visible before it lands in your work.

**Official links: [Live demo](https://cottage.swimlions.com/) · [Documentation](https://doc.cottage.swimlions.com/en/)**

You do not need to move a project or your materials to a cloud platform. The browser supplies the interface and folder permission; the original local folder remains the workspace. Conversations, attachments, and workspace settings live in its `.cottage/` directory, so they can be backed up with the project.

---

## How it works

1. **Open a local folder.** It becomes the Agent's read/write boundary.
2. **Choose a model and the capabilities you need.** Connect an available model, then enable only the packs needed for the task.
3. **Describe the goal and constraints.** Use `@` to reference workspace files and state the output path and files that must not change.
4. **Review and accept the result.** Inspect tool calls, staged diffs, and file previews. Destructive actions wait for your approval.

Small jobs work well in chat mode. For work that spans multiple files, steps, or capabilities, switch to plan mode: agree on and approve a plan first, then continue execution in the same conversation.

---

## Public features today

| Capability | What it does |
|---|---|
| Local-folder workspace | Works only in the folder you authorize through the browser. Conversations, attachments, workspace configuration, and external packs are stored with `.cottage/`; API keys stay in browser-local storage. |
| Chat and plan modes | Chat mode is for questions and small changes. Plan mode aligns on scope, steps, and acceptance criteria before a complex task is approved for execution. |
| Files, previews, and context | A file tree, text/document previews, `@` file references, and attachments keep source material and deliverables in the same workspace. |
| Staged review and confirmation | Writes can enter a staging area for diff review, selective apply, or discard. Deletion and other sensitive actions pause for an explicit decision. |
| Version History Beta | Enable it explicitly per workspace to inspect differences or restore a file or earlier workspace state. It is off by default and does not replace normal backups. |
| Capability packs and extensions | Core file capabilities are always available. Enable domain-specific capabilities per task, install external Capability Packs, or connect MCP when needed. |

### Built-in capability packs

| Use case | Capabilities you can enable when needed |
|---|---|
| Documents and research material | Office documents, PDF handling, charts, image generation, and deep research |
| Code and workspace maintenance | Code changes and workspace tidy-up |
| Web tasks | Web automation. Screenshots, dynamic-page extraction, and multi-step interaction require Cottage Service. |

Capability packs only expose tools for the next conversation turn; they do not move or delete existing files. Turn them off when they are not needed. See the [capability-pack guide](https://doc.cottage.swimlions.com/en/concepts/capability-packs) for details and examples.

### Cottage Service (optional)

The Open Cottage Agent and workspace remain in the browser. For more reliable search and fetching, a headless browser, webpage screenshots, or web automation, connect Cottage Service running on your machine or a specified machine. Ordinary local-file, office, and coding work does not depend on it. See [Cottage Service](https://doc.cottage.swimlions.com/en/concepts/cottage-service-concepts).

---

## Get started

1. Open the [live demo](https://cottage.swimlions.com/) in desktop Chrome or Edge, or run your own deployment.
2. Choose an existing local folder and grant the browser permission to access it.
3. Configure a model and API key in Settings, then enable the capability packs needed for the job.
4. State the goal, output location, and boundaries in natural language; preview and confirm the files that are created or changed.

For a guided setup, task examples, and security details, visit the [English documentation](https://doc.cottage.swimlions.com/en/).

---

## Repository layout

| Directory | Purpose | Stack |
|---|---|---|
| [`frontend/`](frontend/) | Browser Agent container and user interface | Vue 3 + Vite + Element Plus + AI SDK Core + Cottage Agent Runtime |
| [`cottage-service-go/`](cottage-service-go/) | Optional companion service for search, fetching, browser automation, and LLM proxying | Go + rod |
| [`doc-site/`](doc-site/) | Source for the official documentation site | VitePress |

For implementation details, start with the [frontend architecture notes](frontend/ARCHITECTURE.md), [frontend package README](frontend/README.md), and [Cottage Service README](cottage-service-go/README.md).

---

## Local development

This section is for self-hosting, connecting the companion service, or contributing. For everyday use, open the live demo instead.

### Prerequisites

- Node.js 20 or newer and pnpm for `frontend`
- Go 1.23 or newer only when running Cottage Service
- A Chromium browser with the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API), such as desktop Chrome or Edge
- An HTTPS secure context; the development server is configured with `basic-ssl`

### Start the frontend

```powershell
# Windows: install frontend dependencies and start the development server
.\start.ps1
```

```bash
# macOS / Linux
bash start.sh
```

Or start it manually:

```bash
cd frontend
pnpm install
pnpm dev
```

The development server is available at `https://localhost:5176` by default. Your browser may ask you to trust the self-signed certificate the first time.

### Start Cottage Service when needed

Only search, dynamic web pages, and web automation need it:

```bash
cd cottage-service-go
go run .
```

The default address is `https://127.0.0.1:8787`. After it starts, connect it in **Settings → Cottage Service**. See the [deployment guide](https://doc.cottage.swimlions.com/en/architecture/cottage-service-deploy) for certificates and deployment details.

---

## Safety and data

- The Agent can read and write only in the workspace you authorize. Confirm that you selected the right folder before starting.
- Staged review, sensitive-operation confirmation, and plan approval keep changes visible and controllable.
- `.cottage/` stores workspace state. Copy it when backing up important work. API keys are not written into the workspace; configure them again when changing browser or device, or manage them at a proxy.
- Version History is Beta and is not a replacement for your regular backup strategy.

For the full security model and vulnerability-reporting process, see [SECURITY.md](SECURITY.md).

---

## Contributing

Issues, documentation improvements, and capability-pack contributions are welcome. Read the relevant package documentation and the [contribution guide](https://doc.cottage.swimlions.com/en/architecture/contributing) before submitting changes.

## License

This project is released under the **MIT** License. See [LICENSE](LICENSE). Contributions are licensed under the same terms.

---

*Project status: 0.x. Public functionality, APIs, and data formats may evolve.*
