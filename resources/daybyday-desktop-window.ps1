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
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;

public static class DaybydayDesktopWindowNative
{
    private const long GWL_STYLE = -16;
    private const long GWL_EXSTYLE = -20;
    private const uint WS_CHILD = 0x40000000;
    private const uint WS_POPUP = 0x80000000;
    private const uint WS_VISIBLE = 0x10000000;
    private const uint WS_EX_TOPMOST = 0x00000008;
    private const uint GA_PARENT = 1;
    private const uint GA_ROOT = 2;
    private const uint GA_ROOTOWNER = 3;
    private const uint SWP_NOACTIVATE = 0x0010;
    private const uint SWP_FRAMECHANGED = 0x0020;
    private const uint SWP_SHOWWINDOW = 0x0040;

    private delegate bool EnumWindowsCallback(IntPtr hwnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    private struct WindowRect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

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
    private static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool GetWindowRect(IntPtr hwnd, out WindowRect rect);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetDpiForWindow(IntPtr hwnd);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr GetWindowDpiAwarenessContext(IntPtr hwnd);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern int GetAwarenessFromDpiAwarenessContext(IntPtr context);
    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll", EntryPoint = "SetLastError")]
    private static extern void SetLastErrorNative(uint errorCode);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool AttachThreadInput(uint attachThreadId, uint attachToThreadId, bool attach);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetFocus(IntPtr hwnd);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool IsChild(IntPtr parent, IntPtr child);

    [StructLayout(LayoutKind.Sequential)]
    private struct GuiThreadInfo
    {
        public int cbSize;
        public uint flags;
        public IntPtr hwndActive;
        public IntPtr hwndFocus;
        public IntPtr hwndCapture;
        public IntPtr hwndMenuOwner;
        public IntPtr hwndMoveSize;
        public IntPtr hwndCaret;
        public int caretLeft;
        public int caretTop;
        public int caretRight;
        public int caretBottom;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool GetGUIThreadInfo(uint threadId, ref GuiThreadInfo info);
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
    private static IntPtr diagnosticParentBefore;
    private static uint diagnosticStyleBefore;
    private static IntPtr diagnosticSetParentReturn;
    private static int diagnosticSetParentError;
    private static bool diagnosticSetParentCalled;
    private static bool diagnosticSetWindowPosSucceeded;
    private static int diagnosticSetWindowPosError;
    private static string diagnosticFailureReason = "not-started";
    private static string diagnosticPhase = "not-started";
    private static IntPtr diagnosticDesktop;
    private static uint diagnosticDesktopProcessId;
    private static uint diagnosticDesktopThreadId;
    private static bool diagnosticDesktopViewFound;

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

    private static uint ReadExtendedStyle(IntPtr hwnd)
    {
        long value = IntPtr.Size == 8
            ? GetWindowLongPtr64(hwnd, (int)GWL_EXSTYLE).ToInt64()
            : GetWindowLong32(hwnd, (int)GWL_EXSTYLE);
        return unchecked((uint)value);
    }

    private static void WriteStyle(IntPtr hwnd, uint style)
    {
        if (IntPtr.Size == 8) SetWindowLongPtr64(hwnd, (int)GWL_STYLE, new IntPtr(style));
        else SetWindowLong32(hwnd, (int)GWL_STYLE, unchecked((int)style));
    }

    public static string SetKeyboardFocus(IntPtr hwnd, int ownerProcessId, out uint sourceThreadId, out uint targetThreadId, out bool attached)
    {
        sourceThreadId = GetCurrentThreadId();
        targetThreadId = 0;
        attached = false;
        if (!IsWindow(hwnd)) return "focus-window-missing";

        uint actualOwnerProcessId;
        targetThreadId = GetWindowThreadProcessId(hwnd, out actualOwnerProcessId);
        if (actualOwnerProcessId != unchecked((uint)ownerProcessId) || targetThreadId == 0)
            return "focus-owner-mismatch";

        attached = sourceThreadId == targetThreadId || AttachThreadInput(sourceThreadId, targetThreadId, true);
        if (!attached) return "focus-attach-failed";

        return VerifyKeyboardFocus(hwnd, targetThreadId);
    }

    public static string VerifyKeyboardFocus(IntPtr hwnd, uint targetThreadId)
    {
        if (!IsWindow(hwnd) || targetThreadId == 0) return "focus-window-missing";
        SetFocus(hwnd);
        var info = new GuiThreadInfo();
        info.cbSize = Marshal.SizeOf(typeof(GuiThreadInfo));
        if (!GetGUIThreadInfo(targetThreadId, ref info)) return "focus-unverified";
        return info.hwndFocus == hwnd || IsChild(hwnd, info.hwndFocus)
            ? "focus-attached"
            : "focus-unverified";
    }

    public static bool ReleaseKeyboardFocus(uint sourceThreadId, uint targetThreadId)
    {
        if (sourceThreadId == 0 || targetThreadId == 0 || sourceThreadId == targetThreadId)
            return true;
        return AttachThreadInput(sourceThreadId, targetThreadId, false);
    }

    private static bool FindDesktop(out IntPtr progman, out uint explorerPid)
    {
        IntPtr foundProgman = IntPtr.Zero;
        uint foundExplorerPid = 0;
        uint foundExplorerThreadId = 0;
        bool foundIconView = false;
        EnumWindows((hwnd, lParam) => {
            if (ClassName(hwnd) != "Progman") return true;
            uint processId;
            uint explorerThreadId = GetWindowThreadProcessId(hwnd, out processId);
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
            foundExplorerPid = processId;
            foundExplorerThreadId = explorerThreadId;
            foundIconView = true;
            return false;
        }, IntPtr.Zero);
        progman = foundProgman;
        explorerPid = foundExplorerPid;
        diagnosticDesktopViewFound = foundIconView;
        diagnosticDesktop = foundProgman;
        diagnosticDesktopProcessId = foundExplorerPid;
        diagnosticDesktopThreadId = foundExplorerThreadId;
        return progman != IntPtr.Zero && explorerPid != 0 && foundIconView;
    }

    private static string JsonEscape(string value)
    {
        return (value ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"");
    }

    private static string HexHandle(IntPtr hwnd)
    {
        return "0x" + unchecked((ulong)hwnd.ToInt64()).ToString("X", CultureInfo.InvariantCulture);
    }

    private static string ProcessName(uint processId)
    {
        if (processId == 0) return "";
        try { return Process.GetProcessById((int)processId).ProcessName; }
        catch { return "unavailable"; }
    }

    private static bool HasDesktopIconView(IntPtr hwnd)
    {
        bool iconView = false;
        if (!IsWindow(hwnd)) return false;
        EnumChildWindows(hwnd, (child, childParam) => {
            if (ClassName(child) == "SHELLDLL_DefView") iconView = true;
            return true;
        }, IntPtr.Zero);
        return iconView;
    }

    public static string GetLastDiagnostic(IntPtr hwnd, int ownerProcessId)
    {
        bool windowValid = IsWindow(hwnd);
        uint actualOwnerProcessId = 0;
        uint windowThreadId = windowValid ? GetWindowThreadProcessId(hwnd, out actualOwnerProcessId) : 0;
        IntPtr parentAfter = windowValid ? GetParent(hwnd) : IntPtr.Zero;
        IntPtr ancestorParent = windowValid ? GetAncestor(hwnd, GA_PARENT) : IntPtr.Zero;
        IntPtr rootAfter = windowValid ? GetAncestor(hwnd, GA_ROOT) : IntPtr.Zero;
        IntPtr rootOwnerAfter = windowValid ? GetAncestor(hwnd, GA_ROOTOWNER) : IntPtr.Zero;
        uint styleAfter = windowValid ? ReadStyle(hwnd) : 0;
        uint exStyleAfter = windowValid ? ReadExtendedStyle(hwnd) : 0;
        bool visible = windowValid && IsWindowVisible(hwnd);
        WindowRect windowRect = new WindowRect();
        bool hasWindowRect = windowValid && GetWindowRect(hwnd, out windowRect);
        uint windowDpi = 0;
        uint desktopDpi = 0;
        int windowDpiAwareness = -1;
        int desktopDpiAwareness = -1;
        try {
            if (windowValid) {
                windowDpi = GetDpiForWindow(hwnd);
                windowDpiAwareness = GetAwarenessFromDpiAwarenessContext(GetWindowDpiAwarenessContext(hwnd));
            }
            if (diagnosticDesktop != IntPtr.Zero) {
                desktopDpi = GetDpiForWindow(diagnosticDesktop);
                desktopDpiAwareness = GetAwarenessFromDpiAwarenessContext(GetWindowDpiAwarenessContext(diagnosticDesktop));
            }
        } catch (EntryPointNotFoundException) {
            // Windows builds without per-window DPI introspection still get all other binding diagnostics.
        }
        bool childStyle = (styleAfter & WS_CHILD) != 0;
        bool popupStyle = (styleAfter & WS_POPUP) != 0;
        bool topmostStyle = (exStyleAfter & WS_EX_TOPMOST) != 0;
        bool isChild = diagnosticDesktop != IntPtr.Zero && windowValid && IsChild(diagnosticDesktop, hwnd);
        uint actualDesktopProcessId = 0;
        if (diagnosticDesktop != IntPtr.Zero)
            GetWindowThreadProcessId(diagnosticDesktop, out actualDesktopProcessId);
        bool desktopValid = diagnosticDesktop != IntPtr.Zero &&
            IsWindow(diagnosticDesktop) &&
            ClassName(diagnosticDesktop) == "Progman" &&
            actualDesktopProcessId == diagnosticDesktopProcessId &&
            ProcessName(actualDesktopProcessId) == "explorer" &&
            HasDesktopIconView(diagnosticDesktop);
        bool verified = windowValid &&
            actualOwnerProcessId == unchecked((uint)ownerProcessId) &&
            desktopValid &&
            parentAfter == diagnosticDesktop &&
            rootAfter == diagnosticDesktop &&
            isChild && childStyle && !popupStyle && !topmostStyle && visible;
        string desktopClass = diagnosticDesktop == IntPtr.Zero ? "" : ClassName(diagnosticDesktop);
        return "{" +
            "\"phase\":\"" + JsonEscape(diagnosticPhase) + "\"," +
            "\"failureReason\":\"" + JsonEscape(diagnosticFailureReason) + "\"," +
            "\"windowHandle\":\"" + HexHandle(hwnd) + "\"," +
            "\"ownerProcessId\":" + ownerProcessId.ToString(CultureInfo.InvariantCulture) + "," +
            "\"actualWindowProcessId\":" + actualOwnerProcessId.ToString(CultureInfo.InvariantCulture) + "," +
            "\"windowThreadId\":" + windowThreadId.ToString(CultureInfo.InvariantCulture) + "," +
            "\"helperThreadId\":" + GetCurrentThreadId().ToString(CultureInfo.InvariantCulture) + "," +
            "\"windowClass\":\"" + JsonEscape(windowValid ? ClassName(hwnd) : "") + "\"," +
            "\"windowParentBefore\":\"" + HexHandle(diagnosticParentBefore) + "\"," +
            "\"windowParentAfter\":\"" + HexHandle(parentAfter) + "\"," +
            "\"getAncestorParent\":\"" + HexHandle(ancestorParent) + "\"," +
            "\"getAncestorRoot\":\"" + HexHandle(rootAfter) + "\"," +
            "\"getAncestorRootOwner\":\"" + HexHandle(rootOwnerAfter) + "\"," +
            "\"desktopHandle\":\"" + HexHandle(diagnosticDesktop) + "\"," +
            "\"desktopProcessId\":" + diagnosticDesktopProcessId.ToString(CultureInfo.InvariantCulture) + "," +
            "\"actualDesktopProcessId\":" + actualDesktopProcessId.ToString(CultureInfo.InvariantCulture) + "," +
            "\"desktopThreadId\":" + diagnosticDesktopThreadId.ToString(CultureInfo.InvariantCulture) + "," +
            "\"desktopProcessName\":\"" + JsonEscape(ProcessName(diagnosticDesktopProcessId)) + "\"," +
            "\"desktopClass\":\"" + JsonEscape(desktopClass) + "\"," +
            "\"desktopIconViewFound\":" + (diagnosticDesktopViewFound && HasDesktopIconView(diagnosticDesktop) ? "true" : "false") + "," +
            "\"desktopWindowVisible\":" + (diagnosticDesktop != IntPtr.Zero && IsWindowVisible(diagnosticDesktop) ? "true" : "false") + "," +
            "\"setParentCalled\":" + (diagnosticSetParentCalled ? "true" : "false") + "," +
            "\"setParentReturn\":\"" + HexHandle(diagnosticSetParentReturn) + "\"," +
            "\"setParentLastError\":" + diagnosticSetParentError.ToString(CultureInfo.InvariantCulture) + "," +
            "\"setWindowPosSucceeded\":" + (diagnosticSetWindowPosSucceeded ? "true" : "false") + "," +
            "\"setWindowPosLastError\":" + diagnosticSetWindowPosError.ToString(CultureInfo.InvariantCulture) + "," +
            "\"styleBefore\":\"0x" + diagnosticStyleBefore.ToString("X8", CultureInfo.InvariantCulture) + "\"," +
            "\"styleAfter\":\"0x" + styleAfter.ToString("X8", CultureInfo.InvariantCulture) + "\"," +
            "\"extendedStyleAfter\":\"0x" + exStyleAfter.ToString("X8", CultureInfo.InvariantCulture) + "\"," +
            "\"windowIsValid\":" + (windowValid ? "true" : "false") + "," +
            "\"windowVisible\":" + (visible ? "true" : "false") + "," +
            "\"windowDpi\":" + windowDpi.ToString(CultureInfo.InvariantCulture) + "," +
            "\"desktopDpi\":" + desktopDpi.ToString(CultureInfo.InvariantCulture) + "," +
            "\"windowDpiAwareness\":" + windowDpiAwareness.ToString(CultureInfo.InvariantCulture) + "," +
            "\"desktopDpiAwareness\":" + desktopDpiAwareness.ToString(CultureInfo.InvariantCulture) + "," +
            "\"nativeRectAvailable\":" + (hasWindowRect ? "true" : "false") + "," +
            "\"nativeRect\":{\"left\":" + (hasWindowRect ? windowRect.Left : 0).ToString(CultureInfo.InvariantCulture) + ",\"top\":" + (hasWindowRect ? windowRect.Top : 0).ToString(CultureInfo.InvariantCulture) + ",\"right\":" + (hasWindowRect ? windowRect.Right : 0).ToString(CultureInfo.InvariantCulture) + ",\"bottom\":" + (hasWindowRect ? windowRect.Bottom : 0).ToString(CultureInfo.InvariantCulture) + "}," +
            "\"windowIsTopLevel\":" + (windowValid && rootAfter == hwnd ? "true" : "false") + "," +
            "\"styleHasChild\":" + (childStyle ? "true" : "false") + "," +
            "\"styleHasPopup\":" + (popupStyle ? "true" : "false") + "," +
            "\"styleIsTopmost\":" + (topmostStyle ? "true" : "false") + "," +
            "\"isChildOfDesktop\":" + (isChild ? "true" : "false") + "," +
            "\"bindingVerified\":" + (verified ? "true" : "false") + "}";
    }

    private static string AttachToCurrentDesktop(IntPtr hwnd, uint ownerProcessId, int x, int y, int width, int height, bool initial)
    {
        diagnosticPhase = initial ? "initial-attach" : "reattach";
        diagnosticFailureReason = "not-started";
        diagnosticParentBefore = IntPtr.Zero;
        diagnosticStyleBefore = 0;
        diagnosticSetParentReturn = IntPtr.Zero;
        diagnosticSetParentError = 0;
        diagnosticSetParentCalled = false;
        diagnosticSetWindowPosSucceeded = false;
        diagnosticSetWindowPosError = 0;
        diagnosticDesktop = IntPtr.Zero;
        diagnosticDesktopProcessId = 0;
        diagnosticDesktopViewFound = false;

        if (!IsWindow(hwnd)) {
            diagnosticFailureReason = "window-handle-is-not-valid";
            return "window-missing";
        }
        uint actualOwnerProcessId;
        GetWindowThreadProcessId(hwnd, out actualOwnerProcessId);
        diagnosticParentBefore = GetParent(hwnd);
        diagnosticStyleBefore = ReadStyle(hwnd);
        if (actualOwnerProcessId != ownerProcessId) {
            diagnosticFailureReason = "window-process-id-does-not-match-electron-process";
            return "window-owner-mismatch";
        }
        IntPtr progman;
        uint explorerPid;
        if (!FindDesktop(out progman, out explorerPid)) {
            diagnosticFailureReason = "explorer-progman-with-shell-icon-view-not-found";
            return "desktop-unavailable";
        }

        uint currentStyle = ReadStyle(hwnd);
        bool parentIsDesktop = GetParent(hwnd) == progman;
        if (!parentIsDesktop || (currentStyle & WS_CHILD) == 0 || (currentStyle & WS_POPUP) != 0) {
            WriteStyle(hwnd, (currentStyle & ~WS_POPUP) | WS_CHILD);
        }
        if (!parentIsDesktop) {
            SetLastErrorNative(0);
            diagnosticSetParentCalled = true;
            diagnosticSetParentReturn = SetParent(hwnd, progman);
            diagnosticSetParentError = Marshal.GetLastWin32Error();
            if (GetParent(hwnd) != progman) {
                diagnosticFailureReason = diagnosticSetParentReturn == IntPtr.Zero && diagnosticSetParentError != 0
                    ? "set-parent-win32-error"
                    : "get-parent-did-not-match-explorer-progman-after-set-parent";
                return "binding-verification-failed";
            }
        }

        SetLastErrorNative(0);
        diagnosticSetWindowPosSucceeded = SetWindowPos(hwnd, IntPtr.Zero, x, y, width, height,
            SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW);
        diagnosticSetWindowPosError = Marshal.GetLastWin32Error();
        if (!diagnosticSetWindowPosSucceeded) {
            diagnosticFailureReason = "set-window-pos-failed";
            return "binding-verification-failed";
        }

        if (!VerifyDesktopBinding(hwnd, progman, ownerProcessId)) {
            diagnosticFailureReason = "post-attach-parent-style-visibility-or-ancestor-check-failed";
            return "binding-verification-failed";
        }
        diagnosticFailureReason = "none";
        trackedWindow = hwnd;
        trackedProcessId = ownerProcessId;
        attachedDesktop = progman;
        return initial ? "attached-verified" : "reattached-verified";
    }

    private static bool VerifyDesktopBinding(IntPtr hwnd, IntPtr progman, uint ownerProcessId)
    {
        if (!IsWindow(hwnd) || !IsWindow(progman)) return false;
        uint actualOwnerProcessId;
        uint actualDesktopProcessId;
        GetWindowThreadProcessId(hwnd, out actualOwnerProcessId);
        GetWindowThreadProcessId(progman, out actualDesktopProcessId);
        uint style = ReadStyle(hwnd);
        uint exStyle = ReadExtendedStyle(hwnd);
        return actualOwnerProcessId == ownerProcessId &&
            ClassName(progman) == "Progman" &&
            actualDesktopProcessId == diagnosticDesktopProcessId &&
            ProcessName(actualDesktopProcessId) == "explorer" &&
            HasDesktopIconView(progman) &&
            GetParent(hwnd) == progman &&
            GetAncestor(hwnd, GA_ROOT) == progman &&
            IsChild(progman, hwnd) &&
            (style & WS_CHILD) != 0 &&
            (style & WS_POPUP) == 0 &&
            (exStyle & WS_EX_TOPMOST) == 0 &&
            IsWindowVisible(hwnd);
    }

    public static string Attach(IntPtr hwnd, int ownerProcessId, int x, int y, int width, int height)
    {
        return AttachToCurrentDesktop(hwnd, unchecked((uint)ownerProcessId), x, y, width, height, true);
    }

    public static string GetAttachDiagnostic(IntPtr hwnd, int ownerProcessId)
    {
        return GetLastDiagnostic(hwnd, ownerProcessId);
    }

    public static string EnsureAttached(IntPtr hwnd, int ownerProcessId, int x, int y, int width, int height)
    {
        if (!IsWindow(hwnd)) return "window-missing";
        IntPtr progman;
        uint explorerPid;
        if (!FindDesktop(out progman, out explorerPid)) {
            diagnosticPhase = "desktop-watch";
            diagnosticFailureReason = "explorer-progman-with-shell-icon-view-not-found";
            return "desktop-unavailable";
        }
        if (GetParent(hwnd) == progman && attachedDesktop == progman && VerifyDesktopBinding(hwnd, progman, unchecked((uint)ownerProcessId))) {
            diagnosticPhase = "desktop-watch";
            diagnosticParentBefore = GetParent(hwnd);
            diagnosticStyleBefore = ReadStyle(hwnd);
            SetLastErrorNative(0);
            diagnosticSetWindowPosSucceeded = SetWindowPos(hwnd, IntPtr.Zero, x, y, width, height,
                SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW);
            diagnosticSetWindowPosError = Marshal.GetLastWin32Error();
            if (diagnosticSetWindowPosSucceeded && VerifyDesktopBinding(hwnd, progman, unchecked((uint)ownerProcessId))) {
                diagnosticFailureReason = "none";
                return "attached-verified";
            }
            diagnosticFailureReason = diagnosticSetWindowPosSucceeded
                ? "periodic-parent-style-visibility-or-ancestor-check-failed"
                : "periodic-set-window-pos-failed";
            return "binding-verification-failed";
        }
        return AttachToCurrentDesktop(hwnd, unchecked((uint)ownerProcessId), x, y, width, height, false);
    }

    public static string Detach(IntPtr hwnd, int ownerProcessId, int x, int y, int width, int height)
    {
        if (!IsWindow(hwnd)) return "window-missing";
        diagnosticPhase = "detach";
        diagnosticFailureReason = "not-started";
        uint actualOwnerProcessId;
        GetWindowThreadProcessId(hwnd, out actualOwnerProcessId);
        if (actualOwnerProcessId != unchecked((uint)ownerProcessId)) return "window-owner-mismatch";
        uint style = ReadStyle(hwnd);
        diagnosticParentBefore = GetParent(hwnd);
        diagnosticStyleBefore = style;
        diagnosticSetParentCalled = false;
        diagnosticSetParentReturn = IntPtr.Zero;
        diagnosticSetParentError = 0;
        if ((style & WS_CHILD) != 0) {
            SetLastErrorNative(0);
            diagnosticSetParentCalled = true;
            diagnosticSetParentReturn = SetParent(hwnd, IntPtr.Zero);
            diagnosticSetParentError = Marshal.GetLastWin32Error();
        }
        WriteStyle(hwnd, (style & ~WS_CHILD) | WS_POPUP);
        if ((ReadStyle(hwnd) & WS_CHILD) != 0 || GetAncestor(hwnd, GA_ROOT) != hwnd) {
            diagnosticFailureReason = "window-remained-a-child-after-detach";
            return "detach-failed";
        }
        SetLastErrorNative(0);
        diagnosticSetWindowPosSucceeded = SetWindowPos(hwnd, IntPtr.Zero, x, y, width, height,
            SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW);
        diagnosticSetWindowPosError = Marshal.GetLastWin32Error();
        if (!diagnosticSetWindowPosSucceeded) {
            diagnosticFailureReason = "set-window-pos-failed-during-detach";
            return "position-failed";
        }
        trackedWindow = IntPtr.Zero;
        trackedProcessId = 0;
        attachedDesktop = IntPtr.Zero;
        diagnosticFailureReason = "none";
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

function Write-DesktopDiagnostic {
  $details = [DaybydayDesktopWindowNative]::GetAttachDiagnostic(
    $windowHandle,
    $OwnerProcessId
  )
  [Console]::Out.WriteLine('{"code":"diagnostic","details":' + $details + '}')
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

$script:keyboardFocusAttached = $false
$script:keyboardFocusSourceThreadId = [uint32]0
$script:keyboardFocusTargetThreadId = [uint32]0

function Release-DesktopKeyboardFocus {
  if (-not $script:keyboardFocusAttached) { return 'focus-released' }
  $released = [DaybydayDesktopWindowNative]::ReleaseKeyboardFocus(
    $script:keyboardFocusSourceThreadId,
    $script:keyboardFocusTargetThreadId
  )
  if ($released) {
    $script:keyboardFocusAttached = $false
    $script:keyboardFocusSourceThreadId = [uint32]0
    $script:keyboardFocusTargetThreadId = [uint32]0
    return 'focus-released'
  }
  return 'focus-release-failed'
}

function Set-DesktopKeyboardFocus {
  if ($script:keyboardFocusAttached) {
    return [DaybydayDesktopWindowNative]::VerifyKeyboardFocus(
      $windowHandle,
      $script:keyboardFocusTargetThreadId
    )
  }
  $sourceThreadId = [uint32]0
  $targetThreadId = [uint32]0
  $attached = $false
  $status = [DaybydayDesktopWindowNative]::SetKeyboardFocus(
    $windowHandle,
    $OwnerProcessId,
    [ref]$sourceThreadId,
    [ref]$targetThreadId,
    [ref]$attached
  )
  if ($attached) {
    $script:keyboardFocusAttached = $true
    $script:keyboardFocusSourceThreadId = $sourceThreadId
    $script:keyboardFocusTargetThreadId = $targetThreadId
  }
  return $status
}

if ($Mode -eq 'Detach') {
  $detachCode = [DaybydayDesktopWindowNative]::Detach($windowHandle, $OwnerProcessId, $X, $Y, $Width, $Height)
  Write-DesktopDiagnostic
  Write-Status $detachCode
  if ($detachCode -ne 'detached' -and $detachCode -ne 'window-missing') { exit 2 }
  exit 0
}

$status = [DaybydayDesktopWindowNative]::Attach($windowHandle, $OwnerProcessId, $X, $Y, $Width, $Height)
Write-DesktopDiagnostic
Write-Status $status
if ($status -ne 'attached-verified') { exit 2 }

# A bounded poll repairs the parent when Explorer restarts. It never sends
# private shell messages, edits the registry, or terminates Explorer.
# ReadLineAsync keeps the same PowerShell thread available for SetFocus while
# still allowing bounds and focus commands to arrive over the stdin pipe.
$stdinReader = [System.IO.StreamReader]::new([Console]::OpenStandardInput())
$readCommand = $stdinReader.ReadLineAsync()
$lastStatus = $status
$desktopUnavailableSince = $null
$helperExitCode = 0
try {
  while ($true) {
    if ($readCommand.IsCompleted) {
      $line = $readCommand.Result
      if ($null -eq $line) { break }
      try { $command = $line | ConvertFrom-Json } catch { $command = $null }
      if ($command -and $command.command -eq 'stop') { break }
      if ($command -and $command.command -eq 'focus') {
        $focusStatus = Set-DesktopKeyboardFocus
        if ($focusStatus -eq 'focus-attached') {
          Write-Status 'focus-attached'
        } else {
          Write-Status 'focus-error'
        }
      }
      if ($command -and $command.command -eq 'blur') {
        $focusStatus = Release-DesktopKeyboardFocus
        if ($focusStatus -eq 'focus-release-failed') { Write-Status 'focus-error' }
      }
      if ($command -and $command.command -eq 'detach') {
        [void](Release-DesktopKeyboardFocus)
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
      $readCommand = $stdinReader.ReadLineAsync()
    }
    Start-Sleep -Milliseconds 1800
    $status = [DaybydayDesktopWindowNative]::EnsureAttached($windowHandle, $OwnerProcessId, $X, $Y, $Width, $Height)
    if ($status -eq 'desktop-unavailable') {
      if ($null -eq $desktopUnavailableSince) { $desktopUnavailableSince = [DateTime]::UtcNow }
      if (([DateTime]::UtcNow - $desktopUnavailableSince).TotalSeconds -ge 20) {
        Write-Status 'desktop-timeout'
        $helperExitCode = 2
        break
      }
    } else {
      $desktopUnavailableSince = $null
    }
    if ($status -ne $lastStatus) {
      if ($status -ne 'attached-verified') { Write-DesktopDiagnostic }
      Write-Status $status
      $lastStatus = $status
    }
    if ($status -eq 'window-missing' -or $status -eq 'window-owner-mismatch') { break }
  }
} finally {
  [void](Release-DesktopKeyboardFocus)
  $stdinReader.Dispose()
}
if ($helperExitCode -ne 0) { exit $helperExitCode }
