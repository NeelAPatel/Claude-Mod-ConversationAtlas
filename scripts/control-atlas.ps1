$ErrorActionPreference = 'Stop'

$helpText = @'
control-atlas mounts the real Conversation Atlas Pane in the Claude plugin-test kit and prints a text frame after each scripted step.

Surface names:
  TUI means Atlas's terminal renderer (plugin-test surface: terminal).
  GUI means Atlas's separate desktop renderer (surface: desktop); its text dump is an approximation, not what the owner sees.

Flags:
  --surface tui|gui       Required. Select the renderer.
  --width N               Initial body width in columns. Default: 46.
  --height N              Initial body height in rows. Default: 30.
  --state sample|nogoal|setup  Fixture state. Default: sample.
  --step "STEP"           Add one step; repeat this flag for more steps.
  --steps FILE             Read steps from a .json array/object or a .txt file (one step per line; # comments allowed).
  --styles                 Include style annotations like {0:color:#7dcfff,bold}.
  --json                   Print one JSON document with ok, surface, state, frames, and errors.
  --dry-run                Parse and validate steps, print the plan, and do not run Claude.
  --keep-temp              Keep the generated test folder under .claude/atlas/tmp/sim-<random>.
  --help                   Show this help.

Step grammar and examples:
  size <W>x<H>             size 60x20
  tab map|trail|open|evidence  tab trail
  press <key>              press evb-123
  click <key>              click evb-123 (alias for press)
  clickrow <n>             clickrow 3 (first Button on visible row 3; rows start at 1)
  key <char>               key t (press the Button with hotkey t)
  scroll <signed rows>     scroll 5 or scroll -2
  scroll top|end            scroll end
  legend                   legend (press the Legend Button)
  snapshot                 snapshot (print the current frame without an action)

Every successful step emits one frame. Scroll and size use Pane redraw, clicks use Button press, and keys resolve to a Button hotkey.
The test kit does not send real wheel, mouse, or resize-paint events to the Pane.

Exit codes: 0 success, 1 step/test failure, 2 usage error.

Examples:
  pwsh scripts/control-atlas.ps1 --surface tui
  pwsh scripts/control-atlas.ps1 --surface tui --width 46 --height 20 --step "tab trail" --step "scroll 5"
  pwsh scripts/control-atlas.ps1 --surface gui --state nogoal --step "tab open" --styles
'@

function Usage-Failure([string]$Message, [bool]$AsJson) {
  if ($AsJson) {
    $document = [ordered]@{ ok = $false; surface = $null; state = $null; frames = @(); errors = @(@{ message = $Message }) }
    [Console]::Out.WriteLine(($document | ConvertTo-Json -Depth 20 -Compress))
  } else {
    [Console]::Error.WriteLine("Usage error: $Message")
    [Console]::Error.WriteLine('Example fix: pwsh scripts/control-atlas.ps1 --surface tui --step "tab trail"')
  }
  exit 2
}

function Parse-PlanStep([string]$InputStep) {
  $source = $InputStep.Trim()
  $parts = @($source -split '\s+' | Where-Object { $_ -ne '' })
  if ($parts.Count -eq 0) { throw 'Step is empty. Example fix: --step "snapshot".' }
  $command = $parts[0].ToLowerInvariant()
  $argsForStep = @($parts | Select-Object -Skip 1)
  switch ($command) {
    'size' {
      if ($argsForStep.Count -ne 1 -or $argsForStep[0] -notmatch '^(\d+)x(\d+)$') { throw "Invalid step '$source': size must look like 46x30. Example fix: --step `"size 60x20`"." }
      if ([int]$Matches[1] -lt 1 -or [int]$Matches[2] -lt 1) { throw "Invalid step '$source': width and height must be positive. Example fix: --step `"size 60x20`"." }
      return "size $($Matches[1])x$($Matches[2])"
    }
    'tab' {
      if ($argsForStep.Count -ne 1 -or $argsForStep[0].ToLowerInvariant() -notin @('map', 'trail', 'open', 'evidence')) { throw "Invalid step '$source': tab must be map, trail, open, or evidence. Example fix: --step `"tab trail`"." }
      return "tab $($argsForStep[0].ToLowerInvariant())"
    }
    { $_ -in @('press', 'click') } {
      if ($argsForStep.Count -ne 1) { throw "Invalid step '$source': $command needs one Button key. Example fix: --step `"press tab-trail`"." }
      return "$command $($argsForStep[0])"
    }
    'clickrow' {
      if ($argsForStep.Count -ne 1 -or $argsForStep[0] -notmatch '^\d+$' -or [int]$argsForStep[0] -lt 1) { throw "Invalid step '$source': clickrow needs a positive 1-based row. Example fix: --step `"clickrow 3`"." }
      return "clickrow $([int]$argsForStep[0])"
    }
    'key' {
      if ($argsForStep.Count -ne 1 -or $argsForStep[0] -notmatch '^[a-zA-Z0-9]$') { throw "Invalid step '$source': key needs one digit or letter hotkey. Example fix: --step `"key t`"." }
      return "key $($argsForStep[0].ToLowerInvariant())"
    }
    'scroll' {
      if ($argsForStep.Count -ne 1) { throw "Invalid step '$source': scroll needs a signed row count, top, or end. Example fix: --step `"scroll -2`"." }
      $value = $argsForStep[0].ToLowerInvariant()
      if ($value -in @('top', 'end')) { return "scroll $value" }
      if ($value -notmatch '^[+-]?\d+$') { throw "Invalid step '$source': scroll rows must be an integer. Example fix: --step `"scroll 5`"." }
      return "scroll $([int]$value)"
    }
    { $_ -in @('legend', 'snapshot') } {
      if ($argsForStep.Count -ne 0) { throw "Invalid step '$source': $command takes no arguments. Example fix: --step `"$command`"." }
      return $command
    }
    default { throw "Invalid step '$source': unknown command. Valid: size, tab, press, click, clickrow, key, scroll, legend, snapshot. Example fix: --step `"tab trail`"." }
  }
}

function Read-StepFile([string]$Path) {
  $resolved = Resolve-Path -LiteralPath $Path -ErrorAction Stop
  $raw = Get-Content -LiteralPath $resolved.Path -Raw
  if ([IO.Path]::GetExtension($resolved.Path).ToLowerInvariant() -eq '.json') {
    $parsed = $raw | ConvertFrom-Json -AsHashtable
    if ($parsed -is [System.Collections.IDictionary]) { $parsed = $parsed['steps'] }
    if ($null -eq $parsed -or $parsed -isnot [System.Collections.IEnumerable] -or $parsed -is [string]) { throw "Steps JSON must be an array of strings or an object with a steps array. Example: {`"steps`":[`"tab trail`",`"snapshot`"]}." }
    $items = @($parsed)
    foreach ($item in $items) {
      if ($item -isnot [string]) { throw 'Every JSON step must be a string. Example: {"steps":["tab trail","snapshot"]}.' }
    }
    return $items
  }
  return @($raw -split '\r?\n' | ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not $_.StartsWith('#') })
}

$tokens = @($args | ForEach-Object { [string]$_ })
$surface = $null
$width = 46
$height = 30
$state = 'sample'
$stepValues = [System.Collections.Generic.List[string]]::new()
$stepsFile = $null
$showStyles = $false
$asJson = $tokens -contains '--json'
$dryRun = $false
$keepTemp = $false
$showHelp = $false

for ($i = 0; $i -lt $tokens.Count; $i++) {
  $token = $tokens[$i]
  switch ($token.ToLowerInvariant()) {
    '--help' { $showHelp = $true }
    '--styles' { $showStyles = $true }
    '--json' { $asJson = $true }
    '--dry-run' { $dryRun = $true }
    '--keep-temp' { $keepTemp = $true }
    { $_ -in @('--surface', '--width', '--height', '--state', '--step', '--steps') } {
      if ($i + 1 -ge $tokens.Count -or $tokens[$i + 1].StartsWith('--')) { Usage-Failure "Flag $token requires a value." $asJson }
      $value = $tokens[++$i]
      switch ($token.ToLowerInvariant()) {
        '--surface' { $surface = $value.ToLowerInvariant() }
        '--width' { if ($value -notmatch '^\d+$' -or [int]$value -lt 1) { Usage-Failure '--width must be a positive integer.' $asJson }; $width = [int]$value }
        '--height' { if ($value -notmatch '^\d+$' -or [int]$value -lt 1) { Usage-Failure '--height must be a positive integer.' $asJson }; $height = [int]$value }
        '--state' { $state = $value.ToLowerInvariant() }
        '--step' { $stepValues.Add($value) }
        '--steps' { if ($stepsFile) { Usage-Failure '--steps may be specified once.' $asJson }; $stepsFile = $value }
      }
    }
    default { Usage-Failure "Unknown flag or argument '$token'. Use --help for valid flags." $asJson }
  }
}

if ($showHelp) { [Console]::Out.WriteLine($helpText); exit 0 }
if ($surface -notin @('tui', 'gui')) { Usage-Failure '--surface is required and must be tui or gui.' $asJson }
if ($state -notin @('sample', 'nogoal', 'setup')) { Usage-Failure '--state must be sample, nogoal, or setup.' $asJson }
if ($stepsFile -and $stepValues.Count) { Usage-Failure 'Use either --step or --steps, not both.' $asJson }

try {
  if ($stepsFile) { $stepValues.AddRange([string[]](Read-StepFile $stepsFile)) }
  if ($stepValues.Count -eq 0) { $stepValues.Add('snapshot') }
  $plan = @($stepValues | ForEach-Object { Parse-PlanStep $_ })
} catch {
  Usage-Failure $_.Exception.Message $asJson
}

if ($dryRun) {
  if ($asJson) {
    $document = [ordered]@{ ok = $true; surface = $surface; state = $state; frames = @(); errors = @(); plan = $plan }
    [Console]::Out.WriteLine(($document | ConvertTo-Json -Depth 20 -Compress))
  } else {
    [Console]::Out.WriteLine("Plan only; no plugin test will run. Surface=$surface state=$state size=${width}x${height}")
    for ($i = 0; $i -lt $plan.Count; $i++) { [Console]::Out.WriteLine("$($i + 1). $($plan[$i])") }
  }
  exit 0
}

$repo = Split-Path -Parent $PSScriptRoot
$tmpRoot = Join-Path $repo '.claude/atlas/tmp'
$tempPath = Join-Path $tmpRoot ("sim-" + [guid]::NewGuid().ToString('N'))
$frames = [System.Collections.Generic.List[object]]::new()
$errors = [System.Collections.Generic.List[object]]::new()
$testOutputText = ''
$testExit = 1
$tempCreated = $false

try {
  New-Item -ItemType Directory -Path $tmpRoot -Force | Out-Null
  New-Item -ItemType Directory -Path $tempPath -Force | Out-Null
  $tempCreated = $true
  foreach ($relative in @('hooks', 'types', '.claude-plugin', 'tests/fixtures', 'scripts/sim')) {
    $source = Join-Path $repo $relative
    $destination = Join-Path $tempPath $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Recurse -Force | Out-Null
  }
  New-Item -ItemType Directory -Path (Join-Path $tempPath 'tests') -Force | Out-Null
  $template = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'sim/sim.template.txt') -Raw
  $config = [ordered]@{
    surface = $surface
    width = $width
    height = $height
    state = $state
    styles = $showStyles
    steps = @($plan)
  }
  $configJson = $config | ConvertTo-Json -Depth 20 -Compress
  $generated = $template.Replace('/*STEPS*/', $configJson)
  Set-Content -LiteralPath (Join-Path $tempPath 'tests/sim.generated.test.tsx') -Value $generated -Encoding utf8NoBOM

  Push-Location $tempPath
  try {
    $rawOutput = & claude plugin test . 2>&1
    $testExit = $LASTEXITCODE
    $testOutputText = ($rawOutput | ForEach-Object { [string]$_ }) -join "`n"
  } catch {
    $testExit = 127
    $testOutputText = $_.Exception.Message
  } finally {
    Pop-Location
  }

  foreach ($line in ($testOutputText -split "`r?`n")) {
    if ($line -match 'SIM_FRAME\s+(\{.*\})\s*$') {
      try { $frames.Add(($Matches[1] | ConvertFrom-Json -AsHashtable)) } catch { $errors.Add(@{ message = "Could not parse SIM_FRAME output: $($_.Exception.Message)" }) }
    } elseif ($line -match 'SIM_ERROR\s+(\{.*\})\s*$') {
      try { $errors.Add(($Matches[1] | ConvertFrom-Json -AsHashtable)) } catch { $errors.Add(@{ message = $Matches[1] }) }
    }
  }
  if ($testExit -ne 0 -and $errors.Count -eq 0) {
    $message = if ($testExit -eq 127) { "Could not run 'claude plugin test .': $testOutputText" } else { "claude plugin test . failed with exit code $testExit." }
    $errors.Add(@{ message = $message })
  }
} catch {
  $testExit = 1
  $errors.Add(@{ message = $_.Exception.Message })
} finally {
  if ($tempCreated -and -not $keepTemp) {
    $repoPrefix = [IO.Path]::GetFullPath($repo).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $resolvedTemp = [IO.Path]::GetFullPath($tempPath)
    if (-not $resolvedTemp.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolvedTemp) -notmatch '^sim-[a-f0-9]{32}$') {
      throw "Refusing to remove temp folder outside the expected sim directory: $resolvedTemp"
    }
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
  }
}

$ok = $testExit -eq 0 -and $errors.Count -eq 0
if ($asJson) {
  $document = [ordered]@{ ok = $ok; surface = $surface; state = $state; frames = @($frames.ToArray()); errors = @($errors.ToArray()) }
  [Console]::Out.WriteLine(($document | ConvertTo-Json -Depth 100 -Compress))
  if ($keepTemp -and $tempCreated) { [Console]::Error.WriteLine("Kept temp test folder: $tempPath") }
} else {
  foreach ($frame in $frames) {
    [Console]::Out.WriteLine([string]$frame.header)
    foreach ($line in $frame.lines) {
      $rendered = [string]$line.text
      if ($line.styles) { $rendered += "  $($line.styles)" }
      [Console]::Out.WriteLine($rendered)
      foreach ($overflow in $frame.overflow | Where-Object { [int]$_.row -eq [int]$line.row }) {
        [Console]::Out.WriteLine("OVERFLOW row $($overflow.row): $($overflow.cells) > $($overflow.width)")
      }
    }
    $buttonText = @($frame.buttons | ForEach-Object { if ($_.hotkey) { "$($_.key)[$($_.hotkey)]" } else { [string]$_.key } }) -join ' '
    [Console]::Out.WriteLine("buttons: $buttonText")
  }
  if (-not $ok) {
    foreach ($errorItem in $errors) { [Console]::Error.WriteLine("ERROR: $($errorItem.message)") }
    if ($testOutputText -and $testExit -ne 127) { [Console]::Error.WriteLine($testOutputText) }
    if ($keepTemp -and $tempCreated) { [Console]::Error.WriteLine("Kept temp test folder: $tempPath") }
  }
}

if ($ok) { exit 0 } else { exit 1 }
