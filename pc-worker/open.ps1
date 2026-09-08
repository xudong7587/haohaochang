$ErrorActionPreference = 'Stop'
$env:PYTHONUTF8 = '1'
$runtime = Join-Path $PSScriptRoot 'runtime'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
$log = Join-Path $runtime 'launcher.log'
$mutex = New-Object System.Threading.Mutex($false, 'Local\HaohaochangResourceAiLauncher')
$locked = $false
try {
  $configPath = Join-Path $PSScriptRoot 'worker.json'
  if (Test-Path -LiteralPath $configPath) {
    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    $online = $false
    try {
      $health = Invoke-RestMethod "http://127.0.0.1:$($config.port)/health" -Headers @{Authorization="Bearer $($config.key)"} -TimeoutSec 3
      $online = $health.protocol -eq 'ktv-separation-v1'
    } catch { $online = $false }
    if ($online) {
      if ($env:RESOURCE_AI_OPEN_UI -ne '0') {
        Start-Process "http://127.0.0.1:$($config.port)/ui#$($config.key)"
      }
      'Existing local service opened.' | Set-Content -LiteralPath $log
      exit
    }
  }
  $locked = $mutex.WaitOne(0)
  if (!$locked) { exit }
  Start-Transcript -LiteralPath $log -Force | Out-Null
  & (Join-Path $PSScriptRoot 'start.ps1')
  if ($LASTEXITCODE -ne 0) { throw "Worker exited with code $LASTEXITCODE. See $log" }
} catch {
  $launchFailure = $_
  try { Stop-Transcript | Out-Null } catch {}
  if ($locked) { $mutex.ReleaseMutex(); $locked = $false }
  $launchFailure | Out-String | Add-Content -LiteralPath $log
  $dialog = New-Object -ComObject WScript.Shell
  $dialog.Popup("Startup failed. Details: $log`n$($launchFailure.Exception.Message)", 20, 'Haohaochang Resource AI', 16) | Out-Null
} finally {
  try { Stop-Transcript | Out-Null } catch {}
  if ($locked) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
