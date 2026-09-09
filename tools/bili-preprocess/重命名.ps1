param([string]$Folder = (Split-Path -Parent $PSScriptRoot), [switch]$SmokeTest)
. (Join-Path $PSScriptRoot 'core.ps1')
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$form = New-Object Windows.Forms.Form
$form.Text = '好好唱 · B站文件重命名'
$form.Size = New-Object Drawing.Size(980,640)
$form.MinimumSize = New-Object Drawing.Size(800,500)
$form.StartPosition = 'CenterScreen'
$form.Font = New-Object Drawing.Font('Microsoft YaHei UI',10)
$form.BackColor = [Drawing.Color]::White
$label = New-Object Windows.Forms.Label
$label.Text = '歌手名字'; $label.SetBounds(18,20,90,28)
$artist = New-Object Windows.Forms.TextBox
$artist.SetBounds(110,17,245,30)
$scan = New-Object Windows.Forms.Button
$scan.Text = '重新扫描'; $scan.SetBounds(372,15,115,34)
$execute = New-Object Windows.Forms.Button
$execute.Text = '开始重命名'; $execute.SetBounds(505,15,145,34)
$execute.BackColor = [Drawing.Color]::FromArgb(232,239,255)
$hint = New-Object Windows.Forms.Label
$hint.Text = '格式：歌手 - 歌名。下方两框为查找 / 替换，替换留空即删除；批量修正仅影响勾选项。'
$hint.SetBounds(18,62,920,25)
$grid = New-Object Windows.Forms.DataGridView
$grid.SetBounds(18,146,926,393)
$grid.Anchor = 'Top,Bottom,Left,Right'
$grid.AllowUserToAddRows = $false; $grid.AllowUserToDeleteRows = $false
$grid.RowHeadersVisible = $false; $grid.BackgroundColor = [Drawing.Color]::White
$grid.AutoSizeColumnsMode = 'Fill'; $grid.SelectionMode = 'CellSelect'
$grid.AllowUserToOrderColumns = $false
$grid.AutoGenerateColumns = $false
foreach ($definition in @(@('Selected','处理',8),@('Original','原文件名',32),@('Title','歌名（可修改）',26),@('Target','新文件名',42))) {
    if ($definition[0] -eq 'Selected') { $column = New-Object Windows.Forms.DataGridViewCheckBoxColumn } else { $column = New-Object Windows.Forms.DataGridViewTextBoxColumn }
    $column.Name = $definition[0]; $column.DataPropertyName = $definition[0]; $column.HeaderText = $definition[1]; $column.FillWeight = $definition[2]
    $column.ReadOnly = $definition[0] -in @('Original','Target')
    [void]$grid.Columns.Add($column)
}
$status = New-Object Windows.Forms.Label
$status.SetBounds(18,550,926,43); $status.Anchor = 'Bottom,Left,Right'
$status.Text = '正在读取 NFO…'
$form.Controls.AddRange(@($label,$artist,$scan,$execute,$hint,$grid,$status))
$findText = New-Object Windows.Forms.TextBox
$findText.SetBounds(66,100,122,30); $findText.AccessibleName = '查找文字'
$replaceText = New-Object Windows.Forms.TextBox
$replaceText.SetBounds(250,100,122,30); $replaceText.AccessibleName = '替换文字，留空即删除'
$replaceButton = New-Object Windows.Forms.Button
$replaceButton.Text = '选中项替换'; $replaceButton.SetBounds(386,96,145,36)
$bracketsButton = New-Object Windows.Forms.Button
$bracketsButton.Text = '选中项去掉《》'; $bracketsButton.SetBounds(545,96,160,36)
$undoButton = New-Object Windows.Forms.Button
$undoButton.Text = '撤销批量修正'; $undoButton.SetBounds(719,96,180,36)
$findLabel = New-Object Windows.Forms.Label
$findLabel.Text = '查找'; $findLabel.SetBounds(18,103,45,26)
$replaceLabel = New-Object Windows.Forms.Label
$replaceLabel.Text = '替换'; $replaceLabel.SetBounds(202,103,45,26)
$form.Controls.AddRange(@($findLabel,$replaceLabel,$findText,$replaceText,$replaceButton,$bracketsButton,$undoButton))
$script:batchUndo = @()
function Apply-BatchCorrection([bool]$RemoveBrackets) {
    [void]$grid.EndEdit()
    if (-not $RemoveBrackets -and -not $findText.Text) { $status.Text = '请填写查找文字；替换框留空表示删除。'; return }
    $script:batchUndo = @()
    foreach ($row in $table.Rows) {
        if (-not $row.Selected -or $row.ParseError) { continue }
        $script:batchUndo += [pscustomobject]@{ Row = $row; Title = $row.Title }
        $row.Title = Convert-BatchTitle $row.Title $findText.Text $replaceText.Text -RemoveBrackets:$RemoveBrackets
    }
    Update-Names
    $status.Text = '已修正 ' + $script:batchUndo.Count + ' 项预览。尚未改动文件，检查后点击开始重命名。'
}
$replaceButton.Add_Click({ Apply-BatchCorrection $false })
$bracketsButton.Add_Click({ Apply-BatchCorrection $true })
$undoButton.Add_Click({
    foreach ($item in $script:batchUndo) { if ($item.Row.RowState -ne 'Detached') { $item.Row.Title = $item.Title } }
    $script:batchUndo = @(); Update-Names
    $status.Text = '已撤销最近一次批量修正，仅预览发生变化。'
})
$script:items = @()
$table = New-Object Data.DataTable
[void]$table.Columns.Add('Selected',[bool])
foreach ($name in @('Original','Title','Target','File','Nfo','ParseError')) { [void]$table.Columns.Add($name,[string]) }
$grid.DataSource = $table
$script:refreshing = $false
function Update-Names {
    if ($script:refreshing) { return }; $script:refreshing = $true
    try {
        foreach ($row in $table.Rows) {
            if ($row.ParseError) { $row.Target = '无法处理：' + $row.ParseError; continue }
            if (-not $artist.Text.Trim()) { $row.Target = '请先填写歌手'; continue }
            try { $row.Target = (Get-CleanName $artist.Text) + ' - ' + (Get-CleanName $row.Title) + [IO.Path]::GetExtension($row.File) }
            catch { $row.Target = $_.Exception.Message }
        }
    } finally { $script:refreshing = $false }
}
function Load-Files {
    $form.UseWaitCursor = $true; $scan.Enabled = $false; $execute.Enabled = $false
    try {
        $table.Rows.Clear()
        $script:items = @(Get-PreprocessRows $Folder)
        foreach ($item in $script:items) { [void]$table.Rows.Add($item.Selected,$item.Original,$item.Title,'',$item.File,$item.Nfo,$item.ParseError) }
        Update-Names
        $status.Text = '找到 ' + $table.Rows.Count + " 个媒体文件。原 NFO 自动备份，视频只改名、不转码。`r`n" + $Folder
    } catch { [void][Windows.Forms.MessageBox]::Show($_.Exception.Message,'读取失败') }
    finally { $form.UseWaitCursor = $false; $scan.Enabled = $true; $execute.Enabled = $true }
}
$scan.Add_Click({ Load-Files })
$artist.Add_TextChanged({ Update-Names })
$grid.Add_CellEndEdit({ Update-Names })
$grid.Add_CurrentCellDirtyStateChanged({ if ($grid.IsCurrentCellDirty) { [void]$grid.CommitEdit([Windows.Forms.DataGridViewDataErrorContexts]::Commit) } })
$execute.Add_Click({
    [void]$grid.EndEdit()
    $execute.Enabled = $false; $scan.Enabled = $false; $form.UseWaitCursor = $true
    try {
        $plan = @(New-RenamePlan @($table.Rows) $artist.Text)
        $backup = Invoke-RenamePlan $plan $Folder
        [void][Windows.Forms.MessageBox]::Show(('已处理 ' + $plan.Count + " 组文件。`r`n媒体与 NFO 已按歌手 - 歌名命名，NFO 歌名和歌手已同步。`r`n原 NFO 备份：" + $backup),'完成')
        Load-Files
    } catch { [void][Windows.Forms.MessageBox]::Show($_.Exception.Message,'未完成，请检查提示') }
    finally { $execute.Enabled = $true; $scan.Enabled = $true; $form.UseWaitCursor = $false }
})
if ($SmokeTest) {
    Load-Files
    $artist.Text = '测试歌手'
    $form.Show(); $form.Refresh(); [Windows.Forms.Application]::DoEvents()
    $image = New-Object Drawing.Bitmap($form.Width,$form.Height)
    $form.DrawToBitmap($image,(New-Object Drawing.Rectangle(0,0,$form.Width,$form.Height)))
    $image.Save((Join-Path $PSScriptRoot 'preview.png'))
    $image.Dispose(); $form.Close()
    Write-Output ('GUI rows: ' + $table.Rows.Count)
} else {
    $form.Add_Shown({ Load-Files })
    [void]$form.ShowDialog()
}
