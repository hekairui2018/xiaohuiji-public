# 注册瘦桥看门狗计划任务：登录自启 + 每 2 分钟巡检，当前用户、无提权、隐藏。
$ErrorActionPreference = "Stop"
$taskName = "XiaohuijiWecomBridge"
$bridgeDirectory = "D:\xiaohuiji\wecom-bridge"
$hiddenLauncher = Join-Path $bridgeDirectory "scripts\ensure-bridge-hidden.vbs"
$wscript = "$env:SystemRoot\System32\wscript.exe"
$currentUser = if ($env:USERDOMAIN) { "$env:USERDOMAIN\$env:USERNAME" } else { $env:USERNAME }

if (-not (Test-Path $hiddenLauncher)) { throw "launcher not found: $hiddenLauncher" }

$action = New-ScheduledTaskAction -Execute $wscript -Argument "//B //Nologo `"$hiddenLauncher`"" -WorkingDirectory $bridgeDirectory
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$periodicTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 2) -RepetitionDuration (New-TimeSpan -Days 3650)

$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden
$settings.Priority = 4
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($logonTrigger, $periodicTrigger) `
  -Settings $settings -Principal $principal `
  -Description "Xiaohuiji WeCom thin bridge watchdog (login autostart + 2min health check)." -Force | Out-Null

Start-ScheduledTask -TaskName $taskName
Write-Output "Installed and started scheduled task: $taskName"
