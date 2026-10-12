' Hidden launcher for Xiaohuiji 3789 watchdog. No console window.
' Called by Scheduled Task XiaohuijiWatchdog via wscript //B //Nologo.
' Keep this file ASCII-only: wscript decodes VBS as ANSI/GBK.
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""D:\xiaohuiji\scripts\watchdog.ps1""", 0, False
