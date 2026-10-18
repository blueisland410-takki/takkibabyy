# DayByDay

DayByDay 是一款正在开发中的 Windows 桌面日程助手。当前阶段提供可拖动、可缩放的桌面小窗口和今日安排预览。

## 当前阶段

第二阶段在 Electron Forge + Vite + React + TypeScript 项目中实现了无边框桌面窗口、今日日期、示例日程和可勾选的示例待办。窗口位置、大小和置顶偏好保存到 Electron 用户数据目录；待办目前只在本次打开期间用于演示。

课程表截图识别、SQLite 正式数据保存、课程导入和云同步尚未实现。

## 启动应用

需要安装 Node.js 和 npm。开发时在 Windows PowerShell 中运行：

    Set-Location D:\DAYBYDAY
    npm start

应用窗口打开后，可以在终端按 Ctrl+C 停止开发服务器；也可以先关闭应用窗口，再回到终端停止。

如果项目依赖文件夹 node_modules 尚未安装或已被移除，先运行：

    Set-Location D:\DAYBYDAY
    npm install
    npm start

## 常用检查

检查 TypeScript 类型：

    npm run typecheck

检查代码格式和静态规则：

    npm run lint

## 项目文件

- src/main.ts：Electron 主进程，创建无边框窗口、管理窗口状态，并通过白名单 IPC 处理窗口控制。
- src/preload.ts：只向页面暴露置顶、最小化和关闭等必要操作。
- src/renderer.tsx、src/App.tsx：React 界面入口、日期、示例日程和待办展示。
- src/index.css：界面与窗口标题栏样式。
- forge.config.mts：Electron Forge 打包配置。
- vite.*.config.mts：主进程、预加载脚本和界面的 Vite 配置。

窗口设置位于 Electron 的用户数据目录，不写入项目源代码目录。本项目使用 Windows 原生环境开发，不使用 WSL。
