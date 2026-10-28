@echo off
start "" /b "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0Web-Companion.ps1"
