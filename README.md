# Open Cottage

[English](README.md) · [简体中文](README.zh-CN.md)

> **A browser-first Agent that can start instantly or work in folders you already own.**

Open Cottage lets you start in a browser-backed chat workspace immediately, or authorize a local folder when you want the Agent to work with existing material. Choose a model, enable only the capabilities a task needs, and review the outcome before it lands in your work.

**[Open the live demo](https://cottage.swimlions.com/) · [Read the documentation](https://doc.cottage.swimlions.com/en/) · [查看中文说明](https://doc.cottage.swimlions.com/)**

No desktop client, project migration, or mandatory backend is required. The chat workspace keeps conversations and generated files in this browser's IndexedDB; a folder workspace keeps its state under `.cottage/` in the selected folder. API keys remain in browser-local storage in both modes.

---

## A small, local workflow

|  | Part | Role |
|---|---|---|
| 01 | **Browser** | Provides the interface and an IndexedDB chat workspace you can use immediately. |
| 02 | **Optional local folder** | Becomes the workspace when you authorize an existing project, reference collection, or delivery folder. |
| 03 | **Model and capabilities** | Are selected for the task, then read, write, generate, and use the tools you enabled. |

When a task needs stronger web capabilities, connect the optional Cottage Service for search, dynamic-page fetching, screenshots, and browser automation. Ordinary local-file, office, and coding work does not require it.

### What the workflow looks like

1. **Choose a workspace** — start in the browser chat workspace, or open a folder as the Agent's read/write boundary.
2. **Configure a model and capabilities** — start with core file work; enable specialized packs only when needed.
3. **State the goal and constraints** — reference workspace files with `@`, name the output path, and say what must not change.
4. **Review the result** — inspect tool activity, previews, and staged diffs; sensitive actions wait for an explicit choice.

For a cross-file or multi-step task, use plan mode to agree on scope, steps, risks, and acceptance criteria before execution. Small questions and contained changes can stay in chat mode.

---

## Keep work where it belongs

Open Cottage is designed around an explicit local boundary rather than a remote project migration.

- **Your files stay in the folder you authorize.** A repository, a document collection, or a delivery folder can each be a separate workspace.
- **Chat can start without a folder.** The fixed chat workspace persists its conversations and generated files in IndexedDB for this site; its current size is always shown at the lower left.
- **Changes remain inspectable.** Preview files, review staged diffs, selectively apply writes, and explicitly allow or reject sensitive operations.
- **Your choices remain visible.** The active model and capability set are shown in the task surface; a failed connection or model lookup does not silently replace saved configuration.
- **Workspace state travels with the work.** Back up `.cottage/` with an important project if you want to retain its conversations, attachments, and workspace configuration.

Version History Beta can be enabled per workspace to inspect differences and restore a file or an earlier workspace state. It is off by default and complements—not replaces—your normal backup practice.

---

## Capabilities, only when needed

The core local-file workflow is always available. Capability Packs expose specialized tools for a task; enabling one does not move or delete existing files.

| Task | Enable when needed |
|---|---|
| Documents, slides, and spreadsheets | Office documents |
| Code changes | Code changes |
| Research reports | Deep research; optionally PDF handling and charting |
| PDFs and diagrams | PDF handling and charting |
| Workspace images | Image generation |
| File organization | Workspace tidy-up |
| Dynamic sites, screenshots, or browser flows | Web automation + Cottage Service |

You can also install an external Capability Pack in a workspace or connect MCP when it is appropriate for the task. Start with the [capability-pack guide](https://doc.cottage.swimlions.com/en/concepts/capability-packs) for the model and its safety boundaries.

---

## Start now, or open a real folder

1. Open the [live demo](https://cottage.swimlions.com/) in desktop Chrome or Edge, or run your own deployment.
2. Select **Start chatting** for the browser workspace, or choose an existing local folder and confirm the browser permission.
3. Add a model provider and API key in **Settings → Models**.
4. Describe the task, intended output, and boundaries; then review the resulting files in the workspace.

For a guided first task, see [Five-minute setup](https://doc.cottage.swimlions.com/en/guide/first-setup). For task-specific workflows, see the documentation for [documents and spreadsheets](https://doc.cottage.swimlions.com/en/guide/use-office), [code changes](https://doc.cottage.swimlions.com/en/guide/use-coding), [research](https://doc.cottage.swimlions.com/en/guide/use-research), and [web automation](https://doc.cottage.swimlions.com/en/guide/use-web).

---

## Self-hosting and development

The live demo is enough for everyday use. The repository is here when you want to self-host, extend the product, or run the optional companion service.

| Directory | Purpose | Stack |
|---|---|---|
| [`frontend/`](frontend/) | Browser Agent container and user interface | Vue 3 + Vite + Element Plus + AI SDK Core + Cottage Agent Runtime |
| [`cottage-service-go/`](cottage-service-go/) | Optional companion service for search, fetching, browser automation, and LLM proxying | Go + rod |
| [`doc-site/`](doc-site/) | Official documentation source | VitePress |

### Prerequisites

- Node.js 20+ and pnpm for the frontend
- Go 1.23+ only when running Cottage Service
- A modern desktop browser with IndexedDB; Chrome or Edge with the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API) when opening local folders
- An HTTPS secure context; the development server is configured with `basic-ssl`

### Start the frontend

```powershell
# Windows
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

The default development address is `https://localhost:5176`; your browser may ask you to trust the self-signed certificate once.

### Start Cottage Service when the task needs it

```bash
cd cottage-service-go
go run .
```

It listens on `https://127.0.0.1:8787` by default. Connect it from **Settings → Cottage Service** after it starts. See [Deploy Cottage Service](https://doc.cottage.swimlions.com/en/architecture/cottage-service-deploy) for certificates and deployment details.

---

## Safety, contribution, and license

- Confirm which workspace is active before starting. Folder work stays inside the authorized directory; chat-workspace data stays in this browser and is lost if its site data is cleared.
- Treat previews, staged review, sensitive-operation confirmation, and plan approval as normal parts of reliable Agent work.
- Keep normal backups and source control. Version History Beta does not replace either.
- API keys are not written into the workspace. Configure them again when changing browser or device, or manage them at a proxy.

Read [SECURITY.md](SECURITY.md) for the security model and vulnerability-reporting process. Contributions are welcome—start with the [contribution guide](https://doc.cottage.swimlions.com/en/architecture/contributing).

Open Cottage is released under the [MIT License](LICENSE). Public functionality, APIs, and data formats may evolve during the 0.x series.
