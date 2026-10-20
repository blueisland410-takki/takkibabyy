# DayByDay 项目协作约定

## 面向用户

- 用户没有编程基础。用中文说明计划、修改内容、命令的作用和验证结果；第一次出现的技术词要用简单语言解释。
- 不让用户只拿到代码片段；修改应直接落在本项目文件中。
- 每阶段尽量只做当前阶段要求的小改动。

## 工作流程

- 每次修改后执行与改动相称的验证，并说明检查方式和结果。阶段目标要求运行应用时，要实际启动并确认窗口可用。
- 遇到命令失败时，先阅读错误并找出原因，再决定下一步；不要反复盲目安装。
- 使用 Windows 原生 PowerShell 和 Node.js，不使用 WSL。
- 不要擅自升级全局工具、修改 Windows 系统设置或覆盖用户已有配置。

## 数据保护

- 课程表、临时日程、待办、数据库、导入截图及其他用户文件都视为用户数据。
- 未经用户明确要求，不得删除、清空或覆盖用户数据，也不得用重置数据库的方式解决问题。
- 涉及可能影响数据的操作前，先检查目标路径并保留现有内容；无法安全保留时先说明原因。
- SQLite 正式数据位于 Electron `userData` 目录；开发和测试只可使用独立临时数据库，不得把应用数据库纳入 Git、测试清理或重置流程。
- 数据库结构升级使用有版本号的迁移；发现未知的新版本或初始化失败时保留原文件并显示错误，不得静默新建空库覆盖旧文件。
- 只有明确标注为测试创建的系统临时目录可以在对应测试结束时清理；运行前先检查测试目标路径。

## 项目架构和范围

- 桌面框架使用 Electron Forge；优先使用 Vite；界面使用 React + TypeScript。
- Electron 窗口保持 contextIsolation: true、nodeIntegration: false。需要系统能力时，通过预加载脚本里的 contextBridge 提供范围明确的接口；主进程 IPC 必须逐项允许并校验参数。
- 正式数据使用 Electron `userData` 中的本地 SQLite；测试数据库只能位于独立测试目录。
- 课程截图识别使用离线 Tesseract.js、表格解析、预览和人工确认。手机截图解析先定位星期/节次网格和彩色区域，未进入逐块 OCR 与校对导入步骤前，不得把结构预览写入正式课程。
- 遵循用户当前指定的阶段，不提前构建完整日程、课程表或待办功能。

## 每阶段验证

- 修改前先检查 Git 状态、现有文件和本阶段相关代码；在已有项目上小步迭代。
- 有 Git 仓库时，数据层或窗口等重要阶段先创建可回退检查点；只有在用户要求时创建正式提交。
- 每次修改后运行对应的类型检查、lint 和自动化测试；需要实际运行桌面程序时要区分自动验证和用户手动操作，不得把未测项目说成已通过。
- 数据写入失败时保留用户输入并显示可以重试的错误；每个增删改操作默认自动保存。

## 项目开发进度

- 第一阶段：Electron Forge + Vite + React + TypeScript 项目与基础窗口。
- 第二阶段：无标题栏悬浮窗、拖动/缩放、窗口状态恢复和 Notion × 韩系界面。
- 第三阶段：每日待办、临时日程及 SQLite 版本 1 数据库。
- 第四阶段：学期、重复课程、单次停课/调课、每日/周视图。SQLite 版本 2 通过增量迁移添加学期课程表；不得重建或清空版本 1 的 `tasks` 与 `events`。
- 第五阶段：课表截图导入。Tesseract.js 在本地 Worker 中使用随项目/应用提供的 `eng` 与 `chi_sim` OCR 核心和语言数据；截图仅由用户选择并保留在当前页面内存，不上传、不写入数据库。识别文字、文字框坐标和置信度先进入独立预览模型；只有用户逐项校对并最终确认后，才通过主进程白名单 IPC 和 SQLite 单一事务导入课程。
- 第五阶段修复升级检查点 A：新增 ICS、XLSX、CSV 的本地文件解析，并统一转换成课程/单次日程草稿。格式解析、预览校验、白名单 IPC 和 SQLite 事务相互分离。ICS 周重复、EXDATE、RECURRENCE-ID、VEVENT 来源 UID、时区提醒、全天事件均进入可校对流程；不规则重复展开为日期明确的日程。Excel/CSV 支持中英文别名、工作表/表头/列映射、空白模板下载及 UTF-8/GB18030 CSV 选择。用户最终确认前不得写入。不得执行 Excel 公式或宏。
- Phase 5.2 第一、二步：新安装窗口默认 440 × 680，已有窗口 bounds 不覆盖；全应用字号通过 CSS 变量写入用户数据目录的窗口设置。Phase 6.1 检查点 A 将设置范围更新为 80%–130%、5% 步长的即时滑块；旧版 150% 保存值迁移至上限 130%，旧 100/115/125% 档位保留。图片导入页扩宽至可用显示区域；今日/周视图、学期管理、表单、导入与弹窗共享字体变量，课程标题可换行，内容超出时滚动。
- Phase 5.2 手机课表结构检测：新增 `Mobile Timetable` 模式和独立 `mobileTimetableParser.ts`。按 OCR 坐标找明确的“第 N 周”、星期列与 01–24 节次，再在网格 ROI 中做低饱和度颜色组件检测，并按位置分配星期/节次；图片区先缩小到最长边 900px。重复同名不同时间的色块各自保留。它当前只显示结构预览，不能导入课程，也不生成钟点或学期重复规则。
- Daybyday 品牌与主题偏好：应用内可见品牌标题为 `Daybyday`（不含句点），Electron 标题与 HTML 文档标题一致；九套主题通过统一 CSS Design Tokens 覆盖页面、导航、卡片、输入焦点、日期状态、勾选框和强调按钮。主题、字号比例与语言共同保存在 `userData/window-state.json`，主进程校验并写入，preload 只提供受限偏好读取/保存接口；不修改 SQLite、课程或日程数据。旧设置的语言字段缺失时兼容为简体中文；应用首屏绘制前同步读取设置，避免主题或语言闪回。
- Phase 5.3 Appearance & Language：Settings 提供 6 套 Soft & Muted 与 3 套 Pop & Playful 主题，以及简体中文、繁體中文、日本語、한국어、English。翻译资源位于 `locales/`，界面系统文字、日期/星期格式跟随应用语言；用户输入及导入原文不得翻译，应用语言不改变 OCR 语言。主进程白名单 IPC 保存主题和语言并广播偏好变化；字号及窗口设置保持独立兼容，不迁移或改写业务数据库。缺少专属翻译的底层错误在简体中文保留原文，其他语言显示通用重试提示；新增系统消息时需补齐各语言资源并更新国际化测试。
- Phase 5.2 测试边界：合成测试基准含 8 个有正确答案的色块，可验证色块数量/星期/节次为 8/8；不代表真实截图表现。用户提供的 `tests/fixtures/mobile-timetable/` 真实图片尚不存在。课程名称、教师/地点和真实手机课表检测率尚未评估，不能宣称准确率改善；收到脱敏截图后再做实际回归。
- 检查点 A 数据迁移为 SQLite 版本 4，只追加导入批次与导入项目表；不得重建旧的 tasks、events、semesters、courses 或例外数据。批次撤销只删除导入后未被修改的新增项目。
- 检查点 A 的格式支持边界：PDF/DOCX 留待检查点 C；截图 OCR 网格识别与人工校准留待检查点 B。本阶段不得把原有截图解析算法描述成已修复或准确率提升。
- SQLite 版本 3 只新增 `class_period_times` 学校节次模板表，保留版本 1 和 2 的任务、日程、学期、课程及课程例外。课表导入使用现有课程重复规则，不将学期课程复制进 `events`。
- 课表解析只对明确星期列和坐标分组生成候选课程；无法确认的字段必须留空并标注待确认。没有用户设置的节次模板时，不得猜测节次时间。冲突提示不阻止导入；完全重复的课程默认跳过，导入事务失败须整批回滚。
- 所有导入格式必须共享 `NormalizedImportDraft` 预览模型；原始文件数据只用于当前进程内解析，不得默认持久化原始截图或文档。来源类型、来源记录 ID 和内容指纹应用于重复检查与错误排查。
- ICS 的 UTC/TZID/浮动时间处理必须显示时区校对信息。每周课程不应因本机时区不同而静默移动课程钟点；无法无损转换的复杂重复应保留为明确日期的日程，并让用户选择分类。
- 当前 OCR 资源包括本地 Worker、通用 LSTM WASM 核心、中文简体和英文语言包，约 8.3 MiB；Forge 打包时须将 OCR 资源复制到应用 `resources/ocr`，并将 Windows x64 SQLite 运行文件复制到 `resources/better-sqlite3`。没有打包韩文模型。复杂表格、低清图片和 OCR 含糊的周次必须让用户人工校对，不得宣传未经验证的准确率。
- 当前架构仍使用 Electron 主进程、白名单 IPC 和安全 preload；课程规则与日期例外分开保存，课程实例按查询日期范围展开，不复制至 `events`。
- 当前阶段自动化测试使用独立临时数据库。打包或 Electron 桌面交互如受运行环境限制，必须在交付说明中标出未验证项，不得将其写成通过。
- 合成课表图片与 OCR 测试必须独立于用户隐私图片。断网打包应用的完整 UI OCR 流程仍需在 Windows 安装包中人工复核；自动化离线测试使用本地 Tesseract.js、WASM 与合成 PNG。
- 未规划云同步和账号系统；不要在用户未要求时加入。
- Phase 6A Windows 桌面集成：主窗口使用单实例锁；托盘实例只创建一次，菜单支持五种应用语言并在语言切换后刷新。托盘 IPC 仅传递固定的待办/Week/Settings 动作；SQLite 仍只由主进程访问。`closeToTray` 与启动偏好向后兼容地保存在 `userData/window-state.json`，旧文件字段缺失时按关闭处理；默认不开机启动。
- Windows 登录启动只在已打包并能找到 Squirrel 稳定启动器时开放。必须使用 Electron `app.setLoginItemSettings`，路径指向版本目录上一层的启动器；开发版不得注册启动项。只有安装版实际测试完成后才能宣称开机启动已验证；Phase 6C 已测试安装/卸载，但由于 Electron 运行时崩溃，启动项 GUI、升级和 Windows 重启验证仍未完成。
- Phase 6A 增加的 `resources/daybyday-tray.ico` 必须通过 Forge `extraResource` 同时进入打包资源；窗口标题与托盘可见品牌是 `Daybyday`。保留现有 `package.json` `productName`、AppUserModelID（当前未设置）和 `%APPDATA%\DayByDay` 数据目录标识，不能因品牌大小写改动触发新用户数据目录。
- Phase 6A 运行阻塞记录：Windows build 26200 上 Electron 44.9.0 的独立 `electron --version` 触发 `EXCEPTION_BREAKPOINT` / `0x80000003`，`npm start` 和打包 exe 均未显示窗口。该崩溃发生在应用主进程脚本运行前；不得据此声称托盘/窗口 GUI 已验证，也不要为绕过它而关闭安全设置。该环境问题继续阻止后续阶段的真实 Electron UI 验证，必须在交付中标出；类型检查、单元测试和打包不能替代 GUI 验收。
- Phase 6B 本地备份与恢复：主进程调用 `better-sqlite3` 在线备份生成数据库一致快照，将快照和 `userData/window-state.json` 偏好打包为带格式版本、应用/数据库版本、记录数及 SHA-256 校验的 `.ddb` 文件；不直接复制活动 SQLite 主文件，不默认包含课表截图。Restore 先验证格式、偏好、数据库完整性、外键与版本，再由用户确认；执行前在 `userData/recovery/` 创建当前数据安全备份，使用受限的用户选择文件对话框、恢复日志和 SQLite 文件束交换，失败或异常退出时尝试回滚。Renderer 只能调用无路径参数的明确 preload API，不能读写任意文件或 SQL。自动化测试只使用独立临时目录，并覆盖 WAL 在线备份、内容校验、数据保留与现有数据库迁移；正式 Windows GUI 文件对话框及人工恢复流程仍须在 Electron runtime 可启动的环境中验证。
- Phase 6C Windows x64 发布：复用 Electron Forge + Squirrel.Windows，产品安装器名为 `Daybyday-1.0.0-Setup.exe`，应用二进制名为 `Daybyday.exe`；设置 Squirrel 标题、ICO 和版本，保留 `package.json` 的 `productName: DayByDay` 以稳定现有 `%APPDATA%\DayByDay` 数据路径。安装包应包含 ASAR、SQLite Windows x64 N-API 模块、托盘图标和本地 OCR Worker/WASM/chi_sim/eng 资源；不得要求全局 Node/npm，不开启自动更新，不伪造签名。当前生成的是未签名本机测试安装器，发布者身份沿用既有 `author: lan` 元数据，不添加虚构身份。
- Phase 6C 实际验证边界：在本机成功运行 `npm run make -- --platform=win32 --arch=x64`，产物位于 `out/make/squirrel.windows/x64/`；检查 NUPKG 内容、资源和版本元数据；Squirrel 静默安装与 `Update.exe --uninstall` 均完成，测试后只清理本次安装残余。Electron 44.9.0 在 Windows build 26200 上仍于启动前触发 `EXCEPTION_BREAKPOINT` / `0x80000003`，因此安装后的 GUI、开始菜单入口、应用数据操作、OCR UI、托盘/开机启动、升级、缩放、多显示器和真实备份恢复均未通过验收。不要将 Forge 构建或安装器执行成功说成应用启动通过。
- Phase 6C 数据与发布：安装目录和 `%APPDATA%\DayByDay` 用户数据目录分离。测试安装前确认本机无 `daybyday` 安装目录，卸载记录已移除；测试后清理其残余安装目录和构建时新增的临时 NuGet 配置，不清理正式用户数据。无签名证书时必须标记安装包为未签名并说明公开分发会产生 SmartScreen 警告；不得发布到外部位置，除非用户明确要求。
- Phase 6.1 检查点 A：应用图标主资源是 `resources/icon.svg`，导出 PNG/ICO/ICNS 与托盘 ICO 的脚本是 `scripts/render-app-icon.ps1`；Forge Windows app/setup icon 指向 `resources/icon.ico`，tray ICO 由同一视觉生成。Settings 字号是 80%–130%、步长 5% 的全局即时滑块，默认 100%，自动保存；旧窗口设置与备份中超过 130% 的数字会被规范化至 130%，非数字异常值回退 100%。类型检查、lint、69 项自动化测试、Forge package 和 Squirrel make 均通过；从 `Daybyday.exe` 和新 Setup.exe 提取检查了 32×32 嵌入图标。当前 `npm start` 未显示窗口且没有遗留 Electron 进程，因而真实滑块交互、应用重启后的 UI 状态仍未通过手动验收。`icon.icns` 只是资源，未代表 macOS 打包已完成；Desktop Widget、macOS 兼容性与 CI 属于后续检查点。
