<#
Build the dedicated test APK before running this harness:
  cd android
  .\gradlew.bat -I ..\scripts\android-auth-upgrade-runner.init.gradle :app:assembleDebugAndroidTest

For a local 0.4.30 baseline built from the same source under test:
  .\gradlew.bat -I ..\scripts\android-auth-upgrade-runner.init.gradle `
    -Pgymcoach.authUpgrade.versionCode=40 -Pgymcoach.authUpgrade.versionName=0.4.30 `
    :app:packageDebug

The init script substitutes a plain Application only for this cross-version storage test, so a
synthetic sentinel is not sent to production synchronization. A local HTTP fixture exercises the
production SettingsRepository/bootstrap and logout paths without contacting canonical runtime.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$BaselineApk,

    [Parameter(Mandatory = $true)]
    [string]$UpgradeApk,

    [Parameter(Mandatory = $true)]
    [string]$TestApk,

    [string]$Serial = 'emulator-5554'
)

$ErrorActionPreference = 'Stop'
$PSDefaultParameterValues['Get-Content:Encoding'] = 'utf8'
$PSDefaultParameterValues['Set-Content:Encoding'] = 'utf8'
$PSDefaultParameterValues['Out-File:Encoding'] = 'utf8'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

if ($Serial -ne 'emulator-5554') {
    throw 'This regression harness is restricted to emulator-5554.'
}

$BaselineApk = (Resolve-Path -LiteralPath $BaselineApk).Path
$UpgradeApk = (Resolve-Path -LiteralPath $UpgradeApk).Path
$TestApk = (Resolve-Path -LiteralPath $TestApk).Path
$fixtureScript = (Resolve-Path -LiteralPath (
    Join-Path $PSScriptRoot 'android-auth-upgrade-fixture.mjs'
)).Path

$sdkRoot = $env:ANDROID_HOME
if ([string]::IsNullOrWhiteSpace($sdkRoot)) {
    $sdkRoot = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
}
$adb = Join-Path $sdkRoot 'platform-tools\adb.exe'
$buildTools = Get-ChildItem -LiteralPath (Join-Path $sdkRoot 'build-tools') -Directory |
    Sort-Object Name -Descending |
    Select-Object -First 1
if ($null -eq $buildTools) {
    throw 'Android SDK build-tools were not found.'
}
$aapt = Join-Path $buildTools.FullName 'aapt.exe'
$apksigner = Join-Path $buildTools.FullName 'apksigner.bat'
foreach ($tool in @($adb, $aapt, $apksigner)) {
    if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) {
        throw "Required Android tool was not found: $tool"
    }
}
$node = (Get-Command node -ErrorAction Stop).Source

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,

        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    $output = & $FilePath @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')`n$output"
    }
    return @($output)
}

function Get-ApkIdentity {
    param([Parameter(Mandatory = $true)][string]$ApkPath)

    $badging = (Invoke-Checked -FilePath $aapt -Arguments @('dump', 'badging', $ApkPath))[0]
    if ($badging -notmatch "package: name='([^']+)' versionCode='([0-9]+)' versionName='([^']*)'") {
        throw "Could not read APK identity: $ApkPath"
    }
    $packageName = $Matches[1]
    $versionCode = [int64]$Matches[2]
    $versionName = $Matches[3]
    $certificateOutput = Invoke-Checked -FilePath $apksigner -Arguments @('verify', '--print-certs', $ApkPath)
    $certificateLine = $certificateOutput | Where-Object {
        $_ -match '^Signer #1 certificate SHA-256 digest: ([0-9a-fA-F]+)$'
    } | Select-Object -First 1
    if ($null -eq $certificateLine) {
        throw "Could not read APK signing certificate: $ApkPath"
    }
    $null = $certificateLine -match '^Signer #1 certificate SHA-256 digest: ([0-9a-fA-F]+)$'
    return [pscustomobject]@{
        PackageName = $packageName
        VersionCode = $versionCode
        VersionName = $versionName
        CertificateSha256 = $Matches[1].ToLowerInvariant()
    }
}

function Invoke-InstrumentationPhase {
    param([Parameter(Mandatory = $true)][string]$MethodName)

    $className = "org.sharteman.gymcoach.data.security.SecureAccountUpgradeTest#$MethodName"
    $result = Invoke-Checked -FilePath $adb -Arguments @(
        '-s', $Serial, 'shell', 'am', 'instrument', '-w', '-r',
        '-e', 'class', $className,
        '-e', 'serverUrl', $fixtureUrl,
        'org.sharteman.gymcoach.test/org.sharteman.gymcoach.data.security.AuthUpgradeTestRunner'
    )
    if (-not ($result -match '^OK \(1 test\)$')) {
        throw (
            "Instrumentation phase did not report one passing test: $MethodName`n" +
            ($result -join "`n")
        )
    }
}

function Start-UpgradeFixture {
    $portProbe = [System.Net.Sockets.TcpListener]::new(
        [System.Net.IPAddress]::Any,
        0
    )
    $portProbe.Start()
    $port = ([System.Net.IPEndPoint]$portProbe.LocalEndpoint).Port
    $portProbe.Stop()

    $id = [Guid]::NewGuid().ToString('N')
    $stdoutPath = Join-Path $env:TEMP "gymcoach-auth-upgrade-$id.out.log"
    $stderrPath = Join-Path $env:TEMP "gymcoach-auth-upgrade-$id.err.log"
    $startArguments = @{
        FilePath = $node
        ArgumentList = @($fixtureScript, "$port")
        WindowStyle = 'Hidden'
        RedirectStandardOutput = $stdoutPath
        RedirectStandardError = $stderrPath
        PassThru = $true
    }
    $process = $null
    try {
        $process = Start-Process @startArguments
        $deadline = (Get-Date).AddSeconds(15)
        while ((Get-Date) -lt $deadline) {
            if ($process.HasExited) {
                $stderr = Get-Content -Raw -LiteralPath $stderrPath -ErrorAction SilentlyContinue
                throw "The Android auth upgrade fixture exited early: $stderr"
            }
            if ((Get-Content -Raw -LiteralPath $stdoutPath -ErrorAction SilentlyContinue) -match "READY $port") {
                return [pscustomobject]@{
                    Process = $process
                    Port = $port
                    StdoutPath = $stdoutPath
                    StderrPath = $stderrPath
                }
            }
            Start-Sleep -Milliseconds 200
        }
        throw 'Timed out waiting for the Android auth upgrade fixture.'
    } catch {
        if ($null -ne $process -and -not $process.HasExited) {
            Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
            $process.WaitForExit(5000) | Out-Null
        }
        Remove-Item -LiteralPath $stdoutPath -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $stderrPath -Force -ErrorAction SilentlyContinue
        throw
    }
}

function Stop-UpgradeFixture {
    param([Parameter(Mandatory = $true)]$Fixture)

    if (-not $Fixture.Process.HasExited) {
        Stop-Process -Id $Fixture.Process.Id -ErrorAction SilentlyContinue
        $Fixture.Process.WaitForExit(5000) | Out-Null
    }
    Remove-Item -LiteralPath $Fixture.StdoutPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $Fixture.StderrPath -Force -ErrorAction SilentlyContinue
}

function Test-EncryptedPreferencePresent {
    $preferences = & $adb -s $Serial exec-out run-as 'org.sharteman.gymcoach' `
        cat 'shared_prefs/gymcoach-account.xml' 2>$null
    if ($LASTEXITCODE -ne 0) {
        return $false
    }
    return [bool]($preferences | Select-String -SimpleMatch 'access-token' -Quiet)
}

$deviceState = Invoke-Checked -FilePath $adb -Arguments @('-s', $Serial, 'get-state')
if (($deviceState | Select-Object -Last 1).Trim() -ne 'device') {
    throw "$Serial is not ready."
}
$isEmulator = Invoke-Checked -FilePath $adb -Arguments @('-s', $Serial, 'shell', 'getprop', 'ro.kernel.qemu')
if (($isEmulator | Select-Object -Last 1).Trim() -ne '1') {
    throw "$Serial is not an Android emulator."
}

$baseline = Get-ApkIdentity -ApkPath $BaselineApk
$upgrade = Get-ApkIdentity -ApkPath $UpgradeApk
if ($baseline.PackageName -ne 'org.sharteman.gymcoach' -or $upgrade.PackageName -ne $baseline.PackageName) {
    throw 'Both APKs must use the GymCoach application ID.'
}
if ($upgrade.VersionCode -le $baseline.VersionCode) {
    throw 'Upgrade APK versionCode must be greater than the baseline versionCode.'
}
if ($upgrade.CertificateSha256 -ne $baseline.CertificateSha256) {
    throw 'Baseline and upgrade APK signing certificates differ.'
}

$fixture = Start-UpgradeFixture
$fixtureUrl = "http://192.168.0.119:$($fixture.Port)"
try {
    # Initial uninstall and clear create a deterministic baseline before the account is seeded.
    # No clear or uninstall occurs through both install-r, restart, and logout verification phases.
    & $adb -s $Serial uninstall 'org.sharteman.gymcoach' *> $null
    & $adb -s $Serial uninstall 'org.sharteman.gymcoach.test' *> $null
    Invoke-Checked -FilePath $adb -Arguments @('-s', $Serial, 'install', '-r', $BaselineApk) | Out-Null
    Invoke-Checked -FilePath $adb -Arguments @('-s', $Serial, 'shell', 'pm', 'clear', 'org.sharteman.gymcoach') | Out-Null
    Invoke-Checked -FilePath $adb -Arguments @('-s', $Serial, 'install', '-r', $TestApk) | Out-Null
    Invoke-InstrumentationPhase -MethodName 'verifyFreshInstallRequiresAuthentication'
    Invoke-InstrumentationPhase -MethodName 'seedLegacyAccountWithoutSessionAuthorityForUpgrade'
    if (-not (Test-EncryptedPreferencePresent)) {
        throw 'The seed phase did not persist the encrypted account preference.'
    }

    Invoke-Checked -FilePath $adb -Arguments @('-s', $Serial, 'shell', 'am', 'force-stop', 'org.sharteman.gymcoach') | Out-Null
    Invoke-Checked -FilePath $adb -Arguments @('-s', $Serial, 'install', '-r', $UpgradeApk) | Out-Null
    if (-not (Test-EncryptedPreferencePresent)) {
        throw 'The first install-r removed the encrypted account preference before app startup.'
    }
    Invoke-InstrumentationPhase -MethodName 'migrateLegacyAuthorityThroughProductionSettingsRepository'

    Invoke-Checked -FilePath $adb -Arguments @('-s', $Serial, 'shell', 'am', 'force-stop', 'org.sharteman.gymcoach') | Out-Null
    Invoke-InstrumentationPhase -MethodName 'verifyRecoveredAuthorityAndDiagnosticsAfterRestartOrUpdate'

    Invoke-Checked -FilePath $adb -Arguments @('-s', $Serial, 'shell', 'am', 'force-stop', 'org.sharteman.gymcoach') | Out-Null
    Invoke-Checked -FilePath $adb -Arguments @('-s', $Serial, 'install', '-r', $UpgradeApk) | Out-Null
    if (-not (Test-EncryptedPreferencePresent)) {
        throw 'The second install-r removed the encrypted account preference before app startup.'
    }
    Invoke-InstrumentationPhase -MethodName 'verifyRecoveredAuthorityAndDiagnosticsAfterRestartOrUpdate'
    Invoke-InstrumentationPhase -MethodName 'verifyDiagnosticsSurviveProductionLogout'

    Invoke-Checked -FilePath $adb -Arguments @('-s', $Serial, 'shell', 'pm', 'clear', 'org.sharteman.gymcoach') | Out-Null
    Invoke-InstrumentationPhase -MethodName 'verifyFreshInstallRequiresAuthentication'
} finally {
    Stop-UpgradeFixture -Fixture $fixture
}

Write-Output (
    'Android auth upgrade regression passed on emulator-5554: ' +
    "$($baseline.VersionName) ($($baseline.VersionCode)) -> " +
    "$($upgrade.VersionName) ($($upgrade.VersionCode)) with two install-r passes; " +
    'production bootstrap, process restart, diagnostics retention, logout, package, and signer passed.'
)
