$ErrorActionPreference = 'Stop'

$distro = 'Ubuntu-22.04'
$projectDirWsl = '/mnt/d/RENAT/Documents/projects codex/GymCoach'
$watchdogScriptWsl = "$projectDirWsl/scripts/gymcoach-wsl-watchdog.sh"
$lanProxyScript = Join-Path $PSScriptRoot 'gymcoach-lan-proxy.mjs'
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source

$lanProxyRunning = Get-CimInstance Win32_Process |
    Where-Object {
        $_.Name -eq 'node.exe' -and
        $_.CommandLine -and
        $_.CommandLine.Contains('gymcoach-lan-proxy.mjs')
    } |
    Select-Object -First 1

if (-not $lanProxyRunning) {
    $lanProxyArguments = '"{0}"' -f $lanProxyScript
    Start-Process -FilePath $nodePath -ArgumentList $lanProxyArguments -WindowStyle Hidden -WorkingDirectory (Split-Path -Parent $PSScriptRoot) | Out-Null
}

& wsl.exe -d $distro --cd $projectDirWsl --exec bash $watchdogScriptWsl
exit $LASTEXITCODE
