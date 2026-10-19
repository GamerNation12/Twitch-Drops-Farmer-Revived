@echo off
rem ---------------------------------------------------------------------------
rem First-run Twitch sign-in for Twitch Drops Farmer PRO.
rem
rem Put this file next to TwitchDropsFarmer_v1.3.1.exe and run it once:
rem a Twitch sign-in window opens, log in there, and it closes itself as soon
rem as the app has picked up the session.
rem
rem After that, plain launches of the exe sign in silently - nothing opens.
rem ---------------------------------------------------------------------------
set "EXE=%~dp0TwitchDropsFarmer_v1.3.1.exe"
if not exist "%EXE%" (
  echo Could not find TwitchDropsFarmer_v1.3.1.exe next to this file.
  echo Adjust the file name inside this .bat if you built a different version.
  pause
  exit /b 1
)
start "" "%EXE%" --twitch-login
