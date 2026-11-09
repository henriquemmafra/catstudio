@echo off
REM CatStudio - inicia o servidor local e abre o navegador em http://127.0.0.1:8765
REM Opcoes: CatStudio.bat --open "C:\pasta\do\exame"   |   --port 9000   |   --no-browser
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe call instalar.bat
.venv\Scripts\python.exe -m catstudio %*
if errorlevel 1 pause
