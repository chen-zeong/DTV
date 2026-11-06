<#
.SYNOPSIS
    Create and trust a self-signed code signing certificate for DTV (Windows only).

.DESCRIPTION
    This script:
      1. Creates a code signing certificate (RSA 3072 / SHA256 / 5 years) in
         Cert:\CurrentUser\My.
      2. Trusts it locally by adding the public certificate to the current
         user's "Trusted Root Certification Authorities" and "Trusted
         Publishers" stores, so Get-AuthenticodeSignature reports Valid and
         Windows treats DTV as a known publisher.
      3. Exports the public certificate (.cer, safe to share) and a password
         protected .pfx backup of the private key.
      4. Writes build/windows/certs/signing.json with the thumbprint used by
         sign.ps1.

    The private key stays in the Windows certificate store; no password or key
    material is needed by the build.

.PARAMETER Subject
    Certificate subject. sign.ps1 auto-detects certificates matching
    "CN=DTV Code Signing*".

.PARAMETER Years
    Validity in years. Default: 5.

.PARAMETER Force
    Delete and regenerate an existing certificate with the same subject. The
    old certificate is also removed from the local trust stores.

.PARAMETER NoPfx
    Skip exporting the .pfx backup.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File build\windows\gen-selfsigned-cert.ps1

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File build\windows\gen-selfsigned-cert.ps1 -Force
#>
[CmdletBinding()]
param(
    [string]$Subject = "CN=DTV Code Signing, O=DTV, OU=DTV, C=CN",
    [int]$Years = 5,
    [switch]$Force,
    [switch]$NoPfx
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
    Write-Host "[sign:setup] $Message" -ForegroundColor Cyan
}

function Write-Info([string]$Message) {
    Write-Host "[sign:setup] $Message"
}

function Add-ToUserStore([string]$StoreName, [System.Security.Cryptography.X509Certificates.X509Certificate2]$Certificate) {
    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store($StoreName, "CurrentUser")
    $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
    try {
        $found = $store.Certificates | Where-Object { $_.Thumbprint -eq $Certificate.Thumbprint }
        if (-not $found) {
            $store.Add($Certificate)
            Write-Info "Added to current user store: $StoreName"
        } else {
            Write-Info "Already present in current user store: $StoreName"
        }
    } finally {
        $store.Close()
    }
}

function Remove-FromUserStore([string]$StoreName, [string]$Thumbprint) {
    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store($StoreName, "CurrentUser")
    $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
    try {
        $found = $store.Certificates | Where-Object { $_.Thumbprint -eq $Thumbprint }
        foreach ($item in $found) { $store.Remove($item) }
    } finally {
        $store.Close()
    }
}

$certDir = Join-Path $PSScriptRoot "certs"
$cerPath = Join-Path $certDir "dtv-code-signing.cer"
$pfxPath = Join-Path $certDir "dtv-code-signing.pfx"
$pwdPath = Join-Path $certDir "pfx-password.txt"
$configPath = Join-Path $certDir "signing.json"

if (-not (Test-Path $certDir)) {
    New-Item -ItemType Directory -Path $certDir -Force | Out-Null
}

# ---------------------------------------------------------------------------
# 1. Reuse or create the certificate
# ---------------------------------------------------------------------------
$existing = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert -ErrorAction SilentlyContinue |
    Where-Object { $_.Subject -eq $Subject -and $_.NotAfter -gt (Get-Date) } |
    Sort-Object NotAfter -Descending |
    Select-Object -First 1

if ($existing -and -not $Force) {
    $cert = $existing
    Write-Step "Reusing certificate $($cert.Thumbprint)"
} else {
    if ($existing) {
        Write-Step "Removing old certificate $($existing.Thumbprint)"
        foreach ($storeName in @("My", "Root", "TrustedPublisher")) {
            Remove-FromUserStore -StoreName $storeName -Thumbprint $existing.Thumbprint
        }
    }

    Write-Step "Creating certificate: $Subject ($Years years)"
    $cert = New-SelfSignedCertificate `
        -Type CodeSigningCert `
        -Subject $Subject `
        -FriendlyName "DTV Code Signing (Self-Signed)" `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -KeyAlgorithm RSA `
        -KeyLength 3072 `
        -HashAlgorithm SHA256 `
        -KeyUsage DigitalSignature `
        -KeyExportPolicy Exportable `
        -NotAfter (Get-Date).AddYears($Years)
    Write-Step "Created $($cert.Thumbprint)"
}

# ---------------------------------------------------------------------------
# 2. Local trust: root + trusted publisher
# ---------------------------------------------------------------------------
Add-ToUserStore -StoreName "Root" -Certificate $cert
Add-ToUserStore -StoreName "TrustedPublisher" -Certificate $cert

# ---------------------------------------------------------------------------
# 3. Export .cer (public) and .pfx (private key backup)
# ---------------------------------------------------------------------------
Export-Certificate -Cert $cert -FilePath $cerPath -Type CERT -Force | Out-Null
Write-Info "Public certificate: $cerPath"

if (-not $NoPfx) {
    if (-not (Test-Path $pwdPath)) {
        $bytes = New-Object byte[] 24
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        [IO.File]::WriteAllText($pwdPath, [Convert]::ToBase64String($bytes), [Text.Encoding]::ASCII)
    }
    $plainPassword = [IO.File]::ReadAllText($pwdPath).Trim()
    $securePassword = ConvertTo-SecureString -String $plainPassword -Force -AsPlainText
    Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $securePassword -Force | Out-Null
    Write-Info "Private key backup: $pfxPath"
    Write-Info "PFX password file: $pwdPath (gitignored, never commit it)"
}

# ---------------------------------------------------------------------------
# 4. Write signing.json for sign.ps1
# ---------------------------------------------------------------------------
$config = [ordered]@{
    subject    = $cert.Subject
    thumbprint = $cert.Thumbprint
    notBefore  = $cert.NotBefore.ToString("o")
    notAfter   = $cert.NotAfter.ToString("o")
    cer        = [IO.Path]::GetFileName($cerPath)
    pfx        = if ($NoPfx) { $null } else { [IO.Path]::GetFileName($pfxPath) }
}
$json = $config | ConvertTo-Json
[IO.File]::WriteAllText($configPath, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Info "Signing config: $configPath"

# ---------------------------------------------------------------------------
# 5. Summary
# ---------------------------------------------------------------------------
Write-Host ""
Write-Step "Done. Thumbprint: $($cert.Thumbprint)"
Write-Info "Valid until: $($cert.NotAfter.ToString('yyyy-MM-dd'))"
Write-Info ""
Write-Info "Next steps:"
Write-Info "  wails3 build                  # build and sign bin\dtv.exe automatically"
Write-Info "  wails3 task windows:sign      # re-sign an existing bin\dtv.exe"
Write-Info ""
Write-Info "To trust builds on another machine, install the public .cer as that user:"
Write-Info "  Import-Certificate -FilePath '$cerPath' -CertStoreLocation Cert:\CurrentUser\Root"
Write-Info "  Import-Certificate -FilePath '$cerPath' -CertStoreLocation Cert:\CurrentUser\TrustedPublisher"
