$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw '请先安装 Node.js 24。' }
if (-not (Test-Path -LiteralPath 'node_modules')) { npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw '依赖安装失败' } }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw '前端构建失败' }
Write-Host '资源准备完成后，打开 http://127.0.0.1:3210/simulator。关闭此窗口即停止预览。'
node scripts/preview.mjs
