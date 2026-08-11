$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

function New-RoundedPath([float]$x, [float]$y, [float]$width, [float]$height, [float]$radius) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $diameter = $radius * 2
    $path.AddArc($x, $y, $diameter, $diameter, 180, 90)
    $path.AddArc($x + $width - $diameter, $y, $diameter, $diameter, 270, 90)
    $path.AddArc($x + $width - $diameter, $y + $height - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($x, $y + $height - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
}

function New-PresentaIcon([int]$size, [string]$path, [bool]$maskable = $false) {
    $bitmap = New-Object System.Drawing.Bitmap($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.Color]::Transparent)

    $backgroundBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 23, 28, 37))
    $background = $null
    if ($maskable) {
        $graphics.FillRectangle($backgroundBrush, 0, 0, $size, $size)
    } else {
        $background = New-RoundedPath 0 0 $size $size ($size * 0.225)
        $graphics.FillPath($backgroundBrush, $background)
    }

    $screen = New-RoundedPath ($size * 0.22) ($size * 0.245) ($size * 0.56) ($size * 0.405) ($size * 0.055)
    $screenBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 254, 250))
    $graphics.FillPath($screenBrush, $screen)

    $inner = New-RoundedPath ($size * 0.27) ($size * 0.295) ($size * 0.46) ($size * 0.305) ($size * 0.025)
    $violetBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 103, 87, 217))
    $graphics.FillPath($violetBrush, $inner)

    $standPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 255, 254, 250), ($size * 0.05))
    $standPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $standPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $graphics.DrawLine($standPen, ($size * 0.5), ($size * 0.65), ($size * 0.5), ($size * 0.755))
    $graphics.DrawLine($standPen, ($size * 0.39), ($size * 0.755), ($size * 0.61), ($size * 0.755))

    $laserBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 237, 68, 88))
    $laserSize = $size * 0.12
    $graphics.FillEllipse($laserBrush, ($size * 0.60), ($size * 0.40), $laserSize, $laserSize)

    $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $laserBrush.Dispose(); $standPen.Dispose(); $violetBrush.Dispose(); $screenBrush.Dispose(); $backgroundBrush.Dispose()
    $inner.Dispose(); $screen.Dispose()
    if ($null -ne $background) { $background.Dispose() }
    $graphics.Dispose(); $bitmap.Dispose()
}

$publicDirectory = Join-Path (Split-Path $PSScriptRoot -Parent) "public"
New-PresentaIcon 192 (Join-Path $publicDirectory "icon-192.png")
New-PresentaIcon 512 (Join-Path $publicDirectory "icon-512.png")
New-PresentaIcon 192 (Join-Path $publicDirectory "icon-maskable-192.png") $true
New-PresentaIcon 512 (Join-Path $publicDirectory "icon-maskable-512.png") $true
New-PresentaIcon 180 (Join-Path $publicDirectory "apple-touch-icon.png") $true
Write-Output "PWA icons generated."
