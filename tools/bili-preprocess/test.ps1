. (Join-Path $PSScriptRoot 'core.ps1')
function Assert($condition,[string]$message) { if (-not $condition) { throw $message } }
$temp = Join-Path ([IO.Path]::GetTempPath()) ('hhc-rename-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null
function Seed([string]$folder,[string]$name,[string]$title) {
    [IO.File]::WriteAllText((Join-Path $folder ($name+'.mp4')),'unchanged-media-bytes')
    [IO.File]::WriteAllText((Join-Path $folder ($name+'.nfo')),('<?xml version="1.0" encoding="utf-8"?><episodedetails><title>'+[Security.SecurityElement]::Escape($title)+'</title><season>1</season></episodedetails>'),(New-Object Text.UTF8Encoding($false)))
}
Seed $temp 'BV-test1' '【专辑】测试 & 歌曲'
$rows = @(Get-PreprocessRows $temp)
Assert ($rows[0].Title -eq '测试 & 歌曲') 'XML parsing failed'
$plan = @(New-RenamePlan $rows '歌手甲')
$oldHash = (Get-FileHash -LiteralPath $plan[0].Source).Hash
$backup = Invoke-RenamePlan $plan $temp
Assert ((Get-FileHash -LiteralPath $plan[0].Target).Hash -eq $oldHash) 'Media changed'
$xml = Read-SongNfo $plan[0].NfoTarget
Assert ($xml.episodedetails.artist -eq '歌手甲') 'Artist missing'
Assert ($xml.episodedetails.title -eq '测试 & 歌曲') 'Title missing'
Assert ($xml.episodedetails.season -eq '1') 'Original fields lost'
Assert (Test-Path -LiteralPath (Join-Path $backup '0000.nfo')) 'Backup missing'
$rows = @(Get-PreprocessRows $temp)
$plan = @(New-RenamePlan $rows '歌手甲')
[void](Invoke-RenamePlan $plan $temp)
Assert ((Get-FileHash -LiteralPath $plan[0].Target).Hash -eq $oldHash) 'Repeat run changed media'
Seed $temp 'duplicate' '【另张专辑】测试 & 歌曲'
$rejected = $false
try { New-RenamePlan @(Get-PreprocessRows $temp) '歌手甲' | Out-Null } catch { $rejected = $true }
Assert $rejected 'Duplicate not rejected'
$lockedFolder = Join-Path $temp 'locked'
New-Item -ItemType Directory -Path $lockedFolder | Out-Null
Seed $lockedFolder 'locked-source' '【专辑】锁定歌曲'
$lockedPlan = @(New-RenamePlan @(Get-PreprocessRows $lockedFolder) '歌手乙')
$originalXmlHash = (Get-FileHash -LiteralPath $lockedPlan[0].NfoSource).Hash
$handle = [IO.File]::Open($lockedPlan[0].NfoSource,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
$rejected = $false
try { Invoke-RenamePlan $lockedPlan $lockedFolder | Out-Null } catch { $rejected = $true } finally { $handle.Dispose() }
Assert $rejected 'Locked file should fail'
Assert (Test-Path -LiteralPath $lockedPlan[0].Source) 'Rollback did not restore media name'
Assert (-not (Test-Path -LiteralPath $lockedPlan[0].Target)) 'Rollback left target'
Assert ((Get-FileHash -LiteralPath $lockedPlan[0].NfoSource).Hash -eq $originalXmlHash) 'Rollback damaged NFO'
Write-Output 'PASS: XML/album extraction, artist-first names, metadata sync, unchanged media, backup, repeated run, collision rejection, locked-file rollback.'
Write-Output ('Fixture: ' + $temp)

Assert ((Convert-BatchTitle '《晴天》' '' '' -RemoveBrackets) -eq '晴天') 'Bracket correction failed'
Assert ((Convert-BatchTitle '《晴天》 MV MV' ' MV' '') -eq '《晴天》') 'Literal deletion failed'
Assert ((Convert-BatchTitle 'A[1]' '[1]' '$1') -eq 'A$1') 'Replacement should be literal'
Write-Output 'Batch correction tests passed'
