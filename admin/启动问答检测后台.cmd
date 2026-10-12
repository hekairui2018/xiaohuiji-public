@echo off
chcp 65001 >nul
title 小灰机问答检测后台（只读）
cd /d %~dp0
echo 正在启动 小灰机问答检测后台 ...
echo 本机地址   : http://127.0.0.1:3791/
echo 同一内网同事可用本机局域网 IP 访问（启动日志里会打印）。
echo 启动后自动打开浏览器；关闭本窗口即停止后台。
echo.
"C:\Program Files\nodejs\node.exe" admin-server.cjs
echo.
echo 后台已停止，按任意键关闭。
pause >nul
