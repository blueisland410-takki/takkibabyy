import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type PointerEvent,
} from 'react';
import Tesseract from 'tesseract.js';
import type {
  Course,
  CourseInput,
  ImportBatchAnalysis,
  ImportBatchPayload,
  ImportBatchSummary,
  RecurrenceType,
  Semester,
} from './domain';
import { StructuredImport } from './StructuredImport';
import { sha256 } from './importParsers';
import type { OcrLine, TimetableCourseDraft } from './timetableParser';
import {
  ocrLinesFromBlocks,
  parseTimetableLines,
  timeRangeForPeriods,
} from './timetableParser';

type Props = {
  semester: Semester;
  existingCourses: Course[];
  onClose: () => void;
  onImported: () => void;
};

type PeriodDraft = { periodNumber: number; startTime: string; endTime: string };
type AnalysisState = {
  result: ImportBatchAnalysis;
  courseIds: string[];
  payload: ImportBatchPayload;
};
type ImportMode = 'IMAGE' | 'ICS' | 'XLSX' | 'CSV';

const weekdays = [
  '星期一',
  '星期二',
  '星期三',
  '星期四',
  '星期五',
  '星期六',
  '星期日',
];
const recurrenceOptions: Array<[RecurrenceType, string]> = [
  ['ALL', '每周'],
  ['ODD', '单周'],
  ['EVEN', '双周'],
  ['CUSTOM', '指定周次'],
];
const maxImageBytes = 15 * 1024 * 1024;
const maxImagePixels = 30_000_000;

const localWeekCount = (semester: Semester) => {
  const end = new Date(`${semester.endDate}T00:00:00Z`).getTime();
  const monday = new Date(`${semester.firstWeekMonday}T00:00:00Z`).getTime();
  return Math.max(1, Math.ceil((end - monday + 1) / (7 * 86_400_000)));
};

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : '操作失败，请重试。';

function extractRawLines(data: Tesseract.Page): OcrLine[] {
  const withCoordinates = ocrLinesFromBlocks(data.blocks);
  if (withCoordinates.length) return withCoordinates;
  return data.text
    .split(/\r?\n/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text, index) => ({
      text,
      confidence: null,
      bbox: { x0: 0, y0: index * 20, x1: 1, y1: index * 20 + 16 },
    }));
}

function validateCourseDraft(
  course: TimetableCourseDraft,
  semester: Semester,
): { input?: CourseInput; errors: string[] } {
  const errors: string[] = [];
  if (!course.courseName.trim()) errors.push('课程名称不能为空');
  if (!course.weekday || course.weekday < 1 || course.weekday > 7)
    errors.push('星期待确认');
  if (!course.startTime || !course.endTime) errors.push('开始和结束时间待确认');
  if (course.startTime && course.endTime && course.endTime <= course.startTime)
    errors.push('结束时间必须晚于开始时间');
  if (
    !course.firstWeek ||
    !course.lastWeek ||
    course.firstWeek > course.lastWeek
  )
    errors.push('周次范围待确认');
  if (
    course.firstWeek &&
    course.lastWeek &&
    course.lastWeek > localWeekCount(semester)
  )
    errors.push(`不能超过本学期第 ${localWeekCount(semester)} 周`);
  if (!course.recurrenceType) errors.push('重复规则待确认');
  if (course.recurrenceType === 'CUSTOM' && !course.customWeeks.length)
    errors.push('请填写指定周次');
  if (!course.reviewed) errors.push('请先勾选已对照原图核对');
  if (
    errors.length ||
    !course.weekday ||
    !course.firstWeek ||
    !course.lastWeek ||
    !course.recurrenceType
  ) {
    return { errors };
  }
  return {
    input: {
      semesterId: semester.id,
      courseName: course.courseName.trim(),
      weekday: course.weekday,
      startTime: course.startTime,
      endTime: course.endTime,
      classroom: course.classroom.trim(),
      teacher: course.teacher.trim(),
      notes: '',
      firstWeek: course.firstWeek,
      lastWeek: course.lastWeek,
      recurrenceType: course.recurrenceType,
      customWeeks: course.recurrenceType === 'CUSTOM' ? course.customWeeks : [],
    },
    errors,
  };
}

function blankCourse(id: string): TimetableCourseDraft {
  return {
    id,
    courseName: '',
    weekday: null,
    startTime: '',
    endTime: '',
    classroom: '',
    teacher: '',
    firstWeek: null,
    lastWeek: null,
    recurrenceType: null,
    customWeeks: [],
    periodStart: null,
    periodEnd: null,
    confidence: null,
    sourceText: '',
    issues: ['手动新增，请补全课程信息'],
    reviewed: false,
  };
}

export function TimetableImport({
  semester,
  existingCourses,
  onClose,
  onImported,
}: Props) {
  const [sourceMode, setSourceMode] = useState<ImportMode>('IMAGE');
  const [file, setFile] = useState<File | null>(null);
  const [fileHash, setFileHash] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [imageSize, setImageSize] = useState('');
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panStart = useRef<{
    x: number;
    y: number;
    baseX: number;
    baseY: number;
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Tesseract.Worker | null>(null);
  const cancelledRef = useRef(false);
  const [error, setError] = useState('');
  const [recognitionStatus, setRecognitionStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [recognizing, setRecognizing] = useState(false);
  const [rawText, setRawText] = useState('');
  const [rawLines, setRawLines] = useState<OcrLine[]>([]);
  const [unassignedText, setUnassignedText] = useState<string[]>([]);
  const [weekdayColumnsFound, setWeekdayColumnsFound] = useState(0);
  const [courses, setCourses] = useState<TimetableCourseDraft[]>([]);
  const [includedIds, setIncludedIds] = useState<Set<string>>(new Set());
  const [periodCount, setPeriodCount] = useState(12);
  const [periodDrafts, setPeriodDrafts] = useState<PeriodDraft[]>([]);
  const [periodTemplateSaved, setPeriodTemplateSaved] = useState(false);
  const [savingPeriods, setSavingPeriods] = useState(false);
  const [analysisState, setAnalysisState] = useState<AnalysisState | null>(
    null,
  );
  const [duplicateActions, setDuplicateActions] = useState<
    Record<string, 'skip' | 'keep'>
  >({});
  const [analyzing, setAnalyzing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [success, setSuccess] = useState('');
  const [importBatches, setImportBatches] = useState<ImportBatchSummary[]>([]);

  const semesterWeeks = useMemo(() => localWeekCount(semester), [semester]);
  const includedCourses = courses.filter((course) =>
    includedIds.has(course.id),
  );
  const readyCourses = includedCourses.map((course) => ({
    course,
    ...validateCourseDraft(course, semester),
  }));
  const importableCourses = readyCourses.filter((item) => item.input);
  const currentAnalysis = analysisState?.result;

  useEffect(() => {
    void window.dayByDay
      .listImportBatches(semester.id)
      .then(setImportBatches)
      .catch((failure: unknown) => setError(errorText(failure)));
    void window.dayByDay
      .setImportWindowMode(true)
      .catch((failure: unknown) => setError(errorText(failure)));
    void window.dayByDay
      .getClassPeriodTimes()
      .then((periods) => {
        if (periods.length) {
          setPeriodCount(periods.length);
          setPeriodDrafts(periods);
          setPeriodTemplateSaved(true);
        } else {
          setPeriodDrafts(
            Array.from({ length: 12 }, (_, index) => ({
              periodNumber: index + 1,
              startTime: '',
              endTime: '',
            })),
          );
        }
      })
      .catch((failure: unknown) => setError(errorText(failure)));
    return () => {
      if (workerRef.current) void workerRef.current.terminate();
      void window.dayByDay.setImportWindowMode(false);
    };
    // This page's window mode is a mount/unmount concern; preview cleanup is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (previewUrl) return () => URL.revokeObjectURL(previewUrl);
    return undefined;
  }, [previewUrl]);

  const markEdited = (nextCourses: TimetableCourseDraft[]) => {
    setCourses(nextCourses);
    setAnalysisState(null);
    setSuccess('');
  };

  const loadImage = async (nextFile: File) => {
    setError('');
    setSuccess('');
    setAnalysisState(null);
    const extension = nextFile.name.toLocaleLowerCase().split('.').pop();
    if (!['png', 'jpg', 'jpeg'].includes(extension ?? '')) {
      setError('只支持 PNG、JPG 或 JPEG 图片。');
      return;
    }
    if (nextFile.size <= 0 || nextFile.size > maxImageBytes) {
      setError('图片大小必须大于 0 且不超过 15 MB。');
      return;
    }
    try {
      const signature = new Uint8Array(
        await nextFile.slice(0, 12).arrayBuffer(),
      );
      const isPng =
        signature.length >= 8 &&
        [137, 80, 78, 71, 13, 10, 26, 10].every(
          (value, index) => signature[index] === value,
        );
      const isJpeg =
        signature.length >= 3 &&
        signature[0] === 0xff &&
        signature[1] === 0xd8 &&
        signature[2] === 0xff;
      const matchesExtension = extension === 'png' ? isPng : isJpeg;
      const matchesMime =
        !nextFile.type ||
        (isPng
          ? nextFile.type === 'image/png'
          : ['image/jpeg', 'image/jpg'].includes(nextFile.type));
      if (!matchesExtension || !matchesMime)
        throw new Error(
          '文件扩展名、MIME 类型和图片实际内容不匹配，或内容不是有效 PNG/JPEG。',
        );
      const bitmap = await createImageBitmap(nextFile);
      const { width, height } = bitmap;
      bitmap.close();
      if (width < 240 || height < 160)
        throw new Error('图片尺寸太小，至少需要 240 × 160 像素。');
      if (width * height > maxImagePixels)
        throw new Error('图片像素超过 3000 万，请先缩小后再试。');
      const url = URL.createObjectURL(nextFile);
      const contentHash = await sha256(await nextFile.arrayBuffer());
      setPreviewUrl(url);
      setFile(nextFile);
      setFileHash(contentHash);
      setImageSize(`${width} × ${height}`);
      setScale(1);
      setPan({ x: 0, y: 0 });
      setRawText('');
      setRawLines([]);
      setUnassignedText([]);
      setWeekdayColumnsFound(0);
      markEdited([]);
      setIncludedIds(new Set());
    } catch (failure) {
      setError(errorText(failure));
    }
  };

  const chooseImage = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (selected) void loadImage(selected);
    event.target.value = '';
  };

  const dropImage = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const dropped = event.dataTransfer.files[0];
    if (dropped) void loadImage(dropped);
  };

  const recognize = async () => {
    if (!file || recognizing) return;
    cancelledRef.current = false;
    setRecognizing(true);
    setError('');
    setSuccess('');
    setProgress(0);
    setRecognitionStatus('正在启动本地 OCR…');
    let worker: Tesseract.Worker | null = null;
    try {
      worker = await Tesseract.createWorker(
        'eng+chi_sim',
        Tesseract.OEM.LSTM_ONLY,
        {
          workerPath: 'daybyday-ocr://worker/worker.min.js',
          corePath: 'daybyday-ocr://core/tesseract-core-lstm.wasm.js',
          langPath: 'daybyday-ocr://lang',
          gzip: true,
          logger: (message) => {
            setProgress(Math.round(message.progress * 100));
            setRecognitionStatus(message.status || '正在识别…');
          },
        },
      );
      workerRef.current = worker;
      if (cancelledRef.current) {
        await worker.terminate();
        return;
      }
      const result = await worker.recognize(
        file,
        {},
        { text: true, blocks: true },
      );
      if (cancelledRef.current) return;
      const lines = extractRawLines(result.data);
      const parsed = parseTimetableLines(lines, semesterWeeks);
      const nonEmpty = parsed.courses;
      setRawText(result.data.text);
      setRawLines(lines);
      setCourses(nonEmpty);
      setIncludedIds(new Set(nonEmpty.map((course) => course.id)));
      setUnassignedText(parsed.unassignedText);
      setWeekdayColumnsFound(parsed.weekdayColumnsFound);
      setAnalysisState(null);
      setRecognitionStatus(
        nonEmpty.length
          ? `识别完成：发现 ${nonEmpty.length} 个候选课程`
          : '文字识别完成，但没有可靠识别出课程单元格',
      );
      if (!lines.length || !result.data.text.trim())
        setError('没有识别到文字。请换一张更清晰的图片，或手动新增课程。');
    } catch (failure) {
      if (!cancelledRef.current)
        setError(
          `本地识别失败：${errorText(failure)} 请检查本地 OCR 资源后重试。`,
        );
    } finally {
      if (worker && workerRef.current === worker) {
        workerRef.current = null;
        await worker.terminate().catch(() => undefined);
      }
      if (!cancelledRef.current) setRecognizing(false);
    }
  };

  const cancelRecognition = () => {
    cancelledRef.current = true;
    setRecognizing(false);
    setRecognitionStatus('识别已取消，可以再次点击 Recognize 重试。');
    if (workerRef.current) {
      const worker = workerRef.current;
      workerRef.current = null;
      void worker.terminate();
    }
  };

  const savePeriodTemplate = async () => {
    if (savingPeriods) return;
    setSavingPeriods(true);
    setError('');
    try {
      const result = await window.dayByDay.saveClassPeriodTimes(periodDrafts);
      setPeriodDrafts(result);
      setPeriodCount(result.length);
      setPeriodTemplateSaved(true);
      markEdited(
        courses.map((course) => {
          if (!course.periodStart || !course.periodEnd) return course;
          const mapped = timeRangeForPeriods(
            course.periodStart,
            course.periodEnd,
            result,
          );
          if (!mapped) return course;
          return { ...course, ...mapped, reviewed: false };
        }),
      );
    } catch (failure) {
      setError(`节次模板没有保存：${errorText(failure)}`);
    } finally {
      setSavingPeriods(false);
    }
  };

  const setPeriodCountSafe = (value: number) => {
    const nextCount = Math.max(1, Math.min(24, value || 1));
    setPeriodCount(nextCount);
    setPeriodDrafts((previous) =>
      Array.from(
        { length: nextCount },
        (_, index) =>
          previous[index] ?? {
            periodNumber: index + 1,
            startTime: '',
            endTime: '',
          },
      ),
    );
    setPeriodTemplateSaved(false);
  };

  const updateCourse = (id: string, update: Partial<TimetableCourseDraft>) => {
    const confirmed = Object.hasOwn(update, 'reviewed');
    markEdited(
      courses.map((course) =>
        course.id === id
          ? {
              ...course,
              ...update,
              reviewed: confirmed ? (update.reviewed ?? false) : false,
            }
          : course,
      ),
    );
  };

  const applyPeriodRange = (
    course: TimetableCourseDraft,
    start: number | null,
    end: number | null,
  ) => {
    const mapped =
      start && end ? timeRangeForPeriods(start, end, periodDrafts) : null;
    return {
      periodStart: start,
      periodEnd: end,
      ...mapped,
    };
  };

  const addCourse = () => {
    const course = blankCourse(`manual-${Date.now()}`);
    markEdited([...courses, course]);
    setIncludedIds((previous) => new Set([...previous, course.id]));
  };

  const analyze = async () => {
    const invalid = readyCourses.filter((item) => !item.input);
    if (!file || !fileHash) {
      setError('请先选择课表图片；也可以在图片上校对漏识别的课程。');
      return;
    }
    if (invalid.length || !importableCourses.length) {
      setError(
        '请补全所有勾选课程的必填项、周次和时间，并勾选“已对照原图核对”。',
      );
      return;
    }
    setAnalyzing(true);
    setError('');
    setSuccess('');
    try {
      const inputs = importableCourses.map((item) => item.input as CourseInput);
      const payload: ImportBatchPayload = {
        options: {
          semesterId: semester.id,
          sourceType: 'IMAGE',
          sourceLabel: file.name,
          contentHash: fileHash,
        },
        items: importableCourses.map((item, index) => ({
          kind: 'course' as const,
          sourceId: `${fileHash}:${item.course.id}:${index}`,
          input: item.input as CourseInput,
          exceptions: [],
        })),
      };
      const result = await window.dayByDay.analyzeImportBatch(payload);
      setAnalysisState({
        result,
        courseIds: importableCourses.map((item) => item.course.id),
        payload,
      });
      setDuplicateActions(
        Object.fromEntries(
          result.duplicates
            .map((duplicate) => {
              const id = importableCourses[duplicate.itemIndex]?.course.id;
              return id ? [id, 'skip'] : ['', 'skip'];
            })
            .filter(([id]) => Boolean(id)),
        ),
      );
      setSuccess(
        `检查完成：${inputs.length} 门课程；发现 ${result.duplicates.length} 条可能重复、${result.conflicts.length} 处时间冲突。`,
      );
    } catch (failure) {
      setError(`检查课程失败：${errorText(failure)}`);
    } finally {
      setAnalyzing(false);
    }
  };

  const confirmImport = async () => {
    if (!analysisState || importing || !currentAnalysis) return;
    const confirmed = window.confirm(
      `即将导入 ${analysisState.courseIds.length} 门已校对课程至“${semester.semesterName}”。重复课程默认跳过；时间冲突只提示，不会覆盖已有课程。继续吗？`,
    );
    if (!confirmed) return;
    setImporting(true);
    setError('');
    try {
      const decisions = currentAnalysis.duplicates.map((duplicate) => ({
        itemIndex: duplicate.itemIndex,
        action:
          duplicateActions[analysisState.courseIds[duplicate.itemIndex]] ??
          'skip',
      }));
      const result = await window.dayByDay.importBatch(
        analysisState.payload,
        decisions,
      );
      setAnalysisState(null);
      setImportBatches(await window.dayByDay.listImportBatches(semester.id));
      setSuccess(
        `导入完成：新增 ${result.importedCount} 门课程，跳过 ${result.skippedCount} 条重复课程。`,
      );
      onImported();
    } catch (failure) {
      setError(
        `课程未导入，原有课程保持不变：${errorText(failure)}。请重新检查后重试。`,
      );
      setAnalysisState(null);
    } finally {
      setImporting(false);
    }
  };

  const undoImportBatch = async (batchId: string) => {
    if (importing) return;
    if (!window.confirm('仅撤销此批次新增且之后没有修改的课程。继续吗？'))
      return;
    setImporting(true);
    setError('');
    try {
      const result = await window.dayByDay.undoImportBatch(batchId);
      setImportBatches(await window.dayByDay.listImportBatches(semester.id));
      setSuccess(
        `批次已撤销：移除 ${result.removedCourseCount} 门课程；${result.retainedItemCount} 门因导入后有修改而保留。`,
      );
      onImported();
    } catch (failure) {
      setError(`撤销失败：${errorText(failure)}`);
    } finally {
      setImporting(false);
    }
  };

  const onImagePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (scale <= 1) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panStart.current = {
      x: event.clientX,
      y: event.clientY,
      baseX: pan.x,
      baseY: pan.y,
    };
  };
  const onImagePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!panStart.current) return;
    setPan({
      x: panStart.current.baseX + event.clientX - panStart.current.x,
      y: panStart.current.baseY + event.clientY - panStart.current.y,
    });
  };
  const stopImagePointer = () => {
    panStart.current = null;
  };

  const methodButtons = (
    <nav aria-label="导入格式" className="import-method-switch">
      {(
        [
          ['IMAGE', 'Import from image'],
          ['ICS', 'Import ICS'],
          ['XLSX', 'Import Excel'],
          ['CSV', 'Import CSV'],
        ] as Array<[ImportMode, string]>
      ).map(([mode, label]) => (
        <button
          aria-pressed={sourceMode === mode}
          className={sourceMode === mode ? 'is-selected' : ''}
          key={mode}
          onClick={() => setSourceMode(mode)}
          type="button"
        >
          {label}
        </button>
      ))}
      <button
        className="future-import-method"
        disabled
        title="PDF / DOCX 将在检查点 C 实现"
        type="button"
      >
        Import document · C 阶段
      </button>
    </nav>
  );

  if (sourceMode !== 'IMAGE') {
    return (
      <section aria-label="课程导入" className="timetable-import">
        <div className="import-heading">
          <div>
            <p className="eyebrow">SMART TIMETABLE IMPORT</p>
            <h1>导入课程表</h1>
            <p className="import-semester">
              目标学期：{semester.semesterName} · {semesterWeeks} 周
            </p>
          </div>
        </div>
        {methodButtons}
        <StructuredImport
          onClose={onClose}
          onImported={onImported}
          semester={semester}
          sourceType={sourceMode}
        />
      </section>
    );
  }

  return (
    <section aria-label="课表截图导入" className="timetable-import">
      <div className="import-heading">
        <div>
          <p className="eyebrow">SMART TIMETABLE IMPORT</p>
          <h1>导入课程表</h1>
          <p className="import-semester">
            目标学期：{semester.semesterName} · {semesterWeeks} 周
          </p>
        </div>
        <button className="quiet-button" onClick={onClose} type="button">
          返回课程列表
        </button>
      </div>

      {methodButtons}

      {importBatches.length > 0 && (
        <section className="import-batch-history" aria-label="导入记录">
          <strong>最近导入记录</strong>
          {importBatches.map((batch) => (
            <div className="import-batch-row" key={batch.id}>
              <span>
                {batch.sourceLabel} ·{' '}
                {new Date(batch.createdAt).toLocaleString()} ·{' '}
                {batch.importedCourseCount} 门课程 / {batch.importedEventCount}{' '}
                条日程
                {batch.undoneAt ? ' · 已撤销' : ''}
              </span>
              {!batch.undoneAt &&
                batch.importedCourseCount + batch.importedEventCount > 0 && (
                  <button
                    className="quiet-button compact-button"
                    disabled={importing}
                    onClick={() => void undoImportBatch(batch.id)}
                    type="button"
                  >
                    撤销此批次
                  </button>
                )}
            </div>
          ))}
        </section>
      )}

      {(error || success) && (
        <div
          className={
            error
              ? 'import-message import-error'
              : 'import-message import-success'
          }
          role={error ? 'alert' : 'status'}
        >
          <span>{error || success}</span>
          {error && (
            <button
              className="retry-button"
              onClick={() => setError('')}
              type="button"
            >
              知道了
            </button>
          )}
        </div>
      )}

      <div className="import-layout">
        <aside className="import-source-column">
          <section className="import-panel source-panel">
            <div className="import-panel-heading">
              <div>
                <h2>原始课表截图</h2>
                <span>{imageSize || '仅暂存于当前页面，不会写入数据库'}</span>
              </div>
              <div className="image-actions">
                {file && (
                  <button
                    className="quiet-button compact-button"
                    onClick={() => void loadImage(file)}
                    type="button"
                    title="清除识别结果并重新识别"
                  >
                    重新识别
                  </button>
                )}
                {file && (
                  <button
                    className="quiet-button compact-button"
                    onClick={() => {
                      setFile(null);
                      setFileHash('');
                      setPreviewUrl('');
                      setCourses([]);
                      setRawText('');
                      setAnalysisState(null);
                    }}
                    type="button"
                  >
                    清除
                  </button>
                )}
              </div>
            </div>
            <input
              accept=".png,.jpg,.jpeg,image/png,image/jpeg"
              className="hidden-file-input"
              onChange={chooseImage}
              ref={fileInput}
              type="file"
            />
            <div
              className={`image-dropzone${file ? ' has-image' : ''}`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={dropImage}
              onPointerCancel={stopImagePointer}
              onPointerDown={onImagePointerDown}
              onPointerMove={onImagePointerMove}
              onPointerUp={stopImagePointer}
              role="region"
              aria-label="课表图片预览，可拖入图片"
            >
              {previewUrl ? (
                <img
                  alt="待识别的课程表原图"
                  draggable={false}
                  src={previewUrl}
                  style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
                  }}
                />
              ) : (
                <div className="dropzone-copy">
                  <span>＋</span>
                  <strong>拖入课程表图片</strong>
                  <small>或点击下方选择 PNG / JPG / JPEG</small>
                  <button
                    className="quiet-button"
                    onClick={() => fileInput.current?.click()}
                    type="button"
                  >
                    选择图片
                  </button>
                  <small>≤ 15 MB · 至少 240 × 160 · 不会上传</small>
                </div>
              )}
            </div>
            {file && (
              <div className="image-toolbar">
                <span title={file.name}>{file.name}</span>
                <div>
                  <button
                    aria-label="缩小图片"
                    className="row-action"
                    onClick={() =>
                      setScale((value) => Math.max(0.5, value - 0.25))
                    }
                    type="button"
                  >
                    −
                  </button>
                  <span>{Math.round(scale * 100)}%</span>
                  <button
                    aria-label="放大图片"
                    className="row-action"
                    onClick={() =>
                      setScale((value) => Math.min(3, value + 0.25))
                    }
                    type="button"
                  >
                    ＋
                  </button>
                  <button
                    className="text-action"
                    onClick={() => {
                      setScale(1);
                      setPan({ x: 0, y: 0 });
                    }}
                    type="button"
                  >
                    重置
                  </button>
                </div>
              </div>
            )}
            <div className="recognition-controls">
              {!recognizing ? (
                <button
                  className="primary-button"
                  disabled={!file}
                  onClick={() => void recognize()}
                  type="button"
                >
                  Recognize
                </button>
              ) : (
                <button
                  className="quiet-button"
                  onClick={cancelRecognition}
                  type="button"
                >
                  取消识别
                </button>
              )}
              <div aria-live="polite" className="recognition-progress">
                <span>
                  {recognitionStatus || '识别将在本机运行，首次加载会稍慢。'}
                </span>
                {recognizing && (
                  <>
                    <progress max="100" value={progress} />
                    <strong>{progress}%</strong>
                  </>
                )}
              </div>
            </div>
          </section>

          <details className="period-template-panel" open>
            <summary>
              学校节次时间设置{' '}
              {periodTemplateSaved ? '· 已保存默认模板' : '· 可选'}
            </summary>
            <p>
              截图只有“第 1
              节”等节次时，填写本校时间；没有模板时不会猜测上课时间。
            </p>
            <label className="period-count-label">
              设置节数{' '}
              <input
                max="24"
                min="1"
                onChange={(event) =>
                  setPeriodCountSafe(Number(event.target.value))
                }
                type="number"
                value={periodCount}
              />
            </label>
            <div className="period-template-grid">
              {periodDrafts.slice(0, periodCount).map((period, index) => (
                <div className="period-row" key={period.periodNumber}>
                  <strong>第 {index + 1} 节</strong>
                  <input
                    aria-label={`第 ${index + 1} 节开始时间`}
                    onChange={(event) =>
                      setPeriodDrafts((rows) =>
                        rows.map((item) =>
                          item.periodNumber === index + 1
                            ? { ...item, startTime: event.target.value }
                            : item,
                        ),
                      )
                    }
                    type="time"
                    value={period.startTime}
                  />
                  <span>—</span>
                  <input
                    aria-label={`第 ${index + 1} 节结束时间`}
                    onChange={(event) =>
                      setPeriodDrafts((rows) =>
                        rows.map((item) =>
                          item.periodNumber === index + 1
                            ? { ...item, endTime: event.target.value }
                            : item,
                        ),
                      )
                    }
                    type="time"
                    value={period.endTime}
                  />
                </div>
              ))}
            </div>
            <button
              className="quiet-button"
              disabled={savingPeriods}
              onClick={() => void savePeriodTemplate()}
              type="button"
            >
              {savingPeriods ? '保存中…' : '保存为默认模板'}
            </button>
          </details>
        </aside>

        <div className="import-review-column">
          <section className="import-panel review-panel">
            <div className="import-panel-heading review-heading">
              <div>
                <h2>识别结果校对</h2>
                <span>
                  {weekdayColumnsFound
                    ? `识别到 ${weekdayColumnsFound} 个星期列`
                    : '无法确定表格列时，请手动补全'}
                </span>
              </div>
              <button
                className="text-action"
                disabled={!file}
                onClick={addCourse}
                type="button"
              >
                ＋ 手动新增课程
              </button>
            </div>
            {rawText && (
              <details className="raw-ocr-details">
                <summary>
                  查看原始 OCR 文字和坐标信息（{rawLines.length} 行）
                </summary>
                <pre>
                  {rawLines
                    .map(
                      (line) =>
                        `${line.text}　[x:${Math.round(line.bbox.x0)}, y:${Math.round(line.bbox.y0)} · 置信度:${line.confidence === null ? '—' : Math.round(line.confidence)}]`,
                    )
                    .join('\n') || rawText}
                </pre>
              </details>
            )}
            {unassignedText.length > 0 && (
              <p className="parse-note">
                有 {unassignedText.length}{' '}
                行文字未能放入星期列，保留在原始文字中；请检查是否漏了课程。
              </p>
            )}
            {!courses.length ? (
              <div className="import-empty-state">
                {rawText
                  ? '已读取文字，但暂未可靠识别出课程。可以手动新增，或继续查看原始 OCR 结果。'
                  : '选择一张课表截图并点击 Recognize，识别结果会显示在这里。'}
                {rawText && (
                  <button
                    className="text-action"
                    onClick={addCourse}
                    type="button"
                  >
                    ＋ 手动新增课程
                  </button>
                )}
              </div>
            ) : (
              <div className="import-course-list">
                {courses.map((course) => {
                  const validation = validateCourseDraft(course, semester);
                  const included = includedIds.has(course.id);
                  const duplicate = currentAnalysis?.duplicates.find(
                    (item) =>
                      analysisState?.courseIds[item.itemIndex] === course.id,
                  );
                  const conflicts =
                    currentAnalysis?.conflicts.filter(
                      (item) =>
                        analysisState?.courseIds[item.firstCourseIndex] ===
                          course.id ||
                        analysisState?.courseIds[item.secondCourseIndex] ===
                          course.id,
                    ) ?? [];
                  return (
                    <article
                      className={`import-course-card${validation.errors.length ? ' needs-review' : ''}`}
                      key={course.id}
                    >
                      <div className="import-course-card-top">
                        <label className="include-course">
                          <input
                            checked={included}
                            onChange={(event) => {
                              setIncludedIds((current) => {
                                const next = new Set(current);
                                if (event.target.checked) next.add(course.id);
                                else next.delete(course.id);
                                return next;
                              });
                              setAnalysisState(null);
                            }}
                            type="checkbox"
                          />
                          导入
                        </label>
                        <span
                          className={
                            validation.errors.length
                              ? 'course-review-state'
                              : 'course-ready-state'
                          }
                        >
                          {validation.errors.length ? '待确认' : '已填写'}
                        </span>
                        <button
                          aria-label={`删除识别课程 ${course.courseName || '未命名课程'}`}
                          className="row-action delete-action"
                          onClick={() => {
                            markEdited(
                              courses.filter((item) => item.id !== course.id),
                            );
                            setIncludedIds((current) => {
                              const next = new Set(current);
                              next.delete(course.id);
                              return next;
                            });
                          }}
                          type="button"
                          title="从本次导入移除"
                        >
                          ×
                        </button>
                      </div>
                      <div className="import-field-grid">
                        <label>
                          课程名称
                          <input
                            maxLength={120}
                            onChange={(event) =>
                              updateCourse(course.id, {
                                courseName: event.target.value,
                              })
                            }
                            placeholder="必填"
                            value={course.courseName}
                          />
                        </label>
                        <label>
                          星期
                          <select
                            onChange={(event) =>
                              updateCourse(course.id, {
                                weekday: event.target.value
                                  ? Number(event.target.value)
                                  : null,
                              })
                            }
                            value={course.weekday ?? ''}
                          >
                            <option value="">请选择</option>
                            {weekdays.map((day, index) => (
                              <option key={day} value={index + 1}>
                                {day}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          开始时间
                          <input
                            onChange={(event) =>
                              updateCourse(course.id, {
                                startTime: event.target.value,
                              })
                            }
                            type="time"
                            value={course.startTime}
                          />
                        </label>
                        <label>
                          结束时间
                          <input
                            onChange={(event) =>
                              updateCourse(course.id, {
                                endTime: event.target.value,
                              })
                            }
                            type="time"
                            value={course.endTime}
                          />
                        </label>
                        <label>
                          第几周开始
                          <input
                            max={semesterWeeks}
                            min="1"
                            onChange={(event) =>
                              updateCourse(course.id, {
                                firstWeek: event.target.value
                                  ? Number(event.target.value)
                                  : null,
                              })
                            }
                            type="number"
                            value={course.firstWeek ?? ''}
                          />
                        </label>
                        <label>
                          第几周结束
                          <input
                            max={semesterWeeks}
                            min="1"
                            onChange={(event) =>
                              updateCourse(course.id, {
                                lastWeek: event.target.value
                                  ? Number(event.target.value)
                                  : null,
                              })
                            }
                            type="number"
                            value={course.lastWeek ?? ''}
                          />
                        </label>
                        <label>
                          重复规则
                          <select
                            onChange={(event) =>
                              updateCourse(course.id, {
                                recurrenceType: (event.target.value ||
                                  null) as RecurrenceType | null,
                                customWeeks:
                                  event.target.value === 'CUSTOM'
                                    ? course.customWeeks
                                    : [],
                              })
                            }
                            value={course.recurrenceType ?? ''}
                          >
                            <option value="">请选择</option>
                            {recurrenceOptions.map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          教室
                          <input
                            maxLength={120}
                            onChange={(event) =>
                              updateCourse(course.id, {
                                classroom: event.target.value,
                              })
                            }
                            placeholder="可选"
                            value={course.classroom}
                          />
                        </label>
                        <label>
                          教师
                          <input
                            maxLength={120}
                            onChange={(event) =>
                              updateCourse(course.id, {
                                teacher: event.target.value,
                              })
                            }
                            placeholder="可选"
                            value={course.teacher}
                          />
                        </label>
                        <label>
                          起始节次
                          <select
                            onChange={(event) => {
                              const periodStart = event.target.value
                                ? Number(event.target.value)
                                : null;
                              const periodEnd =
                                course.periodEnd &&
                                periodStart &&
                                course.periodEnd < periodStart
                                  ? periodStart
                                  : course.periodEnd;
                              updateCourse(
                                course.id,
                                applyPeriodRange(
                                  course,
                                  periodStart,
                                  periodEnd,
                                ),
                              );
                            }}
                            value={course.periodStart ?? ''}
                          >
                            <option value="">不使用节次</option>
                            {Array.from({ length: 24 }, (_, index) => (
                              <option key={index + 1} value={index + 1}>
                                第 {index + 1} 节
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          结束节次
                          <select
                            onChange={(event) => {
                              const periodEnd = event.target.value
                                ? Number(event.target.value)
                                : null;
                              updateCourse(
                                course.id,
                                applyPeriodRange(
                                  course,
                                  course.periodStart,
                                  periodEnd,
                                ),
                              );
                            }}
                            value={course.periodEnd ?? ''}
                          >
                            <option value="">不使用节次</option>
                            {Array.from({ length: 24 }, (_, index) => (
                              <option key={index + 1} value={index + 1}>
                                第 {index + 1} 节
                              </option>
                            ))}
                          </select>
                        </label>
                        {course.recurrenceType === 'CUSTOM' && (
                          <label className="custom-weeks-field">
                            指定周次
                            <input
                              onChange={(event) => {
                                const weeks = [
                                  ...new Set(
                                    event.target.value
                                      .split(/[,，、\s]+/)
                                      .filter(Boolean)
                                      .map(Number)
                                      .filter(Number.isInteger),
                                  ),
                                ].sort((a, b) => a - b);
                                updateCourse(course.id, { customWeeks: weeks });
                              }}
                              placeholder="例如：1, 3, 8, 12"
                              value={course.customWeeks.join(', ')}
                            />
                          </label>
                        )}
                      </div>
                      {course.periodStart &&
                        (!periodTemplateSaved ||
                          !periodDrafts[course.periodStart - 1]?.startTime) && (
                          <p className="parse-note">
                            识别到第 {course.periodStart}
                            {course.periodEnd &&
                            course.periodEnd !== course.periodStart
                              ? `–${course.periodEnd}`
                              : ''}{' '}
                            节，但尚无完整时间模板；请设置节次时间或手动填写钟点。
                          </p>
                        )}
                      {(validation.errors.length > 0 ||
                        course.issues.length > 0) &&
                        included && (
                          <ul className="course-field-errors">
                            {[
                              ...new Set([
                                ...course.issues,
                                ...validation.errors,
                              ]),
                            ].map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        )}
                      {duplicate && (
                        <div className="duplicate-choice">
                          <span>
                            可能与已有/本批课程重复：{duplicate.title}
                          </span>
                          <select
                            onChange={(event) =>
                              setDuplicateActions((current) => ({
                                ...current,
                                [course.id]: event.target.value as
                                  | 'skip'
                                  | 'keep',
                              }))
                            }
                            value={duplicateActions[course.id] ?? 'skip'}
                          >
                            <option value="skip">跳过这条（默认）</option>
                            <option value="keep">仍然保留</option>
                          </select>
                        </div>
                      )}
                      {conflicts.length > 0 && (
                        <p className="conflict-warning">
                          时间冲突提示：
                          {conflicts
                            .map((item) => item.secondCourseName)
                            .join('、')}
                          。可继续导入，建议核对。
                        </p>
                      )}
                      <label className="review-confirm">
                        <input
                          checked={course.reviewed}
                          onChange={(event) =>
                            updateCourse(course.id, {
                              reviewed: event.target.checked,
                            })
                          }
                          type="checkbox"
                        />
                        我已对照原图核对这门课
                      </label>
                      <details className="course-raw-details">
                        <summary>
                          原始识别文字{' '}
                          {course.confidence === null
                            ? ''
                            : `· 行置信度 ${Math.round(course.confidence)}`}
                        </summary>
                        <pre>
                          {course.sourceText ||
                            '手动新增课程，没有原始 OCR 文字。'}
                        </pre>
                      </details>
                    </article>
                  );
                })}
              </div>
            )}
            <div className="import-review-footer">
              <span>
                {includedCourses.length} 门勾选课程 ·{' '}
                {readyCourses.filter((item) => !item.input).length}{' '}
                门需补全或核对
              </span>
              {!analysisState ? (
                <button
                  className="quiet-button"
                  disabled={analyzing || !includedCourses.length}
                  onClick={() => void analyze()}
                  type="button"
                >
                  {analyzing ? '检查中…' : '检查重复与冲突'}
                </button>
              ) : (
                <button
                  className="primary-button"
                  disabled={importing}
                  onClick={() => void confirmImport()}
                  type="button"
                >
                  {importing
                    ? '导入中…'
                    : `确认导入 ${analysisState.courseIds.length} 门`}
                </button>
              )}
            </div>
          </section>
        </div>
      </div>

      {existingCourses.length === 0 && (
        <p className="import-first-course-note">
          此学期目前还没有课程，确认后将建立第一批课程记录。
        </p>
      )}
    </section>
  );
}
