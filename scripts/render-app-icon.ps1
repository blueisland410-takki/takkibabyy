$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore, PresentationFramework, WindowsBase

$resourceDirectory = Join-Path $PSScriptRoot '..\resources'
$resourceDirectory = [IO.Path]::GetFullPath($resourceDirectory)
$svgPath = Join-Path $resourceDirectory 'icon.svg'
$targetFiles = @(
  (Join-Path $resourceDirectory 'icon.png'),
  (Join-Path $resourceDirectory 'icon.ico'),
  (Join-Path $resourceDirectory 'icon.icns'),
  (Join-Path $resourceDirectory 'daybyday-tray.ico'),
  (Join-Path $resourceDirectory 'daybyday-trayTemplate.png'),
  (Join-Path $resourceDirectory 'daybyday-trayTemplate@2x.png')
)
if (-not (Test-Path -LiteralPath $svgPath)) { throw 'resources/icon.svg is missing.' }

[xml] $svg = Get-Content -LiteralPath $svgPath -Raw
$viewBox = $svg.DocumentElement.GetAttribute('viewBox')
if ($viewBox -ne '0 0 1024 1024') { throw 'icon.svg must use a 1024 square viewBox.' }
$shapes = $svg.SelectNodes("//*[local-name()='path']")
if ($shapes.Count -lt 4) { throw 'icon.svg is missing the background or D mark paths.' }
$clipGeometry = [System.Windows.Media.PathGeometry]::Parse($shapes[0].GetAttribute('d'))
$baseGeometry = [System.Windows.Media.PathGeometry]::Parse($shapes[1].GetAttribute('d'))
$creamGeometry = [System.Windows.Media.PathGeometry]::Parse($shapes[2].GetAttribute('d'))
$letterGeometry = [System.Windows.Media.PathGeometry]::Parse($shapes[3].GetAttribute('d'))
$baseBrush = [System.Windows.Media.SolidColorBrush]::new(
  [System.Windows.Media.ColorConverter]::ConvertFromString(
    $shapes[1].GetAttribute('fill')
  )
)
$creamBrush = [System.Windows.Media.SolidColorBrush]::new(
  [System.Windows.Media.ColorConverter]::ConvertFromString(
    $shapes[2].GetAttribute('fill')
  )
)
$letterBrush = [System.Windows.Media.SolidColorBrush]::new(
  [System.Windows.Media.ColorConverter]::ConvertFromString(
    $shapes[3].GetAttribute('fill')
  )
)
foreach ($brush in @($baseBrush, $creamBrush, $letterBrush)) { $brush.Freeze() }
$templateBrush = [System.Windows.Media.SolidColorBrush]::new(
  [System.Windows.Media.Colors]::Black
)
$templateBrush.Freeze()

function New-IconPngBytes([int] $size) {
  $drawingGroup = [System.Windows.Media.DrawingGroup]::new()
  $drawingGroup.ClipGeometry = $clipGeometry
  [void] $drawingGroup.Children.Add(
    [System.Windows.Media.GeometryDrawing]::new($baseBrush, $null, $baseGeometry)
  )
  [void] $drawingGroup.Children.Add(
    [System.Windows.Media.GeometryDrawing]::new($creamBrush, $null, $creamGeometry)
  )
  [void] $drawingGroup.Children.Add(
    [System.Windows.Media.GeometryDrawing]::new($letterBrush, $null, $letterGeometry)
  )
  $visual = [System.Windows.Media.DrawingVisual]::new()
  $context = $visual.RenderOpen()
  [void] $context.PushTransform(
    [System.Windows.Media.ScaleTransform]::new($size / 1024, $size / 1024)
  )
  $context.DrawDrawing($drawingGroup)
  $context.Close()

  $bitmap = [System.Windows.Media.Imaging.RenderTargetBitmap]::new(
    $size,
    $size,
    96,
    96,
    [System.Windows.Media.PixelFormats]::Pbgra32
  )
  $bitmap.Render($visual)
  $encoder = [System.Windows.Media.Imaging.PngBitmapEncoder]::new()
  [void] $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
  $stream = [IO.MemoryStream]::new()
  try {
    $encoder.Save($stream)
    return ,([byte[]] $stream.ToArray())
  } finally { $stream.Dispose() }
}

function Write-PngIcon([int] $size, [string] $path) {
  [IO.File]::WriteAllBytes($path, (New-IconPngBytes $size))
}

function New-TemplatePngBytes([int] $size, [int] $dpi) {
  $visual = [System.Windows.Media.DrawingVisual]::new()
  $context = $visual.RenderOpen()
  [void] $context.PushTransform(
    [System.Windows.Media.ScaleTransform]::new($size / 1024, $size / 1024)
  )
  $context.DrawGeometry($templateBrush, $null, $letterGeometry)
  $context.Close()

  $bitmap = [System.Windows.Media.Imaging.RenderTargetBitmap]::new(
    $size,
    $size,
    $dpi,
    $dpi,
    [System.Windows.Media.PixelFormats]::Pbgra32
  )
  $bitmap.Render($visual)
  $encoder = [System.Windows.Media.Imaging.PngBitmapEncoder]::new()
  [void] $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
  $stream = [IO.MemoryStream]::new()
  try {
    $encoder.Save($stream)
    return ,([byte[]] $stream.ToArray())
  } finally { $stream.Dispose() }
}

function Write-TemplatePng([int] $size, [int] $dpi, [string] $path) {
  [IO.File]::WriteAllBytes($path, (New-TemplatePngBytes $size $dpi))
}

function ConvertTo-BigEndianLength([int] $value) {
  return ,([byte[]] @(
    [byte] (($value -shr 24) -band 255),
    [byte] (($value -shr 16) -band 255),
    [byte] (($value -shr 8) -band 255),
    [byte] ($value -band 255)
  ))
}

function Write-IconContainer([string] $path, [string] $kind, [int[]] $sizes) {
  $images = @{}
  foreach ($size in $sizes) { $images[$size] = New-IconPngBytes $size }
  $stream = [IO.MemoryStream]::new()
  $writer = [IO.BinaryWriter]::new($stream)
  try {
    if ($kind -eq 'ico') {
      $writer.Write([UInt16] 0)
      $writer.Write([UInt16] 1)
      $writer.Write([UInt16] $sizes.Count)
      $offset = 6 + (16 * $sizes.Count)
      foreach ($size in $sizes) {
        $bytes = [byte[]] $images[$size]
        $dimension = if ($size -eq 256) { [byte] 0 } else { [byte] $size }
        $writer.Write($dimension)
        $writer.Write($dimension)
        $writer.Write([byte] 0)
        $writer.Write([byte] 0)
        $writer.Write([UInt16] 1)
        $writer.Write([UInt16] 32)
        $writer.Write([UInt32] $bytes.Length)
        $writer.Write([UInt32] $offset)
        $offset += $bytes.Length
      }
      foreach ($size in $sizes) { $writer.Write([byte[]] $images[$size]) }
    } else {
      $chunkTypes = @{
        16 = 'icp4'; 32 = 'icp5'; 64 = 'icp6'; 128 = 'ic07';
        256 = 'ic08'; 512 = 'ic09'; 1024 = 'ic10'
      }
      $chunks = [Collections.Generic.List[byte[]]]::new()
      foreach ($size in $sizes) {
        $data = [byte[]] $images[$size]
        $chunkStream = [IO.MemoryStream]::new()
        try {
          $chunkStream.Write([Text.Encoding]::ASCII.GetBytes($chunkTypes[$size]), 0, 4)
          $chunkLength = 8 + $data.Length
          $chunkLengthBytes = ConvertTo-BigEndianLength $chunkLength
          $chunkStream.Write($chunkLengthBytes, 0, 4)
          $chunkStream.Write($data, 0, $data.Length)
          $chunks.Add($chunkStream.ToArray())
        } finally { $chunkStream.Dispose() }
      }
      $totalLength = 8 + (($chunks | ForEach-Object Length | Measure-Object -Sum).Sum)
      $writer.Write([Text.Encoding]::ASCII.GetBytes('icns'))
      $writer.Write((ConvertTo-BigEndianLength $totalLength))
      foreach ($chunk in $chunks) { $writer.Write([byte[]] $chunk) }
    }
    [IO.File]::WriteAllBytes($path, $stream.ToArray())
  } finally {
    $writer.Dispose()
    $stream.Dispose()
  }
}

Write-PngIcon 1024 (Join-Path $resourceDirectory 'icon.png')
Write-IconContainer (Join-Path $resourceDirectory 'icon.ico') 'ico' @(16, 24, 32, 48, 64, 128, 256)
Write-IconContainer (Join-Path $resourceDirectory 'daybyday-tray.ico') 'ico' @(16, 24, 32, 48, 64, 128, 256)
Write-IconContainer (Join-Path $resourceDirectory 'icon.icns') 'icns' @(16, 32, 64, 128, 256, 512, 1024)
Write-TemplatePng 16 72 (Join-Path $resourceDirectory 'daybyday-trayTemplate.png')
Write-TemplatePng 32 144 (Join-Path $resourceDirectory 'daybyday-trayTemplate@2x.png')

foreach ($target in $targetFiles) {
  if (-not (Test-Path -LiteralPath $target)) { throw "Icon output missing: $target" }
}
Write-Output 'Rendered PNG, ICO, and ICNS assets directly from resources/icon.svg.'
