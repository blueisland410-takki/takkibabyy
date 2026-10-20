param(
  [ValidateSet('Inspect', 'Widget')]
  [string]$Mode = 'Inspect'
)

$ErrorActionPreference = 'Stop'

if (-not $IsWindows -and $PSVersionTable.PSEdition -eq 'Core') {
  throw 'This probe only runs on Windows.'
}

$nativeCode = @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class DaybydayDesktopProbeNative
{
    public delegate bool EnumWindowsCallback(IntPtr hwnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool EnumChildWindows(IntPtr parent, EnumWindowsCallback callback, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern int GetClassName(IntPtr hwnd, StringBuilder className, int maxCount);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool GetClientRect(IntPtr hwnd, out RECT rect);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr SetParent(IntPtr child, IntPtr newParent);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr GetParent(IntPtr hwnd);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW", SetLastError = true)]
    public static extern IntPtr GetWindowLongPtr64(IntPtr hwnd, int index);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)]
    public static extern IntPtr SetWindowLongPtr64(IntPtr hwnd, int index, IntPtr value);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongW", SetLastError = true)]
    public static extern int GetWindowLong32(IntPtr hwnd, int index);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongW", SetLastError = true)]
    public static extern int SetWindowLong32(IntPtr hwnd, int index, int value);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool IsWindow(IntPtr hwnd);

    public static string ClassName(IntPtr hwnd)
    {
        var value = new StringBuilder(256);
        GetClassName(hwnd, value, value.Capacity);
        return value.ToString();
    }

    public static IntPtr GetStyle(IntPtr hwnd)
    {
        return IntPtr.Size == 8
            ? GetWindowLongPtr64(hwnd, -16)
            : new IntPtr(GetWindowLong32(hwnd, -16));
    }

    public static void SetStyle(IntPtr hwnd, long value)
    {
        if (IntPtr.Size == 8) SetWindowLongPtr64(hwnd, -16, new IntPtr(value));
        else SetWindowLong32(hwnd, -16, unchecked((int)value));
    }
}
'@

Add-Type -TypeDefinition $nativeCode

$script:desktopWindow = [IntPtr]::Zero
$script:desktopViewFound = $false
$script:desktopProcessId = [uint32]0

[void][DaybydayDesktopProbeNative]::EnumWindows(
  [DaybydayDesktopProbeNative+EnumWindowsCallback]{
    param($hwnd, $lParam)
    if ([DaybydayDesktopProbeNative]::ClassName($hwnd) -eq 'Progman') {
      $script:desktopWindow = $hwnd
      [void][DaybydayDesktopProbeNative]::GetWindowThreadProcessId($hwnd, [ref]$script:desktopProcessId)
    }
    return $true
  },
  [IntPtr]::Zero
)

if ($script:desktopWindow -eq [IntPtr]::Zero) {
  throw '找不到当前交互桌面的 Progman 窗口。请在 Windows 本机桌面会话中运行此脚本。'
}

[void][DaybydayDesktopProbeNative]::EnumChildWindows(
  $script:desktopWindow,
  [DaybydayDesktopProbeNative+EnumWindowsCallback]{
    param($hwnd, $lParam)
    if ([DaybydayDesktopProbeNative]::ClassName($hwnd) -eq 'SHELLDLL_DefView') {
      $script:desktopViewFound = $true
    }
    return $true
  },
  [IntPtr]::Zero
)

$desktopProcess = $null
try {
  $desktopProcess = Get-Process -Id $script:desktopProcessId -ErrorAction Stop
} catch {
  throw "找到了 Progman HWND，但当前进程无法访问其拥有者 PID $script:desktopProcessId。为避免向错误桌面挂接，本探针已停止。请在实际 Windows 桌面用户会话中运行。"
}

if ($desktopProcess.ProcessName -ne 'explorer') {
  throw "Progman 窗口由 '$($desktopProcess.ProcessName)' 进程持有，而非 Explorer；本探针不会修改此窗口。"
}

$desktopRect = [DaybydayDesktopProbeNative+RECT]::new()
if (-not [DaybydayDesktopProbeNative]::GetClientRect($script:desktopWindow, [ref]$desktopRect)) {
  throw '无法读取桌面区域尺寸。'
}

Write-Output 'Desktop layer probe environment'
Write-Output "- Windows: $([Environment]::OSVersion.VersionString)"
Write-Output "- Explorer PID: $($script:desktopProcessId)"
Write-Output "- Progman HWND: 0x$('{0:X}' -f $script:desktopWindow.ToInt64())"
Write-Output "- Desktop icon view found: $script:desktopViewFound"
Write-Output "- Desktop client area: $($desktopRect.Right - $desktopRect.Left) × $($desktopRect.Bottom - $desktopRect.Top)"

if (-not $script:desktopViewFound) {
  throw 'Explorer 当前没有标准 SHELLDLL_DefView 图标视图；本探针不会尝试猜测 WorkerW。'
}

if ($Mode -eq 'Inspect') {
  Write-Output '检查模式没有改变窗口、注册表或应用数据。'
  Write-Output '确认上述 Explorer/Progman/图标视图均存在后，可用 -Mode Widget 打开一次性的可交互探针。'
  exit 0
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$form = [System.Windows.Forms.Form]::new()
$form.Text = 'Daybyday Desktop Widget Probe'
$form.TopLevel = $false
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$form.ShowInTaskbar = $false
$form.KeyPreview = $true
$form.Size = [System.Drawing.Size]::new(360, 206)
$form.BackColor = [System.Drawing.Color]::FromArgb(248, 246, 241)
$form.ForeColor = [System.Drawing.Color]::FromArgb(60, 57, 53)

$header = [System.Windows.Forms.Panel]::new()
$header.Dock = [System.Windows.Forms.DockStyle]::Top
$header.Height = 38
$header.BackColor = [System.Drawing.Color]::FromArgb(232, 217, 196)
$form.Controls.Add($header)

$title = [System.Windows.Forms.Label]::new()
$title.Text = 'Daybyday · Desktop layer probe'
$title.Font = [System.Drawing.Font]::new('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
$title.AutoSize = $true
$title.Location = [System.Drawing.Point]::new(12, 11)
$header.Controls.Add($title)

$body = [System.Windows.Forms.Label]::new()
$body.Text = 'This temporary window is parented to Progman.' + [Environment]::NewLine + 'A normal app window should cover it.'
$body.Font = [System.Drawing.Font]::new('Segoe UI', 9)
$body.AutoSize = $true
$body.Location = [System.Drawing.Point]::new(14, 54)
$form.Controls.Add($body)

$button = [System.Windows.Forms.Button]::new()
$button.Text = 'Click test (0)'
$button.Font = [System.Drawing.Font]::new('Segoe UI', 9)
$button.Size = [System.Drawing.Size]::new(126, 32)
$button.Location = [System.Drawing.Point]::new(14, 112)
$form.Controls.Add($button)
$script:clickCount = 0
$button.Add_Click({
  $script:clickCount++
  $button.Text = "Click test ($script:clickCount)"
})

$closeButton = [System.Windows.Forms.Button]::new()
$closeButton.Text = 'Close probe'
$closeButton.Font = [System.Drawing.Font]::new('Segoe UI', 9)
$closeButton.Size = [System.Drawing.Size]::new(104, 32)
$closeButton.Location = [System.Drawing.Point]::new(150, 112)
$form.Controls.Add($closeButton)
$closeButton.Add_Click({ $form.Close() })
$form.Add_KeyDown({ if ($_.KeyCode -eq [System.Windows.Forms.Keys]::Escape) { $form.Close() } })

$script:probeX = 0
$script:probeY = 0
$script:probeWidth = 360
$script:probeHeight = 206
$script:dragStartMouse = [System.Drawing.Point]::Empty
$script:dragStartLocation = [System.Drawing.Point]::Empty
$script:draggingProbe = $false

$header.Add_MouseDown({
  if ($_.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
    $script:draggingProbe = $true
    $script:dragStartMouse = [System.Windows.Forms.Cursor]::Position
    $script:dragStartLocation = [System.Drawing.Point]::new($script:probeX, $script:probeY)
  }
})
$header.Add_MouseMove({
  if ($script:draggingProbe) {
    $cursor = [System.Windows.Forms.Cursor]::Position
    $script:probeX = $script:dragStartLocation.X + $cursor.X - $script:dragStartMouse.X
    $script:probeY = $script:dragStartLocation.Y + $cursor.Y - $script:dragStartMouse.Y
    [void][DaybydayDesktopProbeNative]::SetWindowPos(
      $formHandle, [IntPtr]::Zero, $script:probeX, $script:probeY,
      $script:probeWidth, $script:probeHeight, 0x0004 -bor 0x0010
    )
  }
})
$header.Add_MouseUp({ $script:draggingProbe = $false })

$sizeGrip = [System.Windows.Forms.Panel]::new()
$sizeGrip.Size = [System.Drawing.Size]::new(16, 16)
$sizeGrip.Location = [System.Drawing.Point]::new(340, 188)
$sizeGrip.Anchor = [System.Windows.Forms.AnchorStyles]::Bottom -bor [System.Windows.Forms.AnchorStyles]::Right
$sizeGrip.BackColor = [System.Drawing.Color]::FromArgb(184, 165, 142)
$form.Controls.Add($sizeGrip)
$script:resizingProbe = $false
$script:resizeStartMouse = [System.Drawing.Point]::Empty
$script:resizeStartSize = [System.Drawing.Size]::Empty
$sizeGrip.Add_MouseDown({
  if ($_.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
    $script:resizingProbe = $true
    $script:resizeStartMouse = [System.Windows.Forms.Cursor]::Position
    $script:resizeStartSize = [System.Drawing.Size]::new($script:probeWidth, $script:probeHeight)
  }
})
$sizeGrip.Add_MouseMove({
  if ($script:resizingProbe) {
    $cursor = [System.Windows.Forms.Cursor]::Position
    $dx = $cursor.X - $script:resizeStartMouse.X
    $dy = $cursor.Y - $script:resizeStartMouse.Y
    $script:probeWidth = [Math]::Max(300, $script:resizeStartSize.Width + $dx)
    $script:probeHeight = [Math]::Max(170, $script:resizeStartSize.Height + $dy)
    [void][DaybydayDesktopProbeNative]::SetWindowPos(
      $formHandle, [IntPtr]::Zero, $script:probeX, $script:probeY,
      $script:probeWidth, $script:probeHeight, 0x0004 -bor 0x0010
    )
  }
})
$sizeGrip.Add_MouseUp({ $script:resizingProbe = $false })

# Put the borderless form below normal top-level windows but above desktop icons.
# The HWND is a child of Progman, not an always-on-top window.
$form.CreateControl()
$formHandle = $form.Handle
$oldStyle = [DaybydayDesktopProbeNative]::GetStyle($formHandle).ToInt64()
$childStyle = ($oldStyle -band 0x7FFFFFFF) -bor 0x40000000
[DaybydayDesktopProbeNative]::SetStyle($formHandle, $childStyle)
[void][DaybydayDesktopProbeNative]::SetParent($formHandle, $script:desktopWindow)
if ([DaybydayDesktopProbeNative]::GetParent($formHandle) -ne $script:desktopWindow) {
  [DaybydayDesktopProbeNative]::SetStyle($formHandle, $oldStyle)
  throw 'Windows 拒绝把探针窗口临时挂接到 Progman。'
}

$script:probeX = [Math]::Max(16, $desktopRect.Right - $script:probeWidth - 32)
$script:probeY = [Math]::Max(16, $desktopRect.Bottom - $script:probeHeight - 48)
$form.Location = [System.Drawing.Point]::new($script:probeX, $script:probeY)

# Start above the icon view in Progman's child-window order. It only covers the
# small rectangle occupied by this probe; place it in a clear desktop area.
if (-not [DaybydayDesktopProbeNative]::SetWindowPos(
  $formHandle, [IntPtr]::Zero, $script:probeX, $script:probeY,
  $script:probeWidth, $script:probeHeight, 0x0040 -bor 0x0010
)) {
  $form.Dispose()
  throw '无法定位探针窗口。'
}

Write-Output '探针窗口已挂接。请按 Win+D 查看桌面，再依次验证按钮、遮挡和图标区域；关闭窗口即可结束。'
try {
  [System.Windows.Forms.Application]::Run($form)
} finally {
  $form.Dispose()
}
