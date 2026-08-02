Add-Type -AssemblyName System.Drawing

$srcPath = "d:\VS Code\E-Service\SmartLocal v1.1\public\images\nong-jaidee.png"
$img = [System.Drawing.Bitmap]::FromFile($srcPath)
$bmp = New-Object System.Drawing.Bitmap($img.Width, $img.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.DrawImage($img, 0, 0)
$g.Dispose()
$img.Dispose()

for ($x = 0; $x -lt $bmp.Width; $x++) {
    for ($y = 0; $y -lt $bmp.Height; $y++) {
        $c = $bmp.GetPixel($x, $y)
        # Check for white / near-white background pixels
        if ($c.R -gt 240 -and $c.G -gt 240 -and $c.B -gt 240) {
            $bmp.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(0, 255, 255, 255))
        }
        # Smooth alpha edge transition for soft anti-aliased white fringe
        elseif ($c.R -gt 220 -and $c.G -gt 220 -and $c.B -gt 220) {
            $alpha = [int](255 * (240 - [Math]::Max($c.R, [Math]::Max($c.G, $c.B))) / 20)
            if ($alpha -lt 0) { $alpha = 0 }
            if ($alpha -gt 255) { $alpha = 255 }
            $bmp.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($alpha, $c.R, $c.G, $c.B))
        }
    }
}

$bmp.Save($srcPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "Successfully removed white background from nong-jaidee.png!"
