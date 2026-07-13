@echo off
setlocal enabledelayedexpansion
rem Downloads the BRouter routing segments (.rd5) covering Germany/Austria/
rem Switzerland (DACH) from the public brouter.de mirror. Only needed once,
rem before starting the local BRouter instance via docker-compose.brouter.yml.
rem See: https://brouter.de/brouter/segments4/

set "TARGET_DIR=%~dp0..\brouter-data\segments4"
set "BASE_URL=https://brouter.de/brouter/segments4"

if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"

rem 5x5 degree tiles covering ~5-20E / 45-60N (superset of DACH borders)
set TILES=E5_N45 E5_N50 E5_N55 E10_N45 E10_N50 E10_N55 E15_N45 E15_N50 E15_N55

for %%T in (%TILES%) do (
  if exist "%TARGET_DIR%\%%T.rd5" (
    echo skip %%T.rd5 ^(already downloaded^)
  ) else (
    echo downloading %%T.rd5...
    curl -fSL "%BASE_URL%/%%T.rd5" -o "%TARGET_DIR%\%%T.rd5.tmp" && move /y "%TARGET_DIR%\%%T.rd5.tmp" "%TARGET_DIR%\%%T.rd5" >nul
  )
)

echo Done. Segments in %TARGET_DIR%
