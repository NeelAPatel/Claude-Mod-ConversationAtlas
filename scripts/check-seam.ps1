param()
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$view = Join-Path $root 'hooks/view.tsx'
$renderers = @('hooks/render-tui.tsx', 'hooks/render-gui.tsx')
$files = Get-ChildItem (Join-Path $root 'hooks') -Recurse -File -Include '*.ts','*.tsx'
$forbidden = @('isGui', 'GLYPH_SETS', 'kitFor')
foreach ($file in $files) {
  $relative = $file.FullName.Substring($root.Length + 1).Replace('\','/')
  if ($file.FullName -eq $view) { continue }
  $source = Get-Content -Raw -LiteralPath $file.FullName
  foreach ($name in $forbidden) {
    if ($source -match "\b$([regex]::Escape($name))\b") {
      Write-Error "Surface seam violation: '$name' found in $relative; only hooks/view.tsx may dispatch surfaces."
      exit 1
    }
  }
  if ($source -match "['']desktop['']") {
    Write-Error "Surface seam violation: the literal 'desktop' found in $relative; only hooks/view.tsx may name the GUI surface."
    exit 1
  }
}
foreach ($renderer in $renderers) {
  $file = Join-Path $root $renderer
  $source = Get-Content -Raw -LiteralPath $file
  if ($source -match 'from\s+["''][^"'']*render-(tui|gui)["'']') {
    Write-Error "Surface seam violation: renderer cross-import in $renderer."
    exit 1
  }
  if ($source -match 'from\s+["''][^"'']*/ui/(?!shared(?:\.tsx?)?["''])[^"'']+["'']') {
    Write-Error "Surface seam violation: $renderer imports a surface-specific hooks/ui module."
    exit 1
  }
}
Write-Output 'Surface seam check passed.'
