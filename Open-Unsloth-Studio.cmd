@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0v2\experiments\retrieval-lora\open-studio.ps1"
if errorlevel 1 pause
