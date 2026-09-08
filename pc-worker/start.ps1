$ErrorActionPreference = 'Stop'
$env:PYTHONUTF8 = '1'
$env:UV_HTTP_TIMEOUT = '600'
$env:UV_HTTP_RETRIES = '5'
Set-Location -LiteralPath $PSScriptRoot
$runtime = Join-Path $PSScriptRoot 'runtime'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
$env:UV_PYTHON_INSTALL_DIR = Join-Path $runtime 'python'
$env:UV_CACHE_DIR = Join-Path $runtime 'cache'
$uv = Join-Path $runtime 'uv-0.8.22\uv.exe'
if (!(Test-Path -LiteralPath $uv)) {
  Write-Host 'Downloading the Python environment manager (first run only)...'
  Invoke-WebRequest 'https://github.com/astral-sh/uv/releases/download/0.8.22/uv-x86_64-pc-windows-msvc.zip' -OutFile (Join-Path $runtime 'uv.zip')
  Expand-Archive -LiteralPath (Join-Path $runtime 'uv.zip') -DestinationPath (Split-Path $uv) -Force
}
$python = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (!(Test-Path -LiteralPath $python)) {
  & $uv venv --python 3.11 (Join-Path $PSScriptRoot '.venv')
  if ($LASTEXITCODE -ne 0) { throw 'Python setup failed. Check internet access and retry.' }
}
$hardwareJson = & $python (Join-Path $PSScriptRoot 'hardware.py')
if ($LASTEXITCODE -ne 0) { throw 'Hardware detection failed.' }
$hardwarePlan = $hardwareJson | ConvertFrom-Json
$hardwareJson | Set-Content -LiteralPath (Join-Path $runtime 'hardware.json') -Encoding UTF8
Write-Host "Device plan: $($hardwarePlan.device) / $($hardwarePlan.runtime) / $($hardwarePlan.model)"
Write-Host $hardwarePlan.reason
$marker = Join-Path $runtime "ready-$($hardwarePlan.runtime)-$($hardwarePlan.torch)-v4"
if (!(Test-Path -LiteralPath $marker)) {
  Write-Host 'Installing audio worker. First download can be several GB; please wait...'
  $torchSpec = "torch==$($hardwarePlan.torch)+$($hardwarePlan.runtime)"
  $audioSpec = "torchaudio==$($hardwarePlan.torch)+$($hardwarePlan.runtime)"
  $torchIndex = "https://download.pytorch.org/whl/$($hardwarePlan.runtime)"
  $cachedWheel = Join-Path $runtime "wheels/torch-$($hardwarePlan.torch)+$($hardwarePlan.runtime)-cp311-cp311-win_amd64.whl"
  if (!(Test-Path -LiteralPath $cachedWheel)) {
    & $python (Join-Path $PSScriptRoot 'download_runtime.py') $hardwarePlan.torch $hardwarePlan.runtime
    if ($LASTEXITCODE -ne 0) { throw 'Runtime download interrupted. Run start.cmd again to resume.' }
  }
  if (Test-Path -LiteralPath $cachedWheel) {
    & $uv pip install --python $python $cachedWheel $audioSpec --index-url $torchIndex
  } else {
    & $uv pip install --python $python $torchSpec $audioSpec --index-url $torchIndex
  }
  if ($LASTEXITCODE -ne 0) { throw 'PyTorch installation failed. Retry start.cmd.' }
  & $uv pip install --python $python $torchSpec $audioSpec -r (Join-Path $PSScriptRoot 'requirements.txt') imageio-ffmpeg==0.6.0 soundfile psutil==7.0.0 --extra-index-url $torchIndex --index-strategy unsafe-best-match
  if ($LASTEXITCODE -ne 0) { throw 'Worker installation failed. Retry start.cmd.' }
  Set-Content -LiteralPath $marker -Value 'ready'
}
& $python (Join-Path $PSScriptRoot 'run.py')
