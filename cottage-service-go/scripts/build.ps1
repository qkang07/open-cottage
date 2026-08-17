# Build cottage-service-go (Windows: no console window by default)
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path dist | Out-Null
go build -ldflags="-H=windowsgui" -o dist/cottage-service-go.exe .
Write-Host "built dist/cottage-service-go.exe (windowsgui)"
