# Runs the demo end to end on Windows. The same steps as demo.sh.
#
#   .\demo.ps1          same as start
#   .\demo.ps1 start    build and start docker, migrate, reset the demo data, run the shop
#   .\demo.ps1 reset    wipe the demo data and the shop's orders, then seed again
#   .\demo.ps1 test     every test suite: server, widget, web and end-to-end
#   .\demo.ps1 stop     stop docker and the test database and redis
#
# Needs Docker Desktop (running), Node and npm. Fills in anything server\.env is missing.
# If Windows refuses to run it: powershell -ExecutionPolicy Bypass -File .\demo.ps1

param([string]$Command = 'start')

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$EnvFile = Join-Path $PSScriptRoot 'server\.env'
$ShopUrl = 'http://127.0.0.1:4174'
$ApiHealth = 'http://localhost:3000/health'
$TestDbContainer = 'insureongo-test-db'
$TestRedisContainer = 'insureongo-test-redis'
$TestRedisPort = 56379

function Say($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Die($text) { Write-Host $text -ForegroundColor Red; exit 1 }

# Call after each program: PowerShell does not stop on its own when one fails.
function Check($what) { if ($LASTEXITCODE -ne 0) { Die "Failed: $what" } }

function RandomBytes($count) {
  $bytes = New-Object byte[] $count
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return , $bytes
}

# One value from server\.env.
function EnvValue($key) {
  $line = Get-Content $EnvFile | Where-Object { $_ -match "^\s*$key\s*=" } | Select-Object -Last 1
  if (-not $line) { return '' }
  return ($line -replace "^\s*$key\s*=", '').Trim().Trim('"', "'")
}

# Appends lines to server\.env without a byte-order mark and with plain newlines, so
# dotenv and docker read every line correctly. Starts a new line first if the file
# does not end with one.
function Add-EnvLines($lines) {
  $text = ''
  if (Test-Path $EnvFile) {
    $existing = [System.IO.File]::ReadAllText($EnvFile)
    if ($existing.Length -gt 0 -and -not $existing.EndsWith("`n")) { $text = "`n" }
  }
  $text += ($lines -join "`n") + "`n"
  [System.IO.File]::AppendAllText($EnvFile, $text, (New-Object System.Text.UTF8Encoding $false))
}

# Fills in whatever server\.env is missing with local demo values. Values already
# there are never changed.
function Check-Env {
  if (-not (Test-Path $EnvFile)) { Say "Creating server\.env" }

  $defaults = [ordered]@{
    POSTGRES_USER           = { 'insureongo' }
    POSTGRES_PASSWORD       = { 'insureongo' }
    POSTGRES_DB             = { 'insureongo' }
    DATABASE_URL            = {
      "postgres://$(EnvValue 'POSTGRES_USER'):$(EnvValue 'POSTGRES_PASSWORD')@db:5432/$(EnvValue 'POSTGRES_DB')"
    }
    PORT                    = { '3000' }
    ENCRYPTION_KEY          = { [Convert]::ToBase64String((RandomBytes 32)) }
    ADMIN_API_KEY           = { [BitConverter]::ToString((RandomBytes 24)).Replace('-', '').ToLower() }
    DEFAULT_COMMISSION_RATE = { '0.1' }
  }

  foreach ($key in $defaults.Keys) {
    if (-not (Test-Path $EnvFile) -or -not (EnvValue $key)) {
      $value = & $defaults[$key]
      Add-EnvLines @("$key=$value")
      Write-Host "Added $key to server\.env"
    }
  }

  # The api reaches Postgres by its container name. localhost there is the api
  # container itself, so a DATABASE_URL copied from a non-docker setup never connects.
  $wanted = "postgres://$(EnvValue 'POSTGRES_USER'):$(EnvValue 'POSTGRES_PASSWORD')@db:5432/$(EnvValue 'POSTGRES_DB')"
  if ((EnvValue 'DATABASE_URL') -ne $wanted) {
    $lines = Get-Content $EnvFile | ForEach-Object {
      if ($_ -match '^\s*DATABASE_URL\s*=') { "DATABASE_URL=$wanted" } else { $_ }
    }
    [System.IO.File]::WriteAllText($EnvFile, ($lines -join "`n") + "`n", (New-Object System.Text.UTF8Encoding $false))
    Write-Host "Set DATABASE_URL in server\.env to the docker database (host db)"
  }

  if ((EnvValue 'ADMIN_API_KEY').Length -lt 32) {
    Die "ADMIN_API_KEY in server\.env is shorter than 32 characters. Delete that line and run again."
  }
}

function Install-Deps {
  Say "Installing dependencies"
  foreach ($dir in '.', 'server', 'web', 'widget', 'demo-store') {
    if (-not (Test-Path (Join-Path $dir 'node_modules'))) {
      npm ci --prefix $dir; Check "npm ci in $dir"
    }
  }
}

function Wait-ForApi {
  Say "Waiting for the API"
  for ($i = 0; $i -lt 60; $i++) {
    try {
      Invoke-WebRequest -UseBasicParsing -Uri $ApiHealth -TimeoutSec 3 | Out-Null
      Write-Host "API is up."
      return
    } catch { Start-Sleep -Seconds 2 }
  }
  Die "The API did not answer $ApiHealth within 2 minutes. Check: docker compose logs api"
}

# Runs inside the api container, where DATABASE_URL already points at the docker
# database. From this machine, localhost:5432 can reach another Postgres installed on
# Windows instead.
function In-Api([string]$What, [string[]]$Cmd) {
  docker compose exec -T api @Cmd
  Check $What
}

function Migrate {
  Say "Applying migrations"
  In-Api 'migrations' @('npm', 'run', '--silent', 'db:migrate')
}

function Reset-Data {
  Say "Resetting demo data"
  In-Api 'demo:reset (is docker running? .\demo.ps1 start)' @('npm', 'run', '--silent', 'demo:reset')

  # The shop keeps its orders in a file. If it is running, ask it to clear them so its
  # memory and the file agree; otherwise remove the file.
  try {
    Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$ShopUrl/reset" -TimeoutSec 3 | Out-Null
    Write-Host "Cleared the shop's orders."
  } catch {
    Remove-Item 'demo-store\data\state.json' -ErrorAction SilentlyContinue
    Write-Host "Cleared the shop's saved state."
  }
}

function Start-Demo {
  Check-Env
  Install-Deps

  Say "Building and starting docker (api, web, postgres, redis)"
  # Recreated every time, so a changed server\.env is always picked up.
  docker compose up --build --force-recreate -d; Check 'docker compose up'

  Wait-ForApi
  Migrate
  Reset-Data

  Say "Ready"
  Write-Host @"
  Merchant pages   http://localhost:8080
  Admin            http://localhost:8080/admin
  Shop             $ShopUrl

  Admin page key   $(EnvValue 'ADMIN_API_KEY')

  At signup use domain 127.0.0.1 and tick phones, laptops and tablets.
  Leave the webhook secret blank so one is generated.

  Starting the shop now. Ctrl+C stops it; docker keeps running (.\demo.ps1 stop).
"@
  npm run dev --prefix demo-store
}

# The server tests use their own database on 55432, never the demo one.
function Start-TestDb {
  $running = docker ps --format '{{.Names}}' | Where-Object { $_ -eq $TestDbContainer }
  if (-not $running) {
    try { docker rm -f $TestDbContainer 2>$null | Out-Null } catch {}
    docker run -d --name $TestDbContainer -e POSTGRES_PASSWORD=test -e POSTGRES_DB=insurance_test -p 55432:5432 postgres:16 | Out-Null
    Check 'starting the test database'
  }
  for ($i = 0; $i -lt 30; $i++) {
    try { docker exec $TestDbContainer pg_isready -U postgres -d insurance_test 2>$null | Out-Null } catch {}
    if ($LASTEXITCODE -eq 0) { return }
    Start-Sleep -Seconds 1
  }
  Die "The test database did not start."
}

# Its own Redis too, on a port nothing else is likely to hold.
function Start-TestRedis {
  $running = docker ps --format '{{.Names}}' | Where-Object { $_ -eq $TestRedisContainer }
  if (-not $running) {
    try { docker rm -f $TestRedisContainer 2>$null | Out-Null } catch {}
    docker run -d --name $TestRedisContainer -p "${TestRedisPort}:6379" redis:7 | Out-Null
    Check 'starting the test redis'
  }
}

function Test-All {
  Install-Deps

  Say "Starting the test database (55432) and redis ($TestRedisPort)"
  Start-TestDb
  Start-TestRedis
  $env:REDIS_URL = "redis://127.0.0.1:$TestRedisPort"

  Say "Server tests";      npm test --prefix server; Check 'server tests'
  Say "Widget tests";      npm test --prefix widget; Check 'widget tests'
  Say "Web tests";         npm test --prefix web; Check 'web tests'
  Say "End-to-end test";   npm run test:e2e; Check 'end-to-end test'

  Say "All tests passed"
}

function Stop-Demo {
  Say "Stopping"
  docker compose down; Check 'docker compose down'
  try { docker rm -f $TestDbContainer $TestRedisContainer 2>$null | Out-Null } catch {}
}

switch ($Command) {
  'start' { Start-Demo }
  'reset' { Check-Env; Reset-Data }
  'test'  { Test-All }
  'stop'  { Stop-Demo }
  default { Die "Usage: .\demo.ps1 [start|reset|test|stop]" }
}
