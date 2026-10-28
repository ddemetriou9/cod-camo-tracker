Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
if (-not ('CamoDesktopCapture' -as [type])) {
    Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text;
public static class CamoDesktopCapture {
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out Rect r);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref Point p);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int max);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    public static string NormalizeTitle(string title) { return System.Text.RegularExpressions.Regex.Replace(title ?? "", @"\p{Cf}", ""); }
    public static string Title(IntPtr h) { var s = new StringBuilder(1024); GetWindowText(h,s,s.Capacity); return NormalizeTitle(s.ToString()); }
    public static Rectangle MenuHeaderBounds(int width, int height) {
        return new Rectangle((int)(width * 0.03), 0, Math.Max(1,(int)(width * 0.50)), Math.Max(1,(int)(height * 0.21)));
    }
    public static Bitmap Capture(IntPtr expected) { return CaptureArea(expected, false); }
    public static Bitmap CaptureMenuHeader(IntPtr expected) { return CaptureArea(expected, true); }
    static Bitmap CaptureArea(IntPtr expected, bool headerOnly) {
        if (expected == IntPtr.Zero || GetForegroundWindow() != expected || IsIconic(expected)) return null;
        Rect r; var p = new Point();
        if (!GetClientRect(expected, out r) || !ClientToScreen(expected, ref p)) return null;
        int w = r.Right-r.Left, h = r.Bottom-r.Top;
        if (w < 320 || h < 200 || w > 10000 || h > 10000) return null;
        var area = headerOnly ? MenuHeaderBounds(w,h) : new Rectangle(0,0,w,h);
        var b = new Bitmap(area.Width,area.Height);
        try {
            using (var g = Graphics.FromImage(b)) g.CopyFromScreen(p.X+area.X,p.Y+area.Y,0,0,area.Size,CopyPixelOperation.SourceCopy);
            if (GetForegroundWindow() != expected) { b.Dispose(); return null; }
            return b;
        } catch { b.Dispose(); throw; }
    }
}
'@
}
$script:CamoAsTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and
    $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function Wait-CamoWinRT($Operation, [Type]$ResultType) {
    $task = $script:CamoAsTask.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    return $task.GetAwaiter().GetResult()
}
function Read-CamoBitmap($Bitmap, $Engine) {
    $memory = New-Object System.IO.MemoryStream
    $random = $null
    $software = $null
    try {
        $Bitmap.Save($memory, [System.Drawing.Imaging.ImageFormat]::Bmp)
        $memory.Position = 0
        $random = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($memory)
        $decoder = Wait-CamoWinRT ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($random)) ([Windows.Graphics.Imaging.BitmapDecoder])
        if ($decoder.PixelWidth -gt [Windows.Media.Ocr.OcrEngine]::MaxImageDimension -or $decoder.PixelHeight -gt [Windows.Media.Ocr.OcrEngine]::MaxImageDimension) {
            throw 'Game window is larger than the Windows OCR limit. Reduce its resolution for this prototype.'
        }
        $software = Wait-CamoWinRT ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
        $result = Wait-CamoWinRT ($Engine.RecognizeAsync($software)) ([Windows.Media.Ocr.OcrResult])
        return @($result.Lines | ForEach-Object { $_.Text })
    } finally {
        if ($null -ne $software) { $software.Dispose() }
        if ($null -ne $random) { $random.Dispose() }
        $memory.Dispose()
    }
}
function Get-CamoBitmapHash($Bitmap) {
    $rect = New-Object System.Drawing.Rectangle 0, 0, $Bitmap.Width, $Bitmap.Height
    $locked = $Bitmap.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = New-Object byte[] ([Math]::Abs($locked.Stride) * $locked.Height)
        [Runtime.InteropServices.Marshal]::Copy($locked.Scan0, $bytes, 0, $bytes.Length)
        return [BitConverter]::ToString($sha.ComputeHash($bytes))
    } finally { $Bitmap.UnlockBits($locked); $sha.Dispose() }
}
