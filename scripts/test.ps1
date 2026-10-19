$ErrorActionPreference = 'Stop'

& .\node_modules\.bin\tsc.cmd --ignoreConfig --target ES2022 --module Node16 --moduleResolution Node16 --esModuleInterop --skipLibCheck --strict --outDir .test-output src\domain.ts src\courseSchedule.ts src\scheduleView.ts src\validation.ts src\courseImport.ts src\timetableParser.ts src\database.ts
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

node --test tests\*.test.cjs
exit $LASTEXITCODE
