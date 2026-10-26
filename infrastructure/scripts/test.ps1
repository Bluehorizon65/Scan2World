# Windows equivalent of test.sh (not executed in CI). Needs Postgres/Redis up: docker compose up -d postgres redis
param([switch]$E2E)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..\..')
$root = Get-Location
if (-not (Test-Path services\.venv\Scripts\python.exe)) {
  py -3.12 -m venv services\.venv
  services\.venv\Scripts\pip install -q -r services\requirements-dev.txt -r services\vision\requirements.txt -r services\geometry\requirements.txt -r services\recon\requirements.txt
}
Push-Location services; .venv\Scripts\ruff check .; .venv\Scripts\pyright common vision recon geometry; Pop-Location
foreach ($s in 'common', 'vision', 'recon', 'geometry') {
  Push-Location "services\$s"; & "$root\services\.venv\Scripts\python.exe" -m pytest -q -p no:logging tests; Pop-Location
}
Push-Location apps\api; npm ci; npx prisma generate; npm run lint; npx jest; npx jest --config test/jest-e2e.json; Pop-Location
Push-Location apps\web; npm ci; npm run lint; npm run typecheck; npm test; Pop-Location
if ($E2E) { Push-Location tests; npm ci; npx playwright install chromium; npx playwright test; Pop-Location }
Write-Host 'All suites passed.'
