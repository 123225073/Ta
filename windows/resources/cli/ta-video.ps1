param([Parameter(Position=0)][string]$Command='schema',[Parameter(ValueFromRemainingArguments=$true)][string[]]$Options)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
try {
  if($Command -in @('help','--help','-h')){$Command='schema'}
  $request=@{command=$Command}
  for($i=0;$i -lt $Options.Length;$i++) {
    $option=$Options[$i]
    if($option -eq '--dry-run'){$request.dryRun=$true;continue}
    if($i+1 -ge $Options.Length){throw ('Missing value for '+$option)}
    $i++;$value=$Options[$i]
    switch($option) {
      '--project' {$request.projectId=$value}
      '--revision' {$request.revision=[int]$value}
      '--time' {$request.time=[double]$value}
      '--height' {$request.height=[int]$value}
      '--output' {$request.output=[IO.Path]::GetFullPath($value)}
      '--kind' {$request.kind=$value}
      '--file' {if($Command -eq 'apply'){$plan=ConvertFrom-Json -InputObject ([IO.File]::ReadAllText([IO.Path]::GetFullPath($value)));$request.operations=$plan.operations;if($plan.projectId){$request.projectId=$plan.projectId};if($null -ne $plan.revision){$request.revision=$plan.revision}}else{$request.file=[IO.Path]::GetFullPath($value)}}
      default {throw ('Unknown option: '+$option)}
    }
  }
  $taskDir=Join-Path ([IO.Path]::GetTempPath()) ('ta-video-cli-'+[guid]::NewGuid().ToString())
  [void][IO.Directory]::CreateDirectory($taskDir)
  $job=Join-Path $taskDir 'request.json';$response=Join-Path $taskDir 'response.json'
  [IO.File]::WriteAllText($job,($request|ConvertTo-Json -Depth 40),(New-Object Text.UTF8Encoding($false)))
  $appDir=Split-Path (Split-Path $PSScriptRoot)
  $exePath=Join-Path $appDir ([char]0x62d3+' Ta.exe')
  if(!(Test-Path -LiteralPath $exePath -PathType Leaf)){throw 'Ta executable not found beside resources directory.'}
  $exe=Get-Item -LiteralPath $exePath
  $start=New-Object Diagnostics.ProcessStartInfo;$start.FileName=$exe.FullName;$start.UseShellExecute=$true;$start.WindowStyle='Hidden';$start.WorkingDirectory=$appDir;$start.Arguments='--minimized --video-cli-job "'+$job+'"'
  # Shell launch detaches the GUI process from CLI pipes, including on a cold start.
  $oldElectronMode=[Environment]::GetEnvironmentVariable('ELECTRON_RUN_AS_NODE','Process')
  try {[Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE',$null,'Process');$cliProcess=[Diagnostics.Process]::Start($start)}finally{[Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE',$oldElectronMode,'Process')}
  $deadline=[DateTime]::UtcNow.AddMinutes(30)
  while(!(Test-Path -LiteralPath $response)){if($cliProcess.HasExited -and $cliProcess.ExitCode -ne 0){throw ('Ta could not start (exit '+$cliProcess.ExitCode+'). Receipt: '+$taskDir)};if([DateTime]::UtcNow -gt $deadline){throw ('CLI timed out; inspect project before retrying. Receipt: '+$taskDir)};Start-Sleep -Milliseconds 100}
  $json=[IO.File]::ReadAllText($response);[Console]::WriteLine($json);$result=ConvertFrom-Json -InputObject $json
  if(!$result.ok){exit 1}
  exit 0
} catch { [Console]::WriteLine((@{ok=$false;error=$_.Exception.Message}|ConvertTo-Json -Compress));exit 1 }
