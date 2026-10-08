$ErrorActionPreference = 'Stop'
# Read `claude plugin test` output as UTF-8 so non-ASCII glyphs in goldens survive.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$testFile = Join-Path $repo 'tests/golden.test.tsx'
$goldenDir = Join-Path $repo 'tests/golden'
$original = [System.IO.File]::ReadAllText($testFile)
$captureLine = 'const CAPTURE_GOLDENS = false'
$captureEnabled = 'const CAPTURE_GOLDENS = true'

if (-not $original.Contains($captureLine)) {
  throw "Could not find the capture switch in $testFile"
}

try {
  [System.IO.File]::WriteAllText($testFile, $original.Replace($captureLine, $captureEnabled), [System.Text.UTF8Encoding]::new($false))
  $output = (& claude plugin test . 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) {
    throw "claude plugin test failed while capturing goldens.`n$output"
  }

  $matches = [regex]::Matches($output, '(?m)^CAPTURE_GOLDEN ([^ ]+) (.+)$')
  if ($matches.Count -ne 32) {
    throw "Expected 32 captured goldens, found $($matches.Count)."
  }

  $entries = [ordered]@{}
  foreach ($match in $matches) {
    $name = $match.Groups[1].Value
    $content = $match.Groups[2].Value | ConvertFrom-Json
    $entries[$name] = $content
    [System.IO.File]::WriteAllText((Join-Path $goldenDir "$name.txt"), $content, [System.Text.UTF8Encoding]::new($false))
  }

  $manifest = [System.Collections.Generic.List[string]]::new()
  $manifest.Add('export const GOLDENS: Record<string, string> = {')
  foreach ($name in ($entries.Keys | Sort-Object)) {
    $json = $entries[$name] | ConvertTo-Json -Compress
    $manifest.Add("  `"$name`": $json,")
  }
  $manifest.Add('}')
  [System.IO.File]::WriteAllText((Join-Path $goldenDir 'manifest.ts'), ($manifest -join "`n") + "`n", [System.Text.UTF8Encoding]::new($false))
  Write-Output "Updated $($entries.Count) Atlas golden snapshots."
}
finally {
  [System.IO.File]::WriteAllText($testFile, $original, [System.Text.UTF8Encoding]::new($false))
}

