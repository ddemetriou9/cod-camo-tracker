function Normalize-CamoText([string]$Text) {
    return (($Text.ToUpperInvariant() -replace '[^A-Z0-9]+', ' ').Trim() -replace '\s+', ' ')
}
function Test-CamoMenuHeader([string[]]$Lines){
    $text=Normalize-CamoText ($Lines -join ' ')
    return ($text -match '\bCAMO\s*(SELECT|CHALLENGES?)\b')
}
function Get-CamoWeaponCandidates([string[]]$Lines,[string[]]$WeaponNames){
    # OCR can join the progression heading or confuse O/0. Only permit this
    # restricted alias matching in an explicit weapon progression heading.
    $headings=@()
    foreach($line in $Lines){
        $compact=(Normalize-CamoText $line)-replace ' ',''
        if($compact -match '^([A-Z0-9]+)PROGRESSION$'){
            $heading=$Matches[1].Replace('0','O').Replace('1','I')
            $headings+=@($WeaponNames|Where-Object {(((Normalize-CamoText $_)-replace ' ','').Replace('0','O').Replace('1','I')) -eq $heading}|ForEach-Object {Normalize-CamoText $_})
        }
    }
    if($headings.Count){return @($headings|Sort-Object -Unique)}
    $normalized=' '+(Normalize-CamoText ($Lines -join ' '))+' '
    return @($WeaponNames|Where-Object {$normalized.Contains(' '+(Normalize-CamoText $_)+' ')}|ForEach-Object {Normalize-CamoText $_}|Sort-Object -Unique)
}
function Get-CamoRecognitionStatus([string[]]$Lines,[string[]]$WeaponNames){
    if(($Lines -join ' ') -notmatch '(?i)\bCAMO(?:S|UFLAGE)?\b'){return 'Game visible; open a weapon camo menu to scan its progress.'}
    $names=@(Get-CamoWeaponCandidates $Lines $WeaponNames)
    if(-not $names.Count){return 'Camo menu visible; OCR could not identify the weapon name.'}
    if($names.Count -gt 1){return 'Camo menu visible; more than one weapon name was identified.'}
    return ('Camo menu visible for '+$names[0]+'; no readable challenge or progression counter yet.')
}

function Get-CamoObservation([string[]]$Lines, [string[]]$WeaponNames, [string]$WeaponOverride) {
    $joined = $Lines -join ' '
    if ($joined -notmatch '(?i)\bCAMO(?:S|UFLAGE)?\b' -or
        $joined -notmatch '(?i)\b(CHALLENGES?|MILITARY|SPECIAL|MASTERY|COMPLETIONIST)\b') { return $null }
    $found = @(Get-CamoWeaponCandidates $Lines $WeaponNames)
    $weapon = $null
    if ($WeaponOverride) { $weapon = Normalize-CamoText $WeaponOverride }
    elseif ($found.Count -eq 1) { $weapon = Normalize-CamoText $found[0] }
    if (-not $weapon) { return $null }

    $counters = @()
    # The progression overview has category totals, not necessarily a selected
    # challenge's numeric counter. Preserve the distinction for review in the UI.
    $categories=@()
    for($i=0;$i -lt $Lines.Count;$i++){
        $text=$Lines[$i]
        if($text -match '(?i)^\s*(MILITARY|SPECIAL|COMPLETIONIST|PRESTIGE)\s*$' -and $i+1 -lt $Lines.Count){$text+=' '+$Lines[$i+1]}
        $text=$text -replace '(?i)(?<=\s|\[|\()[O\u00D8](?=\s*/)','0'
        if($text -match '(?i)^\s*(MILITARY|SPECIAL|COMPLETIONIST|PRESTIGE)\s*[\[\(]?\s*(\d{1,2})\s*/\s*(\d{1,2})\s*[\]\)]?\s*$'){
            $category=$Matches[1].ToUpperInvariant();$current=[int]$Matches[2];$target=[int]$Matches[3]
            $expected=@{MILITARY=@(8);SPECIAL=@(3);COMPLETIONIST=@(3,4);PRESTIGE=@(4)}
            if($target -notin $expected[$category] -or $current -gt $target){continue}
            $categories += [pscustomobject]@{key=($weapon+'|CATEGORY|'+$category+'|'+$target);weapon=$weapon;challenge=($category+' category unlocks');current=$current;target=$target;kind='category';category=$category}
        }
    }
    $categories=@($categories|Group-Object category|Where-Object {$_.Count -eq 1}|ForEach-Object {$_.Group[0]})
    if($joined -match '(?i)PROGRESSION\b' -and $categories.Count -gt 0){$counters+=$categories}
    for ($i = 0; $i -lt $Lines.Count; $i++) {
        foreach ($match in [regex]::Matches($Lines[$i], '(?<!\d)(\d{1,6})\s*/\s*(\d{1,6})(?!\d)')) {
            $current = [int]$match.Groups[1].Value
            $target = [int]$match.Groups[2].Value
            if ($target -le 0 -or $current -gt $target) { continue }
            $label = ($Lines[$i] -replace '\d{1,6}\s*/\s*\d{1,6}', '').Trim()
            if (-not $label -and $i -gt 0) { $label = $Lines[$i - 1] }
            # Only count labeled tasks, not arsenal totals, dates, or page numbers.
            if ($label -notmatch '(?i)\b(GET|EARN|KILL|KILLS|ELIMINATIONS?|HEADSHOTS?|LONGSHOTS?|EXTRACT|EXFIL|COMPLETE|REACH|WIN|WINS|DESTROY)\b') { continue }
            $label = Normalize-CamoText $label
            $key = $weapon + '|' + $label + '|' + $target
            $counters += [pscustomobject]@{ key = $key; weapon = $weapon; challenge = $label; current = $current; target = $target }
        }
    }
    # Ambiguous duplicated task labels are not assigned to a challenge.
    $counters = @($counters | Group-Object key | Where-Object { $_.Count -eq 1 } | ForEach-Object { $_.Group[0] })
    if ($counters.Count -eq 0) { return $null }
    return [pscustomobject]@{ weapon = $weapon; counters = $counters }
}

function New-CamoState([string]$StatePath) {
    $state = @{ entries = @{}; pending = @{}; writes = 0 }
    if (Test-Path -LiteralPath $StatePath) {
        $saved = Get-Content -Raw -LiteralPath $StatePath | ConvertFrom-Json
        if ($saved.schemaVersion -ne 1) { throw 'Unsupported progress file version.' }
        foreach ($entry in $saved.entries) { $state.entries[$entry.key] = $entry }
    }
    return $state
}

function Update-CamoProgress($State, $Observation, [string]$StatePath) {
    if ($null -eq $Observation) { $State.pending.Clear(); return 0 }
    $seen = @{}
    $changes = @()
    foreach ($counter in $Observation.counters) {
        $key = $counter.key
        $seen[$key] = $true
        if ($State.entries.ContainsKey($key)) {
            if ($counter.current -le $State.entries[$key].current) {
                $State.pending.Remove($key)
                continue
            }
        }
        if ($State.pending.ContainsKey($key) -and $State.pending[$key].current -eq $counter.current) {
            $entry=[pscustomobject]@{
                key = $key; weapon = $counter.weapon; challenge = $counter.challenge
                current = $counter.current; target = $counter.target
                observedAt = [DateTime]::UtcNow.ToString('o'); needsReview = $true
            }
            if($counter.PSObject.Properties['kind'] -and $counter.kind -eq 'category'){
                $entry|Add-Member -NotePropertyName kind -NotePropertyValue 'category'
                $entry|Add-Member -NotePropertyName category -NotePropertyValue $counter.category
            }
            $changes += $entry
        } else { $State.pending[$key] = $counter }
    }
    foreach ($key in @($State.pending.Keys)) {
        if (-not $seen.ContainsKey($key)) { $State.pending.Remove($key) }
    }
    if ($changes.Count -eq 0) { return 0 }
    # Persist a prospective copy first; failed writes do not mark readings committed.
    $next = @{}
    foreach ($key in $State.entries.Keys) { $next[$key] = $State.entries[$key] }
    foreach ($entry in $changes) { $next[$entry.key] = $entry }
    $directory = Split-Path -Parent $StatePath
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $temporary = $StatePath + '.tmp'
    try {
        [ordered]@{ schemaVersion = 1; entries = @($next.Values | Sort-Object key) } |
            ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temporary -Encoding UTF8
        if (Test-Path -LiteralPath $StatePath) {
            $backup = $StatePath + '.bak'
            [IO.File]::Replace($temporary, $StatePath, $backup)
            Remove-Item -LiteralPath $backup
        }
        else { [IO.File]::Move($temporary, $StatePath) }
    } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary } }
    $State.entries = $next
    foreach ($entry in $changes) { $State.pending.Remove($entry.key) }
    $State.writes++
    return $changes.Count
}
