@echo off
REM ==============================================================================
REM build.bat - Windows one-command build script for Projectile Motion Calculator
REM ==============================================================================

setlocal enabledelayedexpansion
cd /d "%~dp0"

echo === Building Projectile Motion Physics Core (WebAssembly) ===

where emcc >nul 2>nul
if %errorlevel% neq 0 (
    echo emcc not found in PATH. Checking for Emscripten SDK...
    if exist "%USERPROFILE%\emsdk\emsdk_env.bat" (
        call "%USERPROFILE%\emsdk\emsdk_env.bat"
    ) else if exist "C:\Users\Aditi Pant\emsdk\emsdk_env.bat" (
        call "C:\Users\Aditi Pant\emsdk\emsdk_env.bat"
    ) else if exist "C:\emsdk\emsdk_env.bat" (
        call "C:\emsdk\emsdk_env.bat"
    ) else (
        echo Emscripten SDK not found. Installing into %USERPROFILE%\emsdk...
        git clone --depth 1 https://github.com/emscripten-core/emsdk.git "%USERPROFILE%\emsdk"
        pushd "%USERPROFILE%\emsdk"
        call emsdk.bat install latest
        call emsdk.bat activate latest
        popd
        call "%USERPROFILE%\emsdk\emsdk_env.bat"
    )
)

where emcc >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Could not find or activate emcc.
    exit /b 1
)

if not exist "public" mkdir "public"

echo Compiling src/projectile.c -^> public/projectile.js + public/projectile.wasm...

emcc src/projectile.c -O2 -o public/projectile.js ^
  -s EXPORTED_RUNTIME_METHODS="['ccall','cwrap','getValue']" ^
  -s EXPORTED_FUNCTIONS="['_compute','_position','_malloc','_free']" ^
  -s MODULARIZE=1 -s EXPORT_NAME=createModule

if %errorlevel% equ 0 (
    echo Build SUCCESSFUL!
    dir public\projectile.*
) else (
    echo ERROR: Compilation failed.
    exit /b 1
)
