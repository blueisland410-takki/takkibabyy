const assert = require('node:assert/strict');
const path = require('node:path');

const runtimePath = process.argv[2];
if (typeof runtimePath !== 'string' || !path.isAbsolute(runtimePath)) {
  throw new Error('A staged SQLite runtime path is required.');
}

const Database = require(runtimePath);
const database = new Database(':memory:');
try {
  assert.deepEqual(database.prepare('SELECT 1 AS ok').get(), { ok: 1 });
  console.log(`Electron loaded better-sqlite3 from ${runtimePath}`);
} finally {
  database.close();
}
