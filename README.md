# Daybyday

Daybyday 是一款面向 Windows 与 macOS 的跨平台本地日程助手。Windows 版本包含可拖动、可缩放的悬浮窗、本地每日待办和临时日程，以及按教学周重复计算的学期课程和周视图；macOS 构建状态及尚未实机验证的项目见 Phase 6.1D。

## 启动

在 Windows PowerShell 中打开项目目录并运行：

```powershell
Set-Location D:\DAYBYDAY
npm start
```

不需要登录或连接云端。首次安装依赖时才需要在项目目录执行 `npm install`。

## 第一次设置学期

1. 点击顶部 **Semester Planner**。
2. 点击 **新建学期**，填写名称、学期起止日期和“第一教学周星期一”。
3. 第一教学周必须与学期开始日期处于同一周。例如学期从 2026-09-01（星期二）开始，可将第一教学周星期一设为 2026-08-31。
4. 勾选“设为当前学期”，保存后，该学期的课程会进入每日及周视图。多个学期可保存在列表中，任意时刻只会有一个当前学期。

## 录入课程

在 Semester Planner 点击 **新增课程**，填写课程名、星期、开始和结束时间、周次范围、重复方式，以及可选的教室、教师和备注。

- 每周、单周和双周按“第一教学周星期一”计算，不依据自然年周数。
- 指定周次可勾选不连续周，例如第 1、3、8、12 周。
- 课程只保存一条重复规则；查看日程时按所查日期范围即时展开。
- 日视图中的课程按钮可调整这一次的日期、时间和教室，或取消这一次；原课程发生日期用于追踪例外，跨周移动也不会显示两条。
- Semester Planner 编辑的是整个课程系列。保存时可选择保留仍匹配新规则的单次例外，或清除全部例外；删除课程系列需要两次确认。
- 课程时间冲突目前只并列展示，不阻止保存。

## 导入课表截图（第五阶段）

1. 打开顶部 **Semester Planner**，先选定要导入的学期。
2. 在“我的课程”旁点击 **Import timetable**。导入页面会临时把窗口扩展到较宽的校对模式；返回课程列表后恢复原窗口大小。
3. 选择或拖入 PNG、JPG、JPEG 图片（不超过 15 MB；至少 240 × 160 像素且不超过 3000 万像素）。原图只在当前页面内存中预览和识别，不会写入 SQLite 或上传网络。
4. 点击 **Recognize**。识别在本机的 Tesseract.js Worker 中运行，页面会显示进度，可取消后重试。
5. 对照原图逐项检查课程名称、星期、时间、教室、教师和周次；每门准备导入的课程都要勾选“我已对照原图核对这门课”。无法识别的字段保持待确认，不会猜测。
6. 点击“检查重复与冲突”。完全相同的课程默认跳过；用户可以选择仍保留，或修改课程字段后重新检查。时间冲突会提示但允许继续。
7. 点击“确认导入”并在确认框中再次确认。主进程会在一个 SQLite 事务中一次写入本批课程；失败时整批回滚，已有课程和调课例外不会被覆盖。

第一版重点支持横向按星期排列、星期表头清楚、课程内容在相应列内的常见周课表。Tesseract 会返回文字框坐标与置信度，再由版面解析器按星期列和文字位置分组；文字识别结果不会直接当成课程。复杂合并单元格、无清晰星期表头、同一单元格含多门课、彩色背景区块或 OCR 模糊的内容仍需人工编辑。若 OCR 不能可靠形成课程候选，可手动新增课程；原始识别文字、坐标和行置信度可展开查看。

对于截图只写“第 1 节”而没有钟点的学校，展开“学校节次时间设置”，设置连续的节次起止时间并保存为默认模板。没有模板时不会自动推断作息时间。当前支持简体中文和英文 OCR，未打包韩文模型。

## 导入 ICS、Excel 和 CSV（第五阶段修复升级：检查点 A）

在 **Semester Planner → Import timetable** 中，可以切换 **Import ICS**、**Import Excel** 或 **Import CSV**。目标学期显示在导入页顶部。选择文件后，应用只在本机内存读取；不会上传，也不会把原始文件或截图保存到数据库。单个文件最大 25 MB。

- **ICS**：读取 VEVENT 的标题、起止时间、地点和说明。每周 RRULE 可转换为学期重复课程；EXDATE 和 RECURRENCE-ID 取消/调整会作为单次课程例外保留。无重复规则或无法表达为每周课程的复杂重复，按学期范围展开为明确日期的日程，预览中可改成课程。重复导入时会用 UID/来源记录及已有课程信息提示重复，默认跳过，不自动覆盖。
- **时区**：应用按 ICS 中的 UTC、TZID/VTIMEZONE 或浮动时间解释事件。非本机时区会显示校对提醒；单次事件按电脑本地时间展示。每周课程保存 ICS 表示的墙上时间，不做隐式时区平移，用户应先核对课程所在地的时区和本机时区。
- **Excel / CSV**：提供可下载的空白 Excel 与 CSV 模板。支持中英文表头别名、多工作表、工作表选择、表头行调整、手动列映射、Excel 时间单元格、合并单元格主格读取和 CSV UTF-8 / GB18030 编码选择。Excel 公式不会执行；合并区域和缺失字段会提示人工检查。课程周次可填“单周”“双周”“1-16周”或指定周次。
- **人工校对**：每项都可编辑、切换为课程或单次日程、标记导入/跳过、确认或删除；空解析结果也能手动补录。必须补全必填信息并逐项勾选确认后，才能检查重复和冲突、最终写入。日程与课程都保留来源记录和原始文本，便于排查。
- **安全写入与撤销**：导入先生成统一草稿并预览，最后由主进程验证并用 SQLite 单一事务写入。批次记录保存文件名、格式、SHA-256 内容指纹和新增记录关联。最近批次可以撤销；导入后被编辑过的内容会保留，不会被撤销操作删除。重复课程默认跳过，时间冲突只提示。

该版本的表格模板建议使用“每行一门课程”的标准结构。复杂 ICS 重复规则、CSV 非 UTF-8/GB18030 编码、公式结果、合并单元格中的隐含课程，以及非标准表格都需要用户校正。PDF / DOCX 尚未实现；截图流程继续使用原有 OCR 预览，表格网格检测与手动校准会在检查点 B 处理，本次没有改动 OCR 识别算法。

离线 OCR 使用锁定版本的 Tesseract.js 7.0.0、`chi_sim` 与 `eng`，并通过应用内白名单协议读取随应用打包的本地 OCR Worker、WASM 核心和语言包；运行时不会从 CDN 下载。中文和英文最佳整数模型压缩文件合计 **4,671,641 字节（约 4.46 MiB）**；本项目只打包 Tesseract Worker 和通用 LSTM WASM 核心，合计约 **4,007,791 字节（约 3.82 MiB）**。OCR 资源总计约 **8,679,432 字节（约 8.28 MiB）**，另有少量许可证文本。Windows x64 SQLite 运行文件另占约 **2,020,348 字节（约 1.93 MiB）**。韩文识别模型未包含，可避免进一步增加体积。

合成测试截图位于 `tests/fixtures/synthetic-standard-timetable.png`，只用于自动化测试，不含用户图片。自动化用本地语言文件识别该图片，并检查文字坐标及解析结果。

## 日视图与周视图

- 顶部 **Day** 展示选中日期的课程、临时日程和待办。
- 顶部 **Week** 展示周一至周日的日期与安排标记；点击日期后，下方显示当天详细安排。上一周、下一周和 Today 可快速切换。
- **Semester Planner** 管理学期及课程。
- 临时日程和课程按时间排列，全天临时日程放在最上方。待办仍按日期单独保存。

## 字体与窗口

新安装默认使用 440 × 680 的窗口；已经保存过的窗口位置、大小和置顶状态会继续恢复，不会因升级而被覆盖。窗口仍可拖动和缩放。

顶部 **Settings** → **Font size** 可用滑块在 80%–130% 之间以 5% 步长调整；百分比即时显示，字体立即变化并自动保存。**Reset** 可恢复 100%。设置保存在 Electron 用户数据目录中的窗口设置文件，重启后继续生效。旧版 150% 设置升级后安全限制为 130%，其他原有档位会保留。若旧窗口尺寸较小，Settings 会提示可以拖动边缘扩大；软件不会擅自改写你保存的窗口尺寸。文字变大后主内容、课程卡片和弹窗可换行并滚动。

**Settings → Appearance → Theme Color** 提供九套主题。**Soft & Muted** 包含 Classic、Dusty Rose、Sage Green、Misty Blue、Muted Lavender 和 Oat Beige；**Pop & Playful** 包含 Mint Pop、Sapphire 和 Y2K Pink。点击后立即预览，关闭并重启应用后仍会保留；**Reset to default** 可恢复 Classic。普通文字保持深色；薄荷绿和粉色强调按钮使用深色文字，宝石蓝使用白色文字，并由自动化测试检查对比度。

**Settings → Language → App Language** 可即时切换简体中文、繁體中文、日本語、한국어和 English；选项始终显示各语言的本地名称。界面日期和星期随语言格式化，课程、待办、备注、教师/教室名称及导入原文均保持用户输入内容。主题、语言、字号比例与窗口位置、大小及置顶偏好保存在 `%APPDATA%\DayByDay\window-state.json`，不会写入 SQLite 或更改课程、待办和日程。旧设置缺少语言字段时默认使用简体中文。

## Windows 桌面集成（Phase 6A）

应用启动后会在 Windows 通知区域创建一个 **Daybyday** 托盘图标。单击图标恢复今日窗口；右键菜单可以显示/隐藏窗口、聚焦快速添加待办、打开完整周视图、打开 Settings 或完全退出。托盘菜单会跟随当前应用语言即时更新。系统只创建一个主窗口和一个托盘图标；再次启动时会把已有窗口带到前台。

**Settings → Window** 中的 **关闭到托盘** 默认关闭。关闭时会保存窗口位置、大小和设置；关闭到托盘开启后，点窗口的关闭按钮只会隐藏窗口，应用继续运行。最小化仍是普通最小化，点托盘图标可以恢复。托盘菜单中的“完全退出 Daybyday”会结束应用并关闭 SQLite 连接。

**Launch at Windows startup** 默认关闭。只有正式安装的 Squirrel.Windows 版本才可切换；开发版会显示不可用状态，也不会注册开发目录或 npm 启动命令。程序通过 Electron 的 Windows 登录启动 API 查询实际启动状态，并使用 Squirrel 版本目录上一层的稳定启动器，以便升级后仍启动最新版本。Phase 6C 已构建并安装/卸载测试 Squirrel 安装程序，但 Electron 启动器在本机崩溃，故设置页、实际启动项切换、升级和 Windows 重启后的自动启动仍未验证。

桌面运行验证当前受 Electron 运行时故障阻挡：在这台 Windows 11（OS build 26200）环境中，`electron --version` 自身触发 `EXCEPTION_BREAKPOINT`（退出码 `0x80000003`）；`npm start` 和打包目录中的 exe 也未能打开窗口。该错误发生在 Electron 主进程代码运行前，因此托盘、关闭到托盘和窗口 UI 行为还没有实际 GUI 验证。Phase 6C 也直接运行了安装后的 `Daybyday.exe --version`，仍以 `0x80000003` 退出。类型检查、lint、自动化测试、Forge 打包和 Squirrel 安装/卸载流程通过；运行尝试没有访问或改写正式 `%APPDATA%\DayByDay` 数据内容。需要先解决这台环境的 Electron 运行时问题，再完成 GUI 手动验收。

托盘关闭偏好和最后一次读取的启动偏好沿用 `window-state.json` 保存；SQLite 文件和已有业务数据不会迁移或重建。`package.json` 中现有 `productName` 与 AppUserModelID 保持原样，以避免改变既有安装及用户数据标识；窗口和托盘中的可见品牌为 **Daybyday**。

应用语言资源位于 `locales/zh-CN.json`、`locales/zh-TW.json`、`locales/ja-JP.json`、`locales/ko-KR.json` 和 `locales/en-US.json`。五份资源使用同一组翻译键；页面切换不改变 OCR 语言、教学周次、单双周规则或本地日期计算。未收录的底层错误在非简体中文界面显示通用重试提示，避免把简体中文错误直接混入其他语言；简体中文保留原始详细错误，新增用户可见错误时应同步补充各语言资源。

全应用字号由 CSS 字体变量统一管理：说明文字最低 13px，按钮约 15px，正文约 16px，栏目标题约 19px，主标题约 24px；所选比例会统一应用到今日视图、周视图、学期管理和导入校对页面。Electron 窗口按 Windows 逻辑像素布局，适配 125% / 150% 显示缩放；实际显示效果仍建议在目标电脑上查看。

### 应用图标与字号（Phase 6.1 检查点 A）

应用图标使用奶油色圆角方块和深灰大写 **D**。矢量主资源为 `resources/icon.svg`；`resources/icon.png`（1024×1024）、`resources/icon.ico`（Windows 桌面、任务栏和安装包）和 `resources/icon.icns`（macOS 图标资源）由 `scripts/render-app-icon.ps1` 导出。Windows 系统托盘使用同一设计生成的 `resources/daybyday-tray.ico`。重新绘制 SVG 后，可在项目 PowerShell 中运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\render-app-icon.ps1
```

Forge 在 Windows 使用 ICO 应用图标，在 macOS 使用 ICNS。macOS 菜单栏托盘使用随 SVG 主图标生成的黑色透明 Template PNG（16px 与 32px Retina）；Windows 继续使用 ICO。重新绘制 SVG 后，同一脚本会更新这些图标资源。

本检查点的 Windows Forge package 和 Squirrel make 均成功；已从 `Daybyday.exe` 与 `Daybyday-1.0.0-Setup.exe` 提取并检查嵌入图标，32×32 图像的上下背景与 D 字颜色符合 SVG，托盘 ICO 也进入打包资源。安装器仍未签名。`npm start` 没有显示窗口，故滑块的实际鼠标操作、窗口重启后的界面状态仍需在 Electron 可启动的环境中手动验证。

### Desktop Widget 可行性探针（Phase 6.1B）

桌面便签必须挂在 Explorer 桌面窗口层；仅关闭 `setAlwaysOnTop` 并不等于桌面组件。本阶段先加入独立的 Windows 探针 `scripts/desktop-widget-probe.ps1`，不接入 Daybyday 的窗口、设置或数据库。探针只在能够确认 `Progman`、桌面图标视图及其 Explorer 所有者的交互式 Windows 会话中运行；它使用一个可关闭的小窗测试挂接和基本交互，不写注册表、不重启 Explorer。`WorkerW` 的创建消息没有可依赖的公开 Explorer 契约，因此探针不会猜测或强行创建 WorkerW。

在 Windows 本机 PowerShell 中先运行检查：

```powershell
Set-Location D:\DAYBYDAY
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File .\scripts\desktop-widget-probe.ps1 -Mode Inspect
```

只有检查成功后才运行可见探针：

```powershell
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File .\scripts\desktop-widget-probe.ps1 -Mode Widget
```

探针出现后按 `Win + D` 查看桌面，点击测试按钮，拖动奶油色标题条并拖动右下角调整大小；随后打开记事本等普通窗口确认它能盖住探针，再按 `Win + D` 返回桌面。探针覆盖的小矩形会接收该区域的点击；若它正好盖住桌面图标，请先把它拖到空白处。按 **Close probe** 或 `Esc` 结束。不要把一次性探针结果当作正式功能：Explorer 重启恢复、多显示器变化、Windows 10/11 差异和实际 Electron 窗口尚未验证。

本机 PowerShell 探针已由用户确认通过：组件可见、按钮可交互、普通应用窗口能覆盖、返回桌面后可见，并可拖动和缩放。探针测试的是 WinForms 临时窗口，不等同于已验证 Daybyday 的 Electron BrowserWindow；Explorer 重启、多显示器、Windows 10/11 差异仍需单独检查。

### Window Mode：桌面便签（Phase 6.1C，Windows 实验功能）

在 **Settings → Window Mode** 可切换 **Floating Window**、**Desktop Widget** 和 **Always on Top**。三种模式有独立保存值；旧版只保存“始终置顶”的 `window-state.json` 会自动迁移到 Floating Window 或 Always on Top。顶部图钉按钮可设为 Always on Top，再次点击会回到 Floating Window。Desktop Widget 在 Windows 上通过随应用打包的 `resources/daybyday-desktop-window.ps1` 尝试将 Electron BrowserWindow 挂接到 Explorer 的 `Progman` 桌面层；它不是 `setAlwaysOnTop(false)`。只有父窗口、祖先关系、窗口样式、可见性和 Explorer 宿主检查全部通过时，设置页才显示“桌面绑定已验证”。辅助进程每约 1.8 秒检查桌面宿主，Explorer 重启后会尝试重新挂接；如果宿主连续 20 秒不可用，应用会退回 Floating Window。初次挂接失败也会切回 Floating Window 并显示提示。Desktop Widget 模式下，最小化按钮会隐藏组件，托盘图标可恢复；关闭按钮仍按“关闭到托盘”设置决定隐藏或退出。

桌面层挂接会改变窗口的 Win32 父子关系。微软文档指出，跨进程 `SetParent` 在 Windows 10 1703 及之后可能重置子窗口所属进程的 DPI 感知；Electron 官方 BrowserWindow API 没有将普通 BrowserWindow 直接设置为 Explorer 桌面子窗口的公开接口。因此此模式明确标记为实验功能，可能影响高 DPI 缩放；若布局异常，请切回 Floating Window 并重启应用。[Microsoft SetParent 文档](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setparent)、[Electron BrowserWindow 文档](https://www.electronjs.org/docs/latest/api/browser-window)。目前的环境中 Electron 44.9.0 未能显示应用窗口，所以真实 BrowserWindow 挂接、运行时自动恢复和 DPI 行为尚未完成验收。用户确认通过的是独立 WinForms 探针；这不代表 Explorer 重启、多显示器、Windows 10/11 和高 DPI 均已验证。

### Desktop Widget 输入焦点修复（Phase 6.2）

桌面子窗口不能像普通顶层窗口一样直接取得键盘焦点。桌面模式下，当文字输入框、文本区域、下拉框或可编辑区域获得焦点时，preload 只发送一个布尔焦点状态；主进程会验证 IPC 来自主窗口主 frame，并且当前模式确实是 Desktop Widget，然后通知随包的 PowerShell/Win32 辅助进程。辅助进程将自己的输入队列临时连接到 Electron HWND 所属线程，通过 `SetFocus` 设置并用 `GetGUIThreadInfo` 验证焦点。失焦、切换窗口模式、辅助进程退出时解除连接；失败时以当前应用语言提示切回 Floating Window。不会调用 `SetForegroundWindow`，也不保存输入内容。

Microsoft 说明 `AttachThreadInput` 会重置按键状态，且要求两个线程位于同一桌面；因此连接仅在获得可编辑控件焦点后启用，并在离开后解除。此桥接已通过独立 Electron 探针的文字输入测试（用户确认成功），Windows PowerShell 自动测试也已编译更新后的 Win32 辅助代码。本次使用本地缓存的 Electron ZIP 完成 Forge package，并核对新包内桌面辅助脚本与源码哈希一致，且包含 Windows SQLite、中文和英文 OCR 资源。Squirrel make 已生成 NUPKG，但在 Squirrel 调用归档工具时因系统错误“无效的系统 DLL 重定位”失败，没有生成新的 Setup.exe。**这不等同于已验证 Daybyday 正式安装版**：正式安装版中键盘输入法、中文 IME、焦点切换和退出清理仍需在新安装包生成后验证。

### Desktop Widget 绑定诊断补充

独立 WinForms 探针与 Daybyday 使用的目标都是 Explorer 的 `Progman`，但窗口并不相同：探针由 WinForms 自己创建并在其 UI 线程中控制；Daybyday 通过另一个 PowerShell/C# P/Invoke 辅助进程操作 Electron 的 HWND。旧实现只检查 `GetParent`，且 Electron 窗口在隐藏状态下先绑定、随后再调用 `show()`；这不足以证明完整 Electron 窗口确实位于桌面层。该差异和时序是已确认的实现缺陷，但由于当前环境的完整打包程序在创建窗口前以 `0x80000003` 退出，尚不能证明它们是用户所见故障的唯一原因。

新版辅助脚本会记录 Electron HWND、所有者 PID、绑定前后父窗口、`GetAncestor`、Explorer 进程/窗口类、`SetParent` 返回值及 Win32 错误码、窗口样式、可见状态、原生矩形、窗口/宿主线程 ID 与 DPI 信息。主窗口先以不可见样式显示并等待 HWND 稳定，再附着；只有完整核验通过才报告“桌面绑定已验证”。诊断日志在 `%APPDATA%\DayByDay\desktop-widget-diagnostics.jsonl`，只包含版本、程序/辅助程序路径、窗口与宿主句柄、系统 API 结果和错误信息，不记录课程、待办或截图；文件限制在 256 KiB。新版打包目录为 `out/Daybyday-win32-x64/Daybyday.exe`，版本 1.0.0，辅助脚本与源码 SHA-256 一致。**当前 Electron 运行环境仍在启动窗口前退出，所以完整 Daybyday 的桌面层级、输入、拖动、Win+D、Chrome 覆盖及 Explorer 重启均未验证；桌面便签功能不得标记为已完成。**本次没有重试 Squirrel `make`，先保留其独立故障记录。

本次已将 Forge 输出切换到独立的 `.release-out/`，避免重用时清理被占用的 `out/`。应用目录打包与 `.nupkg` 生成成功，但 Squirrel 在 `CreateZipFromDirectory` 启动 `electron-winstaller@5.4.4` 随附的 `7z-x64.exe` 时返回 Windows `ERROR_ILLEGAL_SYSTEM_DLL_RELOCATION`（623 / `0x26F`）。单独运行该 7-Zip 程序的帮助命令也复现同一错误，因此当前阻塞点是此 Windows 环境无法启动该归档辅助程序，不是 NuGet 权限；没有生成新的 Setup.exe，也没有修改系统权限或关闭安全功能。下一步优先在 GitHub Actions 的干净 Windows Runner 上构建。

### macOS 构建与平台边界（Phase 6.1D）

Forge 保留现有 Windows Squirrel 配置，并增加 macOS ZIP 与原生 DMG maker。DMG 用 macOS 系统自带 `ditto` 复制 App bundle，再由 `hdiutil` 创建压缩镜像，包含 `/Applications` 拖放快捷方式；不使用第三方 DMG/ICNS 解析器。DMG 必须在 macOS runner 上构建；`.github/workflows/build.yml` 配置 Windows x64、macOS Intel x64 和 Apple Silicon arm64 runner，运行依赖安装、lint、TypeScript、自动化测试、Electron 原生模块重建和安装包构建，产物保存为 Actions Artifacts，不会创建 Release 或上传用户数据。仓库 `origin` 已配置，但本次环境无法连接 GitHub，因此工作流尚未实际运行。

在匹配目标架构的 Mac 上可运行：

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run rebuild:native
npm run prepare:sqlite -- --platform=darwin --arch=arm64
npm run make -- --platform=darwin --arch=arm64
```

Intel Mac 将最后两条命令中的 `arm64` 改为 `x64`。`npm run make` 会再次为当前主机架构准备 SQLite 资源；本地构建应在与目标架构匹配的 Mac 上执行。macOS 打包使用 `resources/icon.icns`，SQLite 从已重建的 `better-sqlite3` 生成单架构资源，不会把 Windows `.node` 二进制放进 Mac 应用。Windows Squirrel 包继续使用 `resources/icon.ico` 和 Windows x64 SQLite。应用安装与用户数据目录分离，保留现有 `productName: DayByDay` 和 Windows `%APPDATA%\DayByDay` 标识；macOS 用户数据由 Electron 放在其系统 userData 目录（默认通常为 `~/Library/Application Support/DayByDay`）。没有配置 Apple Developer 签名或公证，DMG 将是未签名测试包，首次打开可能需要用户在 macOS 隐私与安全设置中明确允许；公开分发前需要 Developer ID 签名和 notarization。

macOS 菜单栏托盘使用 Template PNG，以支持浅色和深色菜单栏；系统应用菜单提供 About、Hide、Services、Window 和 Quit 等原生角色。Floating Window 与 Always on Top 由 Electron BrowserWindow 支持。**Desktop Widget 在 macOS 不可用**：Electron 的 macOS `desktop` 窗口类型不接收鼠标和键盘事件，不能满足可交互便签需求；当前会明确显示不支持并回退到普通窗口，不会伪装成取消置顶。实现可交互桌面层需要额外的原生 AppKit 窗口桥接和跨 macOS 版本验收，本阶段未加入。开机登录项在未签名/公证的测试版中关闭；Electron 官方说明 macOS 登录项在未签名且未公证时可能静默失败，因此待正式签名构建后再验证开放。

当前 Windows 本机用缓存 Electron ZIP 成功完成 Forge package，并确认包内包含 `win32-x64.node` 与 Windows 托盘/桌面资源；Squirrel maker 由于随包 `7z-x64.exe` 在本环境报系统 DLL 重定位错误，没有生成新的 Setup.exe。Mac 无法在这台 Windows 电脑上运行，DMG、Mac SQLite Electron 加载、Dock、菜单栏、Retina、多显示器、Mac 安装/卸载和签名公证均**尚未验证**。GitHub Actions 尚未运行；当前 `git ls-remote` 也无法连接 GitHub，远程分支状态因此未核实。此前记录的 Electron 44.9.0 在本机 Windows 11 build 26200 启动前崩溃问题仍然存在。

## 手机教务课表结构预览（Phase 5.2 当前完成范围）

在 **Semester Planner → Import timetable → Mobile Timetable** 选择手机课表截图，然后点击 **Recognize**。此模式先用 OCR 坐标寻找教学周、星期表头和左侧节次编号，再在表格网格内检测彩色矩形区域，并将矩形内已有 OCR 文字按坐标关联。图像检测会先缩小到最长边不超过 900 像素，避免对高分辨率截图同步扫描全部像素。图片仅在本机页面和本地 OCR Worker 中处理。

此阶段只输出结构预览，不写入课程数据库。识别到“第 8 周”只表示截图当前显示第 8 周，不会据此推断全学期每周规则；缺少学校作息模板时只保留节次，不生成钟点。左右缺列、星期/节次不清楚、色块文字断行或色块边界相连时会显示警告，需人工核对。

手机课表真实回归测试目录为 `tests/fixtures/mobile-timetable/`。当前目录包含用户提供的预期答案结构和测试说明，但还没有真实截图；测试使用代码生成的合成图片，只验证 8 个预期矩形区域的网格定位、周次以及星期/节次映射，不衡量真实 OCR 名称、教师或教室准确率。将脱敏后的真实截图放入该目录后，才能评估你学校的实际布局。

普通 **Import from image** 仍保留第五阶段原有的基于文字坐标分组流程；本次没有移除它，也没有宣称其课程文字识别准确率已提升。手机模式的逐块 OCR、教师/教室字段解析、网格手动校准、单周/整学期导入范围确认及完整校对窗口属于后续步骤，当前不得直接导入正式课程。

## 本地数据库与备份

SQLite 文件位于 Electron 的 `app.getPath('userData')` 目录。Windows 上通常为：

```text
%APPDATA%\DayByDay\daybyday.sqlite
```

数据库迁移版本 2 在原有 `tasks` 和 `events` 表上新增 `semesters`、`courses`、`course_custom_weeks` 和 `course_exceptions`；版本 3 新增 `class_period_times` 学校节次模板表；版本 4 只新增 `import_batches` 和 `import_batch_items` 导入历史关联表，不会重建或清空原有待办、临时日程、课程或例外。课程实例不会复制进 `events` 表。版本 4 迁移是增量迁移；如果数据库版本不受支持或迁移失败，程序会提示错误并保留数据库文件。

### 备份与恢复（Phase 6B）

在 **Settings → Data → Backup Data** 选择保存位置，会生成 `Daybyday-backup-YYYY-MM-DD.ddb`。备份使用 SQLite 在线备份接口生成一致快照，因此应用运行期间也能安全备份；文件包含完整 SQLite 数据库（待办、临时日程、学期、课程、调课例外、学校节次模板和导入记录）以及 `window-state.json` 中的主题、语言、字号、窗口和桌面偏好。文件带有格式版本、应用版本、创建时间、数据库版本、记录数量和 SHA-256 校验值。该 `.ddb` 是 Daybyday 的本地备份格式，不是压缩包；不会包含原始课程表截图。

恢复时打开 **Settings → Data → Restore Data**，选择 `.ddb` 文件。应用会先检查文件校验、SQLite 完整性、外键及版本兼容性，再显示备份时间和记录数量供确认。确认后会先在 `%APPDATA%\DayByDay\recovery` 自动备份当前数据，再恢复数据库和偏好设置。恢复成功后页面会重新读取数据；如果切换或检查失败，程序会回滚。若在恢复期间应用异常退出，下次启动会先尝试恢复原数据库。建议把手动备份另存到外接硬盘或其他安全位置；应用不会上传备份。

不要通过删除 `%APPDATA%\DayByDay` 来排查问题，也不要在应用运行时手工替换 `daybyday.sqlite`。遇到数据库版本、权限、磁盘空间或完整性错误时，程序会保留原文件并提示问题。

## Windows 安装包（Phase 6C / 当前构建状态）

Windows x64 安装包目标仍是 Electron Forge + Squirrel.Windows，版本 **1.0.0**，品牌 **Daybyday**。历史检查点曾生成过未签名的测试 Setup.exe；但当前项目输出目录中没有可交付的 Setup.exe，不能把旧记录当成本次生成结果。

本次最新打包的应用目录位于 `.release-out\Daybyday-win32-x64\`，并包含 Windows x64 SQLite、桌面辅助脚本和本地 OCR 资源。Squirrel 只生成 `.release-out\make\squirrel.windows\x64\daybyday.1.0.0.nupkg`，随后因随包 `7z-x64.exe` 不能在当前 Windows 环境启动而失败；因此**目前没有可安装的 Windows Setup.exe**。需要在 GitHub Actions Windows Runner 上重试 Squirrel 安装器生成。安装包生成后仍需单独验证安装和应用启动，不能把构建通过当成桌面验收通过。

安装文件与用户数据库目录分离：Squirrel 安装文件在 `%LOCALAPPDATA%\daybyday`，用户数据库和偏好仍在 `%APPDATA%\DayByDay`。卸载不会主动清理用户数据。发行包目前没有代码签名，Windows 可能显示 SmartScreen 提示；没有伪造签名。

## 检查

在项目目录运行：

```powershell
npm run typecheck
npm run lint
npm test
npm run make -- --platform=win32 --arch=x64
```

自动化测试由跨平台 Node 脚本运行，对系统临时目录中的独立数据库执行并清理；不会访问正式用户数据库。`npm run package` 只生成打包目录；`npm run make -- --platform=win32 --arch=x64` 才会生成 Windows 安装器。打包脚本按平台/架构将 SQLite 原生文件暂存到忽略的 `.package-temp/platform-resources/`，不修改源目录资源或 SQLite 用户数据库。CI 会使用 `@electron/rebuild` 针对当前 Electron 版本重建原生模块，然后在 Electron Node runtime 中执行 SQLite 内存数据库冒烟检查。

若打包时在 `Copying files` 步骤出现网络 `fetch failed`，而项目 `.electron-cache` 内已有匹配版本的 Electron ZIP，可在当前 PowerShell 窗口指定本地 ZIP 目录后重试：

```powershell
$env:DAYBYDAY_ELECTRON_ZIP_DIR = (Resolve-Path .\.electron-cache).Path
npm run make -- --platform=win32 --arch=x64
```

该环境变量只影响当前 PowerShell 窗口，不会修改系统设置。若普通 `out/` 被 Windows 占用，可改用项目已支持的隔离输出目录：

```powershell
$env:DAYBYDAY_OUT_DIR = '.release-out'
npm run make -- --platform=win32 --arch=x64
```

此设置也只影响当前 PowerShell 窗口。当前机器的 Squirrel helper 启动错误仍需通过干净的 Windows Runner 构建解决；GitHub Actions 仅保存 Artifacts，不创建 Release。

## 安全设计

Electron 窗口使用 `contextIsolation: true`、`nodeIntegration: false` 和渲染进程沙箱。React 通过 preload 中逐项列出的 API 请求主进程访问数据库；主进程会再次检查 IPC 来源和参数，页面不能运行 SQL。

SQLite 使用随目标平台/架构构建的 `better-sqlite3` 原生模块。Vite 将原生模块留在主进程包外，避免从生成目录寻找 `.node` 文件。课程截图通过本地 Tesseract.js 和受限白名单资源协议处理；没有云端 OCR、云同步或账号系统。
