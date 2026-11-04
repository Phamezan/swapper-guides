$ErrorActionPreference = 'Stop'
$node = (Get-Command node.exe).Source
$powerShell = (Get-Command powershell.exe).Source
$wrapper = Join-Path $PSScriptRoot 'harvest-loop.ps1'
$action = New-ScheduledTaskAction -Execute $powerShell -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$wrapper`"" -WorkingDirectory (Split-Path $PSScriptRoot)
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$logon = New-ScheduledTaskTrigger -AtLogOn -User $user
$repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(30) -RepetitionInterval (New-TimeSpan -Minutes 30)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -Hidden
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName SwapperVodHarvest -Action $action -Trigger @($logon, $repeat) -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName SwapperVodHarvest
Get-ScheduledTask -TaskName SwapperVodHarvest | Select-Object TaskName, State
