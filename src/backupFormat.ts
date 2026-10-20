import { createHash } from 'node:crypto';

const MAGIC = Buffer.from('DAYBYDAY-BACKUP\n', 'ascii');
const HASH_BYTES = 32;
const MAX_METADATA_BYTES = 64 * 1024;
export const MAX_BACKUP_PREFERENCES_BYTES = 256 * 1024;

export type BackupRecordCounts = {
  tasks: number;
  events: number;
  semesters: number;
  courses: number;
  courseExceptions: number;
  importBatches: number;
};

export type BackupFileMetadata = {
  format: 'daybyday-backup';
  formatVersion: 1;
  appVersion: string;
  createdAt: string;
  database: {
    byteLength: number;
    sha256: string;
    schemaVersion: number;
    counts: BackupRecordCounts;
  };
  preferences: {
    byteLength: number;
    sha256: string;
  };
};

export type BackupPayloadLayout = {
  metadata: BackupFileMetadata;
  headerLength: number;
  databaseOffset: number;
  preferencesOffset: number;
  totalLength: number;
};

export const getBackupFixedPrefixLength = () => MAGIC.length + 4;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isSafeNonNegativeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

const isSha256 = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

const assertMetadata = (value: unknown): BackupFileMetadata => {
  if (!isRecord(value) || value.format !== 'daybyday-backup')
    throw new Error('备份文件格式不受支持。');
  if (value.formatVersion !== 1) throw new Error('备份文件版本不受支持。');
  if (
    typeof value.appVersion !== 'string' ||
    value.appVersion.length < 1 ||
    value.appVersion.length > 64 ||
    typeof value.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(value.createdAt))
  )
    throw new Error('备份文件信息无效。');

  const database = value.database;
  const preferences = value.preferences;
  if (
    !isRecord(database) ||
    !isSafeNonNegativeInteger(database.byteLength) ||
    database.byteLength < 1 ||
    !isSha256(database.sha256) ||
    !isSafeNonNegativeInteger(database.schemaVersion) ||
    database.schemaVersion > 100
  )
    throw new Error('备份中的数据库信息无效。');
  if (!isRecord(database.counts)) throw new Error('备份中的数据统计信息无效。');
  const countKeys: Array<keyof BackupRecordCounts> = [
    'tasks',
    'events',
    'semesters',
    'courses',
    'courseExceptions',
    'importBatches',
  ];
  for (const key of countKeys) {
    if (!isSafeNonNegativeInteger(database.counts[key]))
      throw new Error('备份中的数据统计信息无效。');
  }
  if (
    !isRecord(preferences) ||
    !isSafeNonNegativeInteger(preferences.byteLength) ||
    preferences.byteLength > MAX_BACKUP_PREFERENCES_BYTES ||
    !isSha256(preferences.sha256)
  )
    throw new Error('备份中的偏好设置信息无效。');

  return value as unknown as BackupFileMetadata;
};

export const encodeBackupHeader = (metadataValue: BackupFileMetadata) => {
  const metadata = assertMetadata(metadataValue);
  const metadataBytes = Buffer.from(JSON.stringify(metadata), 'utf8');
  if (metadataBytes.length > MAX_METADATA_BYTES)
    throw new Error('备份文件信息过大。');

  const prefix = Buffer.alloc(
    MAGIC.length + 4 + metadataBytes.length + HASH_BYTES,
  );
  MAGIC.copy(prefix, 0);
  prefix.writeUInt32LE(metadataBytes.length, MAGIC.length);
  metadataBytes.copy(prefix, MAGIC.length + 4);
  createHash('sha256')
    .update(metadataBytes)
    .digest()
    .copy(prefix, MAGIC.length + 4 + metadataBytes.length);
  return prefix;
};

export const parseBackupHeader = (
  header: Buffer,
  fileLength: number,
): BackupPayloadLayout => {
  if (
    !Number.isSafeInteger(fileLength) ||
    fileLength < MAGIC.length + 4 + HASH_BYTES
  )
    throw new Error('备份文件不完整。');
  if (header.length < MAGIC.length + 4 + HASH_BYTES)
    throw new Error('备份文件不完整。');
  if (!header.subarray(0, MAGIC.length).equals(MAGIC))
    throw new Error('这不是 Daybyday 备份文件。');

  const metadataLength = header.readUInt32LE(MAGIC.length);
  if (metadataLength < 2 || metadataLength > MAX_METADATA_BYTES)
    throw new Error('备份文件信息长度无效。');
  const headerLength = MAGIC.length + 4 + metadataLength + HASH_BYTES;
  if (header.length !== headerLength) throw new Error('备份文件信息不完整。');

  const metadataStart = MAGIC.length + 4;
  const metadataBytes = header.subarray(
    metadataStart,
    metadataStart + metadataLength,
  );
  const expectedHash = createHash('sha256').update(metadataBytes).digest();
  const actualHash = header.subarray(
    metadataStart + metadataLength,
    headerLength,
  );
  if (!actualHash.equals(expectedHash))
    throw new Error('备份文件信息校验失败。');

  let parsed: unknown;
  try {
    parsed = JSON.parse(metadataBytes.toString('utf8')) as unknown;
  } catch {
    throw new Error('备份文件信息无法读取。');
  }
  const metadata = assertMetadata(parsed);
  const databaseOffset = headerLength;
  const preferencesOffset = databaseOffset + metadata.database.byteLength;
  const totalLength = preferencesOffset + metadata.preferences.byteLength;
  if (!Number.isSafeInteger(totalLength) || totalLength !== fileLength)
    throw new Error('备份文件长度与内容不匹配。');

  return {
    metadata,
    headerLength,
    databaseOffset,
    preferencesOffset,
    totalLength,
  };
};

export const getBackupHeaderLength = (fixedPrefix: Buffer) => {
  if (fixedPrefix.length !== MAGIC.length + 4)
    throw new Error('备份文件头无效。');
  if (!fixedPrefix.subarray(0, MAGIC.length).equals(MAGIC))
    throw new Error('这不是 Daybyday 备份文件。');
  const metadataLength = fixedPrefix.readUInt32LE(MAGIC.length);
  if (metadataLength < 2 || metadataLength > MAX_METADATA_BYTES)
    throw new Error('备份文件信息长度无效。');
  return MAGIC.length + 4 + metadataLength + HASH_BYTES;
};
