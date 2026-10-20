import { t, translateSystemMessage } from './i18n';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import type {
  CourseExceptionInput,
  CourseOccurrence,
  DayData,
  Event,
  EventInput,
  FontSizeScale,
  LanguageId,
  ThemeId,
  Task,
  TaskInput,
  WindowMode,
  WindowModeState,
} from './domain';
import { SemesterPlanner } from './SemesterPlanner';
import { mergeAgendaItems } from './scheduleView';
import { getThemeTokens, THEME_OPTIONS } from './theme';
import {
  formatDate,
  formatDateKey,
  formatTeachingWeek,
  formatWeekdayLabels,
  LANGUAGE_OPTIONS,
  setActiveLanguage,
} from './i18n';
import './index.css';

type Editor = { kind: 'task'; task?: Task } | { kind: 'event'; event?: Event };
type ViewMode = 'day' | 'week' | 'planner' | 'settings';
const weekdays = [0, 1, 2, 3, 4, 5, 6];

const localDateKey = (date: Date) => {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

const shiftDate = (dateKey: string, amount: number) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  date.setDate(date.getDate() + amount);
  return localDateKey(date);
};

const mondayOfWeek = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  const weekday = date.getDay() || 7;
  date.setDate(date.getDate() - weekday + 1);
  return localDateKey(date);
};

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : '操作失败，请重试。';

function PinIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path
        d="m16 3 5 5-2 1-3 3v4l-2 2-3-5-5 5-1-1 5-5-5-3 2-2h4l3-3 2-1Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
      <path
        d="m8 16-3 3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function MinimizeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path
        d="M5 12h14"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path
        d="m7 7 10 10M17 7 7 17"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function ArrowIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path
        d={
          direction === 'left'
            ? 'm12.5 4.5-5.5 5.5 5.5 5.5'
            : 'm7.5 4.5 5.5 5.5-5.5 5.5'
        }
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path
        d="m11.8 4.2 4 4M4 16l3.6-.8L16 6.8a1.4 1.4 0 0 0-2-2l-8.8 8.4L4 16Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.35"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path
        d="M4.5 6h11m-9.5 0 .6 9.5h6.8L14 6M8 6V4.5h4V6m-3 2.5v4m2-4v4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.3"
      />
    </svg>
  );
}

function TaskEditor({
  task,
  defaultDate,
  error,
  saving,
  onClose,
  onSave,
}: {
  task?: Task;
  defaultDate: string;
  error: string;
  saving: boolean;
  onClose: () => void;
  onSave: (input: TaskInput) => Promise<void>;
}) {
  const [title, setTitle] = useState(task?.title ?? '');
  const [date, setDate] = useState(task?.scheduledDate ?? defaultDate);
  const [notes, setNotes] = useState(task?.notes ?? '');

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onSave({ title, scheduledDate: date, notes });
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        aria-labelledby="task-editor-title"
        aria-modal="true"
        className="editor-modal"
        role="dialog"
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">{t('MY TO-DO LIST')}</p>
            <h2 id="task-editor-title">{t(task ? '编辑待办' : '添加待办')}</h2>
          </div>
          <button
            aria-label={t('关闭编辑窗口')}
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            <CloseIcon />
          </button>
        </div>
        <form className="editor-form" onSubmit={submit}>
          <label className="field-label">
            {t('任务名称')}
            <input
              autoFocus
              maxLength={160}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t('写下一件要完成的小事')}
              required
              value={title}
            />
          </label>
          <label className="field-label">
            {t('日期')}
            <input
              onChange={(event) => setDate(event.target.value)}
              required
              type="date"
              value={date}
            />
          </label>
          <label className="field-label">
            {t('备注（可选）')}
            <textarea
              maxLength={2000}
              onChange={(event) => setNotes(event.target.value)}
              placeholder={t('补充一点细节')}
              rows={3}
              value={notes}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {translateSystemMessage(error)}
            </p>
          )}
          <div className="modal-actions">
            <button className="quiet-button" onClick={onClose} type="button">
              {t('取消')}
            </button>
            <button className="primary-button" disabled={saving} type="submit">
              {t(saving ? '保存中…' : '保存')}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function EventEditor({
  event,
  defaultDate,
  error,
  saving,
  onClose,
  onSave,
}: {
  event?: Event;
  defaultDate: string;
  error: string;
  saving: boolean;
  onClose: () => void;
  onSave: (input: EventInput) => Promise<void>;
}) {
  const [title, setTitle] = useState(event?.title ?? '');
  const [date, setDate] = useState(event?.eventDate ?? defaultDate);
  const [startTime, setStartTime] = useState(event?.startTime ?? '');
  const [endTime, setEndTime] = useState(event?.endTime ?? '');
  const [isAllDay, setIsAllDay] = useState(event?.isAllDay ?? false);
  const [location, setLocation] = useState(event?.location ?? '');
  const [notes, setNotes] = useState(event?.notes ?? '');

  const submit = (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    void onSave({
      title,
      eventDate: date,
      startTime: isAllDay ? null : startTime || null,
      endTime: isAllDay ? null : endTime || null,
      isAllDay,
      location,
      notes,
    });
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(mouseEvent) =>
        mouseEvent.target === mouseEvent.currentTarget && onClose()
      }
    >
      <section
        aria-labelledby="event-editor-title"
        aria-modal="true"
        className="editor-modal"
        role="dialog"
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">{t('SCHEDULE')}</p>
            <h2 id="event-editor-title">
              {t(event ? '编辑日程' : '新建日程')}
            </h2>
          </div>
          <button
            aria-label={t('关闭编辑窗口')}
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            <CloseIcon />
          </button>
        </div>
        <form className="editor-form" onSubmit={submit}>
          <label className="field-label">
            {t('标题')}
            <input
              autoFocus
              maxLength={160}
              onChange={(inputEvent) => setTitle(inputEvent.target.value)}
              placeholder={t('给这段安排起个名字')}
              required
              value={title}
            />
          </label>
          <label className="field-label">
            {t('日期')}
            <input
              onChange={(inputEvent) => setDate(inputEvent.target.value)}
              required
              type="date"
              value={date}
            />
          </label>
          <label className="all-day-toggle">
            <input
              checked={isAllDay}
              onChange={(inputEvent) => setIsAllDay(inputEvent.target.checked)}
              type="checkbox"
            />
            <span>{t('全天事件')}</span>
          </label>
          <div className="time-fields">
            <label className="field-label">
              {t('开始时间')}
              <input
                disabled={isAllDay}
                onChange={(inputEvent) => setStartTime(inputEvent.target.value)}
                type="time"
                value={startTime}
              />
            </label>
            <label className="field-label">
              {t('结束时间')}
              <input
                disabled={isAllDay}
                onChange={(inputEvent) => setEndTime(inputEvent.target.value)}
                type="time"
                value={endTime}
              />
            </label>
          </div>
          <label className="field-label">
            {t('地点（可选）')}
            <input
              maxLength={200}
              onChange={(inputEvent) => setLocation(inputEvent.target.value)}
              placeholder={t('地点')}
              value={location}
            />
          </label>
          <label className="field-label">
            {t('备注（可选）')}
            <textarea
              maxLength={2000}
              onChange={(inputEvent) => setNotes(inputEvent.target.value)}
              placeholder={t('补充说明')}
              rows={2}
              value={notes}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {translateSystemMessage(error)}
            </p>
          )}
          <div className="modal-actions">
            <button className="quiet-button" onClick={onClose} type="button">
              {t('取消')}
            </button>
            <button className="primary-button" disabled={saving} type="submit">
              {t(saving ? '保存中…' : '保存日程')}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function CourseExceptionEditor({
  course,
  onClose,
  onSave,
  onRestore,
  saving,
  error,
}: {
  course: CourseOccurrence;
  onClose: () => void;
  onSave: (input: CourseExceptionInput) => Promise<void>;
  onRestore: () => Promise<void>;
  saving: boolean;
  error: string;
}) {
  const [replacementDate, setReplacementDate] = useState(course.occurrenceDate);
  const [startTime, setStartTime] = useState(course.startTime);
  const [endTime, setEndTime] = useState(course.endTime);
  const [classroom, setClassroom] = useState(course.classroom);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onSave({
      courseId: course.id,
      originalDate: course.originalDate,
      isCancelled: false,
      replacementDate,
      startTime,
      endTime,
      classroom,
    });
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        aria-labelledby="course-exception-title"
        aria-modal="true"
        className="editor-modal"
        role="dialog"
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">{t('单次课程例外')}</p>
            <h2 id="course-exception-title">
              {t('调整')} {course.courseName}
            </h2>
          </div>
          <button
            aria-label={t('关闭编辑窗口')}
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            <CloseIcon />
          </button>
        </div>
        <p className="exception-original">
          {t('原课程日期：')}
          {course.originalDate}
          {t('（只影响这一次）')}
        </p>
        <form className="editor-form" onSubmit={submit}>
          <label className="field-label">
            {t('实际日期')}
            <input
              onChange={(event) => setReplacementDate(event.target.value)}
              required
              type="date"
              value={replacementDate}
            />
          </label>
          <div className="planner-field-row">
            <label className="field-label">
              {t('开始时间')}
              <input
                onChange={(event) => setStartTime(event.target.value)}
                required
                type="time"
                value={startTime}
              />
            </label>
            <label className="field-label">
              {t('结束时间')}
              <input
                onChange={(event) => setEndTime(event.target.value)}
                required
                type="time"
                value={endTime}
              />
            </label>
          </div>
          <label className="field-label">
            {t('教室')}
            <input
              maxLength={120}
              onChange={(event) => setClassroom(event.target.value)}
              value={classroom}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {translateSystemMessage(error)}
            </p>
          )}
          <div className="modal-actions exception-modal-actions">
            {course.isException && (
              <button
                className="quiet-button"
                disabled={saving}
                onClick={() => void onRestore()}
                type="button"
              >
                {t('恢复原课程')}
              </button>
            )}
            <button className="quiet-button" onClick={onClose} type="button">
              {t('取消')}
            </button>
            <button className="primary-button" disabled={saving} type="submit">
              {t(saving ? '保存中…' : '保存这一次')}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function App() {
  const [todayKey, setTodayKey] = useState(() => localDateKey(new Date()));
  const [selectedDate, setSelectedDate] = useState(() =>
    localDateKey(new Date()),
  );
  const [dayData, setDayData] = useState<DayData>();
  const [weekData, setWeekData] = useState<Record<string, DayData>>({});
  const [weekLoading, setWeekLoading] = useState(false);
  const [weekReload, setWeekReload] = useState(0);
  const [plannerReload, setPlannerReload] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const [fontSizeScale, setFontSizeScale] = useState<FontSizeScale>(1);
  const [fontSizeError, setFontSizeError] = useState('');
  const fontSizeChangeSequence = useRef(0);
  const [themeId, setThemeId] = useState<ThemeId>(
    () => window.dayByDay.initialTheme,
  );
  const [languageId, setLanguageId] = useState<LanguageId>(
    () => window.dayByDay.initialLanguage,
  );
  const [languageError, setLanguageError] = useState('');
  const [themeError, setThemeError] = useState('');
  const themeChangeSequence = useRef(0);
  const languageChangeSequence = useRef(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [windowMode, setWindowMode] = useState<WindowMode>('floating');
  const [desktopWidgetSupported, setDesktopWidgetSupported] = useState(false);
  const [windowModeError, setWindowModeError] = useState('');
  const [windowModeSaving, setWindowModeSaving] = useState(false);
  const [closeToTray, setCloseToTray] = useState(false);
  const [launchAtStartup, setLaunchAtStartup] = useState(false);
  const [startupAvailable, setStartupAvailable] = useState(false);
  const [desktopSettingsLoaded, setDesktopSettingsLoaded] = useState(false);
  const [desktopSettingsError, setDesktopSettingsError] = useState('');
  const [startupSaving, setStartupSaving] = useState(false);
  const [dataOperation, setDataOperation] = useState<
    'backup' | 'restore' | null
  >(null);
  const [dataMessage, setDataMessage] = useState('');
  const [dataError, setDataError] = useState('');
  const [controlMessage, setControlMessage] = useState('');
  const [quickTitle, setQuickTitle] = useState('');
  const quickTaskInputRef = useRef<HTMLInputElement>(null);
  const [quickTaskFocusRequested, setQuickTaskFocusRequested] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editorError, setEditorError] = useState('');
  const [savingEditor, setSavingEditor] = useState(false);
  const [busyItemId, setBusyItemId] = useState('');
  const [courseOccurrence, setCourseOccurrence] =
    useState<CourseOccurrence | null>(null);
  const [courseExceptionError, setCourseExceptionError] = useState('');
  const [savingCourseException, setSavingCourseException] = useState(false);

  // The preload reads the saved language synchronously, so the first React
  // render already uses the correct language and does not flash another one.
  setActiveLanguage(languageId);

  const loadDay = useCallback(async (date: string, showLoading: boolean) => {
    if (showLoading) setLoading(true);
    setLoadError('');
    try {
      const result = await window.dayByDay.getDay(date);
      setDayData(result);
    } catch (error) {
      setLoadError(getErrorMessage(error));
      if (showLoading) setDayData(undefined);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDay(selectedDate, true);
  }, [loadDay, selectedDate]);

  useEffect(
    () =>
      window.dayByDay.onDataRestored(() => {
        void loadDay(selectedDate, false);
        setWeekReload((version) => version + 1);
        setPlannerReload((version) => version + 1);
      }),
    [loadDay, selectedDate],
  );

  useEffect(() => {
    if (viewMode !== 'week') return;
    let live = true;
    setWeekLoading(true);
    const monday = mondayOfWeek(selectedDate);
    const dates = weekdays.map((_, index) => shiftDate(monday, index));
    void Promise.all(dates.map((date) => window.dayByDay.getDay(date)))
      .then((days) => {
        if (live)
          setWeekData(
            Object.fromEntries(dates.map((date, index) => [date, days[index]])),
          );
      })
      .catch((error: unknown) => {
        if (live) setLoadError(getErrorMessage(error));
      })
      .finally(() => {
        if (live) setWeekLoading(false);
      });
    return () => {
      live = false;
    };
  }, [selectedDate, viewMode, weekReload]);

  useEffect(() => {
    let midnightTimer = 0;
    const refreshToday = () => {
      const nextToday = localDateKey(new Date());
      setTodayKey((previousToday) => {
        if (previousToday !== nextToday) {
          setSelectedDate((currentDate) =>
            currentDate === previousToday ? nextToday : currentDate,
          );
        }
        return nextToday;
      });
      const now = new Date();
      const nextMidnight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
        0,
        0,
        1,
      );
      window.clearTimeout(midnightTimer);
      midnightTimer = window.setTimeout(
        refreshToday,
        nextMidnight.getTime() - now.getTime(),
      );
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshToday();
    };
    refreshToday();
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearTimeout(midnightTimer);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, []);

  useEffect(() => {
    return window.dayByDay.onPreferencesChanged((preferences) => {
      setThemeId(preferences.themeId);
      setLanguageId(preferences.languageId);
      setFontSizeScale(preferences.fontSizeScale);
    });
  }, []);

  useEffect(() => {
    void window.dayByDay
      .getFontSizeScale()
      .then(setFontSizeScale)
      .catch((error: unknown) => setFontSizeError(getErrorMessage(error)));
  }, []);

  const updateFontSizeScale = async (scale: FontSizeScale) => {
    const sequence = ++fontSizeChangeSequence.current;
    const previousScale = fontSizeScale;
    setFontSizeScale(scale);
    setFontSizeError('');
    try {
      const savedScale = await window.dayByDay.setFontSizeScale(scale);
      if (sequence === fontSizeChangeSequence.current)
        setFontSizeScale(savedScale);
    } catch (error) {
      if (sequence === fontSizeChangeSequence.current) {
        setFontSizeScale(previousScale);
        setFontSizeError(getErrorMessage(error));
      }
    }
  };

  const updateTheme = async (nextTheme: ThemeId) => {
    const previousTheme = themeId;
    const requestSequence = ++themeChangeSequence.current;
    setThemeError('');
    setThemeId(nextTheme);
    try {
      const savedTheme = await window.dayByDay.setTheme(nextTheme);
      if (requestSequence === themeChangeSequence.current)
        setThemeId(savedTheme);
    } catch (error) {
      if (requestSequence === themeChangeSequence.current) {
        setThemeId(previousTheme);
        setThemeError(getErrorMessage(error));
      }
    }
  };

  const createDataBackup = async () => {
    setDataOperation('backup');
    setDataMessage('');
    setDataError('');
    try {
      const result = await window.dayByDay.backupData();
      if (!result.cancelled && result.filePath)
        setDataMessage(t('已创建备份：{{path}}', { path: result.filePath }));
    } catch (error) {
      setDataError(getErrorMessage(error));
    } finally {
      setDataOperation(null);
    }
  };

  const restoreDataBackup = async () => {
    setDataOperation('restore');
    setDataMessage('');
    setDataError('');
    try {
      const result = await window.dayByDay.restoreData();
      if (result.restored && result.recoveryPath)
        setDataMessage(
          t('数据已恢复。恢复前安全备份位于：{{path}}', {
            path: result.recoveryPath,
          }),
        );
      if (result.restored) {
        try {
          const [desktopSettings, modeState] = await Promise.all([
            window.dayByDay.getDesktopSettings(),
            window.dayByDay.getWindowMode(),
          ]);
          setCloseToTray(desktopSettings.closeToTray);
          setLaunchAtStartup(desktopSettings.launchAtStartup);
          setStartupAvailable(desktopSettings.startupAvailable);
          setDesktopSettingsLoaded(true);
          applyWindowModeState(modeState);
          setDesktopSettingsError('');
        } catch (error) {
          setDesktopSettingsError(getErrorMessage(error));
        }
      }
    } catch (error) {
      setDataError(getErrorMessage(error));
    } finally {
      setDataOperation(null);
    }
  };

  const updateLanguage = async (nextLanguage: LanguageId) => {
    const previousLanguage = languageId;
    const requestSequence = ++languageChangeSequence.current;
    setLanguageError('');
    setActiveLanguage(nextLanguage);
    setLanguageId(nextLanguage);
    try {
      const savedLanguage = await window.dayByDay.setLanguage(nextLanguage);
      if (requestSequence === languageChangeSequence.current) {
        setActiveLanguage(savedLanguage);
        setLanguageId(savedLanguage);
      }
    } catch (error) {
      if (requestSequence === languageChangeSequence.current) {
        setActiveLanguage(previousLanguage);
        setLanguageId(previousLanguage);
        setLanguageError(getErrorMessage(error));
      }
    }
  };

  const applyWindowModeState = (state: WindowModeState) => {
    setWindowMode(state.mode);
    setAlwaysOnTop(state.mode === 'always-on-top');
    setDesktopWidgetSupported(state.desktopWidgetSupported);
    setWindowModeError(state.errorKey ?? '');
  };

  const selectWindowMode = async (mode: WindowMode) => {
    if (windowModeSaving) return;
    setWindowModeSaving(true);
    setWindowModeError('');
    try {
      applyWindowModeState(await window.dayByDay.setWindowMode(mode));
    } catch {
      setWindowModeError('窗口模式设置失败，请重试。');
    } finally {
      setWindowModeSaving(false);
    }
  };

  const toggleAlwaysOnTop = async () => {
    await selectWindowMode(
      windowMode === 'always-on-top' ? 'floating' : 'always-on-top',
    );
  };

  useEffect(() => {
    void window.dayByDay
      .getWindowMode()
      .then(applyWindowModeState)
      .catch(() => setControlMessage('窗口设置暂时无法读取。'));
    return window.dayByDay.onWindowModeChanged(applyWindowModeState);
  }, []);

  useEffect(() => {
    void window.dayByDay
      .getDesktopSettings()
      .then((settings) => {
        setCloseToTray(settings.closeToTray);
        setLaunchAtStartup(settings.launchAtStartup);
        setStartupAvailable(settings.startupAvailable);
        setDesktopSettingsLoaded(true);
      })
      .catch((error: unknown) => {
        setDesktopSettingsError(getErrorMessage(error));
        setDesktopSettingsLoaded(true);
      });
  }, []);

  useEffect(
    () =>
      window.dayByDay.onTrayAction((action) => {
        if (action === 'week') {
          setViewMode('week');
        } else if (action === 'settings') {
          setViewMode('settings');
        } else {
          setSelectedDate(localDateKey(new Date()));
          setViewMode('day');
          setQuickTaskFocusRequested(true);
        }
      }),
    [],
  );

  useEffect(() => {
    if (!quickTaskFocusRequested || viewMode !== 'day') return;
    quickTaskInputRef.current?.focus();
    setQuickTaskFocusRequested(false);
  }, [quickTaskFocusRequested, viewMode, selectedDate]);

  const dateObject = useMemo(() => {
    const [year, month, day] = selectedDate.split('-').map(Number);
    return new Date(year, month - 1, day, 12);
  }, [selectedDate]);
  const weekday = formatDate(dateObject, { weekday: 'long' });
  const dateLabel = formatDate(dateObject, {
    month: 'long',
    day: 'numeric',
  });
  const yearLabel = formatDate(dateObject, { year: 'numeric' });
  const tasks = dayData?.tasks ?? [];
  const incompleteTasks = tasks.filter((task) => !task.isCompleted);
  const completedTasks = tasks.filter((task) => task.isCompleted);
  const isToday = selectedDate === todayKey;
  const currentWeekStart = mondayOfWeek(selectedDate);
  const currentWeekDays = weekdays.map((_, index) =>
    shiftDate(currentWeekStart, index),
  );
  const weekStartDate = useMemo(() => {
    const [year, month, day] = currentWeekStart.split('-').map(Number);
    return new Date(year, month - 1, day, 12);
  }, [currentWeekStart]);
  const localizedWeekdays = formatWeekdayLabels(weekStartDate);
  const agendaItems = mergeAgendaItems(
    dayData?.events ?? [],
    dayData?.courses ?? [],
  );

  const refreshCurrentDay = async () => {
    await loadDay(selectedDate, false);
    setWeekReload((version) => version + 1);
  };

  const toggleCloseToTray = async () => {
    const nextValue = !closeToTray;
    setDesktopSettingsError('');
    try {
      setCloseToTray(await window.dayByDay.setCloseToTray(nextValue));
    } catch (error) {
      setDesktopSettingsError(getErrorMessage(error));
    }
  };

  const updateLaunchAtStartup = async () => {
    if (!startupAvailable || startupSaving) return;
    setStartupSaving(true);
    setDesktopSettingsError('');
    try {
      const settings =
        await window.dayByDay.setLaunchAtStartup(!launchAtStartup);
      setLaunchAtStartup(settings.launchAtStartup);
      setStartupAvailable(settings.startupAvailable);
    } catch (error) {
      setDesktopSettingsError(getErrorMessage(error));
    } finally {
      setStartupSaving(false);
    }
  };

  const quickAddTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (addingTask || !quickTitle.trim()) return;
    setAddingTask(true);
    setLoadError('');
    try {
      await window.dayByDay.createTask({
        title: quickTitle,
        scheduledDate: selectedDate,
        notes: '',
      });
      setQuickTitle('');
      await refreshCurrentDay();
    } catch (error) {
      setLoadError(getErrorMessage(error));
    } finally {
      setAddingTask(false);
    }
  };

  const saveTask = async (input: TaskInput) => {
    if (savingEditor) return;
    setSavingEditor(true);
    setEditorError('');
    try {
      if (editor?.kind === 'task' && editor.task) {
        await window.dayByDay.updateTask({ ...input, id: editor.task.id });
      } else {
        await window.dayByDay.createTask(input);
      }
      setEditor(null);
      await refreshCurrentDay();
    } catch (error) {
      setEditorError(getErrorMessage(error));
    } finally {
      setSavingEditor(false);
    }
  };

  const saveEvent = async (input: EventInput) => {
    if (savingEditor) return;
    setSavingEditor(true);
    setEditorError('');
    try {
      if (editor?.kind === 'event' && editor.event) {
        await window.dayByDay.updateEvent({ ...input, id: editor.event.id });
      } else {
        await window.dayByDay.createEvent(input);
      }
      setEditor(null);
      await refreshCurrentDay();
    } catch (error) {
      setEditorError(getErrorMessage(error));
    } finally {
      setSavingEditor(false);
    }
  };

  const toggleTask = async (task: Task) => {
    if (busyItemId) return;
    setBusyItemId(task.id);
    setLoadError('');
    try {
      await window.dayByDay.setTaskCompleted(task.id, !task.isCompleted);
      await refreshCurrentDay();
    } catch (error) {
      setLoadError(getErrorMessage(error));
    } finally {
      setBusyItemId('');
    }
  };

  const deleteTask = async (task: Task) => {
    if (
      !window.confirm(t('确定删除待办“{{title}}”吗？', { title: task.title }))
    )
      return;
    setBusyItemId(task.id);
    setLoadError('');
    try {
      await window.dayByDay.deleteTask(task.id);
      await refreshCurrentDay();
    } catch (error) {
      setLoadError(getErrorMessage(error));
    } finally {
      setBusyItemId('');
    }
  };

  const moveTask = async (task: Task, direction: 'up' | 'down') => {
    if (busyItemId) return;
    setBusyItemId(task.id);
    setLoadError('');
    try {
      await window.dayByDay.moveTask(task.id, direction);
      await refreshCurrentDay();
    } catch (error) {
      setLoadError(getErrorMessage(error));
    } finally {
      setBusyItemId('');
    }
  };

  const deleteEvent = async (event: Event) => {
    if (
      !window.confirm(t('确定删除日程“{{title}}”吗？', { title: event.title }))
    )
      return;
    setBusyItemId(event.id);
    setLoadError('');
    try {
      await window.dayByDay.deleteEvent(event.id);
      await refreshCurrentDay();
    } catch (error) {
      setLoadError(getErrorMessage(error));
    } finally {
      setBusyItemId('');
    }
  };

  const saveCourseException = async (input: CourseExceptionInput) => {
    if (savingCourseException) return;
    setSavingCourseException(true);
    setCourseExceptionError('');
    try {
      await window.dayByDay.saveCourseException(input);
      setCourseOccurrence(null);
      await refreshCurrentDay();
    } catch (error) {
      setCourseExceptionError(getErrorMessage(error));
    } finally {
      setSavingCourseException(false);
    }
  };

  const restoreCourseException = async () => {
    if (!courseOccurrence || savingCourseException) return;
    setSavingCourseException(true);
    setCourseExceptionError('');
    try {
      await window.dayByDay.deleteCourseException(
        courseOccurrence.id,
        courseOccurrence.originalDate,
      );
      setCourseOccurrence(null);
      await refreshCurrentDay();
    } catch (error) {
      setCourseExceptionError(getErrorMessage(error));
    } finally {
      setSavingCourseException(false);
    }
  };

  const cancelCourseOccurrence = async (course: CourseOccurrence) => {
    if (
      !window.confirm(
        t('确定取消“{{title}}”在 {{date}} 的这一次课程吗？', {
          title: course.courseName,
          date: course.originalDate,
        }),
      )
    )
      return;
    await saveCourseException({
      courseId: course.id,
      originalDate: course.originalDate,
      isCancelled: true,
      replacementDate: course.originalDate,
      startTime: '',
      endTime: '',
      classroom: '',
    });
  };

  const openEditor = (nextEditor: Editor) => {
    setEditorError('');
    setEditor(nextEditor);
  };

  return (
    <div
      className="app-shell"
      lang={languageId}
      style={
        {
          ...getThemeTokens(themeId),
          '--font-scale': fontSizeScale,
        } as CSSProperties
      }
    >
      <header className="titlebar">
        <div className="brand" aria-label="Daybyday">
          <span aria-hidden="true" className="brand-mark">
            d
          </span>
          <span className="brand-name">Daybyday</span>
        </div>
        <div aria-hidden="true" className="drag-region" />
        <nav aria-label={t('窗口控制')} className="window-controls">
          <button
            aria-label={t(alwaysOnTop ? '取消始终置顶' : '始终置顶')}
            aria-pressed={alwaysOnTop}
            className={`window-button pin-button${alwaysOnTop ? ' is-active' : ''}`}
            onClick={() => void toggleAlwaysOnTop()}
            title={t(alwaysOnTop ? '已始终置顶' : '始终置顶')}
            type="button"
          >
            <PinIcon />
          </button>
          <button
            aria-label={t('最小化窗口')}
            className="window-button"
            onClick={() => void window.dayByDay.minimizeWindow()}
            title={t('最小化')}
            type="button"
          >
            <MinimizeIcon />
          </button>
          <button
            aria-label={t('关闭窗口')}
            className="window-button close-button"
            onClick={() => void window.dayByDay.closeWindow()}
            title={t('关闭')}
            type="button"
          >
            <CloseIcon />
          </button>
        </nav>
      </header>

      <main className="scroll-content">
        <nav aria-label={t('页面切换')} className="view-tabs">
          <button
            aria-pressed={viewMode === 'day'}
            className={viewMode === 'day' ? 'is-active' : ''}
            onClick={() => setViewMode('day')}
            type="button"
          >
            {t('Day')}
          </button>
          <button
            aria-pressed={viewMode === 'week'}
            className={viewMode === 'week' ? 'is-active' : ''}
            onClick={() => setViewMode('week')}
            type="button"
          >
            {t('Week')}
          </button>
          <button
            aria-pressed={viewMode === 'planner'}
            className={viewMode === 'planner' ? 'is-active' : ''}
            onClick={() => setViewMode('planner')}
            type="button"
          >
            {t('Semester Planner')}
          </button>
          <button
            aria-pressed={viewMode === 'settings'}
            className={viewMode === 'settings' ? 'is-active' : ''}
            onClick={() => setViewMode('settings')}
            type="button"
          >
            {t('Settings')}
          </button>
        </nav>
        {viewMode === 'planner' ? (
          <SemesterPlanner
            key={plannerReload}
            onCurrentSemesterChanged={() => {
              void loadDay(selectedDate, false);
              setWeekReload((version) => version + 1);
            }}
            onOpenDay={(date) => {
              setSelectedDate(date);
              setViewMode('day');
            }}
          />
        ) : viewMode === 'settings' ? (
          <section aria-labelledby="settings-heading" className="settings-page">
            <div className="settings-page-heading">
              <p className="eyebrow">{t('PREFERENCES')}</p>
              <h1 id="settings-heading">{t('Settings')}</h1>
            </div>
            <section
              aria-labelledby="font-size-heading"
              className="settings-card"
            >
              <div className="settings-card-heading">
                <div>
                  <p className="settings-eyebrow">{t('Appearance')}</p>
                  <h2 id="font-size-heading">{t('Font size')}</h2>
                  <p>{t('调整全应用文字大小，设置会保存在这台电脑上。')}</p>
                </div>
              </div>
              <div className="font-size-control">
                <output
                  aria-live="polite"
                  className="font-size-value"
                  htmlFor="font-size-slider"
                >
                  {t('Font size')} {Math.round(fontSizeScale * 100)}%
                </output>
                <button
                  className="reset-font-size-button"
                  disabled={fontSizeScale === 1}
                  onClick={() => void updateFontSizeScale(1)}
                  type="button"
                >
                  {t('Reset')}
                </button>
              </div>
              <input
                aria-label={t('Font size')}
                className="font-size-slider"
                id="font-size-slider"
                max={130}
                min={80}
                onChange={(event) =>
                  void updateFontSizeScale(
                    (Number(event.currentTarget.value) / 100) as FontSizeScale,
                  )
                }
                step={5}
                type="range"
                value={Math.round(fontSizeScale * 100)}
              />
              <div aria-hidden="true" className="font-size-range-labels">
                <span>80%</span>
                <span>130%</span>
              </div>
              <p className="settings-help">
                {t('拖动滑块调整文字大小，字体会立即应用并自动保存。')}
              </p>
              {(window.innerWidth < 440 || window.innerHeight < 680) && (
                <p className="settings-notice" role="status">
                  {t(
                    '当前窗口空间较小。为保留你已有的窗口尺寸，DayByDay 没有自动调整窗口；可拖动窗口边缘扩大查看区域。',
                  )}
                </p>
              )}
              {fontSizeError && (
                <p className="form-error" role="alert">
                  {translateSystemMessage(fontSizeError)}
                </p>
              )}
            </section>
            <section
              aria-labelledby="theme-color-heading"
              className="settings-card appearance-card"
            >
              <div className="settings-card-heading">
                <div>
                  <h2 id="theme-color-heading">{t('Theme Color')}</h2>
                  <p>
                    {t('选择低饱和度主题，点击后立即预览并保存在这台电脑上。')}
                  </p>
                </div>
                <button
                  className="reset-theme-button"
                  disabled={themeId === 'classic'}
                  onClick={() => void updateTheme('classic')}
                  type="button"
                >
                  {t('Reset to default')}
                </button>
              </div>
              {(['soft', 'pop'] as const).map((group) => (
                <div className="theme-group" key={group}>
                  <h3>
                    {t(group === 'soft' ? 'Soft & Muted' : 'Pop & Playful')}
                  </h3>
                  <div
                    aria-label={t(
                      group === 'soft' ? 'Soft & Muted' : 'Pop & Playful',
                    )}
                    className="theme-options"
                    role="group"
                  >
                    {THEME_OPTIONS.filter((theme) => theme.group === group).map(
                      (theme) => (
                        <button
                          aria-pressed={themeId === theme.id}
                          className={`theme-option${themeId === theme.id ? ' is-active' : ''}`}
                          key={theme.id}
                          onClick={() => void updateTheme(theme.id)}
                          type="button"
                        >
                          <span
                            aria-hidden="true"
                            className="theme-swatch"
                            style={
                              {
                                '--swatch-accent': theme.accent,
                                '--swatch-background': theme.background,
                              } as CSSProperties
                            }
                          >
                            <i />
                          </span>
                          <span className="theme-option-name">
                            {t(theme.name)}
                          </span>
                          <span
                            aria-hidden="true"
                            className="theme-option-check"
                          >
                            {themeId === theme.id ? '✓' : ''}
                          </span>
                        </button>
                      ),
                    )}
                  </div>
                </div>
              ))}
              {themeError && (
                <p className="form-error" role="alert">
                  {translateSystemMessage(themeError)}
                </p>
              )}
            </section>
            <section
              aria-labelledby="language-heading"
              className="settings-card"
            >
              <div className="settings-card-heading">
                <div>
                  <p className="settings-eyebrow">{t('Language')}</p>
                  <h2 id="language-heading">{t('App Language')}</h2>
                </div>
              </div>
              <label
                className="language-select-label"
                htmlFor="app-language-select"
              >
                <span>{t('Language')}</span>
                <select
                  id="app-language-select"
                  value={languageId}
                  onChange={(event) =>
                    void updateLanguage(event.target.value as LanguageId)
                  }
                >
                  {LANGUAGE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.nativeName}
                    </option>
                  ))}
                </select>
              </label>
              {languageError && (
                <p className="form-error" role="alert">
                  {translateSystemMessage(languageError)}
                </p>
              )}
            </section>
            <section
              aria-labelledby="data-settings-heading"
              className="settings-card data-settings-card"
            >
              <div className="settings-card-heading">
                <div>
                  <p className="settings-eyebrow">{t('Data')}</p>
                  <h2 id="data-settings-heading">{t('Backup & Restore')}</h2>
                  <p>
                    {t(
                      '备份包含本地数据库和应用偏好；不会包含原始课程表截图。',
                    )}
                  </p>
                </div>
              </div>
              <div className="backup-actions">
                <button
                  className="primary-button"
                  disabled={dataOperation !== null}
                  onClick={() => void createDataBackup()}
                  type="button"
                >
                  {dataOperation === 'backup'
                    ? t('正在处理…')
                    : t('Backup Data')}
                </button>
                <button
                  className="quiet-button"
                  disabled={dataOperation !== null}
                  onClick={() => void restoreDataBackup()}
                  type="button"
                >
                  {dataOperation === 'restore'
                    ? t('正在处理…')
                    : t('Restore Data')}
                </button>
              </div>
              {dataMessage && (
                <p className="settings-success" role="status">
                  {dataMessage}
                </p>
              )}
              {dataError && (
                <p className="form-error" role="alert">
                  {translateSystemMessage(dataError)}
                </p>
              )}
            </section>
            <section
              aria-labelledby="window-settings-heading"
              className="settings-card"
            >
              <div className="settings-card-heading">
                <div>
                  <p className="settings-eyebrow">{t('Window')}</p>
                  <h2 id="window-settings-heading">{t('窗口控制')}</h2>
                </div>
              </div>
              <div
                className="window-mode-options"
                role="group"
                aria-label={t('Window Mode')}
              >
                {(
                  [
                    [
                      'floating',
                      'Floating Window',
                      '普通悬浮窗，可被其他应用窗口覆盖。',
                    ],
                    [
                      'desktop-widget',
                      'Desktop Widget',
                      '固定在 Windows 桌面层；Explorer 重启后会尝试恢复。',
                    ],
                    [
                      'always-on-top',
                      'Always on Top',
                      '显示在普通应用窗口上方。',
                    ],
                  ] as const
                ).map(([mode, label, description]) => (
                  <button
                    key={mode}
                    aria-pressed={windowMode === mode}
                    className={`window-mode-option${windowMode === mode ? ' is-active' : ''}`}
                    disabled={
                      windowModeSaving ||
                      (mode === 'desktop-widget' && !desktopWidgetSupported)
                    }
                    onClick={() => void selectWindowMode(mode)}
                    type="button"
                  >
                    <span className="window-mode-option-heading">
                      <strong>{t(label)}</strong>
                      <span
                        aria-hidden="true"
                        className="window-mode-indicator"
                      />
                    </span>
                    <span className="settings-help">{t(description)}</span>
                    {mode === 'desktop-widget' && desktopWidgetSupported && (
                      <span className="settings-help">
                        {t(
                          '实验功能：Windows 桌面挂接可能影响高 DPI 缩放；若异常，请切回普通悬浮窗并重启应用。',
                        )}
                      </span>
                    )}
                    {mode === 'desktop-widget' && !desktopWidgetSupported && (
                      <span className="settings-help">
                        {t('桌面便签模式目前仅支持 Windows。')}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              {windowModeError && (
                <p className="form-error" role="status">
                  {t(windowModeError)}
                </p>
              )}
              <div className="desktop-setting-row">
                <div>
                  <span>{t('关闭到托盘')}</span>
                  <p className="settings-help">
                    {t('关闭窗口时隐藏到系统托盘，应用仍会继续运行。')}
                  </p>
                </div>
                <button
                  aria-pressed={closeToTray}
                  className={`language-window-toggle${closeToTray ? ' is-active' : ''}`}
                  onClick={() => void toggleCloseToTray()}
                  type="button"
                >
                  {t(closeToTray ? 'On' : 'Off')}
                </button>
              </div>
              <div className="desktop-setting-row">
                <div>
                  <span>{t('Launch at Windows startup')}</span>
                  <p className="settings-help">
                    {startupAvailable
                      ? t('开机启动状态会直接向 Windows 查询。')
                      : t(
                          '仅正式安装版支持开机启动；开发版本不会创建 Windows 启动项。',
                        )}
                  </p>
                </div>
                <button
                  aria-pressed={launchAtStartup}
                  className={`language-window-toggle${launchAtStartup ? ' is-active' : ''}`}
                  disabled={
                    !startupAvailable || !desktopSettingsLoaded || startupSaving
                  }
                  onClick={() => void updateLaunchAtStartup()}
                  type="button"
                >
                  {t(launchAtStartup ? 'On' : 'Off')}
                </button>
              </div>
              {desktopSettingsError && (
                <p className="form-error" role="alert">
                  {translateSystemMessage(desktopSettingsError)}
                </p>
              )}
            </section>
          </section>
        ) : (
          <>
            <section aria-label={t('日期导航')} className="date-section">
              <div className="date-navigation">
                <button
                  aria-label={t(viewMode === 'week' ? '前一周' : '前一天')}
                  className="date-arrow"
                  onClick={() =>
                    setSelectedDate((date) =>
                      shiftDate(date, viewMode === 'week' ? -7 : -1),
                    )
                  }
                  type="button"
                >
                  <ArrowIcon direction="left" />
                </button>
                <div className="date-copy">
                  <p className="date-weekday">{weekday}</p>
                  <h1>{dateLabel}</h1>
                  <time className="date-year" dateTime={selectedDate}>
                    {yearLabel}
                  </time>
                </div>
                <button
                  aria-label={t(viewMode === 'week' ? '后一周' : '后一天')}
                  className="date-arrow"
                  onClick={() =>
                    setSelectedDate((date) =>
                      shiftDate(date, viewMode === 'week' ? 7 : 1),
                    )
                  }
                  type="button"
                >
                  <ArrowIcon direction="right" />
                </button>
              </div>
              <div className="date-tools">
                <label className="date-picker-label">
                  {t('跳转日期')}
                  <input
                    aria-label={t('选择查看日期')}
                    onChange={(event) =>
                      event.target.value && setSelectedDate(event.target.value)
                    }
                    type="date"
                    value={selectedDate}
                  />
                </label>
                {!isToday && (
                  <button
                    className="today-button"
                    onClick={() => setSelectedDate(todayKey)}
                    type="button"
                  >
                    {t('Today')}
                  </button>
                )}
              </div>
            </section>

            {viewMode === 'week' && (
              <section aria-label={t('周视图')} className="week-view-card">
                <div className="week-view-heading">
                  <div>
                    <strong>
                      {dayData?.teachingWeek
                        ? formatTeachingWeek(dayData.teachingWeek)
                        : t('Week view')}
                    </strong>
                    <span>
                      {formatDateKey(currentWeekStart, {
                        month: 'short',
                        day: 'numeric',
                      })}
                      {' — '}
                      {formatDateKey(shiftDate(currentWeekStart, 6), {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  </div>
                  <div className="week-view-actions">
                    <button
                      onClick={() =>
                        setSelectedDate((date) => shiftDate(date, -7))
                      }
                      type="button"
                    >
                      ‹
                    </button>
                    <button
                      onClick={() => setSelectedDate(todayKey)}
                      type="button"
                    >
                      {t('Today')}
                    </button>
                    <button
                      onClick={() =>
                        setSelectedDate((date) => shiftDate(date, 7))
                      }
                      type="button"
                    >
                      ›
                    </button>
                  </div>
                </div>
                <div className="week-day-strip">
                  {currentWeekDays.map((date, index) => {
                    const markerData = weekData[date];
                    const marked = Boolean(
                      markerData &&
                      (markerData.courses.length || markerData.events.length),
                    );
                    return (
                      <button
                        aria-pressed={date === selectedDate}
                        className={`week-day${date === selectedDate ? ' is-selected' : ''}${date === todayKey ? ' is-today' : ''}`}
                        key={date}
                        onClick={() => setSelectedDate(date)}
                        type="button"
                      >
                        <span>{localizedWeekdays[index]}</span>
                        <strong>{Number(date.slice(-2))}</strong>
                        <i
                          aria-hidden="true"
                          className={marked ? 'has-items' : ''}
                        />
                      </button>
                    );
                  })}
                </div>
                {weekLoading && (
                  <p className="week-loading">{t('正在更新本周安排…')}</p>
                )}
              </section>
            )}

            {controlMessage && (
              <p className="notice-message" role="status">
                {t(controlMessage)}
              </p>
            )}
            {loadError && (
              <div className="error-message" role="alert">
                <span>{t(loadError)}</span>
                <button
                  className="retry-button"
                  onClick={() => void loadDay(selectedDate, true)}
                  type="button"
                >
                  {t('重试')}
                </button>
              </div>
            )}

            <section
              aria-labelledby="schedule-heading"
              className="content-section"
            >
              <div className="section-heading">
                <h2 id="schedule-heading">
                  {isToday ? t("Today's schedule") : t('Schedule')}
                </h2>
                <button
                  className="text-action"
                  onClick={() => openEditor({ kind: 'event' })}
                  type="button"
                >
                  {t('＋ 新建日程')}
                </button>
              </div>
              <div className="schedule-card">
                {loading ? (
                  <p className="empty-state">{t('正在读取日程…')}</p>
                ) : agendaItems.length ? (
                  agendaItems.map((item) =>
                    item.kind === 'event' ? (
                      <article
                        className="schedule-item"
                        key={`event:${item.event.id}`}
                      >
                        <button
                          aria-label={`${t('编辑日程')} ${item.event.title}`}
                          className="schedule-main"
                          onClick={() =>
                            openEditor({ kind: 'event', event: item.event })
                          }
                          type="button"
                        >
                          <time className="schedule-time">
                            {item.event.isAllDay
                              ? t('全天')
                              : (item.event.startTime ??
                                (item.event.endTime
                                  ? `${t('至')} ${item.event.endTime}`
                                  : t('时间未定')))}
                          </time>
                          <span
                            aria-hidden="true"
                            className={`timeline-dot${item.event.isAllDay ? ' timeline-dot-plan' : ''}`}
                          />
                          <span className="schedule-copy">
                            <strong>{item.event.title}</strong>
                            {(item.event.location || item.event.notes) && (
                              <span className="schedule-detail">
                                {[item.event.location, item.event.notes]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </span>
                            )}
                          </span>
                          {item.event.startTime && item.event.endTime && (
                            <span className="event-end-time">
                              {item.event.endTime}
                            </span>
                          )}
                        </button>
                        <div className="row-actions">
                          <button
                            aria-label={`${t('编辑日程')} ${item.event.title}`}
                            className="row-action"
                            onClick={() =>
                              openEditor({ kind: 'event', event: item.event })
                            }
                            title={t('编辑日程')}
                            type="button"
                          >
                            <EditIcon />
                          </button>
                          <button
                            aria-label={`${t('删除日程')} ${item.event.title}`}
                            className="row-action delete-action"
                            disabled={busyItemId === item.event.id}
                            onClick={() => void deleteEvent(item.event)}
                            title={t('删除日程')}
                            type="button"
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      </article>
                    ) : (
                      <article
                        className="schedule-item course-schedule-item"
                        key={`course:${item.course.id}:${item.course.originalDate}`}
                      >
                        <button
                          aria-label={`${t('调整课程')} ${item.course.courseName}`}
                          className="schedule-main"
                          onClick={() => {
                            setCourseExceptionError('');
                            setCourseOccurrence(item.course);
                          }}
                          type="button"
                        >
                          <time className="schedule-time">
                            {item.course.startTime}
                          </time>
                          <span
                            aria-hidden="true"
                            className="timeline-dot course-dot"
                          />
                          <span className="schedule-copy">
                            <strong>{item.course.courseName}</strong>
                            <span className="schedule-detail">
                              {item.course.classroom || t('教室待定')} ·{' '}
                              {t(item.course.isException ? '单次调整' : '课程')}
                            </span>
                          </span>
                          <span className="event-end-time">
                            {item.course.endTime}
                          </span>
                        </button>
                        <div className="row-actions">
                          <button
                            aria-label={`${t('单次调课')} ${item.course.courseName}`}
                            className="row-action"
                            onClick={() => {
                              setCourseExceptionError('');
                              setCourseOccurrence(item.course);
                            }}
                            title={t('调课或改教室')}
                            type="button"
                          >
                            <EditIcon />
                          </button>
                          <button
                            aria-label={`${t('取消课程')} ${item.course.courseName}`}
                            className="row-action delete-action"
                            disabled={savingCourseException}
                            onClick={() =>
                              void cancelCourseOccurrence(item.course)
                            }
                            title={t('仅取消这一次')}
                            type="button"
                          >
                            ×
                          </button>
                        </div>
                      </article>
                    ),
                  )
                ) : (
                  <p className="empty-state">
                    {t('这一天还没有课程或临时日程。')}
                  </p>
                )}
              </div>
            </section>

            <section
              aria-labelledby="todo-heading"
              className="content-section todo-section"
            >
              <div className="section-heading">
                <h2 id="todo-heading">{t('My to-do list')}</h2>
                <span>
                  {completedTasks.length}/{tasks.length} {t('完成')}
                </span>
              </div>
              <form
                className="quick-add-form"
                onSubmit={(event) => void quickAddTask(event)}
              >
                <input
                  aria-label={t('快速添加待办')}
                  maxLength={160}
                  onChange={(event) => setQuickTitle(event.target.value)}
                  placeholder={t('写下一件要完成的小事…')}
                  ref={quickTaskInputRef}
                  value={quickTitle}
                />
                <button
                  aria-label={t('添加待办')}
                  className="add-task-button"
                  disabled={addingTask || !quickTitle.trim()}
                  type="submit"
                >
                  {addingTask ? '…' : '+'}
                </button>
              </form>
              <div className="todo-card">
                {loading ? (
                  <p className="empty-state">{t('正在读取待办…')}</p>
                ) : tasks.length === 0 ? (
                  <p className="empty-state">
                    {t('还没有待办，写下一件小事吧。')}
                  </p>
                ) : (
                  <>
                    {incompleteTasks.map((task, index) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        index={index}
                        count={incompleteTasks.length}
                        busy={busyItemId === task.id}
                        onToggle={() => void toggleTask(task)}
                        onEdit={() => openEditor({ kind: 'task', task })}
                        onDelete={() => void deleteTask(task)}
                        onMove={(direction) => void moveTask(task, direction)}
                      />
                    ))}
                    {completedTasks.length > 0 && (
                      <div className="completed-divider">
                        <span>{t('已完成')}</span>
                      </div>
                    )}
                    {completedTasks.map((task, index) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        index={index}
                        count={completedTasks.length}
                        busy={busyItemId === task.id}
                        onToggle={() => void toggleTask(task)}
                        onEdit={() => openEditor({ kind: 'task', task })}
                        onDelete={() => void deleteTask(task)}
                        onMove={(direction) => void moveTask(task, direction)}
                      />
                    ))}
                  </>
                )}
              </div>
            </section>
          </>
        )}
      </main>

      <footer className="app-footer">
        <span aria-hidden="true" className="footer-sparkle">
          ✳
        </span>
        {t('One small thing at a time ♡')}
      </footer>

      {editor?.kind === 'task' && (
        <TaskEditor
          defaultDate={selectedDate}
          error={editorError}
          onClose={() => setEditor(null)}
          onSave={saveTask}
          saving={savingEditor}
          task={editor.task}
        />
      )}
      {editor?.kind === 'event' && (
        <EventEditor
          defaultDate={selectedDate}
          error={editorError}
          event={editor.event}
          onClose={() => setEditor(null)}
          onSave={saveEvent}
          saving={savingEditor}
        />
      )}
      {courseOccurrence && (
        <CourseExceptionEditor
          course={courseOccurrence}
          error={courseExceptionError}
          onClose={() => setCourseOccurrence(null)}
          onRestore={restoreCourseException}
          onSave={saveCourseException}
          saving={savingCourseException}
        />
      )}
    </div>
  );
}

function TaskRow({
  task,
  index,
  count,
  busy,
  onToggle,
  onEdit,
  onDelete,
  onMove,
}: {
  task: Task;
  index: number;
  count: number;
  busy: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (direction: 'up' | 'down') => void;
}) {
  return (
    <div className={`todo-item${task.isCompleted ? ' is-checked' : ''}`}>
      <label className="todo-check-label">
        <input
          checked={task.isCompleted}
          disabled={busy}
          onChange={onToggle}
          type="checkbox"
        />
        <span aria-hidden="true" className="custom-checkbox">
          <svg viewBox="0 0 16 16" fill="none">
            <path
              d="m3.5 8 3 3 6-6"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.6"
            />
          </svg>
        </span>
        <span className="todo-title">{task.title}</span>
      </label>
      <div className="row-actions todo-actions">
        {!task.isCompleted && (
          <>
            <button
              aria-label={`上移待办 ${task.title}`}
              className="row-action order-action"
              disabled={busy || index === 0}
              onClick={() => onMove('up')}
              title={t('上移')}
              type="button"
            >
              ↑
            </button>
            <button
              aria-label={`下移待办 ${task.title}`}
              className="row-action order-action"
              disabled={busy || index === count - 1}
              onClick={() => onMove('down')}
              title={t('下移')}
              type="button"
            >
              ↓
            </button>
          </>
        )}
        <button
          aria-label={`编辑待办 ${task.title}`}
          className="row-action"
          onClick={onEdit}
          title={t('编辑待办')}
          type="button"
        >
          <EditIcon />
        </button>
        <button
          aria-label={`删除待办 ${task.title}`}
          className="row-action delete-action"
          disabled={busy}
          onClick={onDelete}
          title={t('删除待办')}
          type="button"
        >
          <TrashIcon />
        </button>
      </div>
    </div>
  );
}
