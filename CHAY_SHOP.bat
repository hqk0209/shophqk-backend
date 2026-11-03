@echo off
title ShopHQK - May Chu Ban Hang 24/7
color 0A
chcp 65001 >nul
cls

echo ===================================================================
echo             SHOPHQK - HE THONG BAN HANG SO CHUYEN NGHIEP
echo ===================================================================
echo.

:: 1. Kiem tra Node.js co san trong PATH
where node >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [OK] Phat hien Node.js trong he thong!
    goto RUN_SERVER
)

:: 2. Kiem tra Node.js trong thu muc AppData Local Programs
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" (
    echo [OK] Phat hien Node.js tai Local Programs!
    set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"
    goto RUN_SERVER
)

:: 3. Kiem tra Node.js tai Program Files
if exist "C:\Program Files\nodejs\node.exe" (
    echo [OK] Phat hien Node.js tai Program Files!
    set "PATH=C:\Program Files\nodejs;%PATH%"
    goto RUN_SERVER
)

:: 4. Kiem tra VS Code Portable Node
if exist "%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe" (
    echo [OK] Khoi dong qua VS Code Engine...
    set "ELECTRON_RUN_AS_NODE=1"
    start http://localhost:3000
    "%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe" server.js
    pause
    exit /b
)

echo [CHUA CAI NODE.JS]
echo May tinh cua ban chua co Node.js.
echo Vui long tai va cai dat Node.js tai: https://nodejs.org/ (Phien ban LTS)
echo Sau khi cai dat xong, hay mo lai file CHAY_SHOP.bat nay!
echo.
pause
exit /b

:RUN_SERVER
echo [KHOI DONG] Dang khoi chay ShopHQK tai http://localhost:3000 ...
timeout /t 2 >nul
start http://localhost:3000
node server.js
pause
