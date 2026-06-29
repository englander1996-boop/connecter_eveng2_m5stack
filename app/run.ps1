# =====================================================================
# M5 SensorCast G2 - standalone dev launcher (PowerShell native)
# =====================================================================
# Start Vite in the background, poll the URL until ready, launch the
# Even Hub Simulator, and on exit kill the whole Vite process tree with
# taskkill /T /F. Self-contained (mirrors xr_runners/run.ps1).
#
#   .\run.ps1            Vite + Even Hub Simulator (glasses view)
#   .\run.ps1 -WebOnly   Vite + browser (quick check on the PC)
#   .\run.ps1 -SimOnly   Simulator only (expects Vite already running)
#   .\run.ps1 -Help      usage
# =====================================================================

[CmdletBinding()]
param(
    [switch]$WebOnly,
    [switch]$SimOnly,
    [switch]$Help
)

$ErrorActionPreference = 'Stop'

$Root     = $PSScriptRoot
$Port     = if ($env:PORT) { $env:PORT } else { '5241' }
$ViteHost = '0.0.0.0'
$SimHost  = '127.0.0.1'
$Url      = "http://${SimHost}:${Port}/"

function Show-Help {
    Write-Host @"
M5 SensorCast G2 - dev launcher

  .\run.ps1            Vite + Even Hub Simulator (glasses view)
  .\run.ps1 -WebOnly   Vite + browser (quick check on the PC)
  .\run.ps1 -SimOnly   Simulator only (expects Vite already at $Url)
  .\run.ps1 -Help      this help

Env override: PORT (default 5241)
"@
}

function Test-UrlAlive {
    param([string]$TargetUrl)
    try {
        $res = Invoke-WebRequest -Uri $TargetUrl -Method Head -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        return ($res.StatusCode -ge 200 -and $res.StatusCode -lt 500)
    } catch {
        return $false
    }
}

function Wait-Url {
    param([string]$TargetUrl, [int]$TimeoutSec = 90)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (Test-UrlAlive -TargetUrl $TargetUrl) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Stop-ProcessTree {
    param([int]$ProcessId)
    if (-not $ProcessId) { return }
    # Tree is npx.cmd -> node -> vite. Killing only the parent leaves the
    # child node holding the port, so use taskkill /T (tree) /F (force).
    try { & taskkill.exe /PID $ProcessId /T /F 2>$null | Out-Null } catch { }
}

function Install-IfNeeded {
    if (-not (Test-Path (Join-Path $Root 'node_modules'))) {
        Write-Host "Installing dependencies (first run)..." -ForegroundColor Yellow
        Push-Location $Root
        try {
            & npm install
            if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit $LASTEXITCODE)" }
        } finally {
            Pop-Location
        }
    }
}

# ---- main ----
if ($Help) { Show-Help; return }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js not found in PATH. Install from https://nodejs.org/ (v20+ recommended)."
}

Install-IfNeeded

# Reuse an already-running Vite to avoid a double start / port clash.
$alreadyUp = Test-UrlAlive -TargetUrl $Url

if ($SimOnly) {
    if (-not $alreadyUp) { Write-Host "Note: nothing responding at $Url yet." -ForegroundColor Yellow }
    Write-Host "Launching Even Hub Simulator at $Url ..." -ForegroundColor Cyan
    & npx --yes '@evenrealities/evenhub-simulator@latest' $Url
    return
}

$viteProc = $null
if ($alreadyUp) {
    Write-Host "Vite already running at $Url - reusing it." -ForegroundColor Green
} else {
    Write-Host "Starting Vite dev server..." -ForegroundColor Cyan
    $viteProc = Start-Process -FilePath 'npx.cmd' `
        -ArgumentList @('vite', '--host', $ViteHost, '--port', $Port) `
        -WorkingDirectory $Root `
        -NoNewWindow `
        -PassThru
    Write-Host "Waiting for $Url ..." -NoNewline
    if (-not (Wait-Url -TargetUrl $Url -TimeoutSec 90)) {
        Write-Host " timeout." -ForegroundColor Red
        if ($viteProc -and -not $viteProc.HasExited) { Stop-ProcessTree -ProcessId $viteProc.Id }
        throw "Vite did not become ready at $Url within 90s."
    }
    Write-Host " ready." -ForegroundColor Green
}

try {
    if ($WebOnly) {
        Write-Host "Opening browser at $Url" -ForegroundColor Cyan
        Start-Process $Url
        if ($viteProc) {
            Write-Host "Vite running. Press Ctrl+C to stop." -ForegroundColor Yellow
            $viteProc.WaitForExit()
        }
        return
    }

    Write-Host "Launching Even Hub Simulator..." -ForegroundColor Cyan
    & npx --yes '@evenrealities/evenhub-simulator@latest' $Url
} finally {
    # Only clean up a Vite we started ourselves (leave a reused one alone).
    if ($viteProc -and -not $viteProc.HasExited) {
        Write-Host ""
        Write-Host "Stopping Vite (PID $($viteProc.Id))..." -ForegroundColor Yellow
        Stop-ProcessTree -ProcessId $viteProc.Id
    }
}
