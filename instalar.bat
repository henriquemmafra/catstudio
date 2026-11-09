@echo off
REM CatStudio - instalacao no Windows: cria .venv e instala o nucleo do 3D Slicer (slicer-core) via pip.
setlocal
cd /d "%~dp0"
set "PYEXE="
for %%V in (3.12 3.13 3.11 3.10) do (
  if not defined PYEXE (
    py -%%V -c "import sys" >nul 2>nul && set "PYEXE=py -%%V"
  )
)
if not defined PYEXE (
  python -c "import sys; sys.exit(0 if (3,10) <= sys.version_info[:2] <= (3,13) else 1)" >nul 2>nul && set "PYEXE=python"
)
if not defined PYEXE (
  echo [CatStudio] Python 3.10 a 3.13 nao encontrado.
  echo Instale o Python 3.12 de https://www.python.org/downloads/windows/ e marque "Add python.exe to PATH".
  pause
  exit /b 1
)
echo [CatStudio] Usando %PYEXE%
if not exist .venv\Scripts\python.exe (
  %PYEXE% -m venv .venv || ( echo [CatStudio] Falha ao criar .venv & pause & exit /b 1 )
)
.venv\Scripts\python.exe -m pip install --upgrade pip
.venv\Scripts\python.exe -m pip install -e . || ( echo [CatStudio] Falha na instalacao. & pause & exit /b 1 )
echo.
echo [CatStudio] Instalado. Abra com CatStudio.bat
pause
