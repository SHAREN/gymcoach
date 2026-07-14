param(
    [string]$TaskName = 'GymCoach HomePC Watchdog',
    [switch]$StartNow
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$starterPath = Join-Path $PSScriptRoot 'start-gymcoach-watchdog.ps1'
$pwshPath = (Get-Command pwsh.exe -ErrorAction Stop).Source
$userId = "$env:USERDOMAIN\$env:USERNAME"

if (-not (Test-Path -LiteralPath $starterPath -PathType Leaf)) {
    throw "Watchdog starter was not found: $starterPath"
}

$actionArguments = '-WindowStyle Hidden -NoLogo -NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $starterPath
$action = New-ScheduledTaskAction -Execute $pwshPath -Argument $actionArguments -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$trigger.Delay = 'PT30S'
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
    -Hidden `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

$task = New-ScheduledTask `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description 'Keeps the WSL Docker engine, canonical GymCoach Compose runtime and LAN fallback proxy available on port 3030.'

Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null

if ($StartNow) {
    Start-ScheduledTask -TaskName $TaskName
}

Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName, State, TaskPath
