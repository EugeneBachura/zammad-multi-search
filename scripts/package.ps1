param(
    [string]$NodePath = 'node',
    [ValidateSet('all', 'chrome', 'firefox')][string]$Browser = 'chrome'
)

$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
& $NodePath (Join-Path $PSScriptRoot 'check-release.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Release validation failed.' }

$packageInfo = Get-Content -LiteralPath (Join-Path $projectDirectory 'package.json') -Raw | ConvertFrom-Json
$distributionDirectory = Join-Path $projectDirectory 'dist'
New-Item -ItemType Directory -Path $distributionDirectory -Force | Out-Null
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$browsers = if ($Browser -eq 'all') { @('chrome', 'firefox') } else { @($Browser) }
foreach ($targetBrowser in $browsers) {
    & $NodePath (Join-Path $PSScriptRoot 'build.cjs') $targetBrowser
    if ($LASTEXITCODE -ne 0) { throw "Build failed: $targetBrowser" }
    $extensionDirectory = Join-Path $distributionDirectory $targetBrowser
    & $NodePath (Join-Path $PSScriptRoot 'check-release.cjs') $targetBrowser $extensionDirectory
    if ($LASTEXITCODE -ne 0) { throw "Release validation failed: $targetBrowser" }
    $archivePath = Join-Path $distributionDirectory "$($packageInfo.name)-$($packageInfo.version)-$targetBrowser.zip"
    if (Test-Path -LiteralPath $archivePath) { Remove-Item -LiteralPath $archivePath }
    $archive = [System.IO.Compression.ZipFile]::Open($archivePath, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in Get-ChildItem -LiteralPath $extensionDirectory -File -Recurse | Sort-Object FullName) {
            $entryName = $file.FullName.Substring($extensionDirectory.Length + 1).Replace('\', '/')
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    } finally {
        $archive.Dispose()
    }

    $archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
    try {
        if (-not ($archive.Entries | Where-Object FullName -eq 'manifest.json')) { throw 'manifest.json is not at the archive root.' }
        $sourceFiles = @(Get-ChildItem -LiteralPath $extensionDirectory -File -Recurse)
        if ($archive.Entries.Count -ne $sourceFiles.Count) { throw 'Archive file count does not match the source.' }
        foreach ($entry in $archive.Entries) {
            if ($entry.FullName -match '(^/|\\|(^|/)\.\.(/|$))') { throw "Invalid archive path: $($entry.FullName)" }
            $sourcePath = Join-Path $extensionDirectory $entry.FullName
            $expected = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash
            $stream = $entry.Open()
            $hasher = [System.Security.Cryptography.SHA256]::Create()
            try {
                $actual = [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '')
                if ($actual -ne $expected) { throw "Archive content differs: $($entry.FullName)" }
            } finally {
                $hasher.Dispose()
                $stream.Dispose()
            }
        }
    } finally {
        $archive.Dispose()
    }

    $hash = Get-FileHash -LiteralPath $archivePath -Algorithm SHA256
    $checksumPath = [System.IO.Path]::ChangeExtension($archivePath, '.sha256')
    [System.IO.File]::WriteAllText($checksumPath, "$($hash.Hash.ToLowerInvariant())  $([System.IO.Path]::GetFileName($archivePath))`n", [System.Text.UTF8Encoding]::new($false))
    $hash | Select-Object Hash, Path
}

if ($browsers -contains 'chrome') {
    foreach ($extension in @('zip', 'sha256')) {
        $legacyPath = Join-Path $distributionDirectory "$($packageInfo.name)-$($packageInfo.version).$extension"
        if (Test-Path -LiteralPath $legacyPath) { Remove-Item -LiteralPath $legacyPath }
    }
}
