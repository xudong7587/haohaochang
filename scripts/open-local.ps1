$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$data = Join-Path $root 'data-preview'
New-Item -ItemType Directory -Path $data -Force | Out-Null
function Test-Preview {
  try {
    $info = Invoke-RestMethod 'http://127.0.0.1:3210/preview-info' -TimeoutSec 2
    return $info.mode -eq 'local-preview'
  } catch { return $false }
}
try {
  if (!(Test-Preview)) {
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $process = Start-Process -FilePath $node -ArgumentList 'scripts/preview.mjs' -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $data 'preview.log') -RedirectStandardError (Join-Path $data 'preview-error.log') -PassThru
    $ready = $false
    for ($i = 0; $i -lt 45; $i++) {
      if (Test-Preview) { $ready = $true; break }
      if ($process.HasExited) { break }
      Start-Sleep -Seconds 1
    }
    if (!$ready) { throw "Local preview could not start. See $data\preview-error.log" }
  }
  Start-Process 'http://127.0.0.1:3210/admin'
} catch {
  $dialog = New-Object -ComObject WScript.Shell
  $dialog.Popup($_.Exception.Message, 0, 'Haohaochang Local', 16) | Out-Null
  exit 1
}
