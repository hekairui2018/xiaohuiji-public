@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0v2\experiments\retrieval-lora\open-xhj-fast-trial.ps1"
if errorlevel 1 pause
