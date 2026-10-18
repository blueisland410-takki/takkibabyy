# DayByDay

DayByDay 是一款 Windows 桌面日程助手。当前版本包含可拖动、可缩放的悬浮窗、本地每日待办和临时日程，以及按教学周重复计算的学期课程和周视图。

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

## 日视图与周视图

- 顶部 **Day** 展示选中日期的课程、临时日程和待办。
- 顶部 **Week** 展示周一至周日的日期与安排标记；点击日期后，下方显示当天详细安排。上一周、下一周和 Today 可快速切换。
- **Semester Planner** 管理学期及课程。
- 临时日程和课程按时间排列，全天临时日程放在最上方。待办仍按日期单独保存。

## 本地数据库与备份

SQLite 文件位于 Electron 的 `app.getPath('userData')` 目录。Windows 上通常为：

```text
%APPDATA%\DayByDay\daybyday.sqlite
```

数据库迁移版本 2 在原有 `tasks` 和 `events` 表上新增 `semesters`、`courses`、`course_custom_weeks` 和 `course_exceptions`，不会重建或清空待办与临时日程。课程实例不会复制进 `events` 表。

需要备份时，先关闭应用，再复制整个 `%APPDATA%\DayByDay` 文件夹到安全位置。不要删除该目录来排查问题；遇到数据库版本或初始化错误时，程序保留原文件并提示错误。

## 检查

在项目目录运行：

```powershell
npm run typecheck
npm run lint
npm test
npm run package
```

自动化测试对系统临时目录中的独立数据库执行，会在测试结束后清理；不会访问正式用户数据库。`npm run package` 生成打包目录；Windows 安装程序制作仍需单独验证。

## 安全设计

Electron 窗口使用 `contextIsolation: true`、`nodeIntegration: false` 和渲染进程沙箱。React 通过 preload 中逐项列出的 API 请求主进程访问数据库；主进程会再次检查 IPC 来源和参数，页面不能运行 SQL。

SQLite 使用 `better-sqlite3` 随包提供的 Windows x64 N-API 预编译模块。Vite 将原生模块留在主进程包外，避免从生成目录寻找 `.node` 文件。暂未实现课程截图 OCR、云同步或账号系统。
