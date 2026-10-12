' 小灰机看门狗 - 静默运行VBS包装
' 用wscript //B运行此脚本，完全不弹黑框
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' 静默运行PowerShell看门狗脚本
cmd = "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -NonInteractive -File ""D:\xiaohuiji\scripts\watchdog.ps1"""
WshShell.Run cmd, 0, False

Set WshShell = Nothing
Set fso = Nothing
