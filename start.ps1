# Open Cottage - Quick Start Script (Windows PowerShell)
# Usage: .\start.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Open Cottage - Quick Start" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# --- Install dependencies ---
Write-Host "[1/1] Installing dependencies..." -ForegroundColor Yellow

Write-Host "  -> frontend (pnpm install)" -ForegroundColor Gray
Push-Location "$Root\frontend"
pnpm install
Pop-Location

Write-Host ""
Write-Host "Starting frontend..." -ForegroundColor Yellow
Write-Host ""

# --- Start frontend (foreground) ---
Write-Host "  Starting frontend     (https://localhost:5176) ..." -ForegroundColor Gray
Write-Host ""
Write-Host "Press Ctrl+C to stop the frontend. Start Cottage Service separately when needed." -ForegroundColor DarkGray
Write-Host ""

Push-Location "$Root\frontend"
try { pnpm dev } finally { Pop-Location }
