# Windows (PowerShell 7+) equivalent of check-env.sh. Written for Docker Desktop + WSL2; not executed in CI.
# Never deletes or overwrites anything.
$ErrorActionPreference = 'Continue'
Set-Location (Join-Path $PSScriptRoot '..\..')
$failed = $false
function Ok($m) { Write-Host "  [ok]   $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  [warn] $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "  [fail] $m" -ForegroundColor Red; $script:failed = $true }

Write-Host 'Tools'
foreach ($t in 'git', 'docker', 'node', 'npm') {
  if (Get-Command $t -ErrorAction SilentlyContinue) { Ok "$t $(& $t --version | Select-Object -First 1)" } else { Fail "$t not found" }
}
docker compose version *> $null; if ($LASTEXITCODE -eq 0) { Ok (docker compose version) } else { Fail 'docker compose not found' }
docker info *> $null; if ($LASTEXITCODE -eq 0) { Ok 'Docker daemon reachable' } else { Fail 'Docker Desktop is not running' }

Write-Host 'GPU'
if ((docker info 2>$null) -match 'Runtimes:.*nvidia') { Ok 'NVIDIA runtime available (use docker-compose.gpu.yml)' }
else { Warn 'No NVIDIA runtime visible to Docker: CPU-only sparse reconstruction. Docker Desktop needs WSL2 GPU support.' }

Write-Host 'Disk'
$drive = (Get-Item .).PSDrive
$freeGb = [math]::Floor($drive.Free / 1GB)
if ($freeGb -ge 25) { Ok "$freeGb GB free on $($drive.Name):" } else { Warn "$freeGb GB free on $($drive.Name): (images need ~13 GB)" }

Write-Host 'Configuration'
if (Test-Path .env) { Ok '.env exists (left unchanged)' }
else {
  function R { -join ((1..24) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) }) }
  (Get-Content .env.example) `
    -replace '^POSTGRES_PASSWORD=.*', "POSTGRES_PASSWORD=$(R)" `
    -replace '^JWT_SECRET=.*', "JWT_SECRET=$(R)" `
    -replace '^SERVICE_TOKEN=.*', "SERVICE_TOKEN=$(R)" | Set-Content .env
  Ok 'created .env with random secrets'
}
docker compose config -q; if ($LASTEXITCODE -eq 0) { Ok 'docker compose config is valid' } else { Fail 'docker compose config is invalid' }
if ($failed) { exit 1 }
