@echo off
setlocal EnableDelayedExpansion

:: ============================================================================
:: HomePiNAS Image Builder - Launcher
:: Professional Windows Application
:: ============================================================================

:: Set UTF-8 encoding
chcp 65001 >nul 2>&1

:: Window configuration
title HomePiNAS Image Builder v2.0
color 0B

:: Check for admin rights and auto-elevate if needed
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo   Solicitando permisos de Administrador...
    echo.

    :: Create VBS script for elevation
    set "vbsFile=%temp%\elevate_%random%.vbs"

    echo Set UAC = CreateObject^("Shell.Application"^) > "!vbsFile!"
    echo UAC.ShellExecute "%~f0", "", "%~dp0", "runas", 1 >> "!vbsFile!"

    :: Execute elevation
    cscript //nologo "!vbsFile!"

    :: Cleanup
    del "!vbsFile!" >nul 2>&1
    exit /b 0
)

:: We have admin rights, continue
cd /d "%~dp0"

:: Clear screen and show minimal banner while GUI loads
cls
echo.
echo   Iniciando HomePiNAS Image Builder...
echo.

:: Launch the PowerShell GUI application
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0HomePiNAS-ImageBuilder.ps1" %*

exit /b %errorlevel%
