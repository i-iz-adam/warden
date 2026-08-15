@echo off
setlocal enabledelayedexpansion

rem Rebuilds two GitHub repos under the i-iz-adam account from this
rem working tree, from scratch each time:
rem
rem   i-iz-adam/warden         <- everything here EXCEPT server/
rem                               (see .gitignore -- /server/ is excluded)
rem   i-iz-adam/warden-server  <- the server/ folder, as its own repo
rem
rem This DELETES both remote repos (if they exist) and any local .git
rem folders under this tree first, then re-inits and pushes fresh --
rem use this when the repos need to be recreated cleanly (e.g. the
rem "warden" repo previously had server/ committed into it by mistake).
rem
rem Requires: git, and the GitHub CLI (gh) already authenticated
rem (run `gh auth login` first if you haven't). Deleting a repo via
rem `gh repo delete` also requires the `delete_repo` OAuth scope --
rem if that fails, run: gh auth refresh -h github.com -s delete_repo

set GH_USER=i-iz-adam
set ROOT=%~dp0

where git >nul 2>nul
if errorlevel 1 (
    echo [ERROR] git is not on PATH. Install it from https://git-scm.com/downloads and re-run.
    exit /b 1
)

where gh >nul 2>nul
if errorlevel 1 (
    echo [ERROR] GitHub CLI ^(gh^) is not on PATH. Install it from https://cli.github.com and run "gh auth login" first.
    exit /b 1
)

gh auth status >nul 2>nul
if errorlevel 1 (
    echo [ERROR] gh is not authenticated. Run "gh auth login" and re-run this script.
    exit /b 1
)

echo.
echo This will DELETE and recreate:
echo   https://github.com/%GH_USER%/warden
echo   https://github.com/%GH_USER%/warden-server
echo.
set /p CONFIRM="Type YES to continue: "
if /i not "%CONFIRM%"=="YES" (
    echo Aborted.
    exit /b 1
)

echo.
echo === Deleting existing remote repos ^(if present^) ===
gh repo view "%GH_USER%/warden" >nul 2>nul
if not errorlevel 1 (
    echo Deleting %GH_USER%/warden ...
    gh repo delete "%GH_USER%/warden" --yes
)
gh repo view "%GH_USER%/warden-server" >nul 2>nul
if not errorlevel 1 (
    echo Deleting %GH_USER%/warden-server ...
    gh repo delete "%GH_USER%/warden-server" --yes
)

echo.
echo === Resetting local git history ===
if exist "%ROOT%.git" (
    echo Removing existing local .git for warden ^(root^)...
    rmdir /s /q "%ROOT%.git"
)
if exist "%ROOT%server\.git" (
    echo Removing existing local .git for warden-server ^(server\^)...
    rmdir /s /q "%ROOT%server\.git"
)

echo.
echo === Repo 1/2: warden ^(desktop app^) ===
cd /d "%ROOT%"
git init
git branch -M main
git add .
git commit -m "Warden desktop app" -q
gh repo create "%GH_USER%/warden" --private --source=. --remote=origin --push
if errorlevel 1 (
    echo [ERROR] Failed to create/push %GH_USER%/warden.
    exit /b 1
)

echo.
echo === Repo 2/2: warden-server ^(central API server^) ===
cd /d "%ROOT%server"
git init
git branch -M main
git add .
git commit -m "Warden central API server" -q
gh repo create "%GH_USER%/warden-server" --private --source=. --remote=origin --push
if errorlevel 1 (
    echo [ERROR] Failed to create/push %GH_USER%/warden-server.
    exit /b 1
)

cd /d "%ROOT%"
echo.
echo Done. Fresh repos pushed:
echo   https://github.com/%GH_USER%/warden
echo   https://github.com/%GH_USER%/warden-server
endlocal
