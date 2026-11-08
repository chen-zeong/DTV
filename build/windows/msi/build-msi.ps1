param(
    [string]$WixBin = $env:WIX_BIN,
    [string]$SourceExe = "",
    [string]$Output = "",
    [string]$Version = ""
)

$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$wxsPath = Join-Path $PSScriptRoot "dtv.wxs"

if (-not $SourceExe) {
    $SourceExe = Join-Path $projectRoot "bin\dtv.exe"
}
if (-not (Test-Path -LiteralPath $SourceExe)) {
    throw "dtv.exe not found: $SourceExe (run: wails3 build SIGN_ENABLED=false)"
}
$SourceExe = (Resolve-Path -LiteralPath $SourceExe).Path
$sourceDir = Split-Path -Parent $SourceExe

if (-not $Version) {
    $infoPath = Join-Path $projectRoot "build\windows\info.json"
    $info = Get-Content -LiteralPath $infoPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $Version = $info.fixed.file_version
}
if (-not $Version) {
    $Version = "4.1.0"
}

if (-not $WixBin) {
    $candidate = Join-Path $projectRoot ".tmp-debug\wix"
    if (Test-Path -LiteralPath (Join-Path $candidate "candle.exe")) {
        $WixBin = $candidate
    }
}
if (-not $WixBin -or -not (Test-Path -LiteralPath (Join-Path $WixBin "candle.exe"))) {
    throw "WiX v3 candle.exe not found. Download https://github.com/wixtoolset/wix3/releases/download/wix3141rtm/wix314-binaries.zip and pass -WixBin <dir> or set WIX_BIN."
}

$candle = Join-Path $WixBin "candle.exe"
$light = Join-Path $WixBin "light.exe"
$objDir = Join-Path $PSScriptRoot "obj"
New-Item -ItemType Directory -Force -Path $objDir | Out-Null
$wixTemp = Join-Path $objDir "temp"
New-Item -ItemType Directory -Force -Path $wixTemp | Out-Null
# WiX light writes temp cabs to %TEMP%; system TEMP may be read-only in restricted environments.
$env:TMP = $wixTemp
$env:TEMP = $wixTemp
$wixobj = Join-Path $objDir "dtv.wixobj"

if (-not $Output) {
    $Output = Join-Path $projectRoot "bin\dtv-amd64.msi"
}
$outputDir = Split-Path -Parent $Output
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

Write-Host "[msi] candle $Version"
& $candle -nologo -arch x64 `
    "-dProductVersion=$Version" `
    "-dProjectDir=$projectRoot" `
    "-dSourceDir=$sourceDir" `
    -out $wixobj $wxsPath
if ($LASTEXITCODE -ne 0) { throw "candle failed (exit $LASTEXITCODE)" }

Write-Host "[msi] light"
# -sval disables ICE validation: it depends on the local Windows Installer service and often fails in CI/sandboxes.
& $light -nologo -sval -ext WixUIExtension -out $Output $wixobj
if ($LASTEXITCODE -ne 0) { throw "light failed (exit $LASTEXITCODE)" }

Remove-Item -LiteralPath $wixobj -Force -ErrorAction SilentlyContinue

$file = Get-Item -LiteralPath $Output
Write-Host ("[msi] OK: {0} ({1:N0} bytes)" -f $file.FullName, $file.Length)
