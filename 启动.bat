@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有找到 python，请先安装 Python 3 并加入 PATH。
  pause
  exit /b 1
)

echo.
echo   花息 · Blossom Breath
echo   地址: http://127.0.0.1:8848/
echo   关闭此窗口即可停止本地服务。
echo.

start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:8848/'"
python -m http.server 8848 --bind 127.0.0.1
