Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'

function Read-SongNfo([string]$File) {
    $settings = New-Object System.Xml.XmlReaderSettings
    $settings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver = $null
    $reader = [System.Xml.XmlReader]::Create($File, $settings)
    try {
        $doc = New-Object System.Xml.XmlDocument
        $doc.XmlResolver = $null
        $doc.Load($reader)
        return ,$doc
    } finally { $reader.Dispose() }
}
function Get-CleanName([string]$Value) {
    $name = ($Value -replace '[<>:"/\\|?*\x00-\x1f]', '_').Trim().TrimEnd('.', ' ')
    if (-not $name) { throw '歌名或歌手不能为空' }
    return $name
}
function Get-PreprocessRows([string]$Folder) {
    foreach ($file in Get-ChildItem -LiteralPath $Folder -File | Where-Object { $_.Extension -match '^\.(mp4|mkv|avi|mov|webm|m4v|mp3|flac|wav|m4a|ogg|aac)$' } | Sort-Object Name) {
        $nfo = Join-Path $Folder ($file.BaseName + '.nfo')
        $title = ''; $errorText = ''
        try {
            if (-not (Test-Path -LiteralPath $nfo -PathType Leaf)) { throw '缺少同名 NFO' }
            $doc = Read-SongNfo $nfo
            $node = $doc.SelectSingleNode('/*/title')
            if (-not $node) { throw 'NFO 没有 title 字段' }
            $title = ($node.InnerText -replace '^\s*【[^】]*】\s*', '').Trim()
            if (-not $title) { throw '歌曲名称为空' }
        } catch { $errorText = $_.Exception.Message }
        [pscustomobject]@{ Selected = (-not $errorText); File = $file.FullName; Nfo = $nfo; Title = $title; Original = $file.Name; Target = ''; Status = $errorText; ParseError = $errorText }
    }
}
function New-RenamePlan([object[]]$Rows, [string]$Artist) {
    $artistName = Get-CleanName $Artist
    $targets = @{}
    foreach ($row in $Rows) {
        if (-not $row.Selected) { continue }
        if ($row.ParseError) { throw ($row.Original + ': ' + $row.ParseError) }
        $title = Get-CleanName $row.Title
        $stem = $artistName + ' - ' + $title
        $folder = Split-Path -Parent $row.File
        $mediaTarget = Join-Path $folder ($stem + [IO.Path]::GetExtension($row.File))
        $nfoTarget = Join-Path $folder ($stem + '.nfo')
        foreach ($pair in @(@($row.File, $mediaTarget), @($row.Nfo, $nfoTarget))) {
            if ($pair[1].Length -gt 240) { throw ($row.Original + ': 目标路径太长，请缩短歌名') }
            $key = $pair[1].ToLowerInvariant()
            if ($targets.ContainsKey($key)) { throw ('名称冲突：' + [IO.Path]::GetFileName($pair[1]) + '，请编辑歌名或取消勾选重复项') }
            $targets[$key] = $true
            if ([string]::Equals($pair[0], $pair[1], [StringComparison]::OrdinalIgnoreCase)) { continue }
            if (Test-Path -LiteralPath $pair[1]) { throw ('目标已存在，不会覆盖：' + $pair[1]) }
        }
        $mediaInfo = Get-Item -LiteralPath $row.File
        [pscustomobject]@{ Source = $row.File; Target = $mediaTarget; NfoSource = $row.Nfo; NfoTarget = $nfoTarget; Title = $row.Title.Trim(); Artist = $Artist.Trim(); Size = $mediaInfo.Length; Modified = $mediaInfo.LastWriteTimeUtc.Ticks; NfoHash = (Get-FileHash -LiteralPath $row.Nfo -Algorithm SHA256).Hash }
    }
}
function Invoke-RenamePlan([object[]]$Plan, [string]$Folder) {
    if (-not $Plan.Count) { throw '请先选择需要处理的文件' }
    $root = [IO.Path]::GetFullPath($Folder).TrimEnd('\') + '\'
    foreach ($item in $Plan) {
        foreach ($p in @($item.Source, $item.Target, $item.NfoSource, $item.NfoTarget)) {
            if (-not [string]::Equals(([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($p)).TrimEnd('\') + '\'), $root, [StringComparison]::OrdinalIgnoreCase)) { throw '操作路径超出所选目录' }
        }
        $info = Get-Item -LiteralPath $item.Source
        if ($info.Length -ne $item.Size -or $info.LastWriteTimeUtc.Ticks -ne $item.Modified -or (Get-FileHash -LiteralPath $item.NfoSource).Hash -ne $item.NfoHash) { throw '文件在预览后发生变化，请重新扫描' }
        foreach ($pair in @(@($item.Source, $item.Target), @($item.NfoSource, $item.NfoTarget))) {
            if ($pair[0] -ine $pair[1] -and (Test-Path -LiteralPath $pair[1])) { throw ('目标已存在：' + $pair[1]) }
        }
    }
    $backup = Join-Path $Folder ('.好好唱重命名备份\' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8))
    New-Item -ItemType Directory -Path $backup | Out-Null
    $operations = New-Object 'System.Collections.Generic.List[object]'
    $index = 0
    foreach ($item in $Plan) {
        $saved = Join-Path $backup ($index.ToString('D4') + '.nfo')
        Copy-Item -LiteralPath $item.NfoSource -Destination $saved
        $doc = Read-SongNfo $saved
        $doc.SelectSingleNode('/*/title').InnerText = $item.Title
        foreach ($node in @($doc.SelectNodes('/*/artist'))) { [void]$doc.DocumentElement.RemoveChild($node) }
        $artistNode = $doc.CreateElement('artist'); $artistNode.InnerText = $item.Artist
        [void]$doc.DocumentElement.AppendChild($artistNode)
        $prepared = Join-Path $backup ($index.ToString('D4') + '.new.xml')
        $doc.Save($prepared)
        $operations.Add([pscustomobject]@{ Item = $item; Backup = $saved; Prepared = $prepared; MediaMoved = $false; NfoMoved = $false; NfoWritten = $false })
        $index++
    }
    $operations | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $backup '重命名记录.json') -Encoding UTF8
    try {
        foreach ($op in $operations) {
            $item = $op.Item
            if ($item.Source -ine $item.Target) { Move-Item -LiteralPath $item.Source -Destination $item.Target; $op.MediaMoved = $true }
            if ($item.NfoSource -ine $item.NfoTarget) { Move-Item -LiteralPath $item.NfoSource -Destination $item.NfoTarget; $op.NfoMoved = $true }
            $op.NfoWritten = $true
            Copy-Item -LiteralPath $op.Prepared -Destination $item.NfoTarget -Force
        }
        '完成' | Set-Content -LiteralPath (Join-Path $backup '状态.txt') -Encoding UTF8
    } catch {
        $failure = $_.Exception.Message; $rollbackErrors = @()
        for ($i = $operations.Count - 1; $i -ge 0; $i--) {
            $op = $operations[$i]; $item = $op.Item
            try {
                if ($op.NfoWritten) { Copy-Item -LiteralPath $op.Backup -Destination $item.NfoTarget -Force }
                if ($op.NfoMoved) { Move-Item -LiteralPath $item.NfoTarget -Destination $item.NfoSource }
                if ($op.MediaMoved) { Move-Item -LiteralPath $item.Target -Destination $item.Source }
            } catch { $rollbackErrors += $_.Exception.Message }
        }
        $message = '操作失败：' + $failure + "`r`n备份与记录：" + $backup
        if ($rollbackErrors.Count) { $message += "`r`n部分回退失败：" + ($rollbackErrors -join '; ') } else { $message += "`r`n已回退本批文件修改。" }
        $message | Set-Content -LiteralPath (Join-Path $backup '状态.txt') -Encoding UTF8
        throw $message
    }
    return $backup
}

function Convert-BatchTitle {
    param([string]$Title, [string]$Find, [string]$Replacement, [switch]$RemoveBrackets)
    if ($RemoveBrackets) { return $Title.Replace('《','').Replace('》','').Trim() }
    if (-not $Find) { throw '查找文字不能为空' }
    return $Title.Replace($Find,$Replacement).Trim()
}
