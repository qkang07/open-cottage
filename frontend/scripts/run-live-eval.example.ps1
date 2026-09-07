param(
  [string]$Provider = 'openai',
  [Parameter(Mandatory = $true)]
  [string]$Model,
  [string]$ApiKeyEnv = 'COTTAGE_LIVE_API_KEY',
  [string]$CaseId = 'live-workspace-grounding',
  [string]$BaseUrl = ''
)

$ErrorActionPreference = 'Stop'
$apiKey = [Environment]::GetEnvironmentVariable($ApiKeyEnv, 'Process')
if ([string]::IsNullOrWhiteSpace($apiKey)) {
  throw "Environment variable $ApiKeyEnv is missing. Set it in this terminal first."
}

$frontendRoot = Split-Path -Parent $PSScriptRoot
$arguments = @(
  'eval:live'
  '--'
  '--live'
  '--provider', $Provider
  '--model', $Model
  '--api-key-env', $ApiKeyEnv
  '--case', $CaseId
  '--max-cases', 1
  '--max-model-calls', 4
  '--max-total-tokens', 5000
  '--max-duration-ms', 120000
  '--max-output-tokens', 1000
)
if (-not [string]::IsNullOrWhiteSpace($BaseUrl)) {
  $arguments += @('--base-url', $BaseUrl)
}

Push-Location $frontendRoot
try {
  & pnpm @arguments
  $commandExitCode = $LASTEXITCODE
} finally {
  Pop-Location
}
exit $commandExitCode
