[CmdletBinding()]
param(
    [ValidateRange(2, 60)][int]$IntervalSeconds = 4,
    [string]$ProcessPattern = '^(cod|cod[0-9]+|modernwarfare[0-9]*)$',
    [string]$TitlePattern = 'Call of Duty|Modern Warfare',
    [switch]$CheckOnly,
    [string]$Weapon,
    [string]$StatePath
)
$ErrorActionPreference = 'Stop'
if (-not $StatePath) { $StatePath = Join-Path $PSScriptRoot 'data\progress.json' }
. (Join-Path $PSScriptRoot 'CamoProgress.ps1')
. (Join-Path $PSScriptRoot 'LocalCapture.ps1')
[CamoDesktopCapture]::SetProcessDPIAware() | Out-Null
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { throw 'Install an English Windows OCR language pack before starting.' }
$settings = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'watch-settings.json') | ConvertFrom-Json
$rosterPath = Join-Path $PSScriptRoot 'weapons.json'
if (Test-Path -LiteralPath $rosterPath) {
    $roster = Get-Content -Raw -LiteralPath $rosterPath | ConvertFrom-Json
    $settings.weaponNames = @(@($settings.weaponNames) + @($roster.weapons | ForEach-Object { $_.name }) | Sort-Object -Unique)
}
$state = New-CamoState $StatePath
if ($CheckOnly) {
    $foreground = [CamoDesktopCapture]::GetForegroundWindow()
    $foregroundProcessId = [uint32]0
    [CamoDesktopCapture]::GetWindowThreadProcessId($foreground, [ref]$foregroundProcessId) | Out-Null
    $foregroundProcess = Get-Process -Id $foregroundProcessId -ErrorAction SilentlyContinue
    [pscustomobject]@{
        ocrLanguage = $engine.RecognizerLanguage.LanguageTag
        configuredWeaponNames = @($settings.weaponNames).Count
        foregroundMatchesGame = ($null -ne $foregroundProcess -and $foregroundProcess.ProcessName -match $ProcessPattern -and [CamoDesktopCapture]::Title($foreground) -match $TitlePattern)
        screenshotsSaved = 0
        loadedProgressEntries = $state.entries.Count
    } | ConvertTo-Json
    return
}
$lastHash = $null
$lastHeaderHash=$null
$headerIsMenu=$false
$lastWindow = [IntPtr]::Zero
$lastStatus = ''
$mutexHash = [Security.Cryptography.SHA256]::Create()
try {
    $mutexName = 'Local\MW4CamoWatcher_' + [BitConverter]::ToString($mutexHash.ComputeHash([Text.Encoding]::UTF8.GetBytes([IO.Path]::GetFullPath($StatePath).ToUpperInvariant()))).Replace('-', '')
} finally { $mutexHash.Dispose() }
$watchMutex = New-Object System.Threading.Mutex -ArgumentList @($false, $mutexName)
$ownsMutex = $false
try {
try { $ownsMutex = $watchMutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $ownsMutex = $true }
if (-not $ownsMutex) { throw 'Another camo watcher already owns this progress file. Stop its console or dashboard first.' }
Write-Host ('Camo watcher running. Allow about '+([Math]::Max(10,$IntervalSeconds)+$IntervalSeconds+2)+' seconds to detect a new menu and confirm it.')
Write-Host 'No screenshot files are saved. Ctrl+C or close this window to stop.'
Write-Host ('Progress: ' + $StatePath)
while ($true) {
    $bitmap = $null
    $headerBitmap=$null
    $sleepSeconds=[Math]::Max(10,$IntervalSeconds)
    $status = 'Paused: Call of Duty is not the foreground window.'
    try {
        $window = [CamoDesktopCapture]::GetForegroundWindow()
        $processId = [uint32]0
        [CamoDesktopCapture]::GetWindowThreadProcessId($window, [ref]$processId) | Out-Null
        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if ($null -ne $process -and $process.ProcessName -match $ProcessPattern -and
            [CamoDesktopCapture]::Title($window) -match $TitlePattern) {
            if ($window -ne $lastWindow) { $lastHash = $null; $lastHeaderHash=$null; $headerIsMenu=$false; $state.pending.Clear() }
            $lastWindow = $window
            $headerBitmap=[CamoDesktopCapture]::CaptureMenuHeader($window)
            if($headerBitmap){
                $headerHash=Get-CamoBitmapHash $headerBitmap
                if($headerHash -ne $lastHeaderHash){
                    $headerLines=@(Read-CamoBitmap $headerBitmap $engine)
                    $headerIsMenu=Test-CamoMenuHeader $headerLines
                    $lastHeaderHash=$headerHash
                }
                if($headerIsMenu){$sleepSeconds=$IntervalSeconds;$bitmap=[CamoDesktopCapture]::Capture($window)}
                else{$status='Low-resource mode: checking only the menu header every '+$sleepSeconds+' seconds; full-screen OCR is idle.';$state.pending.Clear();$lastHash=$null}
            }else{$status='Waiting: game header cannot be captured.';$state.pending.Clear();$lastHeaderHash=$null;$headerIsMenu=$false}
            if ($null -ne $bitmap) {
                $hash = Get-CamoBitmapHash $bitmap
                $status = 'Game visible; image unchanged.'
                if ($hash -ne $lastHash -or $state.pending.Count -gt 0) {
                    $lines = @(Read-CamoBitmap $bitmap $engine)
                    $observation = Get-CamoObservation $lines @($settings.weaponNames) $Weapon
                    $changed = Update-CamoProgress $state $observation $StatePath
                    $lastHash = $hash
                    if ($null -eq $observation) { $status = Get-CamoRecognitionStatus $lines @($settings.weaponNames) }
                    elseif ($changed -gt 0) { $status = 'Saved ' + $changed + ' changed counter(s) for ' + $observation.weapon + '; matched progress applies automatically.' }
                    elseif ($state.pending.Count -gt 0) { $status = 'Camo menu detected: confirming ' + $observation.weapon + ' on the next scan.' }
                    else { $status = 'Camo menu detected: progress unchanged; no write.' }
                }
            } elseif($headerIsMenu) { $status = 'Waiting: window changed focus or cannot be captured.'; $state.pending.Clear(); $lastHash = $null }
        } else { $state.pending.Clear(); $lastHash = $null; $lastHeaderHash=$null; $headerIsMenu=$false; $lastWindow = [IntPtr]::Zero }
    } catch {
        $state.pending.Clear()
        $lastHash = $null
        $lastHeaderHash=$null;$headerIsMenu=$false
        $status = 'Scan skipped: ' + $_.Exception.Message
    } finally { if ($null -ne $bitmap) { $bitmap.Dispose() };if($null -ne $headerBitmap){$headerBitmap.Dispose()} }
    if ($status -ne $lastStatus) { Write-Host ('[' + (Get-Date -Format 'HH:mm:ss') + '] ' + $status); $lastStatus = $status }
    Start-Sleep -Seconds $sleepSeconds
}
} finally {
    if ($ownsMutex) { $watchMutex.ReleaseMutex() }
    $watchMutex.Dispose()
}
