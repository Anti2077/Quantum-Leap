$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$IperfVersion = "3.21"
$IperfSha256 = "656e4405ebd620121de7ceca3eaf43a88f79ea1b857d041a6a0b1314801acdd8"
$IperfUrl = "https://github.com/esnet/iperf/releases/download/$IperfVersion/iperf-$IperfVersion.tar.gz"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$BuildRoot = if ($env:IPERF_BUILD_DIR) { $env:IPERF_BUILD_DIR } else { Join-Path $Root "src-tauri\target\iperf-sidecar\windows" }
$Archive = Join-Path $BuildRoot "iperf-$IperfVersion.tar.gz"
$Source = Join-Path $BuildRoot "iperf-$IperfVersion"
$Output = Join-Path $Root "src-tauri\binaries"
$LicenseOutput = Join-Path $Output "licenses"
$CygwinRoot = if ($env:CYGWIN_ROOT) { $env:CYGWIN_ROOT } else { "C:\tools\cygwin" }
$Bash = Join-Path $CygwinRoot "bin\bash.exe"
$Cygcheck = Join-Path $CygwinRoot "bin\cygcheck.exe"
$Tar = Join-Path $env:SystemRoot "System32\tar.exe"

if (-not [Environment]::Is64BitOperatingSystem) {
  throw "Windows x64 sidecar builds require a 64-bit operating system."
}
if (-not (Test-Path $Bash)) {
  throw "Cygwin bash was not found at $Bash. Set CYGWIN_ROOT to the Cygwin installation directory."
}
if (-not (Test-Path $Tar)) {
  throw "Windows tar was not found at $Tar."
}

New-Item -ItemType Directory -Force -Path $BuildRoot, $Output, $LicenseOutput | Out-Null
Get-ChildItem -Path $Output -Filter "*.dll" -File -ErrorAction SilentlyContinue | Remove-Item -Force
if (-not (Test-Path $Archive)) {
  Invoke-WebRequest -Uri $IperfUrl -OutFile $Archive
}
$Sha256 = [System.Security.Cryptography.SHA256]::Create()
$ArchiveStream = [System.IO.File]::OpenRead($Archive)
try {
  $ActualHash = ([System.BitConverter]::ToString($Sha256.ComputeHash($ArchiveStream))).Replace("-", "").ToLowerInvariant()
}
finally {
  $ArchiveStream.Dispose()
  $Sha256.Dispose()
}
if ($ActualHash -ne $IperfSha256) {
  throw "iperf source checksum mismatch: expected $IperfSha256, got $ActualHash"
}

if (Test-Path $Source) {
  Remove-Item -Recurse -Force $Source
}
& $Tar -xzf $Archive -C $BuildRoot
if ($LASTEXITCODE -ne 0) {
  throw "Unable to extract the iperf source archive (exit code $LASTEXITCODE)."
}

$env:IPERF_SOURCE_WINDOWS = $Source
$CygSource = (& $Bash -lc 'cygpath -u "$IPERF_SOURCE_WINDOWS"').Trim()
& $Bash -lc "set -euo pipefail; cd '$CygSource'; ./configure --disable-shared --enable-static --without-openssl --without-sctp; make -j`$(getconf _NPROCESSORS_ONLN)"
if ($LASTEXITCODE -ne 0) {
  throw "Cygwin iperf build failed with exit code $LASTEXITCODE"
}

$BuiltExe = Join-Path $Source "src\iperf3.exe"
$Sidecar = Join-Path $Output "iperf3-x86_64-pc-windows-msvc.exe"
Copy-Item $BuiltExe $Sidecar -Force
Copy-Item (Join-Path $Source "LICENSE") (Join-Path $LicenseOutput "iperf3-LICENSE") -Force

$DependencyLines = & $Cygcheck $BuiltExe
$CygwinDlls = $DependencyLines |
  ForEach-Object { $_.Trim() } |
  Where-Object { $_ -match '\.dll$' -and $_.StartsWith($CygwinRoot, [System.StringComparison]::OrdinalIgnoreCase) } |
  Sort-Object -Unique
if (-not $CygwinDlls) {
  throw "cygcheck did not report any Cygwin runtime DLLs"
}
foreach ($Dll in $CygwinDlls) {
  Copy-Item $Dll (Join-Path $Output (Split-Path $Dll -Leaf)) -Force
}

$CygwinLicenseCandidates = @(
  (Join-Path $CygwinRoot "usr\share\doc\cygwin\COPYING"),
  (Join-Path $CygwinRoot "usr\share\doc\Cygwin\COPYING"),
  (Join-Path $CygwinRoot "usr\share\doc\common-licenses\LGPL-3.0")
)
$CygwinLicense = $CygwinLicenseCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $CygwinLicense) {
  throw "Unable to locate the Cygwin runtime license"
}
Copy-Item $CygwinLicense (Join-Path $LicenseOutput "cygwin-LICENSE") -Force

$VersionOutput = & $Sidecar --version 2>&1 | Out-String
if ($VersionOutput -notmatch "iperf $IperfVersion") {
  throw "Unexpected iperf version output: $VersionOutput"
}
$HelpOutput = & $Sidecar --help 2>&1 | Out-String
if ($HelpOutput -notmatch "--json-stream") {
  throw "The built iperf sidecar does not support --json-stream"
}
Write-Host "Windows iperf3 sidecar ready: $Sidecar"
