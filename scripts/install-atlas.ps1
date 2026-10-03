param(
    [string]$Destination = (Join-Path $env:USERPROFILE '.claude\skills\conversation-atlas')
)

# Private, user-level install of ConversationAtlas (Atlas): a copy of the source folder that
# every new Claude Code session loads as conversation-atlas@skills-dir. Nothing is published.
# Authorized by the user on 2026-10-02 when Atlas was promoted to a working product.

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
# This repo IS the mod: its root holds .claude-plugin/, hooks/, types/ and tests/.
$source = $repoRoot
$manifest = Join-Path $source '.claude-plugin\plugin.json'
if (-not (Test-Path -LiteralPath $manifest)) { throw 'Atlas source manifest is missing.' }
& claude plugin validate $source
if ($LASTEXITCODE -ne 0) { throw 'Source validation failed; installation was not changed.' }

$target = [System.IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $target) {
    $existingManifest = Join-Path $target '.claude-plugin\plugin.json'
    if (-not (Test-Path -LiteralPath $existingManifest)) { throw "Refusing to overwrite an unrelated directory: $target" }
    $existing = Get-Content -LiteralPath $existingManifest -Raw | ConvertFrom-Json
    if ($existing.name -ne 'conversation-atlas') { throw "Refusing to overwrite another plugin: $target" }
    $backupRoot = Join-Path $env:USERPROFILE '.claude\plugin-backups'
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    $backup = Join-Path $backupRoot ('conversation-atlas-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-ffff'))
    Copy-Item -LiteralPath $target -Destination $backup -Recurse
    Write-Host "Previous installation backed up to $backup"
    # Replace the authored files wholesale so a file removed from source does not linger.
    foreach ($name in @('hooks', 'types', 'tests', 'README.md', 'AGENTS.md')) {
        $old = Join-Path $target $name
        if (Test-Path -LiteralPath $old) { Remove-Item -LiteralPath $old -Recurse -Force }
    }
}

New-Item -ItemType Directory -Path (Join-Path $target '.claude-plugin') -Force | Out-Null
Copy-Item -LiteralPath $manifest -Destination (Join-Path $target '.claude-plugin\plugin.json') -Force
foreach ($name in @('hooks', 'types', 'tests', 'README.md', 'AGENTS.md')) {
    Copy-Item -LiteralPath (Join-Path $source $name) -Destination $target -Recurse -Force
}
& claude plugin validate $target
if ($LASTEXITCODE -ne 0) { throw "Installed validation failed. Inspect $target; a previous installation is preserved in the backup if there was one." }
$listed = & claude plugin list --json
if ($LASTEXITCODE -ne 0) { throw 'Claude could not list its plugins.' }
$plugin = @($listed | ConvertFrom-Json) | Where-Object { $_.id -eq 'conversation-atlas@skills-dir' }
if (-not $plugin) { throw 'Files were copied, but Claude did not discover conversation-atlas@skills-dir.' }
if (-not $plugin.enabled) {
    & claude plugin enable conversation-atlas@skills-dir
    if ($LASTEXITCODE -ne 0) { throw 'Atlas was discovered but could not be enabled.' }
}
Write-Host "Installed Atlas at $target"
Write-Host 'Start a new Claude Code session, or run /reload-plugins in an existing session.'
