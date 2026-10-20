param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Attach', 'Detach')]
  [string]$Mode,
  [Parameter(Mandatory = $true)]
  [string]$Handle,
  [Parameter(Mandatory = $true)]
  [int]$OwnerProcessId,
  [Parameter(Mandatory = $true)]
  [int]$X,
  [Parameter(Mandatory = $true)]
  [int]$Y,
  [Parameter(Mandatory = $true)]
  [int]$Width,
  [Parameter(Mandatory = $true)]
  [int]$Height
)

$ErrorActionPreference = 'Stop'

$nativeCode = @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class DaybydayDesktopWindowNative
{
    private const long GWL_STYLE = -16;
    private const uint WS_CHILD = 0x40000000;
    private const uint WS_POPUP = 0x80000000;
    private const uint SWP_NOACTIVATE = 0x0010;
    private const uint SWP_FRAMECHANGED = 0x0020;
    private const uint SWP_SHOWWINDOW = 0x0040;

    private delegate bool EnumWindowsCallback(IntPtr hwnd, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr lParam);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool EnumChildWindows(IntPtr parent, EnumWindowsCallback callback, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int GetClassName(IntPtr hwnd, StringBuilder name, int maxCount);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetParent(IntPtr child, IntPtr parent);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr GetParent(IntPtr hwnd);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW", SetLastError = true)]
    private static extern IntPtr GetWindowLongPtr64(IntPtr hwnd, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)]
    private static extern IntPtr SetWindowLongPtr64(IntPtr hwnd, int index, IntPtr value);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongW", SetLastError = true)]
    private static extern int GetWindowLong32(IntPtr hwnd, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongW", SetLastError = true)]
    private static extern int SetWindowLong32(IntPtr hwnd, int index, int value);

    private static IntPtr trackedWindow;
    private static uint trackedProcessId;
    private static IntPtr attachedDesktop;

    private static string ClassName(IntPtr hwnd)
    {
        var name = new StringBuilder(256);
        GetClassName(hwnd, name, name.Capacity);
        return name.ToString();
    }

    private static uint ReadStyle(IntPtr hwnd)
    {
        long value = IntPtr.Size == 8
            ? GetWindowLongPtr64(hwnd, (int)GWL_STYLE).ToInt64()
            : GetWindowLong32(hwnd, (int)GWL_STYLE);
        return unchecked((uint)value);
    }

    private static void WriteStyle(IntPtr hwnd, uint style)
    {
        if (IntPtr.Size == 8) SetWindowLongPtr64(hwnd, (int)GWL_STYLE, new IntPtr(style));
        else SetWindowLong32(hwnd, (int)GWL_STYLE, unchecked((int)style));
    }

    private static bool FindDesktop(out IntPtr progman)
    {
        IntPtr foundProgman = IntPtr.Zero;
        uint explorerPid = 0;
        EnumWindows((hwnd, lParam) => {
            if (ClassName(hwnd) != "Progman") return true;
            uint processId;
            GetWindowThreadProcessId(hwnd, out processId);
            try {
                if (Process.GetProcessById((int)processId).ProcessName != "explorer") return true;
            } catch { return true; }
            bool iconView = false;
            EnumChildWindows(hwnd, (child, childParam) => {
                if (ClassName(child) == "SHELLDLL_DefView") iconView = true;
                return true;
            }, IntPtr.Zero);
            if (!iconView) return true;
            foundProgman = hwnd;
            explorerPid = processId;
            return false;
        }, IntPtr.Zero);
        progman = foundProgman;
        return progman != IntPtr.Zero && explorerPid != 0;
    }

    private static string AttachToCurrentDesktop(IntPtr hwnd, uint ownerProcessId, int x, int y, int width, int height, bool initial)
    {
        if (!IsWindow(hwnd)) return "window-missing";
        uint actualOwnerProcessId;
        GetWindowThreadProcessId(hwnd, out actualOwnerProcessId);
        if (actualOwnerProcessId != ownerProcessId) return "window-owner-mismatch";
        IntPtr progman;
        if (!FindDesktop(out progman)) return "desktop-unavailable";
        if (GetParent(hwnd) == progman) {
            trackedWindow = hwnd;
            trackedProcessId = ownerProcessId;
            attachedDesktop = progman;
            return "attached";
        }

        uint style = ReadStyle(hwnd);
        WriteStyle(hwnd, (style & ~WS_POPUP) | WS_CHILD);
        SetParent(hwnd, progman);
        if (GetParent(hwnd) != progman) {
            SetParent(hwnd, IntPtr.Zero);
            WriteStyle(hwnd, (style & ~WS_CHILD) | WS_POPUP);
            return "attach-failed";
        }
        if (!SetWindowPos(hwnd, IntPtr.Zero, x, y, width, height,
            SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW)) {
            SetParent(hwnd, IntPtr.Zero);
            WriteStyle(hwnd, (style & ~WS_CHILD) | WS_POPUP);
            return "position-failed";
        }
        trackedWindow = hwnd;
        trackedProcessId = ownerProcessId;
        attachedDesktop = progman;
        return initial ? "attached" : "reattached";
    }

    public static string Attach(IntPtr hwnd, int ownerProcessId, int x, int y, int width, int height)
    {
        return AttachToCurrentDesktop(hwnd, unchecked((uint)ownerProcessId), x, y, width, height, true);
    }

    public static string EnsureAttached(IntPtr hwnd, int ownerProcessId, int x, int y, int width, int height)
    {
        if (!IsWindow(hwnd)) return "window-missing";
        IntPtr progman;
        if (!FindDesktop(out progman)) return "desktop-unavailable";
        if (GetParent(hwnd) == progman && attachedDesktop == progman) return "attached";
        return AttachToCurrentDesktop(hwnd, unchecked((uint)ownerProcessId), x, y, width, height, false);
    }

    public static string Detach(IntPtr hwnd, int ownerProcessId, int x, int y, int width, int height)
    {
        if (!IsWindow(hwnd)) return "window-missing";
        uint actualOwnerProcessId;
        GetWindowThreadProcessId(hwnd, out actualOwnerProcessId);
        if (actualOwnerProcessId != unchecked((uint)ownerProcessId)) return "window-owner-mismatch";
        uint style = ReadStyle(hwnd);
        if ((style & WS_CHILD) != 0) SetParent(hwnd, IntPtr.Zero);
        WriteStyle(hwnd, (style & ~WS_CHILD) | WS_POPUP);
        if ((ReadStyle(hwnd) & WS_CHILD) != 0) return "detach-failed";
        if (!SetWindowPos(hwnd, IntPtr.Zero, x, y, width, height,
            SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW)) return "position-failed";
        trackedWindow = IntPtr.Zero;
        trackedProcessId = 0;
        attachedDesktop = IntPtr.Zero;
        return "detached";
    }
}
'@

Add-Type -TypeDefinition $nativeCode
$windowHandle = [IntPtr][Convert]::ToInt64($Handle.Substring(2), 16)

function Write-Status([string]$Code) {
  [Console]::Out.WriteLine((ConvertTo-Json -Compress @{ code = $Code }))
  [Console]::Out.Flush()
}

if ($Width -lt 320 -or $Height -lt 420 -or $OwnerProcessId -lt 1) {
  Write-Status 'invalid-arguments'
  exit 2
}
if ($Handle -notmatch '^0x[0-9A-Fa-f]{1,16}$') {
  Write-Status 'invalid-arguments'
  exit 2
}

if ($Mode -eq 'Detach') {
  $detachCode = [DaybydayDesktopWindowNative]::Detach($windowHandle, $OwnerProcessId, $X, $Y, $Width, $Height)
  Write-Status $detachCode
  if ($detachCode -ne 'detached' -and $detachCode -ne 'window-missing') { exit 2 }
  exit 0
}

$status = [DaybydayDesktopWindowNative]::Attach($windowHandle, $OwnerProcessId, $X, $Y, $Width, $Height)
Write-Status $status
if ($status -ne 'attached') { exit 2 }

# A bounded poll repairs the parent when Explorer restarts. It never sends
# private shell messages, edits the registry, or terminates Explorer.
$readCommand = [System.Threading.Tasks.Task[string]]::Factory.StartNew([Func[string]]{ [Console]::In.ReadLine() })
$lastStatus = $status
$desktopUnavailableSince = $null
while ($true) {
  if ($readCommand.IsCompleted) {
    $line = $readCommand.Result
    if ($null -eq $line) { break }
    try { $command = $line | ConvertFrom-Json } catch { $command = $null }
    if ($command -and $command.command -eq 'stop') { break }
    if ($command -and $command.command -eq 'detach') {
      $nextX = 0
      $nextY = 0
      $nextWidth = 0
      $nextHeight = 0
      $validBounds =
        [int]::TryParse([string]$command.x, [ref]$nextX) -and
        [int]::TryParse([string]$command.y, [ref]$nextY) -and
        [int]::TryParse([string]$command.width, [ref]$nextWidth) -and
        [int]::TryParse([string]$command.height, [ref]$nextHeight) -and
        $nextWidth -ge 320 -and $nextHeight -ge 420 -and
        $nextWidth -le 16384 -and $nextHeight -le 16384
      if ($validBounds) {
        $X = $nextX
        $Y = $nextY
        $Width = $nextWidth
        $Height = $nextHeight
      }
      $detachCode = [DaybydayDesktopWindowNative]::Detach($windowHandle, $OwnerProcessId, $X, $Y, $Width, $Height)
      Write-Status $detachCode
      break
    }
    if ($command -and $command.command -eq 'bounds') {
      $nextX = 0
      $nextY = 0
      $nextWidth = 0
      $nextHeight = 0
      $validBounds =
        [int]::TryParse([string]$command.x, [ref]$nextX) -and
        [int]::TryParse([string]$command.y, [ref]$nextY) -and
        [int]::TryParse([string]$command.width, [ref]$nextWidth) -and
        [int]::TryParse([string]$command.height, [ref]$nextHeight) -and
        $nextWidth -ge 320 -and $nextHeight -ge 420 -and
        $nextWidth -le 16384 -and $nextHeight -le 16384
      if ($validBounds) {
        $X = $nextX
        $Y = $nextY
        $Width = $nextWidth
        $Height = $nextHeight
      }
    }
    $readCommand = [System.Threading.Tasks.Task[string]]::Factory.StartNew([Func[string]]{ [Console]::In.ReadLine() })
  }
  Start-Sleep -Milliseconds 1800
  $status = [DaybydayDesktopWindowNative]::EnsureAttached($windowHandle, $OwnerProcessId, $X, $Y, $Width, $Height)
  if ($status -eq 'desktop-unavailable') {
    if ($null -eq $desktopUnavailableSince) { $desktopUnavailableSince = [DateTime]::UtcNow }
    if (([DateTime]::UtcNow - $desktopUnavailableSince).TotalSeconds -ge 20) {
      Write-Status 'desktop-timeout'
      exit 2
    }
  } else {
    $desktopUnavailableSince = $null
  }
  if ($status -ne $lastStatus) {
    Write-Status $status
    $lastStatus = $status
  }
  if ($status -eq 'window-missing' -or $status -eq 'window-owner-mismatch') { break }
}
