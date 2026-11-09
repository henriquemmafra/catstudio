@echo off
REM CatStudio - testes automatizados no Windows: dados sinteticos, nucleo do Slicer e navegador.
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe call instalar.bat
.venv\Scripts\python.exe -m pip install -e .[test] || ( pause & exit /b 1 )
.venv\Scripts\python.exe -m playwright install chromium
.venv\Scripts\python.exe tests\fixtures\make_fixtures.py
if not exist tests\.out mkdir tests\.out
.venv\Scripts\python.exe -m pytest -q tests --junitxml=tests\.out\resultado.xml
echo.
echo Resultado em tests\.out\resultado.xml (envie esse arquivo se algo falhar).
pause
