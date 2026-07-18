[CmdletBinding()]
param(
    [string]$FixturePath,
    [string]$ThreadSnapshotPath,
    [string[]]$TaskThreadSnapshotPath,
    [string]$RepositoryRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($PSVersionTable.PSVersion.Major -lt 7) {
    throw 'scripts/harness-status.ps1 requires PowerShell 7 or newer.'
}

$scriptRoot = Split-Path -Parent $PSCommandPath
$repoRoot = if ($RepositoryRoot) {
    (Resolve-Path -LiteralPath $RepositoryRoot).Path
} else {
    (Resolve-Path -LiteralPath (Join-Path $scriptRoot '..')).Path
}
$classifier = Join-Path $scriptRoot 'harness-status-core.mjs'

function Invoke-NativeReadOnly {
    param(
        [Parameter(Mandatory)]
        [string]$Command,
        [Parameter(Mandatory)]
        [string[]]$Arguments
    )

    try {
        $output = & $Command @Arguments 2>&1
        $exitCode = $LASTEXITCODE
        $text = ($output | ForEach-Object { $_.ToString() }) -join "`n"
        return [ordered]@{
            Ok = ($exitCode -eq 0)
            ExitCode = $exitCode
            Output = $text
        }
    } catch {
        return [ordered]@{
            Ok = $false
            ExitCode = -1
            Output = $_.Exception.Message
        }
    }
}

function ConvertFrom-JsonSafe {
    param(
        [string]$Text,
        [string]$Label
    )

    try {
        return $Text | ConvertFrom-Json -Depth 100
    } catch {
        throw "$Label returned invalid JSON: $($_.Exception.Message)"
    }
}

function ConvertFrom-GitWorktreeList {
    param([string]$Text)

    $items = [System.Collections.Generic.List[object]]::new()
    $current = $null
    foreach ($line in ($Text -split "`r?`n")) {
        if ($line -eq '') {
            if ($null -ne $current) {
                $items.Add([pscustomobject]$current)
                $current = $null
            }
            continue
        }
        $separator = $line.IndexOf(' ')
        $key = if ($separator -eq -1) { $line } else { $line.Substring(0, $separator) }
        $value = if ($separator -eq -1) { $true } else { $line.Substring($separator + 1) }
        if ($key -eq 'worktree') {
            if ($null -ne $current) {
                $items.Add([pscustomobject]$current)
            }
            $current = [ordered]@{
                path = $value
                head = $null
                branch = $null
                detached = $false
                locked = $false
                prunable = $false
            }
            continue
        }
        if ($null -eq $current) {
            continue
        }
        switch ($key) {
            'HEAD' { $current.head = $value }
            'branch' { $current.branch = $value -replace '^refs/heads/', '' }
            'detached' { $current.detached = $true }
            'locked' { $current.locked = $true }
            'prunable' { $current.prunable = $true }
        }
    }
    if ($null -ne $current) {
        $items.Add([pscustomobject]$current)
    }
    return @($items)
}

function Get-DiskSnapshot {
    $items = [System.Collections.Generic.List[object]]::new()
    foreach ($name in @('C', 'D')) {
        $drive = Get-PSDrive -PSProvider FileSystem -Name $name -ErrorAction SilentlyContinue
        if ($null -ne $drive) {
            $items.Add([pscustomobject][ordered]@{
                name = $name
                freeBytes = [double]$drive.Free
            })
        }
    }
    return @($items)
}

function Get-PortSnapshot {
    $items = [System.Collections.Generic.List[object]]::new()
    $command = Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        return [ordered]@{
            Ok = $false
            Detail = 'Get-NetTCPConnection is unavailable.'
            Items = @()
        }
    }

    foreach ($port in @(3030, 3031, 5434)) {
        $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
        $listener = $listeners | Sort-Object OwningProcess | Select-Object -First 1
        $processName = $null
        if ($null -ne $listener -and $listener.OwningProcess) {
            $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
            if ($null -ne $process) {
                $processName = $process.ProcessName
            }
        }
        $items.Add([pscustomobject][ordered]@{
            port = $port
            listening = ($null -ne $listener)
            ownerPid = if ($null -ne $listener) { [int]$listener.OwningProcess } else { $null }
            processName = $processName
        })
    }
    return [ordered]@{
        Ok = $true
        Detail = 'Read from Get-NetTCPConnection.'
        Items = @($items)
    }
}

function Find-SqliteCommand {
    $command = Get-Command sqlite3.exe -ErrorAction SilentlyContinue
    if ($null -ne $command) {
        return $command.Source
    }
    $androidCandidate = Join-Path $HOME 'AppData\Local\Android\Sdk\platform-tools\sqlite3.exe'
    if (Test-Path -LiteralPath $androidCandidate -PathType Leaf) {
        return $androidCandidate
    }
    return $null
}

function Get-LocalCodexThreadSnapshot {
    $codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME '.codex' }
    $database = Join-Path $codexHome 'state_5.sqlite'
    $sqlite = Find-SqliteCommand
    $items = [System.Collections.Generic.List[object]]::new()

    if ($null -ne $sqlite -and (Test-Path -LiteralPath $database -PathType Leaf)) {
        $query = @'
SELECT json_object(
  'id', t.id,
  'cwd', t.cwd,
  'gitBranch', COALESCE(t.git_branch, ''),
  'agentRole', COALESCE(t.agent_role, ''),
  'updatedAtMs', COALESCE(t.updated_at_ms, t.updated_at * 1000),
  'spawnStatus', COALESCE(e.status, '')
)
FROM threads AS t
LEFT JOIN thread_spawn_edges AS e ON e.child_thread_id = t.id
WHERE t.archived = 0
ORDER BY COALESCE(t.updated_at_ms, t.updated_at * 1000) DESC, t.id DESC
LIMIT 49;
'@
        $result = Invoke-NativeReadOnly -Command $sqlite -Arguments @('-readonly', '-batch', '-noheader', $database, $query)
        if ($result.Ok) {
            foreach ($line in ($result.Output -split "`r?`n")) {
                if (-not $line.Trim()) {
                    continue
                }
                $row = ConvertFrom-JsonSafe -Text $line -Label 'Codex SQLite query'
                $items.Add([pscustomobject][ordered]@{
                    id = $row.id
                    cwd = $row.cwd
                    gitBranch = $row.gitBranch
                    agentRole = $row.agentRole
                    state = 'unknown'
                    updatedAtMs = $row.updatedAtMs
                    source = 'codex-state-sqlite'
                })
            }
            return [ordered]@{
                source = 'codex-state-sqlite'
                complete = $false
                problems = @(
                    'Local Codex SQLite has identity, cwd, branch, role, and spawn-edge fields but no authoritative Desktop runtime status or pending clientThreadId state.'
                )
                items = @($items)
            }
        }
    }

    $sessionIndex = Join-Path $codexHome 'session_index.jsonl'
    if (Test-Path -LiteralPath $sessionIndex -PathType Leaf) {
        foreach ($line in (Get-Content -LiteralPath $sessionIndex -Encoding utf8)) {
            if (-not $line.Trim()) {
                continue
            }
            try {
                $row = $line | ConvertFrom-Json
                $items.Add([pscustomobject][ordered]@{
                    id = $row.id
                    cwd = $null
                    gitBranch = $null
                    agentRole = $null
                    state = 'unknown'
                    updatedAt = $row.updated_at
                    source = 'codex-session-index'
                })
            } catch {
                continue
            }
        }
        return [ordered]@{
            source = 'codex-session-index'
            complete = $false
            problems = @(
                'session_index.jsonl exposes saved identities only; Desktop runtime and pending clientThreadId state remain unavailable.'
            )
            items = @($items)
        }
    }

    return [ordered]@{
        source = 'unavailable'
        complete = $false
        problems = @(
            'No readable local Codex identity source was found. Creation recommendations are suppressed.'
        )
        items = @()
    }
}

function Write-ClassifierOutput {
    param([string]$InputJson)

    $output = $InputJson | & node $classifier --stdin 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Harness classifier failed: $($output -join "`n")"
    }
    $text = ($output | ForEach-Object { $_.ToString() }) -join "`n"
    $null = $text | ConvertFrom-Json -Depth 100
    Write-Output $text.Trim()
}

if ($FixturePath) {
    $resolvedFixture = (Resolve-Path -LiteralPath $FixturePath).Path
    $output = & node $classifier --fixture $resolvedFixture 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Harness fixture classification failed: $($output -join "`n")"
    }
    $text = ($output | ForEach-Object { $_.ToString() }) -join "`n"
    $null = $text | ConvertFrom-Json -Depth 100
    Write-Output $text.Trim()
    exit 0
}

$sourceHealth = [ordered]@{
    beads = [ordered]@{ ok = $false; detail = $null }
    git = [ordered]@{ ok = $false; detail = $null }
    disks = [ordered]@{ ok = $false; detail = $null }
    ports = [ordered]@{ ok = $false; detail = $null }
}
$tasks = @()
$worktrees = @()
$disks = @()
$ports = @()

Push-Location -LiteralPath $repoRoot
try {
    $beadsResult = Invoke-NativeReadOnly -Command 'bd' -Arguments @('--readonly', 'list', '--all', '--limit', '0', '--json')
    if ($beadsResult.Ok) {
        try {
            $tasks = @(ConvertFrom-JsonSafe -Text $beadsResult.Output -Label 'bd --readonly list')
            $sourceHealth.beads.ok = $true
            $sourceHealth.beads.detail = 'Queried with bd --readonly.'
        } catch {
            $sourceHealth.beads.detail = $_.Exception.Message
        }
    } else {
        $sourceHealth.beads.detail = "bd --readonly failed with exit $($beadsResult.ExitCode)."
    }

    $gitResult = Invoke-NativeReadOnly -Command 'git' -Arguments @('worktree', 'list', '--porcelain')
    if ($gitResult.Ok) {
        $worktrees = @(ConvertFrom-GitWorktreeList -Text $gitResult.Output)
        $sourceHealth.git.ok = $true
        $sourceHealth.git.detail = 'Read from git worktree list --porcelain.'
    } else {
        $sourceHealth.git.detail = "git worktree list failed with exit $($gitResult.ExitCode)."
    }

    try {
        $disks = @(Get-DiskSnapshot)
        $sourceHealth.disks.ok = $true
        $sourceHealth.disks.detail = 'Read from FileSystem PSDrives.'
    } catch {
        $sourceHealth.disks.detail = $_.Exception.Message
    }

    try {
        $portSnapshot = Get-PortSnapshot
        $ports = @($portSnapshot.Items)
        $sourceHealth.ports.ok = $portSnapshot.Ok
        $sourceHealth.ports.detail = $portSnapshot.Detail
    } catch {
        $sourceHealth.ports.detail = $_.Exception.Message
    }
} finally {
    Pop-Location
}

$threads = if ($ThreadSnapshotPath) {
    [ordered]@{
        snapshot = Get-Content -Raw -Encoding utf8 -LiteralPath (Resolve-Path -LiteralPath $ThreadSnapshotPath).Path |
            ConvertFrom-Json -Depth 100
    }
} else {
    Get-LocalCodexThreadSnapshot
}

$taskThreadSnapshots = @(
    foreach ($path in @($TaskThreadSnapshotPath)) {
        if (-not $path) {
            continue
        }
        Get-Content -Raw -Encoding utf8 -LiteralPath (Resolve-Path -LiteralPath $path).Path |
            ConvertFrom-Json -Depth 100
    }
)
if ($taskThreadSnapshots.Count -gt 0) {
    $threads['taskSnapshots'] = $taskThreadSnapshots
}

$snapshot = [ordered]@{
    observedAt = [DateTimeOffset]::UtcNow.ToString('o')
    tasks = $tasks
    threads = $threads
    worktrees = $worktrees
    disks = $disks
    ports = $ports
    sourceHealth = $sourceHealth
}

Write-ClassifierOutput -InputJson ($snapshot | ConvertTo-Json -Depth 100 -Compress)
