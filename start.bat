@echo off
rem ===================================================================
rem  Monet Reader launcher  (see README.md)
rem
rem  IMPORTANT: keep this file pure ASCII.
rem  cmd.exe parses .bat files using the system ANSI codepage (GBK on
rem  Chinese Windows).  A UTF-8 Chinese string here gets mis-decoded into
rem  garbage and the script dies before Python even starts.
rem  All Chinese messages are printed by server.py instead, which writes
rem  to the Windows console correctly.
rem ===================================================================
cd /d "%~dp0"

python -c "import sys; assert sys.version_info >= (3,7)" 2>nul
if errorlevel 1 goto NOPYTHON

python "%~dp0server.py"
echo.
pause
exit /b 0

:NOPYTHON
echo.
echo   [!] Python 3 not found on this computer.
echo.
echo       Please install it first, then double-click this file again:
echo         https://www.python.org/downloads/
echo.
echo       During installation, remember to check:
echo         [x] Add python.exe to PATH
echo       (or run:  winget install -e --id Python.Python.3.12 )
echo.
pause
exit /b 1
