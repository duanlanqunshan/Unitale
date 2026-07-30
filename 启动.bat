@echo off
chcp 936 >nul
echo Starting Unitale AI Backend + Frontend...
echo.
set REPO_DIR=%~dp0
cd /d "%REPO_DIR%"

:: 默认音效下载目录（可在前端 UI 或此处自定义）
if not defined UNITALE_SFX_DIR (
    set "UNITALE_SFX_DIR=%USERPROFILE%\unitale_sfx"
)

echo [1/3] Starting backend (FastAPI + static) on port 8080 (SFX dir: %UNITALE_SFX_DIR%)...
start "Unitale Backend" /min python backend_main.py

echo [2/3] Waiting 3 seconds...
timeout /t 3 >nul

echo [3/3] Opening browser...
start "" "http://localhost:8080/index.html"

echo.
echo Done. Press any key to exit.
pause
