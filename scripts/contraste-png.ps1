# Contraste WCAG medido sobre los PÍXELES de una captura, dentro de un rectángulo.
# Toma el píxel de menor y de mayor luminancia del área (texto antialiaseado y
# fondo) y calcula (L1 + 0.05) / (L2 + 0.05).
# Uso: powershell -File contraste-png.ps1 -Png captura.png -X 1265 -Y 343 -W 120 -H 12
param(
  [Parameter(Mandatory)] [string] $Png,
  [Parameter(Mandatory)] [int] $X,
  [Parameter(Mandatory)] [int] $Y,
  [Parameter(Mandatory)] [int] $W,
  [Parameter(Mandatory)] [int] $H
)
Add-Type -AssemblyName System.Drawing

function Canal([double] $c) {
  $s = $c / 255.0
  if ($s -le 0.03928) { return $s / 12.92 }
  return [Math]::Pow(($s + 0.055) / 1.055, 2.4)
}
function Luminancia($px) {
  return 0.2126 * (Canal $px.R) + 0.7152 * (Canal $px.G) + 0.0722 * (Canal $px.B)
}

$bmp = [System.Drawing.Bitmap]::FromFile($Png)
try {
  $min = 2.0; $max = -1.0; $pxMin = $null; $pxMax = $null
  for ($i = $X; $i -lt [Math]::Min($X + $W, $bmp.Width); $i++) {
    for ($j = $Y; $j -lt [Math]::Min($Y + $H, $bmp.Height); $j++) {
      $px = $bmp.GetPixel($i, $j)
      $l = Luminancia $px
      if ($l -lt $min) { $min = $l; $pxMin = $px }
      if ($l -gt $max) { $max = $l; $pxMax = $px }
    }
  }
  $ratio = ($max + 0.05) / ($min + 0.05)
  "{0:N2} (oscuro rgb({1},{2},{3}) / claro rgb({4},{5},{6}))" -f $ratio, $pxMin.R, $pxMin.G, $pxMin.B, $pxMax.R, $pxMax.G, $pxMax.B
} finally {
  $bmp.Dispose()
}
