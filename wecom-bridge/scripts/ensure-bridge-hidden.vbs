' Hidden launcher for Xiaohuiji wecom-bridge watchdog. No console window.
' Called by Scheduled Task XiaohuijiWecomBridge via wscript //B //Nologo.
' Keep this file ASCII-only: wscript decodes VBS as ANSI/GBK.
Set shell = CreateObject("WScript.Shell")
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""D:\xiaohuiji\wecom-bridge\scripts\ensure-bridge.ps1""", 0, False
