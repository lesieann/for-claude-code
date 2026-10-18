@echo off
chcp 65001 >nul
cd /d "%~dp0"
python -c "import sys" >/dev/null 2>nul
if errorlevel 1 (
  echo 找不到 Python，正在自動安裝……
  winget install -e --id Python.Python.3.12 --scope user --accept-source-agreements --accept-package-agreements
  echo.
  echo Python 裝好了。請關閉這個視窗，再雙擊一次「安裝.bat」。
  pause
  exit /b
)
echo 正在安裝需要的套件，第一次會花幾分鐘……
python -m pip install --upgrade -r requirements.txt
python -m playwright install chromium
echo.
echo 安裝完成！之後雙擊「開始.bat」就能使用。
pause
