import { t, translateSystemMessage } from './i18n';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import type {
  ImportBatchAnalysis,
  ImportBatchItem,
  ImportBatchSummary,
  ImportSourceType,
  NormalizedImportDraft,
  RecurrenceType,
  Semester,
} from './domain';
import {
  createCourseTemplate,
  createCsvTemplate,
  parseCsvImport,
  parseIcsImport,
  parseXlsxImport,
  sha256,
  type ColumnMapping,
  type ImportColumn,
  type TabularParseResult,
} from './importParsers';
import { formatDate, formatWeekdayNames } from './i18n';

type Props = {
  semester: Semester;
  sourceType: 'ICS' | 'XLSX' | 'CSV';
  onClose: () => void;
  onImported: () => void;
};

const recurrenceOptions: Array<[RecurrenceType, string]> = [
  ['ALL', '每周'],
  ['ODD', '单周'],
  ['EVEN', '双周'],
  ['CUSTOM', '指定周次'],
];
const columnOptions: Array<[ImportColumn, string]> = [
  ['courseName', '课程名称'],
  ['weekday', '星期'],
  ['startTime', '开始时间'],
  ['endTime', '结束时间'],
  ['classroom', '教室'],
  ['teacher', '教师'],
  ['firstWeek', '开始周次'],
  ['lastWeek', '结束周次'],
  ['weekRule', '周次/重复规则'],
  ['customWeeks', '指定周次'],
  ['notes', '备注'],
];
const maxFileBytes = 25 * 1024 * 1024;

const errorText = (failure: unknown) =>
  failure instanceof Error ? failure.message : '操作失败，请重试。';

function semesterWeekCount(semester: Semester): number {
  const start = Date.parse(`${semester.firstWeekMonday}T00:00:00Z`);
  const end = Date.parse(`${semester.endDate}T00:00:00Z`);
  return Math.max(1, Math.ceil((end - start + 1) / (7 * 86_400_000)));
}

function decodeCsv(buffer: ArrayBuffer, encoding: string): string {
  try {
    return new TextDecoder(encoding, { fatal: true })
      .decode(buffer)
      .replace(/^\uFEFF/, '');
  } catch {
    throw new Error(
      `无法按 ${encoding.toUpperCase()} 解码。请切换 UTF-8 或 GB18030 后重试。`,
    );
  }
}

function draftErrors(
  draft: NormalizedImportDraft,
  semester: Semester,
): string[] {
  if (!draft.included) return [];
  const errors: string[] = [];
  if (!draft.courseName.trim()) errors.push('标题不能为空');
  if (draft.kind === 'course') {
    if (!draft.weekday || draft.weekday < 1 || draft.weekday > 7)
      errors.push('星期待确认');
    if (!draft.startTime || !draft.endTime) errors.push('开始/结束时间待确认');
    if (draft.startTime && draft.endTime && draft.endTime <= draft.startTime)
      errors.push('结束时间必须晚于开始时间');
    if (!draft.firstWeek || !draft.lastWeek || draft.firstWeek > draft.lastWeek)
      errors.push('周次范围待确认');
    if (draft.lastWeek && draft.lastWeek > semesterWeekCount(semester))
      errors.push(`不能超过本学期第 ${semesterWeekCount(semester)} 周`);
    if (!draft.recurrenceType) errors.push('重复规则待确认');
    if (draft.recurrenceType === 'CUSTOM' && !draft.customWeeks.length)
      errors.push('请填写指定周次');
    if (
      draft.customWeeks.some(
        (week) =>
          !draft.firstWeek ||
          !draft.lastWeek ||
          week < draft.firstWeek ||
          week > draft.lastWeek ||
          week > semesterWeekCount(semester),
      )
    )
      errors.push('指定周次超出课程范围');
  } else {
    if (
      !draft.eventDate ||
      draft.eventDate < semester.startDate ||
      draft.eventDate > semester.endDate
    )
      errors.push('日程日期不在目标学期内');
    if (
      !draft.isAllDay &&
      draft.startTime &&
      draft.endTime &&
      draft.endTime <= draft.startTime
    )
      errors.push('结束时间必须晚于开始时间');
  }
  if (!draft.reviewed) errors.push('请先确认已核对该条记录');
  return errors;
}

function toBatchItem(draft: NormalizedImportDraft): ImportBatchItem {
  if (draft.kind === 'event') {
    return {
      kind: 'event',
      sourceId: draft.sourceId,
      input: {
        title: draft.courseName.trim(),
        eventDate: draft.eventDate ?? '',
        startTime: draft.isAllDay ? null : draft.startTime,
        endTime: draft.isAllDay ? null : draft.endTime,
        isAllDay: draft.isAllDay,
        location: draft.classroom.trim(),
        notes: draft.notes.trim(),
      },
    };
  }
  return {
    kind: 'course',
    sourceId: draft.sourceId,
    input: {
      semesterId: draft.semesterId,
      courseName: draft.courseName.trim(),
      weekday: draft.weekday ?? 0,
      startTime: draft.startTime ?? '',
      endTime: draft.endTime ?? '',
      classroom: draft.classroom.trim(),
      teacher: draft.teacher.trim(),
      notes: draft.notes.trim(),
      firstWeek: draft.firstWeek ?? 0,
      lastWeek: draft.lastWeek ?? 0,
      recurrenceType: draft.recurrenceType ?? 'ALL',
      customWeeks: draft.recurrenceType === 'CUSTOM' ? draft.customWeeks : [],
    },
    exceptions: draft.exceptions,
  };
}

export function StructuredImport({
  semester,
  sourceType,
  onClose,
  onImported,
}: Props) {
  const weekDays = formatWeekdayNames();
  const [file, setFile] = useState<File | null>(null);
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [contentHash, setContentHash] = useState('');
  const [drafts, setDrafts] = useState<NormalizedImportDraft[]>([]);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [tableResult, setTableResult] = useState<TabularParseResult | null>(
    null,
  );
  const [sheetName, setSheetName] = useState('');
  const [headerRow, setHeaderRow] = useState(1);
  const [mapping, setMapping] = useState<ColumnMapping | undefined>();
  const [encoding, setEncoding] = useState('utf-8');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [analysis, setAnalysis] = useState<ImportBatchAnalysis | null>(null);
  const [duplicateActions, setDuplicateActions] = useState<
    Record<string, 'skip' | 'keep'>
  >({});
  const [batches, setBatches] = useState<ImportBatchSummary[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const activeDrafts = useMemo(
    () => drafts.filter((draft) => draft.included),
    [drafts],
  );
  const invalidDrafts = activeDrafts
    .map((draft) => ({ draft, errors: draftErrors(draft, semester) }))
    .filter((item) => item.errors.length);

  const refreshBatches = async () => {
    try {
      setBatches(await window.dayByDay.listImportBatches(semester.id));
    } catch (failure) {
      setError(`无法读取导入记录：${errorText(failure)}`);
    }
  };

  useEffect(() => {
    void refreshBatches();
    // The selected semester is fixed while this import page is mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [semester.id]);

  const clearAnalysis = () => {
    setAnalysis(null);
    setSuccess('');
  };

  const setParsed = (
    nextDrafts: NormalizedImportDraft[],
    warnings: string[],
  ) => {
    setDrafts(nextDrafts);
    setParseWarnings(warnings);
    clearAnalysis();
  };

  const parseSelected = async (
    selectedFile: File,
    fileBuffer: ArrayBuffer,
    hash: string,
    nextSheetName = sheetName,
    nextHeaderRow = headerRow,
    nextMapping = mapping,
    nextEncoding = encoding,
  ) => {
    const context = {
      semester,
      sourceLabel: selectedFile.name,
      contentHash: hash,
    };
    setError('');
    setSuccess('');
    if (sourceType === 'ICS') {
      const text = new TextDecoder('utf-8', { fatal: true })
        .decode(fileBuffer)
        .replace(/^\uFEFF/, '');
      setTableResult(null);
      setParsed(parseIcsImport(text, context), []);
      return;
    }
    if (sourceType === 'CSV') {
      const parsed = parseCsvImport(
        decodeCsv(fileBuffer, nextEncoding),
        context,
        {
          headerRow: nextHeaderRow,
          mapping: nextMapping,
        },
      );
      setTableResult(parsed);
      setParsed(parsed.drafts, parsed.warnings);
      return;
    }
    const parsed = await parseXlsxImport(fileBuffer, context, {
      headerRow: nextHeaderRow,
      sheetName: nextSheetName || undefined,
      mapping: nextMapping,
    });
    setTableResult(parsed);
    setSheetName(nextSheetName || parsed.sheetNames[0] || '');
    setParsed(parsed.drafts, parsed.warnings);
  };

  const loadFile = async (selected: File) => {
    setError('');
    setSuccess('');
    const extension = selected.name.toLocaleLowerCase().split('.').pop();
    const allowed =
      sourceType === 'ICS'
        ? ['ics']
        : sourceType === 'XLSX'
          ? ['xlsx']
          : ['csv'];
    if (!allowed.includes(extension ?? '')) {
      setError(
        `当前入口只接受 ${allowed.map((item) => `.${item}`).join('、')} 文件。`,
      );
      return;
    }
    if (!selected.size || selected.size > maxFileBytes) {
      setError('文件大小必须大于 0 且不超过 25 MB。');
      return;
    }
    setBusy(true);
    setFile(selected);
    setDrafts([]);
    setParseWarnings([]);
    setTableResult(null);
    setMapping(undefined);
    setHeaderRow(1);
    setSheetName('');
    clearAnalysis();
    try {
      const fileBuffer = await selected.arrayBuffer();
      const hash = await sha256(fileBuffer);
      setBuffer(fileBuffer);
      setContentHash(hash);
      await parseSelected(
        selected,
        fileBuffer,
        hash,
        '',
        1,
        undefined,
        encoding,
      );
    } catch (failure) {
      setError(`文件没有解析成功：${errorText(failure)}`);
      // Keep a successfully read source file and its fingerprint available so
      // the user can still add corrected records manually after an unsupported
      // or malformed layout. No data is written until explicit confirmation.
    } finally {
      setBusy(false);
    }
  };

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (selected) void loadFile(selected);
    event.target.value = '';
  };

  const dropFile = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const selected = event.dataTransfer.files[0];
    if (selected) void loadFile(selected);
  };

  const reparse = async (
    nextSheet = sheetName,
    nextHeader = headerRow,
    nextMapping = mapping,
    nextEncoding = encoding,
  ) => {
    if (!file || !buffer || !contentHash || busy) return;
    setBusy(true);
    try {
      await parseSelected(
        file,
        buffer,
        contentHash,
        nextSheet,
        nextHeader,
        nextMapping,
        nextEncoding,
      );
    } catch (failure) {
      setError(`重新解析失败：${errorText(failure)}`);
    } finally {
      setBusy(false);
    }
  };

  const updateDraft = (id: string, update: Partial<NormalizedImportDraft>) => {
    setDrafts((previous) =>
      previous.map((draft) =>
        draft.id === id
          ? {
              ...draft,
              ...update,
              reviewed: Object.hasOwn(update, 'reviewed')
                ? (update.reviewed ?? false)
                : false,
            }
          : draft,
      ),
    );
    clearAnalysis();
  };

  const removeDraft = (id: string) => {
    setDrafts((previous) => previous.filter((draft) => draft.id !== id));
    clearAnalysis();
  };

  const addManual = (kind: 'course' | 'event') => {
    const id = `manual-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const manualPrefix = `manual:${contentHash}:${kind}:`;
    const manualOrdinal =
      drafts.filter((draft) => draft.sourceId.startsWith(manualPrefix)).length +
      1;
    setDrafts((previous) => [
      ...previous,
      {
        id,
        kind,
        semesterId: semester.id,
        courseName: '',
        weekday: kind === 'course' ? 1 : null,
        startTime: '',
        endTime: '',
        classroom: '',
        teacher: '',
        firstWeek: kind === 'course' ? 1 : null,
        lastWeek: kind === 'course' ? semesterWeekCount(semester) : null,
        recurrenceType: kind === 'course' ? 'ALL' : null,
        customWeeks: [],
        exceptions: [],
        eventDate: kind === 'event' ? semester.startDate : null,
        isAllDay: false,
        notes: '',
        sourceType,
        sourceId: `${manualPrefix}${manualOrdinal}`,
        sourceLabel: file?.name ?? '手动新增',
        rawText: '',
        warnings: ['手动新增，请补全课程信息'],
        confidence: null,
        included: true,
        reviewed: false,
      },
    ]);
    clearAnalysis();
  };

  const buildPayload = () => ({
    options: {
      semesterId: semester.id,
      sourceType: sourceType as ImportSourceType,
      sourceLabel: file?.name ?? '手动新增',
      contentHash,
    },
    items: activeDrafts.map(toBatchItem),
  });

  const analyze = async () => {
    if (!file || !contentHash) {
      setError('请先选择 ICS、XLSX 或 CSV 文件。');
      return;
    }
    if (!activeDrafts.length) {
      setError('请至少保留一条准备导入的记录。');
      return;
    }
    if (invalidDrafts.length) {
      setError('请补全所有勾选记录中的必填字段，并勾选“已核对”。');
      return;
    }
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const result = await window.dayByDay.analyzeImportBatch(buildPayload());
      setAnalysis(result);
      setDuplicateActions(
        Object.fromEntries(
          result.duplicates
            .map((duplicate) => [
              activeDrafts[duplicate.itemIndex]?.id ?? '',
              'skip',
            ])
            .filter(([id]) => Boolean(id)),
        ),
      );
      setSuccess(
        t(
          '检查完成：{{count}} 条记录，{{duplicates}} 条可能重复，{{conflicts}} 处时间冲突。',
          {
            count: activeDrafts.length,
            duplicates: result.duplicates.length,
            conflicts: result.conflicts.length,
          },
        ),
      );
    } catch (failure) {
      setError(t('检查失败：{{message}}', { message: errorText(failure) }));
    } finally {
      setBusy(false);
    }
  };

  const importConfirmed = async () => {
    if (!analysis || busy) return;
    if (
      !window.confirm(
        t(
          '将 {{count}} 条已校对内容导入“{{semester}}”。可能重复项默认跳过；不会覆盖已有课程或调课。继续吗？',
          {
            count: activeDrafts.length,
            semester: semester.semesterName,
          },
        ),
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      const decisions = analysis.duplicates.map((duplicate) => ({
        itemIndex: duplicate.itemIndex,
        action:
          duplicateActions[activeDrafts[duplicate.itemIndex]?.id ?? ''] ??
          'skip',
      }));
      const result = await window.dayByDay.importBatch(
        buildPayload(),
        decisions,
      );
      setAnalysis(null);
      setSuccess(
        t(
          '导入完成：新增 {{courses}} 门课程、{{events}} 条日程，跳过 {{skipped}} 条重复内容。',
          {
            courses: result.importedCount,
            events: result.importedEventCount,
            skipped: result.skippedCount,
          },
        ),
      );
      await refreshBatches();
      onImported();
    } catch (failure) {
      setError(
        t('导入失败，原有课程和日程保持不变：{{message}}', {
          message: errorText(failure),
        }),
      );
      setAnalysis(null);
    } finally {
      setBusy(false);
    }
  };

  const undoBatch = async (batchId: string) => {
    if (busy) return;
    if (
      !window.confirm(t('仅撤销该批次新增且此后未编辑的课程和日程。继续吗？'))
    )
      return;
    setBusy(true);
    setError('');
    try {
      const result = await window.dayByDay.undoImportBatch(batchId);
      setSuccess(
        t(
          '批次已撤销：移除 {{courses}} 门课程、{{events}} 条日程；{{retained}} 项因导入后有修改而保留。',
          {
            courses: result.removedCourseCount,
            events: result.removedEventCount,
            retained: result.retainedItemCount,
          },
        ),
      );
      await refreshBatches();
      onImported();
    } catch (failure) {
      setError(t('撤销失败：{{message}}', { message: errorText(failure) }));
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = async (kind: 'xlsx' | 'csv') => {
    try {
      let blob: Blob;
      let filename: string;
      if (kind === 'xlsx') {
        blob = await createCourseTemplate();
        filename = 'DayByDay课程导入模板.xlsx';
      } else {
        blob = new Blob(['\uFEFF', createCsvTemplate()], {
          type: 'text/csv;charset=utf-8',
        });
        filename = 'DayByDay课程导入模板.csv';
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (failure) {
      setError(t('模板生成失败：{{message}}', { message: errorText(failure) }));
    }
  };

  const formatLabel =
    sourceType === 'ICS'
      ? t('iCalendar')
      : sourceType === 'XLSX'
        ? t('Excel 工作簿')
        : t('CSV 表格');
  const accepts =
    sourceType === 'ICS'
      ? '.ics,text/calendar'
      : sourceType === 'XLSX'
        ? '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : '.csv,text/csv';
  const seenCount = drafts.length;

  return (
    <section
      className="structured-import"
      aria-label={t('{{format}} import preview', { format: formatLabel })}
    >
      <div className="structured-import-topline">
        <div>
          <span className="structured-format-pill">{formatLabel}</span>
          <span className="structured-file-name">
            {file?.name ?? t('选择本地文件')}
          </span>
        </div>
        <button
          className="quiet-button compact-button"
          type="button"
          onClick={onClose}
        >
          {t('返回课程列表')}
        </button>
      </div>

      {!file && (
        <>
          <input
            accept={accepts}
            className="hidden-file-input"
            onChange={chooseFile}
            ref={fileInput}
            type="file"
          />
          <button
            className="structured-dropzone"
            onClick={() => fileInput.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={dropFile}
            type="button"
          >
            <strong>
              {t('点击选择或拖入')} {formatLabel} {t('文件')}
            </strong>
            <span>
              {t(
                '文件仅在本机临时读取，不上传，也不会保存到数据库。最大 25 MB。',
              )}
            </span>
          </button>
          {sourceType !== 'ICS' && (
            <div className="template-actions">
              <button
                className="quiet-button compact-button"
                onClick={() => void downloadTemplate('xlsx')}
                type="button"
              >
                {t('下载 Excel 模板')}
              </button>
              <button
                className="quiet-button compact-button"
                onClick={() => void downloadTemplate('csv')}
                type="button"
              >
                {t('下载 CSV 模板')}
              </button>
            </div>
          )}
        </>
      )}

      {file && (
        <div className="structured-file-tools">
          <button
            className="quiet-button compact-button"
            onClick={() => fileInput.current?.click()}
            type="button"
          >
            {t('重新选择')}
          </button>
          <button
            className="quiet-button compact-button"
            onClick={() => {
              setFile(null);
              setBuffer(null);
              setContentHash('');
              setDrafts([]);
              setTableResult(null);
              setAnalysis(null);
              setSuccess('');
            }}
            type="button"
          >
            {t('清除文件')}
          </button>
          <input
            accept={accepts}
            className="hidden-file-input"
            onChange={chooseFile}
            ref={fileInput}
            type="file"
          />
          <span>
            {t('目标学期：')}
            {semester.semesterName} · {semesterWeekCount(semester)} {t('周')}
          </span>
        </div>
      )}

      {sourceType === 'CSV' && file && (
        <label className="structured-option-label">
          {t('CSV 编码')}
          <select
            disabled={busy}
            onChange={(event) => {
              setEncoding(event.target.value);
              void reparse(sheetName, headerRow, mapping, event.target.value);
            }}
            value={encoding}
          >
            <option value="utf-8">{t('UTF-8')}</option>
            <option value="gb18030">
              {t('GB18030 / 常见简体中文 Windows CSV')}
            </option>
          </select>
        </label>
      )}

      {tableResult && sourceType === 'XLSX' && (
        <div className="structured-table-options">
          <label className="structured-option-label">
            {t('工作表')}
            <select
              disabled={busy}
              onChange={(event) => {
                setSheetName(event.target.value);
                setMapping(undefined);
                void reparse(event.target.value, headerRow, undefined);
              }}
              value={sheetName || tableResult.sheetNames[0]}
            >
              {tableResult.sheetNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="structured-option-label">
            {t('表头行')}
            <input
              disabled={busy}
              max={100}
              min={1}
              onChange={(event) =>
                setHeaderRow(Math.max(1, Number(event.target.value) || 1))
              }
              onBlur={() => void reparse(sheetName, headerRow, mapping)}
              type="number"
              value={headerRow}
            />
          </label>
        </div>
      )}

      {tableResult && sourceType !== 'ICS' && (
        <details className="column-mapping-panel">
          <summary>{t('列映射（无法自动识别表头时在这里调整）')}</summary>
          <div className="column-mapping-grid">
            {columnOptions.map(([field, label]) => (
              <label key={field}>
                {t(label)}
                <select
                  disabled={busy}
                  onChange={(event) => {
                    const value =
                      event.target.value === ''
                        ? null
                        : Number(event.target.value);
                    const next = {
                      ...(mapping ?? tableResult.mapping),
                      [field]: value,
                    };
                    setMapping(next);
                    void reparse(sheetName, headerRow, next);
                  }}
                  value={
                    mapping?.[field] === undefined
                      ? (tableResult.mapping[field] ?? '')
                      : (mapping[field] ?? '')
                  }
                >
                  <option value="">{t('不映射')}</option>
                  {tableResult.headers.map((header, index) => (
                    <option key={`${index}-${header}`} value={index}>
                      {header || `第 ${index + 1} 列`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </details>
      )}

      {(error || success) && (
        <div
          className={`import-message ${error ? 'import-error' : 'import-success'}`}
          role={error ? 'alert' : 'status'}
        >
          <span>{translateSystemMessage(error || success)}</span>
          {error && (
            <button
              className="retry-button"
              onClick={() => setError('')}
              type="button"
            >
              {t('知道了')}
            </button>
          )}
        </div>
      )}

      {batches.length > 0 && (
        <section className="import-batch-history" aria-label={t('导入记录')}>
          <strong>{t('最近导入记录')}</strong>
          {batches.map((batch) => (
            <div className="import-batch-row" key={batch.id}>
              <span>
                {batch.sourceLabel} ·{' '}
                {formatDate(new Date(batch.createdAt), {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}{' '}
                · {batch.importedCourseCount} {t('门课程 /')}{' '}
                {batch.importedEventCount} {t('条日程')}
                {batch.undoneAt ? t(' · 已撤销') : ''}
              </span>
              {!batch.undoneAt &&
                batch.importedCourseCount + batch.importedEventCount > 0 && (
                  <button
                    className="quiet-button compact-button"
                    disabled={busy}
                    onClick={() => void undoBatch(batch.id)}
                    type="button"
                  >
                    {t('撤销此批次')}
                  </button>
                )}
            </div>
          ))}
        </section>
      )}

      {file && (
        <div className="structured-counts">
          <span>
            {t('识别')} {seenCount} {t('项')}
          </span>
          <span>
            {t('待确认')}{' '}
            {
              activeDrafts.filter(
                (draft) => draftErrors(draft, semester).length > 0,
              ).length
            }{' '}
            {t('项')}
          </span>
          <span>
            {t('目标学期')} {semester.semesterName}
          </span>
        </div>
      )}

      {parseWarnings.length > 0 && (
        <ul className="structured-warning-list">
          {parseWarnings.map((warning, index) => (
            <li key={`${index}-${warning}`}>{t(warning)}</li>
          ))}
        </ul>
      )}

      {file && (
        <div className="structured-draft-toolbar">
          <strong>{t('校对内容')}</strong>
          <div>
            <button
              className="quiet-button compact-button"
              onClick={() => addManual('course')}
              type="button"
            >
              {t('＋ 添加课程')}
            </button>
            {sourceType === 'ICS' && (
              <button
                className="quiet-button compact-button"
                onClick={() => addManual('event')}
                type="button"
              >
                {t('＋ 添加日程')}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="structured-draft-list">
        {drafts.map((draft, index) => {
          const errors = draftErrors(draft, semester);
          const duplicate = analysis?.duplicates.find(
            (item) =>
              item.itemIndex ===
              activeDrafts.findIndex((active) => active.id === draft.id),
          );
          const conflict = analysis?.conflicts.find(
            (item) =>
              item.firstItemIndex === index || item.secondItemIndex === index,
          );
          return (
            <article
              className={`import-course-card${errors.length ? ' needs-review' : ''}`}
              key={draft.id}
            >
              <div className="import-course-card-top">
                <label className="include-course">
                  <input
                    checked={draft.included}
                    onChange={(event) =>
                      updateDraft(draft.id, { included: event.target.checked })
                    }
                    type="checkbox"
                  />
                  {t('导入')}
                </label>
                <select
                  aria-label={t('导入为课程或日程')}
                  className="draft-kind-select"
                  onChange={(event) =>
                    updateDraft(draft.id, {
                      kind: event.target.value as 'course' | 'event',
                      exceptions:
                        event.target.value === 'event' ? [] : draft.exceptions,
                    })
                  }
                  value={draft.kind}
                >
                  <option value="course">{t('课程')}</option>
                  <option value="event">{t('单次日程')}</option>
                </select>
                <button
                  aria-label={`${t('删除')} ${draft.courseName || t('未命名记录')}`}
                  className="row-action delete-action"
                  onClick={() => removeDraft(draft.id)}
                  type="button"
                >
                  ×
                </button>
                <span
                  className={
                    errors.length ? 'course-review-state' : 'course-ready-state'
                  }
                >
                  {t(errors.length ? '待确认' : '已完整')}
                </span>
              </div>
              <div className="import-field-grid">
                <label className="wide-field">
                  {t(draft.kind === 'course' ? '课程名称' : '日程标题')}
                  <input
                    onChange={(event) =>
                      updateDraft(draft.id, { courseName: event.target.value })
                    }
                    value={draft.courseName}
                  />
                </label>
                {draft.kind === 'course' ? (
                  <>
                    <label>
                      {t('星期')}
                      <select
                        onChange={(event) =>
                          updateDraft(draft.id, {
                            weekday: Number(event.target.value) || null,
                          })
                        }
                        value={draft.weekday ?? ''}
                      >
                        <option value="">{t('待确认')}</option>
                        {weekDays.map((day, dayIndex) => (
                          <option key={day} value={dayIndex + 1}>
                            {day}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {t('重复规则')}
                      <select
                        onChange={(event) =>
                          updateDraft(draft.id, {
                            recurrenceType: (event.target.value ||
                              null) as RecurrenceType | null,
                          })
                        }
                        value={draft.recurrenceType ?? ''}
                      >
                        <option value="">{t('待确认')}</option>
                        {recurrenceOptions.map(([value, label]) => (
                          <option key={value} value={value}>
                            {t(label)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {t('开始时间')}
                      <input
                        onChange={(event) =>
                          updateDraft(draft.id, {
                            startTime: event.target.value || null,
                          })
                        }
                        type="time"
                        value={draft.startTime ?? ''}
                      />
                    </label>
                    <label>
                      {t('结束时间')}
                      <input
                        onChange={(event) =>
                          updateDraft(draft.id, {
                            endTime: event.target.value || null,
                          })
                        }
                        type="time"
                        value={draft.endTime ?? ''}
                      />
                    </label>
                    <label>
                      {t('开始周次')}
                      <input
                        max={semesterWeekCount(semester)}
                        min={1}
                        onChange={(event) =>
                          updateDraft(draft.id, {
                            firstWeek: Number(event.target.value) || null,
                          })
                        }
                        type="number"
                        value={draft.firstWeek ?? ''}
                      />
                    </label>
                    <label>
                      {t('结束周次')}
                      <input
                        max={semesterWeekCount(semester)}
                        min={1}
                        onChange={(event) =>
                          updateDraft(draft.id, {
                            lastWeek: Number(event.target.value) || null,
                          })
                        }
                        type="number"
                        value={draft.lastWeek ?? ''}
                      />
                    </label>
                    {draft.recurrenceType === 'CUSTOM' && (
                      <label className="custom-weeks-field">
                        {t('指定周次（逗号分隔）')}
                        <input
                          onChange={(event) =>
                            updateDraft(draft.id, {
                              customWeeks: [
                                ...new Set(
                                  event.target.value
                                    .match(/\d{1,2}/g)
                                    ?.map(Number) ?? [],
                                ),
                              ].sort((a, b) => a - b),
                            })
                          }
                          placeholder={t('例如：1, 3, 8, 12')}
                          value={draft.customWeeks.join(', ')}
                        />
                      </label>
                    )}
                    <label>
                      {t('教室')}
                      <input
                        onChange={(event) =>
                          updateDraft(draft.id, {
                            classroom: event.target.value,
                          })
                        }
                        value={draft.classroom}
                      />
                    </label>
                    <label>
                      {t('教师')}
                      <input
                        onChange={(event) =>
                          updateDraft(draft.id, { teacher: event.target.value })
                        }
                        value={draft.teacher}
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <label>
                      {t('日期')}
                      <input
                        onChange={(event) =>
                          updateDraft(draft.id, {
                            eventDate: event.target.value || null,
                          })
                        }
                        type="date"
                        value={draft.eventDate ?? ''}
                      />
                    </label>
                    <label>
                      {t('地点')}
                      <input
                        onChange={(event) =>
                          updateDraft(draft.id, {
                            classroom: event.target.value,
                          })
                        }
                        value={draft.classroom}
                      />
                    </label>
                    <label className="wide-field">
                      <span className="review-confirm">
                        <input
                          checked={draft.isAllDay}
                          onChange={(event) =>
                            updateDraft(draft.id, {
                              isAllDay: event.target.checked,
                            })
                          }
                          type="checkbox"
                        />
                        {t('全天事件')}
                      </span>
                    </label>
                    {!draft.isAllDay && (
                      <>
                        <label>
                          {t('开始时间')}
                          <input
                            onChange={(event) =>
                              updateDraft(draft.id, {
                                startTime: event.target.value || null,
                              })
                            }
                            type="time"
                            value={draft.startTime ?? ''}
                          />
                        </label>
                        <label>
                          {t('结束时间')}
                          <input
                            onChange={(event) =>
                              updateDraft(draft.id, {
                                endTime: event.target.value || null,
                              })
                            }
                            type="time"
                            value={draft.endTime ?? ''}
                          />
                        </label>
                      </>
                    )}
                  </>
                )}
                <label className="wide-field">
                  {t('备注')}
                  <textarea
                    onChange={(event) =>
                      updateDraft(draft.id, { notes: event.target.value })
                    }
                    value={draft.notes}
                  />
                </label>
              </div>
              {errors.length > 0 && (
                <ul className="course-field-errors">
                  {errors.map((message) => (
                    <li key={message}>{t(message)}</li>
                  ))}
                </ul>
              )}
              {draft.warnings.length > 0 && (
                <ul className="structured-warning-list">
                  {draft.warnings.map((warning) => (
                    <li key={warning}>{t(warning)}</li>
                  ))}
                </ul>
              )}
              {duplicate && (
                <div className="duplicate-choice">
                  {t('可能重复：')}
                  {duplicate.title}
                  <select
                    onChange={(event) =>
                      setDuplicateActions((previous) => ({
                        ...previous,
                        [draft.id]: event.target.value as 'skip' | 'keep',
                      }))
                    }
                    value={duplicateActions[draft.id] ?? 'skip'}
                  >
                    <option value="skip">{t('跳过')}</option>
                    <option value="keep">{t('仍然导入')}</option>
                  </select>
                </div>
              )}
              {conflict && (
                <div className="conflict-warning">
                  {t('存在时间冲突：')}
                  {conflict.firstCourseName} / {conflict.secondCourseName}
                  {t('。可以校对后继续。')}
                </div>
              )}
              <label className="review-confirm">
                <input
                  checked={draft.reviewed}
                  onChange={(event) =>
                    updateDraft(draft.id, { reviewed: event.target.checked })
                  }
                  type="checkbox"
                />
                {t('我已确认这条记录的类别、时间和周次')}
              </label>
              <details className="course-raw-details">
                <summary>{t('查看来源信息和原始文本')}</summary>
                <small>
                  {draft.sourceLabel} · {draft.sourceType} · {draft.sourceId}
                </small>
                <pre>{draft.rawText || t('无可用原始文本')}</pre>
              </details>
              {draft.exceptions.length > 0 && (
                <p className="exception-import-note">
                  {t('该课程将一并导入')} {draft.exceptions.length}{' '}
                  {t('条单次停课/调课例外。')}
                </p>
              )}
            </article>
          );
        })}
      </div>

      {file && drafts.length === 0 && !busy && (
        <div className="empty-state planner-card">
          {t(
            '没有解析出课程或日程。可以调整工作表/表头/列映射后重新解析，或手动添加课程。',
          )}
        </div>
      )}

      {file && (
        <div className="structured-import-footer">
          <span>
            {busy
              ? t('正在读取或检查文件…')
              : t('{{selected}} selected · {{review}} need review', {
                  selected: activeDrafts.length,
                  review: invalidDrafts.length,
                })}
          </span>
          {analysis ? (
            <button
              className="primary-button"
              disabled={
                busy || !activeDrafts.length || invalidDrafts.length > 0
              }
              onClick={() => void importConfirmed()}
              type="button"
            >
              {busy
                ? t('正在写入…')
                : t('确认导入 {{count}} 条', { count: activeDrafts.length })}
            </button>
          ) : (
            <button
              className="primary-button"
              disabled={
                busy || !activeDrafts.length || invalidDrafts.length > 0
              }
              onClick={() => void analyze()}
              type="button"
            >
              {busy ? t('正在检查…') : t('检查重复与冲突')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
