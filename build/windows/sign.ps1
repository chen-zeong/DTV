<#
.SYNOPSIS
    Sign a Windows executable or installer with an Authenticode certificate.

.DESCRIPTION
    Works with certificates in the Windows certificate store and with .pfx
    files. It does not need signtool.exe or the Windows SDK: signing uses
    Set-AuthenticodeSignature (SHA256 + RFC3161 timestamp over HTTP).

    Certificate resolution order:
      1. -Thumbprint
      2. -PfxPath (the .pfx is imported into Cert:\CurrentUser\My if needed)
      3. environment variable DTV_SIGN_THUMBPRINT
      4. build/windows/certs/signing.json (written by gen-selfsigned-cert.ps1)
      5. auto-detect a "CN=DTV Code Signing*" certificate in CurrentUser\My
      6. auto-detect the same subject in LocalMachine\My

.PARAMETER Path
    File to sign: bin\dtv.exe or bin\dtv-amd64-installer.exe.

.PARAMETER SkipIfMissing
    Exit successfully (with a warning) when no certificate is configured.
    Used by the normal build so an unsigned local build still works.

.PARAMETER Skip
    Do nothing and exit 0. Used by dev builds.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File build\windows\sign.ps1 -Path bin\dtv.exe

.EXAMPLE
    $env:DTV_SIGN_PFX_PASSWORD = "secret"
    powershell -NoProfile -ExecutionPolicy Bypass -File build\windows\sign.ps1 -Path bin\dtv.exe -PfxPath C:\certs\company.pfx
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [string]$Thumbprint,
    [string]$PfxPath,
    [string]$PfxPassword,

    [string]$TimestampServer = "http://timestamp.digicert.com",
    [switch]$NoTimestamp,
    [switch]$SkipIfMissing,
    [switch]$Skip,
    [switch]$VerifyOnly
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
    Write-Host "[sign] $Message" -ForegroundColor Cyan
}

function Write-Info([string]$Message) {
    Write-Host "[sign] $Message"
}

function Write-Warn([string]$Message) {
    Write-Host "[sign] WARNING: $Message" -ForegroundColor Yellow
}

function Fail([string]$Message) {
    Write-Host "[sign] ERROR: $Message" -ForegroundColor Red
    exit 1
}

if ($Skip) {
    Write-Info "Skipped (build is a dev build or signing is disabled)."
    exit 0
}

$resolved = Resolve-Path -LiteralPath $Path -ErrorAction SilentlyContinue
if (-not $resolved) {
    Fail "File not found: $Path"
}
$resolved = $resolved.Path

if ($VerifyOnly) {
    $check = Get-AuthenticodeSignature -LiteralPath $resolved
    $check | Format-List Status, StatusMessage, Path, @{n = "Signer"; e = { $_.SignerCertificate.Subject } }
    if ($check.Status -ne "Valid") { exit 1 }
    exit 0
}

# ---------------------------------------------------------------------------
# Resolve the signing certificate
# ---------------------------------------------------------------------------
$cert = $null
$signingConfig = Join-Path $PSScriptRoot "certs\signing.json"

if ($PfxPath) {
    $pfxResolved = Resolve-Path -LiteralPath $PfxPath -ErrorAction SilentlyContinue
    if (-not $pfxResolved) { Fail "PFX file not found: $PfxPath" }
    $pfxResolved = $pfxResolved.Path

    if (-not $PfxPassword) { $PfxPassword = $env:WAILS_WINDOWS_CERT_PASSWORD }
    if (-not $PfxPassword) { $PfxPassword = $env:DTV_SIGN_PFX_PASSWORD }
    if (-not $PfxPassword) {
        Fail "No PFX password. Pass -PfxPassword, or set WAILS_WINDOWS_CERT_PASSWORD / DTV_SIGN_PFX_PASSWORD."
    }

    try {
        $pfxCert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($pfxResolved, $PfxPassword)
    } catch {
        Fail "Could not open PFX $pfxResolved (wrong password?): $($_.Exception.Message)"
    }
    $candidate = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert -ErrorAction SilentlyContinue |
        Where-Object { $_.Thumbprint -eq $pfxCert.Thumbprint -and $_.HasPrivateKey } |
        Select-Object -First 1

    if (-not $candidate) {
        Write-Info "Importing PFX into Cert:\CurrentUser\My"
        $securePassword = ConvertTo-SecureString -String $PfxPassword -Force -AsPlainText
        $imported = Import-PfxCertificate -FilePath $pfxResolved -CertStoreLocation "Cert:\CurrentUser\My" -Password $securePassword
        $candidate = $imported | Where-Object { $_.Thumbprint -eq $pfxCert.Thumbprint } | Select-Object -First 1
        if (-not $candidate) {
            $candidate = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert |
                Where-Object { $_.Thumbprint -eq $pfxCert.Thumbprint -and $_.HasPrivateKey } |
                Select-Object -First 1
        }
    }
    $cert = $candidate
} else {
    $thumbprintSource = "explicit"
    if (-not $Thumbprint) {
        $Thumbprint = $env:DTV_SIGN_THUMBPRINT
        if ($Thumbprint) { $thumbprintSource = "environment" }
    }
    if (-not $Thumbprint -and (Test-Path $signingConfig)) {
        try {
            $Thumbprint = (Get-Content -LiteralPath $signingConfig -Raw | ConvertFrom-Json).thumbprint
            if ($Thumbprint) { $thumbprintSource = "signing.json" }
        } catch {
            Write-Warn "Could not read $signingConfig, ignoring it."
        }
    }

    if ($Thumbprint) {
        $thumb = ($Thumbprint -replace '[^0-9A-Fa-f]', '').ToUpperInvariant()
        $cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert -ErrorAction SilentlyContinue |
            Where-Object { $_.Thumbprint -eq $thumb } | Select-Object -First 1
        if (-not $cert) {
            $cert = Get-ChildItem Cert:\LocalMachine\My -CodeSigningCert -ErrorAction SilentlyContinue |
                Where-Object { $_.Thumbprint -eq $thumb } | Select-Object -First 1
        }
        if (-not $cert) {
            if ($thumbprintSource -eq "signing.json") {
                # Stale config (e.g. cloned repo, certificate regenerated on another
                # machine): fall back to auto-detection instead of failing.
                Write-Warn "Thumbprint $thumb from signing.json was not found; falling back to auto-detection."
            } else {
                Fail "No certificate with thumbprint $thumb in CurrentUser\My or LocalMachine\My."
            }
        }
    }

    if (-not $cert) {
        $cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert -ErrorAction SilentlyContinue |
            Where-Object { $_.Subject -like "CN=DTV Code Signing*" -and $_.HasPrivateKey } |
            Sort-Object NotAfter -Descending | Select-Object -First 1
        if (-not $cert) {
            $cert = Get-ChildItem Cert:\LocalMachine\My -CodeSigningCert -ErrorAction SilentlyContinue |
                Where-Object { $_.Subject -like "CN=DTV Code Signing*" -and $_.HasPrivateKey } |
                Sort-Object NotAfter -Descending | Select-Object -First 1
        }
    }
}

if (-not $cert) {
    if ($SkipIfMissing) {
        Write-Warn "No code signing certificate found; leaving $resolved unsigned."
        Write-Warn "Run: wails3 task windows:sign:setup   (creates a local self-signed certificate)"
        exit 0
    }
    Fail "No code signing certificate found. Run: wails3 task windows:sign:setup"
}

if (-not $cert.HasPrivateKey) {
    Fail "Certificate $($cert.Thumbprint) has no private key. Make sure the PFX was imported for the current user."
}

if ($cert.NotAfter -lt (Get-Date)) {
    Fail "Certificate $($cert.Thumbprint) expired on $($cert.NotAfter.ToString('yyyy-MM-dd')). Run: wails3 task windows:sign:setup -Force"
}

Write-Info "Signing $resolved"
Write-Info "Certificate: $($cert.Subject)"
Write-Info "Thumbprint:  $($cert.Thumbprint)"

# ---------------------------------------------------------------------------
# Sign
# ---------------------------------------------------------------------------
$psParams = @{
    LiteralPath = $resolved
    Certificate = $cert
}

$supportsHash = (Get-Command Set-AuthenticodeSignature).Parameters.ContainsKey("HashAlgorithm")
if ($supportsHash) { $psParams["HashAlgorithm"] = "SHA256" }
if (-not $NoTimestamp) { $psParams["TimestampServer"] = $TimestampServer }

$result = $null
$lastError = $null
for ($attempt = 1; $attempt -le 2; $attempt++) {
    try {
        $result = Set-AuthenticodeSignature @psParams
        $lastError = $null
        break
    } catch {
        $lastError = $_
        if ($attempt -lt 2) {
            Write-Warn "Signing attempt $attempt failed: $($_.Exception.Message). Retrying..."
            Start-Sleep -Seconds 2
        }
    }
}

if ($lastError) {
    Fail "Signing failed: $($lastError.Exception.Message). If only the timestamp server is unreachable, retry with -NoTimestamp (not recommended for release builds)."
}

if (-not $result -or $result.Status -eq "NotSigned") {
    Fail "Signing did not produce a signature (status: $($result.Status))."
}

if ($result.Status -ne "Valid") {
    $message = "$($result.Status): $($result.StatusMessage)"
    $signatureExists = (Get-AuthenticodeSignature -LiteralPath $resolved).SignerCertificate -ne $null
    if ($signatureExists) {
        Write-Warn "Signature was applied but the chain is not fully trusted: $message"
        Write-Warn "Install the public certificate into Trusted Root / Trusted Publishers, or use a CA-issued certificate."
    } else {
        Fail "Signature verification failed: $message"
    }
}

# ---------------------------------------------------------------------------
# Verify
# ---------------------------------------------------------------------------
$verify = Get-AuthenticodeSignature -LiteralPath $resolved
Write-Host ""
Write-Info "Status:      $($verify.Status)"
Write-Info "Signer:      $($verify.SignerCertificate.Subject)"
if ($verify.TimeStamperCertificate) {
    Write-Info "Timestamped: $($verify.TimeStamperCertificate.Subject)"
} else {
    Write-Warn "No timestamp: the signature expires together with the certificate."
}
if ($verify.Status -eq "Valid") {
    Write-Step "OK: $resolved is signed and trusted."
} else {
    Write-Step "Signed: $resolved (status: $($verify.Status))"
}
