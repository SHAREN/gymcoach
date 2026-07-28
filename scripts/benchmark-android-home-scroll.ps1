param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z0-9-]+$')]
    [string]$Label,

    [string]$Serial = 'emulator-5554',

    [string]$OutputDirectory = 'android/app/build/reports/ui-evidence/gymcoach-1kv',

    [switch]$NoPulse
)

$ErrorActionPreference = 'Stop'
$PSDefaultParameterValues['Get-Content:Encoding'] = 'utf8'
$PSDefaultParameterValues['Set-Content:Encoding'] = 'utf8'
$PSDefaultParameterValues['Out-File:Encoding'] = 'utf8'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

if ($PSVersionTable.PSVersion.Major -lt 7) {
    throw 'PowerShell 7 or newer is required.'
}
if ($Serial -ne 'emulator-5554') {
    throw 'Home scroll profiling is restricted to emulator-5554.'
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$outputRoot = if ([System.IO.Path]::IsPathRooted($OutputDirectory)) {
    $OutputDirectory
} else {
    Join-Path $repoRoot $OutputDirectory
}
$apkPath = Join-Path $repoRoot 'android/app/build/outputs/apk/benchmark/app-benchmark.apk'
$packageName = 'org.sharteman.gymcoach.benchmark'
$componentName = "$packageName/org.sharteman.gymcoach.ui.HomeBenchmarkActivity"
$remoteData = "/data/local/tmp/gymcoach-home-$Label.data"
$remoteReport = "/data/local/tmp/gymcoach-home-$Label-simpleperf.txt"
$remoteScreenshot = "/sdcard/gymcoach-home-$Label.png"
$statusPath = Join-Path $outputRoot "home-scroll-$Label.status.json"
$profiler = $null
$success = $false
$failure = $null

New-Item -ItemType Directory -Force $outputRoot | Out-Null

function Invoke-Adb {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    $output = & adb -s $Serial @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "adb failed ($LASTEXITCODE): $($Arguments -join ' ')`n$($output -join "`n")"
    }
    return $output
}

function Get-MetricInt {
    param([string]$Text, [string]$Pattern)
    $match = [regex]::Match($Text, $Pattern, [System.Text.RegularExpressions.RegexOptions]::Multiline)
    if (-not $match.Success) { return $null }
    return [int]$match.Groups[1].Value
}

try {
    if (-not (Test-Path -LiteralPath $apkPath)) {
        throw "Benchmark APK not found: $apkPath. Run android/gradlew.bat assembleBenchmark first."
    }

    $devices = & adb devices
    if ($LASTEXITCODE -ne 0 -or -not ($devices -match '^emulator-5554\s+device$')) {
        throw 'emulator-5554 is not available as an ADB device.'
    }

    $deviceUid = (Invoke-Adb -Arguments @('shell', 'id', '-u') | Select-Object -First 1).Trim()
    if ($deviceUid -ne '0') {
        $rootOutput = & adb -s $Serial root 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "Could not enable emulator-only root profiling:`n$($rootOutput -join "`n")"
        }
        & adb -s $Serial wait-for-device
        if ($LASTEXITCODE -ne 0) {
            throw 'emulator-5554 did not reconnect after adb root.'
        }
    }

    Invoke-Adb -Arguments @('install', '-r', $apkPath) | Out-Null
    Invoke-Adb -Arguments @('shell', 'am', 'force-stop', $packageName) | Out-Null
    $pulseValue = if ($NoPulse) { 'false' } else { 'true' }
    Invoke-Adb -Arguments @('shell', 'am', 'start', '-W', '-n', $componentName, '--ez', 'pulse', $pulseValue) | Out-Null
    Start-Sleep -Seconds 2

    foreach ($iteration in 1..2) {
        Invoke-Adb -Arguments @('shell', 'input', 'swipe', '720', '2550', '720', '650', '220') | Out-Null
    }
    foreach ($iteration in 1..2) {
        Invoke-Adb -Arguments @('shell', 'input', 'swipe', '720', '650', '720', '2550', '220') | Out-Null
    }

    Invoke-Adb -Arguments @(
        'shell', 'am', 'start', '-W', '-n', $componentName,
        '--activity-single-top', '--ez', 'reset', 'true'
    ) | Out-Null
    Start-Sleep -Milliseconds 500
    Invoke-Adb -Arguments @('logcat', '-c') | Out-Null
    Invoke-Adb -Arguments @('shell', 'dumpsys', 'gfxinfo', $packageName, 'reset') | Out-Null

    $targetPid = (Invoke-Adb -Arguments @('shell', 'pidof', $packageName) | Select-Object -First 1).Trim()
    if ($targetPid -notmatch '^\d+$') {
        throw "Could not resolve benchmark process id: $targetPid"
    }

    $adbPath = (Get-Command adb -ErrorAction Stop).Source
    $profilerOutLog = Join-Path $outputRoot "home-scroll-$Label-simpleperf-process.out.log"
    $profilerErrorLog = Join-Path $outputRoot "home-scroll-$Label-simpleperf-process.err.log"
    $profilerArguments = @(
        '-s', $Serial, 'shell', 'simpleperf', 'record', '-p', $targetPid,
        '-e', 'cpu-clock:u', '-g', '--duration', '12', '-o', $remoteData
    )
    $profiler = Start-Process -FilePath $adbPath -ArgumentList $profilerArguments -RedirectStandardOutput $profilerOutLog -RedirectStandardError $profilerErrorLog -WindowStyle Hidden -PassThru

    foreach ($iteration in 1..12) {
        Invoke-Adb -Arguments @('shell', 'input', 'swipe', '720', '2550', '720', '650', '220') | Out-Null
    }
    foreach ($iteration in 1..12) {
        Invoke-Adb -Arguments @('shell', 'input', 'swipe', '720', '650', '720', '2550', '220') | Out-Null
    }

    if (-not $profiler.WaitForExit(30000)) {
        $profiler.Kill($true)
        throw 'simpleperf did not exit within the 30-second hard timeout.'
    }
    if ($profiler.ExitCode -ne 0) {
        throw "simpleperf record failed with exit code $($profiler.ExitCode)."
    }

    $gfxText = (Invoke-Adb -Arguments @('shell', 'dumpsys', 'gfxinfo', $packageName)) -join "`n"
    $gfxPath = Join-Path $outputRoot "home-scroll-$Label-gfxinfo.txt"
    Set-Content -LiteralPath $gfxPath -Value $gfxText

    Invoke-Adb -Arguments @(
        'shell', 'am', 'start', '-W', '-n', $componentName,
        '--activity-single-top', '--ez', 'dump', 'true'
    ) | Out-Null
    Start-Sleep -Milliseconds 300
    $counterText = (Invoke-Adb -Arguments @(
        'shell', 'logcat', '-d', '-s', 'GymCoachHomeBenchmark:I', '*:S'
    )) -join "`n"
    $counterPath = Join-Path $outputRoot "home-scroll-$Label-counters.txt"
    Set-Content -LiteralPath $counterPath -Value $counterText

    Invoke-Adb -Arguments @(
        'shell', 'simpleperf', 'report', '-i', $remoteData,
        '--sort', 'comm,pid,tid,dso,symbol', '-g', 'caller', '--children',
        '--percent-limit', '0.25', '-o', $remoteReport
    ) | Out-Null
    Invoke-Adb -Arguments @(
        'pull', $remoteData, (Join-Path $outputRoot "home-scroll-$Label-simpleperf.data")
    ) | Out-Null
    Invoke-Adb -Arguments @(
        'pull', $remoteReport, (Join-Path $outputRoot "home-scroll-$Label-simpleperf.txt")
    ) | Out-Null

    Invoke-Adb -Arguments @('shell', 'screencap', '-p', $remoteScreenshot) | Out-Null
    Invoke-Adb -Arguments @(
        'pull', $remoteScreenshot, (Join-Path $outputRoot "home-scroll-$Label.png")
    ) | Out-Null

    $histogramLine = ($gfxText -split "`n" | Where-Object { $_ -like 'HISTOGRAM:*' } | Select-Object -First 1)
    $slowFrames = 0
    $frozenFrames = 0
    foreach ($bin in [regex]::Matches($histogramLine, '(\d+)ms=(\d+)')) {
        $durationMs = [int]$bin.Groups[1].Value
        $count = [int]$bin.Groups[2].Value
        if ($durationMs -gt 16) { $slowFrames += $count }
        if ($durationMs -ge 700) { $frozenFrames += $count }
    }
    $counterMatch = [regex]::Match(
        $counterText,
        'parentCompositions=(\d+) benchmarkWorkoutItems=(\d+) destinationRows=(\d+) maxDestinationCardsPerRow=(\d+)'
    )

    $metrics = [ordered]@{
        label = $Label
        serial = $Serial
        profileable = $true
        pulseEnabled = -not $NoPulse
        refreshRateHz = 60
        swipePairs = 12
        totalFrames = Get-MetricInt $gfxText '^Total frames rendered:\s+(\d+)'
        jankyFrames = Get-MetricInt $gfxText '^Janky frames:\s+(\d+)'
        frameDeadlineMissed = Get-MetricInt $gfxText '^Number Frame deadline missed:\s+(\d+)'
        missedVsync = Get-MetricInt $gfxText '^Number Missed Vsync:\s+(\d+)'
        slowUiThread = Get-MetricInt $gfxText '^Number Slow UI thread:\s+(\d+)'
        p50Ms = Get-MetricInt $gfxText '^50th percentile:\s+(\d+)ms'
        p90Ms = Get-MetricInt $gfxText '^90th percentile:\s+(\d+)ms'
        p95Ms = Get-MetricInt $gfxText '^95th percentile:\s+(\d+)ms'
        p99Ms = Get-MetricInt $gfxText '^99th percentile:\s+(\d+)ms'
        slowFramesOver16Ms = $slowFrames
        frozenFramesAtLeast700Ms = $frozenFrames
        parentCompositions = if ($counterMatch.Success) { [int]$counterMatch.Groups[1].Value } else { $null }
        benchmarkWorkoutItems = if ($counterMatch.Success) { [int]$counterMatch.Groups[2].Value } else { $null }
        destinationRows = if ($counterMatch.Success) { [int]$counterMatch.Groups[3].Value } else { $null }
        maxDestinationCardsPerRow = if ($counterMatch.Success) { [int]$counterMatch.Groups[4].Value } else { $null }
    }
    $metricsPath = Join-Path $outputRoot "home-scroll-$Label-metrics.json"
    Set-Content -LiteralPath $metricsPath -Value ($metrics | ConvertTo-Json -Depth 4)

    $success = $true
    $metrics | ConvertTo-Json -Depth 4
} catch {
    $failure = $_.Exception.Message
    throw
} finally {
    if ($profiler -and -not $profiler.HasExited) {
        $profiler.Kill($true)
    }
    & adb -s $Serial shell rm -f $remoteData $remoteReport $remoteScreenshot 2>$null | Out-Null
    $status = [ordered]@{
        label = $Label
        success = $success
        failure = $failure
        completedAt = [DateTimeOffset]::Now.ToString('O')
    }
    Set-Content -LiteralPath $statusPath -Value ($status | ConvertTo-Json -Depth 3)
}
