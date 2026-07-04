<#
.SYNOPSIS
  Agendex CLI installer for Windows (PowerShell).

.DESCRIPTION
  Installs the Agendex CLI (agendex-cli) globally using the best available
  package manager (npm first, then pnpm, yarn, or bun).

  Usage:
    irm https://agendex.dev/install.ps1 | iex

  With options (download first, then invoke):
    & ([scriptblock]::Create((irm https://agendex.dev/install.ps1))) -Version 1.2.3
    & ([scriptblock]::Create((irm https://agendex.dev/install.ps1))) -Pm pnpm -SkipVerify

  Environment variable equivalents (work with plain irm | iex):
    $env:AGENDEX_INSTALL_VERSION = '1.2.3'
    $env:AGENDEX_INSTALL_PM      = 'npm'
    $env:AGENDEX_INSTALL_PACKAGE = 'agendex-cli'
#>
[CmdletBinding()]
param(
    [string]$Version = '',
    [string]$Pm = '',
    [switch]$SkipVerify
)

$ErrorActionPreference = 'Stop'

$PackageName = if ($env:AGENDEX_INSTALL_PACKAGE) { $env:AGENDEX_INSTALL_PACKAGE } else { 'agendex-cli' }
$BinName = if ($env:AGENDEX_INSTALL_BIN) { $env:AGENDEX_INSTALL_BIN } else { 'agendex' }
if (-not $Version) { $Version = if ($env:AGENDEX_INSTALL_VERSION) { $env:AGENDEX_INSTALL_VERSION } else { 'latest' } }
if (-not $Pm) { $Pm = if ($env:AGENDEX_INSTALL_PM) { $env:AGENDEX_INSTALL_PM } else { 'auto' } }
if (@('auto', 'npm', 'pnpm', 'yarn', 'bun') -notcontains $Pm) {
    Write-Host "[agendex] error: unsupported package manager: $Pm (expected npm, pnpm, yarn, bun, or auto)"
    exit 1
}

# PowerShell 5.1 (Windows default) does not define $IsWindows; PS 6+ does.
$OnWindows = ($PSVersionTable.PSVersion.Major -lt 6) -or $IsWindows

function Write-Info([string]$Message) {
    Write-Host '[agendex] ' -ForegroundColor White -NoNewline
    Write-Host $Message
}

function Write-Success([string]$Message) {
    Write-Host '[agendex] ' -ForegroundColor Green -NoNewline
    Write-Host $Message
}

function Write-Warn([string]$Message) {
    Write-Host '[agendex] warning: ' -ForegroundColor Yellow -NoNewline
    Write-Host $Message
}

function Fail([string]$Message) {
    Write-Host '[agendex] error: ' -ForegroundColor Red -NoNewline
    Write-Host $Message
    exit 1
}

function Test-Command([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-NormalizedVersion([string]$Raw) {
    if ($Raw -match '^v[0-9]') { return $Raw.Substring(1) }
    return $Raw
}

function Assert-Node {
    if (-not (Test-Command 'node')) {
        Fail @'
Node.js 20+ is required. Install it first, then rerun this installer:

  winget install OpenJS.NodeJS.LTS

or download it from https://nodejs.org/. After installing, open a NEW
PowerShell window so PATH updates take effect.
'@
    }

    $rawVersion = ''
    try { $rawVersion = (& node -v) 2>$null } catch { }
    if (-not $rawVersion -or $rawVersion -notmatch '^v(\d+)') {
        Fail 'could not determine your Node.js version; Agendex requires Node.js 20+.'
    }

    $major = [int]$Matches[1]
    if ($major -lt 20) {
        Fail "Node.js 20+ is required; found $rawVersion. Upgrade Node.js and rerun this installer."
    }
}

function Resolve-PackageManager {
    if ($Pm -ne 'auto') {
        if (-not (Test-Command $Pm)) {
            Fail "$Pm is not installed or not on PATH."
        }
        return $Pm
    }

    foreach ($candidate in @('npm', 'pnpm', 'yarn', 'bun')) {
        if (Test-Command $candidate) { return $candidate }
    }

    Fail 'no supported package manager found. Install npm, pnpm, yarn, or bun and rerun this installer.'
}

function Assert-PackageManager([string]$Manager) {
    if ($Manager -eq 'yarn') {
        $yarnVersion = ''
        try { $yarnVersion = (& yarn --version) 2>$null } catch { }
        if ($yarnVersion -match '^(\d+)' -and [int]$Matches[1] -ge 2) {
            Fail "Yarn $yarnVersion does not support 'yarn global add'. Rerun with '-Pm npm' or use npm install -g $PackageName."
        }
    }
}

function Install-Package([string]$Manager, [string]$PkgSpec) {
    Write-Info "Installing $PkgSpec with $Manager..."
    switch ($Manager) {
        'npm' { & npm install -g $PkgSpec }
        'pnpm' { & pnpm add -g $PkgSpec }
        'yarn' { & yarn global add $PkgSpec }
        'bun' { & bun install -g $PkgSpec }
    }
    return ($LASTEXITCODE -eq 0)
}

function Get-ManagerBinDir([string]$Manager) {
    try {
        switch ($Manager) {
            'npm' {
                $prefix = (& npm prefix -g) 2>$null
                if ($prefix) {
                    # On Windows npm puts shims directly in the prefix dir; elsewhere in <prefix>/bin.
                    if ($OnWindows) { return $prefix } else { return (Join-Path $prefix 'bin') }
                }
            }
            'pnpm' { return (& pnpm bin -g) 2>$null }
            'yarn' { return (& yarn global bin) 2>$null }
            'bun' {
                $bunBin = (& bun pm bin -g) 2>$null
                if ($bunBin) { return $bunBin }
                return (Join-Path $HOME '.bun\bin')
            }
        }
    } catch { }
    return $null
}

function Resolve-AgendexBin([string]$Manager) {
    $binDir = Get-ManagerBinDir $Manager
    if ($binDir) {
        $candidates = if ($OnWindows) {
            @("$BinName.cmd", "$BinName.ps1", "$BinName.exe", $BinName)
        } else {
            @($BinName)
        }
        foreach ($candidate in $candidates) {
            $candidatePath = Join-Path $binDir $candidate
            if (Test-Path $candidatePath) { return $candidatePath }
        }
    }

    $found = Get-Command $BinName -ErrorAction SilentlyContinue
    if ($found) { return $found.Source }
    return $null
}

function Show-NextSteps {
    Write-Host @'

Next steps:
  agendex login       # authenticate with Agendex Cloud
  agendex configure   # select which agent plan sources to index
  agendex start       # start the background sync daemon

For a self-hosted Agendex instance, use:
  agendex login --url https://agendex.yourdomain.com
'@
}

$Arch = if ($env:PROCESSOR_ARCHITECTURE) { $env:PROCESSOR_ARCHITECTURE } else { 'unknown' }
$OsLabel = if ($OnWindows) { 'Windows' } else { [string][System.Environment]::OSVersion.Platform }

Assert-Node
$Manager = Resolve-PackageManager
Assert-PackageManager $Manager
$NormalizedVersion = Get-NormalizedVersion $Version
$PkgSpec = "$PackageName@$NormalizedVersion"

Write-Info "Installing Agendex CLI ($PkgSpec) on $OsLabel/$Arch"
if (-not (Install-Package $Manager $PkgSpec)) {
    Write-Warn 'installation failed.'
    if ($Manager -eq 'npm') {
        Write-Host @'
If this was a permissions error, try rerunning PowerShell as Administrator,
or configure a user-writable npm prefix and rerun:

  npm config set prefix "$env:LOCALAPPDATA\npm"
  $env:Path = "$env:LOCALAPPDATA\npm;$env:Path"
'@
    }
    exit 1
}

$BinPath = Resolve-AgendexBin $Manager
if (-not $SkipVerify) {
    if (-not $BinPath) {
        $binDir = Get-ManagerBinDir $Manager
        Write-Success "Agendex CLI was installed, but '$BinName' is not on PATH yet."
        if ($binDir) {
            Write-Host "Add it for this session with:"
            Write-Host "  `$env:Path = `"$binDir;`$env:Path`""
        }
        Show-NextSteps
        exit 0
    }

    $installedVersion = ''
    try { $installedVersion = (& $BinPath --version) 2>$null } catch { }
    if (-not $installedVersion) {
        Fail "installed $BinName, but '$BinPath --version' failed."
    }
    Write-Success "Agendex CLI installed successfully ($BinName $installedVersion)."
} else {
    Write-Success 'Agendex CLI installed successfully.'
}

if (-not (Test-Command $BinName) -and $BinPath) {
    $binDir = Split-Path $BinPath -Parent
    Write-Host ""
    Write-Host "$BinName is installed at:"
    Write-Host "  $BinPath"
    Write-Host ""
    Write-Host "Add it for this session with:"
    Write-Host "  `$env:Path = `"$binDir;`$env:Path`""
}

Show-NextSteps
