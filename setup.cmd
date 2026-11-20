@echo off
rem Visual Style Builder setup on Windows: runs setup.ps1 (PowerShell) without changing the computer's script policy.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
pause
