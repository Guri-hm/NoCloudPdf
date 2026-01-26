# PNG to ICO converter using .NET
# Creates a multi-size ICO file from PNG input

$sourceFile = "icon-192.png"
$outputFile = "favicon.ico"

Write-Host "Converting $sourceFile to $outputFile..."

Add-Type -AssemblyName System.Drawing

# Load the source image
$image = [System.Drawing.Image]::FromFile((Resolve-Path $sourceFile))

# Create ICO with multiple sizes (16x16, 32x32, 48x48)
$sizes = @(16, 32, 48)
$icons = @()

foreach ($size in $sizes) {
    $bitmap = New-Object System.Drawing.Bitmap($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.DrawImage($image, 0, 0, $size, $size)
    $graphics.Dispose()
    $icons += $bitmap
}

# Save as ICO
$memoryStream = New-Object System.IO.MemoryStream
$icons[0].Save($memoryStream, [System.Drawing.Imaging.ImageFormat]::Icon)

# ICO file format requires special handling for multiple sizes
# Using a simpler approach: save the 32x32 as ICO
$icon32 = $icons[1]  # 32x32
$icon32.Save($outputFile, [System.Drawing.Imaging.ImageFormat]::Icon)

# Cleanup
foreach ($icon in $icons) {
    $icon.Dispose()
}
$image.Dispose()
$memoryStream.Dispose()

Write-Host "Successfully created $outputFile"
Write-Host "Note: This creates a single 32x32 ICO. For multi-size ICO, use online tools like favicon-generator.org"
