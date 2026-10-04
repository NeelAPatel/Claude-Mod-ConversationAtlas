# Guard for GUI-only sessions: everything changed since the TUI freeze tag must be on the GUI side.
# Works on Windows PowerShell 5.1 and pwsh. Exit 1 lists every violation.
param([string]$Base = 'tui-freeze-2026-10-04')
$ErrorActionPreference = 'Continue'
function Invoke-G { & git.exe @args 2>&1 | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] } }
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$allowed = @(
  '^hooks/render-gui\.tsx$',
  '^tests/gui-[A-Za-z0-9._-]+\.test\.tsx$',
  '^tests/golden/desktop-[0-9]+-[a-z-]+\.txt$',
  '^tests/golden/manifest\.ts$',
  '^docs/gui/.+$',
  '^docs/GUI-TAKEOVER\.md$'
)
$changed = @(Invoke-G diff --name-only $Base) + @(Invoke-G ls-files --others --exclude-standard)
$changed = $changed | Where-Object { $_ } | ForEach-Object { $_.Replace('\', '/') } | Sort-Object -Unique
$bad = @()
foreach ($file in $changed) {
  if ($file -like '.claude/*') { continue }
  $ok = $false
  foreach ($pattern in $allowed) { if ($file -match $pattern) { $ok = $true; break } }
  if (-not $ok) { $bad += "FORBIDDEN FILE changed since ${Base}: $file" }
}
$manifest = @(Invoke-G diff -U0 $Base -- tests/golden/manifest.ts | Where-Object { $_ -match '^[+-]' -and $_ -notmatch '^(\+\+\+|---)' })
foreach ($line in $manifest) {
  if ($line -notmatch '^[+-]  "desktop-') { $bad += "FORBIDDEN manifest line (only desktop-* entries may change): " + $line.Substring(0, [Math]::Min(80, $line.Length)) }
}
if ($bad.Count -gt 0) {
  $bad | ForEach-Object { Write-Output $_ }
  Write-Output "GUI scope check FAILED: a GUI session may change only render-gui.tsx, tests/gui-*.test.tsx, desktop-* goldens (and their manifest entries) and docs/gui/*. Stop and ask the owner."
  exit 1
}
Write-Output "GUI scope check passed ($($changed.Count) changed file(s) since $Base, all GUI-side)."
