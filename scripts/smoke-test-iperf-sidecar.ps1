param(
  [Parameter(Mandatory = $true)]
  [string]$Binary,
  [int]$Port = 45201,
  [string]$ExpectedVersion = "3.21"
)

$ErrorActionPreference = "Stop"
$Binary = (Resolve-Path $Binary).Path
$SourceDirectory = Split-Path $Binary -Parent
$Staging = Join-Path ([System.IO.Path]::GetTempPath()) "quantum-leap-iperf-$([Guid]::NewGuid().ToString('N'))"
$Output = [System.IO.Path]::GetTempFileName()
$Server = $null
try {
  New-Item -ItemType Directory -Path $Staging | Out-Null
  Copy-Item $Binary (Join-Path $Staging "iperf3.exe")
  Get-ChildItem -Path $SourceDirectory -Filter "*.dll" -File | Copy-Item -Destination $Staging
  $Binary = Join-Path $Staging "iperf3.exe"
  $env:PATH = "$env:SystemRoot\System32;$env:SystemRoot"

  $VersionOutput = & $Binary --version 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0 -or $VersionOutput -notmatch "iperf $([regex]::Escape($ExpectedVersion))") {
    throw "Unexpected iperf version output: $VersionOutput"
  }
  $Server = Start-Process -FilePath $Binary -ArgumentList @("-s", "-1", "-p", "$Port") -PassThru -WindowStyle Hidden
  Start-Sleep -Milliseconds 300
  & $Binary -c 127.0.0.1 -p $Port --json-stream -t 1 -P 1 | Set-Content -Encoding utf8 $Output
  if ($LASTEXITCODE -ne 0) {
    throw "iperf3 loopback client exited with code $LASTEXITCODE"
  }
  $Server.WaitForExit(5000) | Out-Null
  if (-not (Select-String -Path $Output -SimpleMatch '"event":"interval"' -Quiet)) {
    throw "iperf3 loopback output did not contain an interval event"
  }
  Write-Host "iperf3 sidecar loopback smoke test passed"
}
finally {
  if ($Server -and -not $Server.HasExited) {
    $Server.Kill()
  }
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $Staging
  Remove-Item -Force -ErrorAction SilentlyContinue $Output
}
