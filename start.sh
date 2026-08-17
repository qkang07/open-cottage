#!/usr/bin/env bash
# Open Cottage - Quick Start Script (macOS / Linux)
# Usage: bash start.sh

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "========================================"
echo "  Open Cottage - Quick Start"
echo "========================================"
echo ""

# --- Install dependencies ---
echo "[1/1] Installing dependencies..."

echo "  -> frontend (pnpm install)"
(cd "$ROOT/frontend" && pnpm install)

echo ""
echo "Starting frontend..."
echo ""

# --- Start frontend (foreground) ---
echo "  Starting frontend     (https://localhost:5176) ..."
echo ""
echo "Press Ctrl+C to stop the frontend. Start Cottage Service separately when needed."
echo ""
(cd "$ROOT/frontend" && pnpm dev)
