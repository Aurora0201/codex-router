param(
  [string]$OutputDirectory = "release"
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$outputPath = [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot $OutputDirectory))
$stagingPath = Join-Path ([System.IO.Path]::GetTempPath()) ("codex-router-release-" + [System.Guid]::NewGuid().ToString("N"))
$version = (Get-Content (Join-Path $repositoryRoot "package.json") | ConvertFrom-Json).version

New-Item -ItemType Directory -Force -Path $outputPath | Out-Null
@(
  "aurora0201-codex-router-$version.tgz",
  "codex-router-v$version-win32-x64.zip",
  "SHA256SUMS.txt"
) | ForEach-Object {
  $existingArtifact = Join-Path $outputPath $_
  if (Test-Path -LiteralPath $existingArtifact) {
    Remove-Item -LiteralPath $existingArtifact -Force
  }
}

try {
  $packResult = npm pack --workspace @aurora0201/codex-router --pack-destination $outputPath --json | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or $packResult.Count -ne 1) {
    throw "npm pack failed"
  }

  $tarballPath = Join-Path $outputPath $packResult[0].filename
  New-Item -ItemType Directory -Force -Path $stagingPath | Out-Null
  npm install --prefix $stagingPath --omit=dev --no-audit --no-fund $tarballPath
  if ($LASTEXITCODE -ne 0) {
    throw "production dependency installation failed"
  }

  $launcher = @"
@ECHO OFF
SETLOCAL
node "%~dp0node_modules\@aurora0201\codex-router\dist\cli.js" %*
"@
  $launcherPath = Join-Path $stagingPath "codex-router.cmd"
  Set-Content -LiteralPath $launcherPath -Value $launcher -Encoding ascii
  Copy-Item -LiteralPath (Join-Path $repositoryRoot "README.md") -Destination $stagingPath
  Copy-Item -LiteralPath (Join-Path $repositoryRoot "LICENSE") -Destination $stagingPath

  $reportedVersion = (& $launcherPath --version).Trim()
  if ($LASTEXITCODE -ne 0 -or $reportedVersion -ne $version) {
    throw "Windows launcher reported '$reportedVersion' instead of '$version'"
  }

  $zipPath = Join-Path $outputPath "codex-router-v$version-win32-x64.zip"
  Compress-Archive -Path (Join-Path $stagingPath "*") -DestinationPath $zipPath -CompressionLevel Optimal -Force

  $checksumPath = Join-Path $outputPath "SHA256SUMS.txt"
  $checksums = Get-ChildItem -LiteralPath $outputPath -File |
    Where-Object { $_.Name -ne "SHA256SUMS.txt" } |
    Sort-Object Name |
    ForEach-Object { "{0}  {1}" -f (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant(), $_.Name }
  Set-Content -LiteralPath $checksumPath -Value $checksums -Encoding ascii
} finally {
  if (Test-Path -LiteralPath $stagingPath) {
    Remove-Item -LiteralPath $stagingPath -Recurse -Force
  }
}
