[CmdletBinding()]
param([ValidateRange(0,65535)][int]$Port=8777,[switch]$NoBrowser,[switch]$DisableCapture,[switch]$StartTracking,[string]$Token,[string]$ReadyPath)
$ErrorActionPreference='Stop'
$sessionPath=Join-Path $PSScriptRoot 'data\web-session.json'
if($Port -eq 8777 -and -not $DisableCapture -and -not $Token -and (Test-Path -LiteralPath $sessionPath)){
    $reuse=$false
    try{
        $existing=Get-Content -LiteralPath $sessionPath -Raw|ConvertFrom-Json
        if($existing.url -eq 'http://127.0.0.1:8777' -and $existing.token -match '^[a-f0-9]{64}$'){
            $status=Invoke-RestMethod -Uri ($existing.url+'/api/status') -Headers @{'X-Tracker-Token'=$existing.token} -TimeoutSec 3
            if($status.appId -eq 'mw4-local-camo-tracker'){
                $reuse=$true
            }
        }
    }catch{}
    if($reuse){
        if($StartTracking -and -not $status.running){Invoke-RestMethod -Uri ($existing.url+'/api/start') -Method Post -Headers @{'X-Tracker-Token'=$existing.token} -ContentType 'application/json' -Body (@{interval=$status.interval}|ConvertTo-Json -Compress)|Out-Null}
        if($ReadyPath){[IO.File]::WriteAllText($ReadyPath,(@{url=$existing.url;processId=$existing.processId;reused=$true}|ConvertTo-Json -Compress))}
        if(-not $NoBrowser){Start-Process ($existing.url+'/#token='+$existing.token)}
        return
    }
}
if (-not $Token) { $Token=[guid]::NewGuid().ToString('N')+[guid]::NewGuid().ToString('N') }
$webRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'web'))
$dataPath=Join-Path $PSScriptRoot 'data\progress.json'
$importedPath=Join-Path $PSScriptRoot 'data\imported-observations.json'
$script:Watcher=$null;$script:OutputTask=$null;$script:ErrorTask=$null;$script:LastMessage='Capture is stopped.';$script:Interval=4;$script:Shutdown=$false
$script:LastWorkerError='';$script:ReportedExit=$false
$lastContact=[DateTime]::UtcNow
function Stop-LocalWatcher {
    if($null -ne $script:Watcher){try{if(-not $script:Watcher.HasExited){$script:Watcher.Kill();$script:Watcher.WaitForExit(1500)|Out-Null}}finally{$script:Watcher.Dispose();$script:Watcher=$null;$script:OutputTask=$null;$script:ErrorTask=$null}}
    $script:LastMessage='Capture is stopped.'
}
function Read-WorkerMessages {
    for($i=0;$i -lt 100 -and $script:OutputTask -and $script:OutputTask.IsCompleted;$i++){
        try{$line=$script:OutputTask.Result;if($null -eq $line){$script:OutputTask=$null}else{if(-not [string]::IsNullOrWhiteSpace($line)){$script:LastMessage=$line};$script:OutputTask=$script:Watcher.StandardOutput.ReadLineAsync()}}catch{$script:OutputTask=$null}
    }
    for($i=0;$i -lt 100 -and $script:ErrorTask -and $script:ErrorTask.IsCompleted;$i++){
        try{$line=$script:ErrorTask.Result;if($null -eq $line){$script:ErrorTask=$null}else{if(-not [string]::IsNullOrWhiteSpace($line) -and -not $script:LastWorkerError){$script:LastWorkerError=$line;$script:LastMessage=$line};$script:ErrorTask=$script:Watcher.StandardError.ReadLineAsync()}}catch{$script:ErrorTask=$null}
    }
    if($script:Watcher -and $script:Watcher.HasExited -and -not $script:OutputTask -and -not $script:ErrorTask -and -not $script:ReportedExit){
        $script:ReportedExit=$true
        $detail=if($script:LastWorkerError){$script:LastWorkerError}else{$script:LastMessage}
        $script:LastMessage='Watcher stopped (exit '+$script:Watcher.ExitCode+'). '+$detail
    }
}
function Start-LocalWatcher([int]$Seconds) {
    if($DisableCapture){throw 'Capture is disabled for this validation session.'}
    if($Seconds -lt 2 -or $Seconds -gt 60){throw 'Scan interval must be 2 to 60 seconds.'}
    Stop-LocalWatcher
    $script:LastWorkerError='';$script:ReportedExit=$false
    $info=New-Object Diagnostics.ProcessStartInfo
    $info.FileName=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $info.Arguments='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+(Join-Path $PSScriptRoot 'Watch-CamoMenu.ps1')+'" -IntervalSeconds '+$Seconds+' -StatePath "'+$dataPath+'"'
    $info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true;$info.WorkingDirectory=$PSScriptRoot
    $script:Watcher=New-Object Diagnostics.Process;$script:Watcher.StartInfo=$info;$script:Watcher.Start()|Out-Null
    $script:OutputTask=$script:Watcher.StandardOutput.ReadLineAsync();$script:ErrorTask=$script:Watcher.StandardError.ReadLineAsync();$script:Interval=$Seconds;$script:LastMessage='Starting local OCR watcher.'
}
function Read-HttpLine($Stream) {
    $line=New-Object 'System.Collections.Generic.List[byte]'
    while($true){$b=$Stream.ReadByte();if($b -lt 0){throw 'Connection closed.'};if($b -eq 10){break};if($b -ne 13){$line.Add([byte]$b)};if($line.Count -gt 8192){throw 'Header line too long.'}}
    return [Text.Encoding]::ASCII.GetString($line.ToArray())
}
function Send-Response($Stream,[int]$Status,[string]$Type,[byte[]]$Body) {
    $reason=@{200='OK';400='Bad Request';403='Forbidden';404='Not Found';405='Method Not Allowed';409='Conflict';413='Payload Too Large';500='Internal Server Error'}[$Status]
    $head='HTTP/1.1 '+$Status+' '+$reason+"`r`nContent-Type: "+$Type+"`r`nContent-Length: "+$Body.Length+"`r`nConnection: close`r`nCache-Control: no-store`r`nX-Content-Type-Options: nosniff`r`nReferrer-Policy: no-referrer`r`n`r`n"
    $bytes=[Text.Encoding]::ASCII.GetBytes($head);$Stream.Write($bytes,0,$bytes.Length);$Stream.Write($Body,0,$Body.Length);$Stream.Flush()
}
function Send-Json($Stream,[int]$Status,$Value) {Send-Response $Stream $Status 'application/json; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes(($Value|ConvertTo-Json -Depth 15 -Compress)))}
function Read-CombinedProgress {
    $combined=@{}
    foreach($file in @($dataPath,$importedPath)){
        if(-not (Test-Path -LiteralPath $file)){continue}
        $saved=Get-Content -Raw -LiteralPath $file|ConvertFrom-Json
        foreach($entry in $saved.entries){
            $key=[string]$entry.key
            if(-not $combined.ContainsKey($key) -or $entry.current -gt $combined[$key].current -or ($entry.current -eq $combined[$key].current -and $entry.observedAt -gt $combined[$key].observedAt)){$combined[$key]=$entry}
        }
    }
    return @($combined.Values|Sort-Object key)
}
$listener=New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,$Port)
try {
    $listener.Start();$actualPort=([Net.IPEndPoint]$listener.LocalEndpoint).Port;$baseUrl='http://127.0.0.1:'+$actualPort
    if($Port -eq 8777 -and -not $DisableCapture){
        New-Item -ItemType Directory -Path (Split-Path -Parent $sessionPath) -Force|Out-Null
        [IO.File]::WriteAllText($sessionPath,(@{url=$baseUrl;processId=$PID;token=$Token}|ConvertTo-Json -Compress))
    }
    if($StartTracking){Start-LocalWatcher $script:Interval}
    if($ReadyPath){[IO.File]::WriteAllText($ReadyPath,(@{url=$baseUrl;processId=$PID;captureDisabled=[bool]$DisableCapture}|ConvertTo-Json -Compress))}
    if(-not $NoBrowser){Start-Process ($baseUrl+'/#token='+$Token)}
    while(-not $script:Shutdown){
        Read-WorkerMessages
        if($script:Watcher -and ([DateTime]::UtcNow-$lastContact).TotalMinutes -gt 5){Stop-LocalWatcher}
        if(-not $listener.Pending()){Start-Sleep -Milliseconds 80;continue}
        $client=$listener.AcceptTcpClient();$stream=$client.GetStream();$stream.ReadTimeout=2500;$stream.WriteTimeout=5000
        try{
            $request=Read-HttpLine $stream;$parts=$request.Split(' ');if($parts.Length -ne 3){throw 'Invalid request.'}
            $method=$parts[0];$target=$parts[1];$headers=@{};$headerBytes=0
            while($true){$line=Read-HttpLine $stream;if(-not $line){break};$headerBytes+=$line.Length;if($headerBytes -gt 32768){throw 'Headers too large.'};$split=$line.IndexOf(':');if($split -gt 0){$headers[$line.Substring(0,$split).ToLowerInvariant()]=$line.Substring($split+1).Trim()}}
            if($headers['host'] -cne ('127.0.0.1:'+$actualPort)){Send-Json $stream 403 @{error='Local host header required.'};continue}
            $route=([Uri]($baseUrl+$target)).AbsolutePath
            if($route.StartsWith('/api/')){
                if($headers['x-tracker-token'] -cne $Token -or ($headers['origin'] -and $headers['origin'] -cne $baseUrl)){Send-Json $stream 403 @{error='This session token is required.'};continue}
                $lastContact=[DateTime]::UtcNow
                $body=@{}
                if($method -eq 'POST'){
                    $length=0;if($headers['content-length']){$length=[int]$headers['content-length']}
                    if($length -gt 32768 -or $length -lt 0 -or $headers['transfer-encoding']){Send-Json $stream 413 @{error='Request body too large or unsupported.'};continue}
                    if($length){$bytes=New-Object byte[] $length;$offset=0;while($offset -lt $length){$read=$stream.Read($bytes,$offset,$length-$offset);if($read -le 0){throw 'Incomplete body.'};$offset+=$read};$body=[Text.Encoding]::UTF8.GetString($bytes)|ConvertFrom-Json}
                }
                switch($method+' '+$route){
                    'GET /api/status' {
                        $entries=@();$message=$script:LastMessage
                        try{$entries=@(Read-CombinedProgress)}catch{$message='Could not read OCR progress; existing manual progress is unchanged.'}
                        Send-Json $stream 200 @{appId='mw4-local-camo-tracker';running=[bool]($script:Watcher -and -not $script:Watcher.HasExited);message=$message;entries=$entries;interval=$script:Interval}
                    }
                    'GET /api/manual' {
                        $manual=Join-Path $PSScriptRoot 'data\dashboard.json';if(Test-Path -LiteralPath $manual){Send-Json $stream 200 (Get-Content -Raw -LiteralPath $manual|ConvertFrom-Json)}else{Send-Json $stream 200 @{schemaVersion=2;checks=@{};goals=@();links=@{};confirmed=@{};interval=4}}
                    }
                    'POST /api/start' {try{Start-LocalWatcher ([int]$body.interval);Send-Json $stream 200 @{ok=$true}}catch{Send-Json $stream 409 @{error=$_.Exception.Message}}}
                    'POST /api/stop' {Stop-LocalWatcher;Send-Json $stream 200 @{ok=$true}}
                    'POST /api/shutdown' {Stop-LocalWatcher;$script:Shutdown=$true;Send-Json $stream 200 @{ok=$true}}
                    default {Send-Json $stream 404 @{error='Unknown tracker route.'}}
                }
            }else{
                if($method -ne 'GET'){Send-Json $stream 405 @{error='GET required.'};continue}
                if($route -eq '/migration.js'){Send-Response $stream 200 'text/javascript' ([Text.Encoding]::UTF8.GetBytes('window.NATIVE_MIGRATION=null;'));continue}
                if($route -eq '/'){$route='/index.html'}
                $relative=[Uri]::UnescapeDataString($route).TrimStart('/').Replace('/',[IO.Path]::DirectorySeparatorChar)
                $path=[IO.Path]::GetFullPath((Join-Path $webRoot $relative))
                if(-not $path.StartsWith($webRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){Send-Json $stream 403 @{error='Path outside web folder.'};continue}
                $types=@{'.html'='text/html; charset=utf-8';'.js'='text/javascript; charset=utf-8';'.css'='text/css; charset=utf-8';'.json'='application/json';'.webp'='image/webp';'.png'='image/png';'.jpg'='image/jpeg'}
                $extension=[IO.Path]::GetExtension($path).ToLowerInvariant()
                if(-not $types.ContainsKey($extension) -or -not (Test-Path -LiteralPath $path -PathType Leaf)){Send-Json $stream 404 @{error='File not found.'};continue}
                Send-Response $stream 200 $types[$extension] ([IO.File]::ReadAllBytes($path))
            }
        }catch{try{Send-Json $stream 400 @{error='Request could not be processed.'}}catch{}}
        finally{$stream.Dispose();$client.Dispose()}
    }
}catch{
    if(-not $NoBrowser){Add-Type -AssemblyName System.Windows.Forms;[Windows.Forms.MessageBox]::Show($_.Exception.Message,'Local tracker companion')|Out-Null}else{throw}
}finally{
    Stop-LocalWatcher;$listener.Stop()
    if($Port -eq 8777 -and -not $DisableCapture -and (Test-Path -LiteralPath $sessionPath)){
        try{$session=Get-Content -LiteralPath $sessionPath -Raw|ConvertFrom-Json;if($session.processId -eq $PID){Remove-Item -LiteralPath $sessionPath}}catch{}
    }
}
