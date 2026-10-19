$ErrorActionPreference = 'Stop'

& .\node_modules\.bin\tsc.cmd --ignoreConfig --target ES2022 --module Node16 --moduleResolution Node16 --esModuleInterop --skipLibCheck --strict --outDir .test-output src\domain.ts src\theme.ts src\courseSchedule.ts src\scheduleView.ts src\validation.ts src\courseImport.ts src\timetableParser.ts src\importParsers.ts src\database.ts
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

$testTempDirectory = (Resolve-Path .\.test-output).Path
$env:TEMP = $testTempDirectory
$env:TMP = $testTempDirectory

node --test tests\*.test.cjs
exit $LASTEXITCODE
