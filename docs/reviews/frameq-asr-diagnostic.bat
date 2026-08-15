@echo off
chcp 65001 >nul
setlocal
echo ============================================
echo   FrameQ ASR model download diagnostic
echo ============================================
echo.
echo Step 1: Make sure FrameQ is OPEN, then run this.
echo.

set "APP_DIR="

rem -- 1) locate the running FrameQ process
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "(Get-Process -Name FrameQ -ErrorAction SilentlyContinue | Select-Object -First 1).Path"`) do (
  if not defined APP_DIR (
    if exist "%%P" (
      for %%I in ("%%P") do set "APP_DIR=%%~dpI"
    )
  )
)

rem -- 2) fallback: common install locations
if not defined APP_DIR (
  for %%D in ("%LOCALAPPDATA%\Programs\FrameQ" "C:\Program Files\FrameQ" "C:\Program Files (x86)\FrameQ") do (
    if not defined APP_DIR (
      if exist "%%~D\resources\python\python.exe" set "APP_DIR=%%~D\"
    )
  )
)

if not defined APP_DIR (
  echo [ERROR] FrameQ install directory was not found.
  echo Please start FrameQ first, then double-click this script again.
  echo.
  pause
  exit /b 1
)

set "PY=%APP_DIR%resources\python\python.exe"
if not exist "%PY%" (
  echo [ERROR] Bundled Python was not found at:
  echo   %PY%
  echo The installation may be incomplete or blocked by security software.
  echo.
  pause
  exit /b 1
)

echo Found FrameQ at: %APP_DIR%
echo.
echo Running the ASR model download now. This can take a few minutes.
echo Please wait until this window shows the result.
echo.

set "PYTHONPATH=%APP_DIR%resources\worker"
set "PYTHONUTF8=1"
set "FRAMEQ_MODEL_DIR=%LOCALAPPDATA%\com.frameq.desktop\models"

"%PY%" -m frameq_worker --download-asr-model --asr-model iic/SenseVoiceSmall > "%USERPROFILE%\Desktop\frameq-out.txt" 2> "%USERPROFILE%\Desktop\frameq-err.txt"
set "EXITCODE=%ERRORLEVEL%"

echo.
echo ============================================
echo Done. Exit code: %EXITCODE%
echo ============================================
echo Results were saved to your Desktop:
echo   frameq-err.txt   (error details - THE IMPORTANT ONE)
echo   frameq-out.txt   (progress output)
echo.
echo Please send BOTH files back, especially frameq-err.txt.
echo.
pause
