$ErrorActionPreference = 'Stop'

$distro = 'Ubuntu-22.04'
$projectDirWsl = '/mnt/d/RENAT/Documents/projects codex/GymCoach'
$watchdogScriptWsl = "$projectDirWsl/scripts/gymcoach-wsl-watchdog.sh"

& wsl.exe -d $distro --cd $projectDirWsl --exec bash $watchdogScriptWsl
exit $LASTEXITCODE
