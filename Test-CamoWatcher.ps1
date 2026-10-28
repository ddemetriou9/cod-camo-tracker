$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'CamoProgress.ps1')
. (Join-Path $PSScriptRoot 'LocalCapture.ps1')
function Assert-Camo([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}
$formattedTitle='C'+[char]0x200B+'all of Duty'+[char]0x00AE+[char]0x200B
Assert-Camo ([CamoDesktopCapture]::NormalizeTitle($formattedTitle) -match 'Call of Duty') 'Invisible format characters in the game title must not block matching.'
Assert-Camo ([CamoDesktopCapture]::NormalizeTitle('Other app') -notmatch 'Call of Duty|Modern Warfare') 'Unrelated titles must stay excluded.'
$testRoot = Join-Path $PSScriptRoot ('validation\watcher-' + [guid]::NewGuid().ToString('N'))
$statePath = Join-Path $testRoot 'progress.json'
$state = New-CamoState $statePath
$names = @('M4', 'Han 86')
Assert-Camo (Test-CamoMenuHeader @('CHALLENGES / CAMO CHALLENGES /','CAMO SELECT','AXION PROGRESSION')) 'Camo menu header should enable a full scan.'
Assert-Camo (-not (Test-CamoMenuHeader @('KILL CONFIRMED','WINNING','AXION','WEAPON LEVEL UP'))) 'Gameplay and level-up notifications must not enable full-screen OCR.'
Assert-Camo (-not (Test-CamoMenuHeader @('WEAPON PROGRESSION','AFTER ACTION REPORT'))) 'Round summary must stay outside full OCR until a dedicated parser exists.'
$headerRect=[CamoDesktopCapture]::MenuHeaderBounds(2520,1400)
Assert-Camo (($headerRect.Width*$headerRect.Height)/(2520.0*1400) -lt 0.11) 'Menu scout region must stay below 11 percent of full-frame pixels.'
$overview=@('CAMO SELECT','HAN 86 PROGRESSION','MILITARY [8/8]','SPECIAL [3/3]','COMPLETIONIST [1/4]','PRESTIGE [0/4]','MILITARY CAMO B')
$overviewReading=Get-CamoObservation $overview $names ''
Assert-Camo ($overviewReading.counters.Count -eq 4) 'Progression overview should yield four category readings.'
Assert-Camo (@($overviewReading.counters|Where-Object {$_.kind -eq 'category' -and $_.category -eq 'MILITARY' -and $_.current -eq 8}).Count -eq 1) 'Completed Military category should stay a category, not a challenge.'
Assert-Camo ($null -eq (Get-CamoObservation @('CAMO CHALLENGES','HAN 86','MILITARY [8/8]') $names '')) 'A lone category label is not a valid progression overview.'
$partiallyValid=Get-CamoObservation @('CAMO SELECT','HAN 86 PROGRESSION','MILITARY [9/8]','SPECIAL [3/3]') $names ''
Assert-Camo (@($partiallyValid.counters|Where-Object {$_.category -eq 'MILITARY'}).Count -eq 0) 'Impossible category totals must be rejected independently.'
$axion=Get-CamoObservation @('CAMO SELECT','AXI0NPROGRESSION','MILITARY [8/8]') @('Axion','M4') ''
Assert-Camo ($axion.weapon -eq 'AXION' -and $axion.counters.Count -eq 1 -and $axion.counters[0].current -eq 8) 'A known progression heading and one Military total should be sufficient, including joined O/0 OCR.'
$zeroReading=Get-CamoObservation @('CAMO SELECT','AXION PROGRESSION',('SPECIAL ['+[char]0x00D8+'/3]')) @('Axion','M4') ''
Assert-Camo ($zeroReading.counters[0].current -eq 0 -and $zeroReading.counters[0].category -eq 'SPECIAL') 'A slashed OCR zero inside a category fraction should read as zero.'
Assert-Camo ($null -eq (Get-CamoObservation @('CAMO SELECT','AXI0N','MILITARY [8/8]') @('Axion','M4') '')) 'O/0 correction must not apply outside a progression heading.'
$overviewPath=Join-Path $PSScriptRoot ('validation\overview-'+[guid]::NewGuid().ToString('N')+'\progress.json')
$overviewState=New-CamoState $overviewPath
Assert-Camo ((Update-CamoProgress $overviewState $overviewReading $overviewPath) -eq 0) 'Overview needs two matching observations.'
Assert-Camo ((Update-CamoProgress $overviewState $overviewReading $overviewPath) -eq 4) 'Confirmed overview should save four category readings.'
$overviewReload=New-CamoState $overviewPath
Assert-Camo (@($overviewReload.entries.Values|Where-Object {$_.kind -eq 'category'}).Count -eq 4) 'Category metadata must survive persistence.'
Assert-Camo ((Update-CamoProgress $overviewReload $overviewReading $overviewPath) -eq 0) 'Repeated overview must not rewrite progress.'
$menu = @('M4 CAMO CHALLENGES', 'Get 50 eliminations', '12 / 50')
$observation = Get-CamoObservation $menu $names ''
Assert-Camo ($null -ne $observation) 'Menu should be recognized.'
Assert-Camo ($null -eq (Get-CamoObservation @('M4 MATCH', 'Get 50 eliminations', '12 / 50') $names '')) 'Gameplay must not be recognized.'
Assert-Camo ($null -eq (Get-CamoObservation @('UNKNOWN CAMO CHALLENGES', 'Get 50 eliminations', '12 / 50') $names '')) 'Unknown weapons must be skipped.'
Assert-Camo ($null -eq (Get-CamoObservation @('M4 CAMO CHALLENGES', '12 / 50') $names '')) 'Unlabeled fractions must be skipped.'
Assert-Camo ($null -eq (Get-CamoObservation @('M4 CAMO CHALLENGES', 'Get 50 eliminations', '99 / 50') $names '')) 'Impossible fractions must be skipped.'
Assert-Camo ($null -eq (Get-CamoObservation @('M4 HAN 86 CAMO CHALLENGES', 'Get 50 eliminations', '12 / 50') $names '')) 'Multiple weapon names must be skipped.'
Assert-Camo ((Update-CamoProgress $state $observation $statePath) -eq 0) 'First reading must not write.'
Assert-Camo (-not (Test-Path -LiteralPath $statePath)) 'No file before confirmation.'
Assert-Camo ((Update-CamoProgress $state $observation $statePath) -eq 1) 'Second reading must write.'
$savedHash = (Get-FileHash -LiteralPath $statePath).Hash
Assert-Camo ((Update-CamoProgress $state $observation $statePath) -eq 0) 'Duplicates must not write.'
Assert-Camo ($state.writes -eq 1 -and (Get-FileHash -LiteralPath $statePath).Hash -eq $savedHash) 'Duplicate changed persistence.'
$changed = Get-CamoObservation @('M4 CAMO CHALLENGES', 'Get 50 eliminations', '13 / 50') $names ''
Update-CamoProgress $state $changed $statePath | Out-Null
Update-CamoProgress $state $null $statePath | Out-Null
Assert-Camo ((Update-CamoProgress $state $changed $statePath) -eq 0) 'Menu exit must clear pending confirmation.'
Assert-Camo ((Update-CamoProgress $state $changed $statePath) -eq 1) 'Stable changed count must save.'
Update-CamoProgress $state $observation $statePath | Out-Null
Update-CamoProgress $state $observation $statePath | Out-Null
Assert-Camo ($state.writes -eq 2) 'Decreased OCR reading must not write.'
$reloaded = New-CamoState $statePath
Assert-Camo ((Update-CamoProgress $reloaded $changed $statePath) -eq 0) 'Restart must preserve deduplication.'
Assert-Camo ($reloaded.entries.Count -eq 1 -and @($reloaded.entries.Values)[0].current -eq 13) 'Latest state must survive restart.'
'PASS: menu gating, unknown/ambiguous weapons, invalid/unlabeled counters, confirmation, exit reset, changes, duplicate suppression, decreases, restart persistence.'

# Synthetic menu stays in memory: the live OCR path is exercised without any desktop capture.
$bitmap = New-Object System.Drawing.Bitmap 1400, 500
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$font = New-Object System.Drawing.Font 'Arial', 38
try {
    $graphics.Clear([System.Drawing.Color]::White)
    $graphics.DrawString('M4 CAMO CHALLENGES', $font, [System.Drawing.Brushes]::Black, 40, 40)
    $graphics.DrawString('Get 50 eliminations', $font, [System.Drawing.Brushes]::Black, 40, 150)
    $graphics.DrawString('12 / 50', $font, [System.Drawing.Brushes]::Black, 40, 260)
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    $lines = @(Read-CamoBitmap $bitmap $engine)
    $ocrObservation = Get-CamoObservation $lines $names ''
    Assert-Camo ($null -ne $ocrObservation -and $ocrObservation.counters[0].current -eq 12) ('In-memory OCR failed: ' + ($lines -join ' | '))
    $firstHash = Get-CamoBitmapHash $bitmap
    Assert-Camo ($firstHash -eq (Get-CamoBitmapHash $bitmap)) 'Identical bitmap hash changed.'
    $graphics.FillRectangle([System.Drawing.Brushes]::Black, 5, 5, 50, 50)
    Assert-Camo ($firstHash -ne (Get-CamoBitmapHash $bitmap)) 'Changed bitmap hash was missed.'
} finally { $font.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
Assert-Camo (@(Get-ChildItem -LiteralPath $testRoot -File | Where-Object { $_.Extension -in @('.png', '.jpg', '.bmp') }).Count -eq 0) 'Watcher test saved a screenshot.'
'PASS: in-memory Windows OCR, unchanged/changed image hashes, no screenshot files written.'
Write-Host ('Test state: ' + $statePath)
