param(
  [string]$SourceRepo = 'F:\work\aiagent\.runtime\index-tts',
  [string]$PythonRoot = 'F:\AIMIS\IndexTTSRuntime\python313',
  [string]$OutputRoot = 'F:\work\aiagent\release\indextts-runtime',
  [int64]$PartBytes = 1500MB,
  [switch]$StageOnly
)

$ErrorActionPreference = 'Stop'
$stage = Join-Path $OutputRoot 'stage'
$repoOut = Join-Path $stage 'index-tts'
$siteSource = Join-Path $SourceRepo '.venv\Lib\site-packages'
$siteOut = Join-Path $repoOut '.venv\Lib\site-packages'
$modelSource = Join-Path $SourceRepo 'checkpoints_1_5'
$modelOut = Join-Path $repoOut 'checkpoints_1_5'

if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $repoOut, $siteOut, $modelOut | Out-Null

Copy-Item -LiteralPath $PythonRoot -Destination (Join-Path $stage 'python313') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $SourceRepo 'indextts') -Destination $repoOut -Recurse -Force
Copy-Item -LiteralPath (Join-Path $SourceRepo 'LICENSE') -Destination $repoOut -Force -ErrorAction SilentlyContinue

# Copy the environment, then remove build-time/static-development material.
& robocopy $siteSource $siteOut /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }

Get-ChildItem -LiteralPath $siteOut -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Extension.ToLowerInvariant() -in @('.lib', '.h', '.hpp', '.pyi') } |
  Remove-Item -Force
Get-ChildItem -LiteralPath $siteOut -Recurse -Directory -Force -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -in @('__pycache__', '.pytest_cache', '.mypy_cache', 'include') } |
  Sort-Object FullName -Descending |
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

foreach ($name in @('config.yaml', 'gpt.pth', 'bigvgan_generator.pth', 'bpe.model')) {
  Copy-Item -LiteralPath (Join-Path $modelSource $name) -Destination $modelOut -Force
}

$installed = Get-ChildItem -LiteralPath $stage -Recurse -File | Measure-Object Length -Sum
Write-Host ("Minimal runtime: {0:N2} GiB ({1} files)" -f ($installed.Sum / 1GB), $installed.Count)
if ($StageOnly) { exit 0 }

New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
$archive = Join-Path $OutputRoot 'indextts-runtime-win-x64.tar.gz'
if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
& tar.exe -czf $archive -C $stage python313 index-tts
if ($LASTEXITCODE -ne 0) { throw 'tar.exe failed to create the runtime archive' }

$archiveHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
$archiveSize = (Get-Item -LiteralPath $archive).Length
$parts = @()
$input = [System.IO.File]::OpenRead($archive)
try {
  $buffer = New-Object byte[] (8MB)
  $partNumber = 1
  while ($input.Position -lt $input.Length) {
    $partName = 'indextts-runtime-win-x64.tar.gz.part{0:d3}' -f $partNumber
    $partPath = Join-Path $OutputRoot $partName
    $output = [System.IO.File]::Create($partPath)
    try {
      $remaining = [Math]::Min($PartBytes, $input.Length - $input.Position)
      while ($remaining -gt 0) {
        $read = $input.Read($buffer, 0, [int][Math]::Min($buffer.Length, $remaining))
        if ($read -le 0) { break }
        $output.Write($buffer, 0, $read)
        $remaining -= $read
      }
    } finally { $output.Dispose() }
    $item = Get-Item -LiteralPath $partPath
    $parts += [ordered]@{
      name = $partName
      url = "https://github.com/ArayaTouka1/SHOREKEEPER-AGENT/releases/download/indextts-runtime-v1.5/$partName"
      bytes = $item.Length
      sha256 = (Get-FileHash -LiteralPath $partPath -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    $partNumber++
  }
} finally { $input.Dispose() }

$manifest = [ordered]@{
  version = '1.5-minimal-win-x64-v1'
  archiveSha256 = $archiveHash
  archiveBytes = $archiveSize
  installedBytes = [int64]$installed.Sum
  parts = $parts
}
$manifestJson = $manifest | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText(
  (Join-Path $OutputRoot 'indextts-runtime-manifest.json'),
  $manifestJson,
  (New-Object System.Text.UTF8Encoding($false))
)
Write-Host "Archive: $archive"
Write-Host "Parts: $($parts.Count)"
