' Hidden launcher for Xiaohuiji 3791 QA admin watchdog. No console window.
' Called by Scheduled Task XiaohuijiAdminWatchdog via wscript //B //Nologo.
' Keep this file ASCII-only: wscript decodes VBS as ANSI/GBK.
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""D:\xiaohuiji\scripts\watchdog-3791.ps1""", 0, False
