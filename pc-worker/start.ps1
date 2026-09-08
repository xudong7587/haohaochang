$ErrorActionPreference = 'Stop'
$env:PYTHONUTF8 = '1'
Set-Location -LiteralPath $PSScriptRoot
$runtime = Join-Path $PSScriptRoot 'runtime'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
$env:UV_PYTHON_INSTALL_DIR = Join-Path $runtime 'python'
$env:UV_CACHE_DIR = Join-Path $runtime 'cache'
$uv = Join-Path $runtime 'uv.exe'
if (!(Test-Path -LiteralPath $uv)) {
  Write-Host 'Downloading the Python environment manager (first run only)...'
  Invoke-WebRequest 'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip' -OutFile (Join-Path $runtime 'uv.zip')
  Expand-Archive -LiteralPath (Join-Path $runtime 'uv.zip') -DestinationPath $runtime -Force
}
$python = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (!(Test-Path -LiteralPath $python)) {
  & $uv venv --python 3.11 (Join-Path $PSScriptRoot '.venv')
  if ($LASTEXITCODE -ne 0) { throw 'Python setup failed. Check internet access and retry.' }
}
if (!(Test-Path -LiteralPath (Join-Path $runtime 'ready-v1'))) {
  Write-Host 'Installing CUDA audio worker. First download is several GB; please wait...'
  & $uv pip install --python $python torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cu121
  if ($LASTEXITCODE -ne 0) { throw 'PyTorch installation failed. Retry start.cmd.' }
  & $uv pip install --python $python torch==2.5.1+cu121 torchaudio==2.5.1+cu121 -r (Join-Path $PSScriptRoot 'requirements.txt') imageio-ffmpeg==0.6.0 soundfile --extra-index-url https://download.pytorch.org/whl/cu121 --index-strategy unsafe-best-match
  if ($LASTEXITCODE -ne 0) { throw 'Worker installation failed. Retry start.cmd.' }
  Set-Content -LiteralPath (Join-Path $runtime 'ready-v1') -Value 'ready'
}
& $python (Join-Path $PSScriptRoot 'run.py')
