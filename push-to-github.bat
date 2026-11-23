@echo off
setlocal enabledelayedexpansion
title PUSH LOVELYSHELL BOT TO GITHUB

echo ========================================================
echo        PUSH LOVELYSHELL BOT TO GITHUB FOR RENDER
echo ========================================================
echo.

where git >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Git is not installed or not in your PATH.
    pause
    exit /b 1
)

cd /d "%~dp0"

if not exist ".git" (
    echo [*] Initializing Git repository...
    git init
    git branch -M main
)

set REMOTE_URL=
for /f "tokens=*" %%a in ('git remote get-url origin 2^>nul') do set REMOTE_URL=%%a

if "%REMOTE_URL%"=="" (
    echo.
    echo Paste your GitHub repository URL (e.g. https://github.com/your-username/your-repo.git):
    set /p REPO_INPUT="Repo URL: "
    if "!REPO_INPUT!"=="" (
        echo [ERROR] No GitHub URL provided.
        pause
        exit /b 1
    )
    git remote add origin !REPO_INPUT!
) else (
    echo [*] Current remote: %REMOTE_URL%
)

echo.
echo [*] Staging all files...
git add -A

set "COMMIT_MSG=Deploy lovelyshell web and bot to Render %date%"
echo [*] Committing changes...
git commit -m "%COMMIT_MSG%"

echo.
echo [*] Pushing to GitHub main branch...
git push -u origin main

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================================
    echo [SUCCESS] Code pushed to GitHub!
    echo Now open Render (https://dashboard.render.com),
    echo create a New Web Service connected to this repository!
    echo ========================================================
) else (
    echo.
    echo [WARNING] If push was rejected, check permissions or run:
    echo git push -u origin main --force
)

echo.
pause
