param([string]$Source = 'assets/icon-source.png')

$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $projectDirectory $Source
$iconDirectory = Join-Path $projectDirectory 'extension/icons'
New-Item -ItemType Directory -Path $iconDirectory -Force | Out-Null
Add-Type -AssemblyName System.Drawing
$sourceImage = [System.Drawing.Image]::FromFile($sourcePath)

try {
    foreach ($size in @(16, 32, 48, 128)) {
        $icon = [System.Drawing.Bitmap]::new($size, $size)
        $canvas = [System.Drawing.Graphics]::FromImage($icon)
        try {
            $canvas.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $canvas.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $canvas.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
            $canvas.DrawImage($sourceImage, 0, 0, $size, $size)
            $icon.Save((Join-Path $iconDirectory "icon-$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
        } finally {
            $canvas.Dispose()
            $icon.Dispose()
        }
    }
} finally {
    $sourceImage.Dispose()
}
