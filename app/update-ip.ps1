# =====================================================================
# M5 SensorCast G2 - IP 自動更新スクリプト
# =====================================================================
# テザリングを入れ直すと M5 の IP が変わる。このスクリプトは:
#   1. 同じネットワーク上の M5 (ポート81が開いている機器) を自動で探す
#   2. src/main.ts の WS_URL と app.json の whitelist を新 IP に書き換える
#   3. npm run build + evenhub pack で out.ehpk を作り直す
#
#   .\update-ip.ps1             探して書き換えて再パックまで
#   .\update-ip.ps1 -NoPack     書き換えだけ (シミュレータ/QRサイドロード用)
#   .\update-ip.ps1 -Ip 10.0.0.5  スキャンせず IP を手動指定
# =====================================================================

[CmdletBinding()]
param(
    [string]$Ip,
    [switch]$NoPack,
    [switch]$Help
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot

if ($Help) {
    Write-Host @"
M5 SensorCast G2 - IP 自動更新

  .\update-ip.ps1             M5 を探して WS_URL / whitelist を書き換え、out.ehpk を再パック
  .\update-ip.ps1 -NoPack     書き換えのみ (run やQRサイドロードだけならこれで十分)
  .\update-ip.ps1 -Ip x.x.x.x スキャンせず IP を手動指定
"@
    return
}

# ---- 1. M5 を探す ---------------------------------------------------
function Get-MyIPv4 {
    $cand = Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object { $_.IPAddress -notlike '169.254*' -and $_.IPAddress -ne '127.0.0.1' } |
        Sort-Object -Property { $_.InterfaceAlias -notlike 'Wi-Fi*' } |
        Select-Object -First 1
    if (-not $cand) { throw "IPv4 アドレスが見つからない。Wi-Fi(テザリング)につながっている?" }
    return $cand.IPAddress
}

function Find-M5 {
    $mine = Get-MyIPv4
    $prefix = ($mine -split '\.')[0..2] -join '.'
    Write-Host "PC は $mine 。 $prefix.0/24 でポート 81 を探索中..." -ForegroundColor Cyan

    $probes = 1..254 | ForEach-Object {
        $addr = "$prefix.$_"
        $c = New-Object System.Net.Sockets.TcpClient
        [pscustomobject]@{ ip = $addr; task = $c.ConnectAsync($addr, 81); client = $c }
    }
    Start-Sleep -Seconds 3
    $hits = @($probes | Where-Object { $_.client.Connected } | ForEach-Object { $_.ip })
    $probes | ForEach-Object { try { $_.client.Close() } catch { } }

    if ($hits.Count -eq 0) {
        throw "M5 が見つからない。M5 の電源と Wi-Fi 接続 (本体画面の ws:// 表示) を確認して。"
    }
    if ($hits.Count -gt 1) {
        Write-Host "ポート81が開いている機器が複数: $($hits -join ', ') 。先頭を使う。" -ForegroundColor Yellow
    }
    return $hits[0]
}

if (-not $Ip) { $Ip = Find-M5 }
Write-Host "M5 の IP: $Ip" -ForegroundColor Green

# ---- 2. ファイル書き換え --------------------------------------------
# BOM 無し UTF-8 で書き戻す (BOM が付くと evenhub-cli が app.json を読めない)
$utf8 = New-Object System.Text.UTF8Encoding($false)
$ipPattern = '(?<=\b(?:https?|wss?)://)\d+\.\d+\.\d+\.\d+'

foreach ($rel in @('src\main.ts', 'app.json')) {
    $path = Join-Path $Root $rel
    $text = [System.IO.File]::ReadAllText($path)
    $new = [regex]::Replace($text, $ipPattern, $Ip)
    if ($new -ne $text) {
        [System.IO.File]::WriteAllText($path, $new, $utf8)
        Write-Host "updated: $rel" -ForegroundColor Green
    } else {
        Write-Host "no change: $rel (既に $Ip)" -ForegroundColor DarkGray
    }
}

# ---- 3. 再パック ------------------------------------------------------
if ($NoPack) {
    Write-Host "`n-NoPack 指定なので書き換えのみ。シミュレータは 'run' で起動。" -ForegroundColor Cyan
} else {
    Push-Location $Root
    try {
        Write-Host "`nnpm run build ..." -ForegroundColor Cyan
        & npm run build
        if ($LASTEXITCODE -ne 0) { throw "npm run build 失敗 (exit $LASTEXITCODE)" }
        Write-Host "packing out.ehpk ..." -ForegroundColor Cyan
        & npx --yes '@evenrealities/evenhub-cli' pack app.json dist
        if ($LASTEXITCODE -ne 0) { throw "evenhub pack 失敗 (exit $LASTEXITCODE)" }
    } finally {
        Pop-Location
    }
}

# ---- 4. 次にやることの案内 --------------------------------------------
$pcIp = Get-MyIPv4
Write-Host ""
Write-Host "== done ==" -ForegroundColor Green
Write-Host "シミュレータ:      run"
Write-Host "実機QRサイドロード: npx @evenrealities/evenhub-cli qr --url `"http://${pcIp}:5241`""
if (-not $NoPack) {
    Write-Host "確定版の配布:      out.ehpk を Even Hub にアップロード"
}
