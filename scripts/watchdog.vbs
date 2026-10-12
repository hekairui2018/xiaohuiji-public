' 小灰机3789端口看门狗 - 纯VBS版本（完全不用PowerShell，轻量不卡）
' 用法：wscript //B //Nologo watchdog.vbs
Option Explicit

Dim WshShell, fso, port, projectRoot, logFile, outLog, errLog
port = "3789"
projectRoot = "D:\xiaohuiji"
logFile = projectRoot & "\tmp\watchdog.log"
outLog = projectRoot & "\tmp\server-3789-out.log"
errLog = projectRoot & "\tmp\server-3789-err.log"

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' 检查3789端口是否在监听
Dim exec, output, isListening
isListening = False
Set exec = WshShell.Exec("netstat -ano -p TCP")
output = exec.StdOut.ReadAll()
If InStr(output, ":" & port & " ") > 0 And InStr(output, "LISTENING") > 0 Then
    ' 进一步确认是3789在LISTENING
    Dim lines, line, i
    lines = Split(output, vbCrLf)
    For i = 0 To UBound(lines)
        line = lines(i)
        If InStr(line, ":" & port & " ") > 0 And InStr(line, "LISTENING") > 0 Then
            isListening = True
            Exit For
        End If
    Next
End If

' 如果在监听，直接退出（不记录，避免日志刷屏）
If isListening Then
    WScript.Quit 0
End If

' 没在监听，记录日志并重启
Log "Port " & port & " not listening, restarting..."

' 杀掉可能残留的node进程（只杀3789相关的，通过端口找PID）
Dim pid, pidMatch
Set exec = WshShell.Exec("netstat -ano -p TCP")
output = exec.StdOut.ReadAll()
lines = Split(output, vbCrLf)
For i = 0 To UBound(lines)
    line = lines(i)
    If InStr(line, ":" & port & " ") > 0 Then
        ' 提取PID（最后一列）
        Dim parts, j
        parts = Split(Trim(line), " ")
        For j = UBound(parts) To 0 Step -1
            If parts(j) <> "" And IsNumeric(parts(j)) Then
                pid = parts(j)
                Exit For
            End If
        Next
        If pid <> "" Then
            WshShell.Run "taskkill /F /PID " & pid, 0, True
            Log "Killed residual PID=" & pid
        End If
    End If
Next

' 等待500ms
WScript.Sleep 500

' 启动node服务
Dim env
Set env = WshShell.Environment("PROCESS")
env("PORT") = port
WshShell.CurrentDirectory = projectRoot
WshShell.Run "node.exe backend\server.js", 0, False

' 等待3秒验证
WScript.Sleep 3000

' 验证是否启动成功
Set exec = WshShell.Exec("netstat -ano -p TCP")
output = exec.StdOut.ReadAll()
isListening = False
lines = Split(output, vbCrLf)
For i = 0 To UBound(lines)
    line = lines(i)
    If InStr(line, ":" & port & " ") > 0 And InStr(line, "LISTENING") > 0 Then
        isListening = True
        Exit For
    End If
Next

If isListening Then
    Log "Port " & port & " restarted successfully"
Else
    Log "Port " & port & " restart FAILED, check logs"
End If

Set WshShell = Nothing
Set fso = Nothing
WScript.Quit 0

' 写日志函数
Sub Log(msg)
    Dim ts, f
    ts = Year(Now) & "-" & Right("0" & Month(Now),2) & "-" & Right("0" & Day(Now),2) & " " & Right("0" & Hour(Now),2) & ":" & Right("0" & Minute(Now),2) & ":" & Right("0" & Second(Now),2)
    Set f = fso.OpenTextFile(logFile, 8, True)
    f.WriteLine ts & " " & msg
    f.Close
End Sub
