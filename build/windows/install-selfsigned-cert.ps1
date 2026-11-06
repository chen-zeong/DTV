<#
.SYNOPSIS
    Install the DTV self-signed code-signing certificate for the current user.

.DESCRIPTION
    Use this on a machine that will run DTV builds signed with the project's
    self-signed certificate. It installs the PUBLIC certificate (.cer) into:
      - Current user \ Trusted Root Certification Authorities
      - Current user \ Trusted Publishers

    No administrator rights are required. The private key (.pfx) must never be
    shared; only the .cer file is needed.

    This removes the "unknown publisher" warning and makes the Authenticode
    signature valid on that machine. SmartScreen reputation is a separate
    mechanism and may still show a warning for a brand-new file; for public
    distribution use a CA-issued certificate instead.

.PARAMETER Certificate
    Path to dtv-code-signing.cer.

.PARAMETER Unblock
    Optional files (for example dtv.exe) whose Mark-of-the-Web should be
    removed, so Windows stops treating them as downloaded files.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File install-selfsigned-cert.ps1 -Certificate .\dtv-code-signing.cer

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File install-selfsigned-cert.ps1 -Certificate .\dtv-code-signing.cer -Unblock .\dtv.exe
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Certificate,

    [string[]]$Unblock
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
    Write-Host "[install-cert] $Message" -ForegroundColor Cyan
}

$resolved = Resolve-Path -LiteralPath $Certificate -ErrorAction SilentlyContinue
if (-not $resolved) {
    Write-Host "[install-cert] ERROR: certificate not found: $Certificate" -ForegroundColor Red
    exit 1
}
$resolved = $resolved.Path

$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($resolved)
Write-Step "Certificate: $($cert.Subject)"
Write-Step "Thumbprint:  $($cert.Thumbprint)"

foreach ($storeName in @("Root", "TrustedPublisher")) {
    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store($storeName, "CurrentUser")
    $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
    try {
        $found = $store.Certificates | Where-Object { $_.Thumbprint -eq $cert.Thumbprint }
        if ($found) {
            Write-Step "Already trusted in current user store: $storeName"
        } else {
            $store.Add($cert)
            Write-Step "Added to current user store: $storeName"
        }
    } finally {
        $store.Close()
    }
}

foreach ($file in $Unblock) {
    $fileResolved = Resolve-Path -LiteralPath $file -ErrorAction SilentlyContinue
    if (-not $fileResolved) {
        Write-Host "[install-cert] WARNING: file not found, skipped: $file" -ForegroundColor Yellow
        continue
    }
    $streams = Get-Item -LiteralPath $fileResolved.Path -Stream * -ErrorAction SilentlyContinue |
        Where-Object { $_.Stream -eq "Zone.Identifier" }
    if ($streams) {
        Unblock-File -LiteralPath $fileResolved.Path
        Write-Step "Removed Mark-of-the-Web: $($fileResolved.Path)"
    } else {
        Write-Step "No Mark-of-the-Web: $($fileResolved.Path)"
    }
}

Write-Host ""
Write-Step "Done. Signed DTV builds should now show 'DTV Code Signing' as publisher."
Write-Step "Verify with: Get-AuthenticodeSignature <path-to-dtv.exe>"
