$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
public static class TaCaptureDpiAwareness {
  [DllImport("user32.dll")]
  public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  public static void ForceOpaque(byte[] pixels) {
    for (int offset = 3; offset < pixels.Length; offset += 4) pixels[offset] = 255;
  }
}

public static class TaNativeWindows {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

  public sealed class WindowInfo {
    public string handle { get; set; }
    public int processId { get; set; }
    public int z { get; set; }
    public int x { get; set; }
    public int y { get; set; }
    public int width { get; set; }
    public int height { get; set; }
    public string title { get; set; }
    public string className { get; set; }
  }

  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hWnd, StringBuilder text, int maxCount);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hWnd, uint attribute, out RECT value, int size);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hWnd, uint attribute, out int value, int size);
  [DllImport("dwmapi.dll")] static extern int DwmFlush();

  public static void FlushComposition() {
    try {
      // Two compositor boundaries cover both the opacity update and SW_HIDE.
      DwmFlush();
      DwmFlush();
    } catch { }
  }

  public static void SavePngs(Bitmap[] bitmaps, string[] paths) {
    if (bitmaps == null || paths == null || bitmaps.Length != paths.Length) {
      throw new ArgumentException("Bitmap and preview path counts must match.");
    }
    // Each display owns an independent bitmap. Encoding them concurrently
    // avoids making dual-monitor users wait for two full-resolution PNG jobs
    // back-to-back while preserving every captured physical pixel.
    Parallel.For(0, bitmaps.Length, index => bitmaps[index].Save(paths[index], ImageFormat.Png));
  }

  public static WindowInfo[] GetWindows(long[] excludedHandles) {
    var excluded = new HashSet<long>(excludedHandles ?? new long[0]);
    var windows = new List<WindowInfo>();
    int z = 0;
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      long handle = hWnd.ToInt64();
      if (handle == 0 || excluded.Contains(handle) || !IsWindowVisible(hWnd) || IsIconic(hWnd)) return true;
      int cloaked = 0;
      try { if (DwmGetWindowAttribute(hWnd, 14, out cloaked, sizeof(int)) == 0 && cloaked != 0) return true; } catch { }
      var classNameBuilder = new StringBuilder(256);
      GetClassName(hWnd, classNameBuilder, classNameBuilder.Capacity);
      string className = classNameBuilder.ToString();
      if (className == "Progman" || className == "WorkerW" || className == "Shell_TrayWnd" || className == "Shell_SecondaryTrayWnd") return true;
      RECT rect;
      bool hasRect = false;
      try { hasRect = DwmGetWindowAttribute(hWnd, 9, out rect, Marshal.SizeOf(typeof(RECT))) == 0; }
      catch { rect = new RECT(); }
      if (!hasRect) hasRect = GetWindowRect(hWnd, out rect);
      int width = rect.Right - rect.Left;
      int height = rect.Bottom - rect.Top;
      if (!hasRect || width < 24 || height < 24) return true;
      int titleLength = Math.Min(512, Math.Max(0, GetWindowTextLength(hWnd)) + 1);
      var titleBuilder = new StringBuilder(Math.Max(2, titleLength));
      GetWindowText(hWnd, titleBuilder, titleBuilder.Capacity);
      uint processId;
      GetWindowThreadProcessId(hWnd, out processId);
      windows.Add(new WindowInfo {
        handle = handle.ToString(), processId = (int)processId, z = z++,
        x = rect.Left, y = rect.Top, width = width, height = height,
        title = titleBuilder.ToString(), className = className
      });
      return true;
    }, IntPtr.Zero);
    return windows.ToArray();
  }
}
'@ -ReferencedAssemblies System.Drawing
[void][TaCaptureDpiAwareness]::SetProcessDpiAwarenessContext([IntPtr](-4))

# Prime GDI+ without retaining any desktop content so the first user-triggered
# capture does not pay one-time graphics initialization costs.
$primaryBounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$warmupBitmap = New-Object System.Drawing.Bitmap(1, 1, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$warmupGraphics = [System.Drawing.Graphics]::FromImage($warmupBitmap)
try {
  $warmupGraphics.CopyFromScreen($primaryBounds.X, $primaryBounds.Y, 0, 0, (New-Object System.Drawing.Size(1, 1)), [System.Drawing.CopyPixelOperation]::SourceCopy)
} finally {
  $warmupGraphics.Dispose()
  $warmupBitmap.Dispose()
}
$codecWarmupBitmap = New-Object System.Drawing.Bitmap(16, 16, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$codecWarmupStream = New-Object IO.MemoryStream
try { $codecWarmupBitmap.Save($codecWarmupStream, [System.Drawing.Imaging.ImageFormat]::Png) }
finally {
  $codecWarmupStream.Dispose()
  $codecWarmupBitmap.Dispose()
}

function New-TaCaptureFrames {
  $frames = @()
  $index = 0
  foreach ($screen in [System.Windows.Forms.Screen]::AllScreens) {
    $bounds = $screen.Bounds
    $bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.Clear([System.Drawing.Color]::Black)
    $frames += [pscustomobject]@{ screen = $screen; bounds = $bounds; bitmap = $bitmap; graphics = $graphics; index = $index }
    $index += 1
  }
  return $frames
}

function Test-TaCaptureFrames($Frames) {
  $screens = @([System.Windows.Forms.Screen]::AllScreens)
  if (@($Frames).Count -ne $screens.Count) { return $false }
  for ($index = 0; $index -lt $screens.Count; $index += 1) {
    $screen = $screens[$index]
    $frame = @($Frames)[$index]
    if ($frame.screen.DeviceName -ne $screen.DeviceName -or $frame.bounds -ne $screen.Bounds) { return $false }
  }
  return $true
}

function Clear-TaCaptureFrames($Frames) {
  foreach ($frame in @($Frames)) {
    try { $frame.graphics.Clear([System.Drawing.Color]::Black) } catch { }
  }
}

function Dispose-TaCaptureFrames($Frames) {
  foreach ($frame in @($Frames)) {
    try { $frame.graphics.Dispose() } catch { }
    try { $frame.bitmap.Dispose() } catch { }
  }
}

# Allocate the large backing surfaces while the helper starts in the background.
# This removes allocation stalls from the user's first click. The surfaces are
# cleared after each response so the helper does not retain desktop pixels.
$captureFrames = @(New-TaCaptureFrames)
try {
  foreach ($frame in $captureFrames) {
    $bounds = $frame.bounds
    $frame.graphics.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bounds.Size, [System.Drawing.CopyPixelOperation]::SourceCopy)
  }
} finally {
  Clear-TaCaptureFrames $captureFrames
}

function Write-TaResponse($Value) {
  [Console]::Out.WriteLine(($Value | ConvertTo-Json -Compress -Depth 5))
  [Console]::Out.Flush()
}

Write-TaResponse ([pscustomobject]@{ type = 'ready'; protocol = 1 })

while (($line = [Console]::In.ReadLine()) -ne $null) {
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  $request = $null
  try {
    $request = $line | ConvertFrom-Json
    if ($request.command -eq 'exit') { break }
    if ($request.command -ne 'capture') { throw 'Unsupported capture-host command.' }

    $outputDirectory = [IO.Path]::GetFullPath([string]$request.outputDirectory)
    [IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $screens = @()
    try {
      if (-not (Test-TaCaptureFrames $captureFrames)) {
        Dispose-TaCaptureFrames $captureFrames
        $captureFrames = @(New-TaCaptureFrames)
      }
      [TaNativeWindows]::FlushComposition()
      foreach ($frame in $captureFrames) {
        $bounds = $frame.bounds
        $frame.graphics.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bounds.Size, [System.Drawing.CopyPixelOperation]::SourceCopy)
      }
      $copyMilliseconds = $timer.ElapsedMilliseconds
      $excludedWindowHandles = @($request.excludedWindowHandles | ForEach-Object { if ($_ -ne $null) { [long]$_ } })
      $windows = @([TaNativeWindows]::GetWindows([long[]]$excludedWindowHandles))

      $previewPaths = @($captureFrames | ForEach-Object {
        [IO.Path]::Combine($outputDirectory, ('{0}-{1}-preview.png' -f $request.id, $_.index))
      })
      [TaNativeWindows]::SavePngs(
        [System.Drawing.Bitmap[]]@($captureFrames | ForEach-Object { $_.bitmap }),
        [string[]]$previewPaths
      )

      foreach ($frame in $captureFrames) {
        $screen = $frame.screen
        $bounds = $frame.bounds
        $bitmap = $frame.bitmap
        $index = $frame.index
        $filePath = [IO.Path]::Combine($outputDirectory, ('{0}-{1}.bgra' -f $request.id, $index))
        $previewPath = $previewPaths[$index]
        # The overlay is the user's visual source of truth while selecting. The
        # captured bitmap keeps every physical pixel; parallel encoding removes
        # multi-display serialization without reintroducing JPEG blur.
        $screens += [pscustomobject]@{
          path = $filePath
          previewPath = $previewPath
          primary = $screen.Primary
          deviceName = $screen.DeviceName
          x = $bounds.X
          y = $bounds.Y
          width = $bounds.Width
          height = $bounds.Height
        }
      }
      Write-TaResponse ([pscustomobject]@{ id = $request.id; type = 'captured'; ok = $true; copyMilliseconds = $copyMilliseconds; milliseconds = $timer.ElapsedMilliseconds; screens = $screens; windows = $windows })

      foreach ($frame in $captureFrames) {
        $bounds = $frame.bounds
        $bitmap = $frame.bitmap
        $index = $frame.index
        $filePath = [IO.Path]::Combine($outputDirectory, ('{0}-{1}.bgra' -f $request.id, $index))
        $bitmapData = $bitmap.LockBits((New-Object System.Drawing.Rectangle(0, 0, $bounds.Width, $bounds.Height)), [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        try {
          $rawPixels = [byte[]]::new([Math]::Abs($bitmapData.Stride) * $bounds.Height)
          [Runtime.InteropServices.Marshal]::Copy($bitmapData.Scan0, $rawPixels, 0, $rawPixels.Length)
          [TaCaptureDpiAwareness]::ForceOpaque($rawPixels)
          [IO.File]::WriteAllBytes($filePath, $rawPixels)
        } finally {
          $bitmap.UnlockBits($bitmapData)
        }
      }
      Write-TaResponse ([pscustomobject]@{ id = $request.id; type = 'complete'; ok = $true; milliseconds = $timer.ElapsedMilliseconds; screens = $screens; windows = $windows })
    } finally {
      Clear-TaCaptureFrames $captureFrames
    }
  } catch {
    Write-TaResponse ([pscustomobject]@{ id = $request.id; ok = $false; error = $_.Exception.Message })
  }
}

Dispose-TaCaptureFrames $captureFrames
