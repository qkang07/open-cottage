# Local development and startup

For ordinary use, open the live demo. This guide is for self-hosting, development, and connecting the optional companion service.

## Prerequisites

- Node.js 20+ and pnpm for the frontend
- Go 1.23+ when running Cottage Service
- Desktop Chrome or Edge with the File System Access API
- HTTPS; the development setup includes a self-signed local certificate

Start the frontend with `./start.ps1` on Windows or `bash start.sh` on macOS/Linux. You can also run `pnpm install` and `pnpm dev` from `frontend/`. The default local address is `https://localhost:5176`.

Run `go run .` from `cottage-service-go/` only when the task needs its search, fetching, or browser features. Its default address is `https://127.0.0.1:8787`. See [Deploy Cottage Service](/en/architecture/cottage-service-deploy) for deployment details.
