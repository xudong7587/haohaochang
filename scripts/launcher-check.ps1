$ErrorActionPreference = 'Stop'
$launchRoot = Join-Path ([IO.Path]::GetTempPath()) ('ktv-launch-test-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $launchRoot | Out-Null
$savedMode = $env:KTV_LOCAL_ONLY
try {
  foreach ($name in @('start.cmd', 'open.vbs', 'open.ps1')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "../pc-worker/$name") -Destination $launchRoot
  }
  # Replace environment installation with a recorder; never download models or open LAN listeners.
  @'
@{ openUi = $env:RESOURCE_AI_OPEN_UI; localOnly = $env:KTV_LOCAL_ONLY } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'started.json')
exit 0
'@ | Set-Content -LiteralPath (Join-Path $launchRoot 'start.ps1')
  $env:KTV_LOCAL_ONLY = '1'
  Start-Process -FilePath $env:ComSpec -ArgumentList ('/d /c ""' + (Join-Path $launchRoot 'start.cmd') + '""') -WorkingDirectory $launchRoot -WindowStyle Hidden -Wait
  $marker = Join-Path $launchRoot 'started.json'
  for ($n = 0; $n -lt 40 -and !(Test-Path -LiteralPath $marker); $n++) { Start-Sleep -Milliseconds 250 }
  $actual = Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
  if ($actual.openUi -ne '0' -or $actual.localOnly -ne '1') { throw 'Launcher did not preserve headless/local-only settings' }
  Start-Sleep -Milliseconds 500
  Write-Output 'Windows start.cmd -> hidden launcher -> headless worker startup passed (isolated stub, no LAN or model download).'
} finally {
  $env:KTV_LOCAL_ONLY = $savedMode
  $resolvedLaunch = [IO.Path]::GetFullPath($launchRoot)
  $allowedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  if (!$resolvedLaunch.StartsWith($allowedTemp, [StringComparison]::OrdinalIgnoreCase) -or !(Split-Path $resolvedLaunch -Leaf).StartsWith('ktv-launch-test-')) { throw 'Unexpected cleanup path' }
  Remove-Item -LiteralPath $resolvedLaunch -Recurse -Force
}
