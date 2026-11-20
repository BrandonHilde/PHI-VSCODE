@echo off
rem Builds the extension into a .vsix: phi-language-<version>.vsix, in this folder.
rem
rem   build.bat                  install what it needs, compile, run the tests, package
rem   build.bat --skip-tests     package without running the tests
rem   build.bat --install        and install the .vsix into VS Code (the code on PATH)
rem
rem It needs Node.js 18 or later (with npm). The tests read the PHI repository when it's at
rem %PHI_ROOT%, ..\..\Libraries\PHI or ..\PHI, and leave those parts out when it isn't.
setlocal
cd /d "%~dp0"

set tests=yes
set install=no
:options
if "%~1"=="" goto run
if "%~1"=="--skip-tests" (set tests=no) else if "%~1"=="--install" (set install=yes) else (
    echo build.bat: unknown option %~1 ^(--skip-tests, --install^) 1>&2
    exit /b 2
)
shift
goto options

:run
where npm >nul 2>nul
if errorlevel 1 (
    echo build.bat: npm isn't on PATH: install Node.js 18 or later ^(https://nodejs.org^) 1>&2
    exit /b 1
)

rem what package-lock.json says, exactly: only when it's changed since the last install
set needs=no
if not exist node_modules\.package-lock.json set needs=yes
if "%needs%"=="no" node -e "const fs=require('fs');process.exit(fs.statSync('package-lock.json').mtimeMs>fs.statSync('node_modules/.package-lock.json').mtimeMs?1:0)"
if errorlevel 1 set needs=yes
if "%needs%"=="yes" (
    call npm ci
    if errorlevel 1 exit /b 1
)

if "%tests%"=="yes" (
    call npm test
    if errorlevel 1 exit /b 1
)

for /f %%v in ('node -p "require('./package.json').version"') do set version=%%v
set vsix=phi-language-%version%.vsix
if exist "%vsix%" del "%vsix%"

rem compiles first (vscode:prepublish)
call npm run package
if errorlevel 1 exit /b 1
if not exist "%vsix%" (
    echo build.bat: %vsix% wasn't made 1>&2
    exit /b 1
)
echo.
echo built %cd%\%vsix%

if "%install%"=="yes" (
    where code >nul 2>nul
    if errorlevel 1 (
        echo build.bat: code isn't on PATH: install it by hand, code --install-extension %vsix% 1>&2
        exit /b 1
    )
    call code --install-extension "%vsix%" --force
    if errorlevel 1 exit /b 1
) else (
    echo install it with: code --install-extension %vsix% --force
)
endlocal
