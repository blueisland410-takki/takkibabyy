const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
  moveDatabaseBundle,
  removeDatabaseBundle,
  restorePartialDatabaseBundle,
} = require('../.test-output/src/backupFiles.js');

test('database bundle swap and rollback preserve SQLite WAL sidecars', () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'daybyday-swap-test-'),
  );
  const livePath = path.join(directory, 'daybyday.sqlite');
  const candidatePath = path.join(directory, '.candidate.sqlite');
  const rollbackPath = path.join(directory, '.rollback.sqlite');
  const rejectedPath = path.join(directory, '.rejected.sqlite');
  try {
    fs.writeFileSync(livePath, 'current-db');
    fs.writeFileSync(`${livePath}-wal`, 'current-wal');
    fs.writeFileSync(`${livePath}-shm`, 'current-shm');
    fs.writeFileSync(candidatePath, 'backup-db');
    fs.writeFileSync(`${candidatePath}-wal`, 'backup-wal');

    moveDatabaseBundle(livePath, rollbackPath);
    moveDatabaseBundle(candidatePath, livePath);
    assert.equal(fs.readFileSync(livePath, 'utf8'), 'backup-db');
    assert.equal(fs.readFileSync(`${livePath}-wal`, 'utf8'), 'backup-wal');
    assert.equal(fs.existsSync(`${livePath}-shm`), false);

    moveDatabaseBundle(livePath, rejectedPath);
    moveDatabaseBundle(rollbackPath, livePath);
    assert.equal(fs.readFileSync(livePath, 'utf8'), 'current-db');
    assert.equal(fs.readFileSync(`${livePath}-wal`, 'utf8'), 'current-wal');
    assert.equal(fs.readFileSync(`${livePath}-shm`, 'utf8'), 'current-shm');
    removeDatabaseBundle(rejectedPath);
    assert.equal(fs.existsSync(rejectedPath), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('startup recovery rejoins the database when a file-bundle move was interrupted', () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'daybyday-recover-test-'),
  );
  const livePath = path.join(directory, 'daybyday.sqlite');
  const rollbackPath = path.join(directory, '.rollback.sqlite');
  try {
    fs.writeFileSync(livePath, 'old-db');
    fs.writeFileSync(`${livePath}-wal`, 'old-wal');
    fs.writeFileSync(`${livePath}-shm`, 'old-shm');

    // Simulate power loss after the primary file moved but before the sidecars.
    fs.renameSync(livePath, rollbackPath);
    restorePartialDatabaseBundle(rollbackPath, livePath);

    assert.equal(fs.readFileSync(livePath, 'utf8'), 'old-db');
    assert.equal(fs.readFileSync(`${livePath}-wal`, 'utf8'), 'old-wal');
    assert.equal(fs.readFileSync(`${livePath}-shm`, 'utf8'), 'old-shm');
    assert.equal(fs.existsSync(rollbackPath), false);

    const resumedLivePath = path.join(directory, 'resumed.sqlite');
    const resumedRollbackPath = path.join(
      directory,
      '.resumed-rollback.sqlite',
    );
    fs.writeFileSync(resumedLivePath, 'resumed-db');
    fs.writeFileSync(`${resumedRollbackPath}-wal`, 'resumed-wal');
    fs.writeFileSync(`${resumedLivePath}-shm`, 'resumed-shm');
    restorePartialDatabaseBundle(resumedRollbackPath, resumedLivePath);
    assert.equal(
      fs.readFileSync(`${resumedLivePath}-wal`, 'utf8'),
      'resumed-wal',
    );
    assert.equal(
      fs.readFileSync(`${resumedLivePath}-shm`, 'utf8'),
      'resumed-shm',
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
