@echo off
REM MOrbVis - Tauri build script
REM Build outside Dropbox to avoid file lock errors

set PATH=%USERPROFILE%\.cargo\bin;%PATH%
set CARGO_TARGET_DIR=%USERPROFILE%\.cache\tauri-build\morbvis

cd /d "%~dp0"

REM Sync version from package.json to tauri.conf.json and Cargo.toml
node -e "const fs=require('fs');const v=JSON.parse(fs.readFileSync('package.json','utf8')).version;let t=fs.readFileSync('src-tauri/tauri.conf.json','utf8');t=t.replace(/\"version\":\s*\"[^\"]*\"/,'\"version\": \"'+v+'\"');fs.writeFileSync('src-tauri/tauri.conf.json',t);let c=fs.readFileSync('src-tauri/Cargo.toml','utf8');c=c.replace(/^version\s*=\s*\"[^\"]*\"/m,'version = \"'+v+'\"');fs.writeFileSync('src-tauri/Cargo.toml',c);console.log('Version: '+v);"

REM Clean old bundle artifacts
if exist "%CARGO_TARGET_DIR%\release\bundle\nsis" rd /s /q "%CARGO_TARGET_DIR%\release\bundle\nsis"
if exist "%CARGO_TARGET_DIR%\release\bundle\msi" rd /s /q "%CARGO_TARGET_DIR%\release\bundle\msi"

call npx tauri build

if errorlevel 1 (
    echo Build failed.
    pause
    exit /b 1
)

set DIST_DIR=%~dp0tauri-dist
if exist "%DIST_DIR%" rd /s /q "%DIST_DIR%"
mkdir "%DIST_DIR%"
if exist "%CARGO_TARGET_DIR%\release\MOrbVis.exe" copy /y "%CARGO_TARGET_DIR%\release\MOrbVis.exe" "%DIST_DIR%\" >nul
if exist "%CARGO_TARGET_DIR%\release\bundle\nsis" copy /y "%CARGO_TARGET_DIR%\release\bundle\nsis\*setup*.exe" "%DIST_DIR%\" >nul
if exist "%CARGO_TARGET_DIR%\release\bundle\msi" copy /y "%CARGO_TARGET_DIR%\release\bundle\msi\*.msi" "%DIST_DIR%\" >nul

echo.
echo === Build complete ===
echo Output: %DIST_DIR%
dir "%DIST_DIR%"
pause
