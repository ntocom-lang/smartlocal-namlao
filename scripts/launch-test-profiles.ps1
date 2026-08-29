<#
.SYNOPSIS
  Launch Google Chrome with isolated Test Profiles for SmartLocal testing.
.EXAMPLE
  .\scripts\launch-test-profiles.ps1 -Role admin
  .\scripts\launch-test-profiles.ps1 -Role technician
#>

param (
    [ValidateSet(
        "admin", "officer", "officer-fin", "staff", "technician", "technician-2",
        "viewer", "council", "citizen",
        "fleet-admin", "fleet-staff", "fleet-viewer"
    )]
    [string]$Role = "admin",
    # ชี้สนามซ้อมเป็นค่าเริ่มต้นเสมอ ห้ามเปลี่ยนกลับเป็น localhost:5173
    # เพราะ dev server อ่าน VITE_TENANT_SLUG จาก .env.local ซึ่งชี้ไป อปท. จริงอยู่
    # ถ้าจะทดสอบในเครื่อง ให้ส่ง -Url เองอย่างตั้งใจ และเช็คก่อนว่า .env.local ชี้ไปไหน
    [string]$Url = "https://demo.rk-networks.com"
)

$chromePaths = @(
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)

$chromeExe = $chromePaths | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $chromeExe) {
    Write-Error "Google Chrome executable not found."
    exit 1
}

$baseProfileDir = Join-Path $PSScriptRoot "..\.chrome-test-profiles"
$profilePath = Join-Path $baseProfileDir "TEST-$Role"

if (-not (Test-Path $profilePath)) {
    New-Item -ItemType Directory -Path $profilePath -Force | Out-Null
}

$profilePath = (Resolve-Path -LiteralPath $profilePath).Path
$profileArgument = '--user-data-dir="{0}"' -f $profilePath

Write-Host "🚀 Launching Chrome for Role: [$Role] (Profile: TEST-$Role)" -ForegroundColor Green
$argsList = @(
    $profileArgument,
    "--no-first-run",
    "--no-default-browser-check",
    $Url
)

Start-Process -FilePath $chromeExe -ArgumentList $argsList
