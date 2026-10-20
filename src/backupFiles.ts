import fs from 'node:fs';

export const databaseBundlePaths = (databasePath: string) => [
  databasePath,
  `${databasePath}-wal`,
  `${databasePath}-shm`,
];

export const hasDatabaseBundle = (databasePath: string) =>
  databaseBundlePaths(databasePath).some((filePath) => fs.existsSync(filePath));

export const moveDatabaseBundle = (
  sourcePath: string,
  destinationPath: string,
) => {
  const sourceFiles = databaseBundlePaths(sourcePath);
  if (!fs.existsSync(sourcePath))
    throw new Error('SQLite source database was not found.');
  const moved: Array<{ from: string; to: string }> = [];
  try {
    for (const sourceFile of sourceFiles) {
      if (!fs.existsSync(sourceFile)) continue;
      const suffix = sourceFile.slice(sourcePath.length);
      const destinationFile = `${destinationPath}${suffix}`;
      fs.renameSync(sourceFile, destinationFile);
      moved.push({ from: sourceFile, to: destinationFile });
    }
  } catch (error) {
    for (const item of moved.reverse()) {
      try {
        if (fs.existsSync(item.to)) fs.renameSync(item.to, item.from);
      } catch {
        // The caller retains the source and destination paths for recovery.
      }
    }
    throw error;
  }
};

export const restorePartialDatabaseBundle = (
  rollbackPath: string,
  livePath: string,
) => {
  const moved: Array<{ from: string; to: string }> = [];
  try {
    for (const rollbackFile of databaseBundlePaths(rollbackPath)) {
      if (!fs.existsSync(rollbackFile)) continue;
      const suffix = rollbackFile.slice(rollbackPath.length);
      const liveFile = `${livePath}${suffix}`;
      if (fs.existsSync(liveFile))
        throw new Error('Both live and rollback SQLite files exist.');
      fs.renameSync(rollbackFile, liveFile);
      moved.push({ from: rollbackFile, to: liveFile });
    }
    if (!fs.existsSync(livePath))
      throw new Error('Rollback did not restore the SQLite database.');
  } catch (error) {
    for (const item of moved.reverse()) {
      try {
        if (fs.existsSync(item.to)) fs.renameSync(item.to, item.from);
      } catch {
        // The restore journal remains so the next launch can retry recovery.
      }
    }
    throw error;
  }
};

export const removeDatabaseBundle = (databasePath: string) => {
  for (const filePath of databaseBundlePaths(databasePath)) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // Temporary artifacts are best-effort cleanup; user databases are never passed here.
    }
  }
};
