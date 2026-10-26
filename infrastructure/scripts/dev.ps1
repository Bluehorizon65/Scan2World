# Windows equivalent of dev.sh (not executed in CI).
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..\..')
$files = @('-f', 'docker-compose.yml', '-f', 'docker-compose.override.yml')
if ((docker info 2>$null) -match 'Runtimes:.*nvidia') { $files += @('-f', 'docker-compose.gpu.yml'); Write-Host 'GPU override enabled' }
docker compose @files up -d --build
for ($i = 0; $i -lt 60; $i++) {
  try { Invoke-RestMethod http://localhost:3000/api/v1/ready | ConvertTo-Json -Depth 4; break } catch { Start-Sleep 2 }
}
Write-Host 'Open http://localhost:8080'
