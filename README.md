# DayByDay

DayByDay 是一款 Windows 桌面日程助手。当前版本包含可拖动、可缩放的柔和风格悬浮窗，以及本地保存的每日待办和单次临时日程。

## 启动应用

请在 Windows PowerShell 中打开项目文件夹 `D:\DAYBYDAY`，然后运行：

```powershell
npm start
```

第一次启动前如果项目依赖尚未安装，在该文件夹运行 `npm install`。应用会在本地打开 Electron 窗口，不需要账号或云端服务。

## 当前功能

- 用日期两侧的箭头、Today 按钮或日期选择器切换日期。
- 在 Schedule 中新增、编辑和删除单次日程，支持全天、时间、地点和备注。
- 在 My to-do list 中快速添加待办，也可以编辑标题、日期和备注，完成、恢复、删除及调整顺序。
- 删除操作会先显示确认提示；增删改会自动保存。
- 课程表、截图识别和重复日程尚未加入。

## 本地数据

SQLite 文件名为 `daybyday.sqlite`，存放在 Electron 的 `app.getPath('userData')` 应用专属目录中。在 Windows 上通常是：

```text
%APPDATA%\DayByDay\daybyday.sqlite
```

窗口的位置和大小仍保存在同一应用数据目录下的 `window-state.json`。这两项都不写入项目源代码目录。迁移只升级数据库结构；遇到不支持的数据库版本时会报错，不会清空数据库。

需要备份时，先关闭应用，再复制整个 `%APPDATA%\DayByDay` 文件夹到安全位置。不要删除该目录来排查问题。

## 开发检查

在项目目录运行：

```powershell
npm run typecheck
npm run lint
npm test
```

`npm test` 使用 Node 自带的测试运行器，对临时测试数据库检查待办和日程的增删改查、日期隔离、排序、校验及迁移保护；测试文件写入系统临时目录并在测试后清理。`npm run package` 用于生成本地打包目录；Windows 安装程序制作计划在后续阶段验证。

## 安全设计

Electron 窗口保持 `contextIsolation: true`、`nodeIntegration: false` 和渲染进程沙箱。React 通过 preload 里逐项列出的 API 请求主进程读写数据库；主进程会再次检查来源和输入，页面不接触 SQLite 或任意 SQL。

SQLite 使用 `better-sqlite3` 随包提供的 Windows x64 N-API 预编译模块。当前 Forge 配置跳过对该模块的源码重建；切换到没有对应预编译文件的平台或架构时，需要重新评估 Electron 兼容性和原生构建工具。
