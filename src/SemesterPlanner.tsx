import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type {
  Course,
  CourseInput,
  RecurrenceType,
  Semester,
  SemesterInput,
  SeriesExceptionPolicy,
} from './domain';
import { TimetableImport } from './TimetableImport';

const localDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const mondayFor = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  const weekday = date.getDay() || 7;
  date.setDate(date.getDate() - weekday + 1);
  return localDateKey(date);
};
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : '操作失败，请重试。';
const recurrenceLabel: Record<RecurrenceType, string> = {
  ALL: '每周',
  ODD: '单周',
  EVEN: '双周',
  CUSTOM: '指定周次',
};
const weekdays = [
  '星期一',
  '星期二',
  '星期三',
  '星期四',
  '星期五',
  '星期六',
  '星期日',
];

type Props = {
  onCurrentSemesterChanged: () => void;
  onOpenDay: (date: string) => void;
};

type SemesterDraft = {
  semesterName: string;
  startDate: string;
  endDate: string;
  firstWeekMonday: string;
  isCurrent: boolean;
};

type CourseDraft = {
  courseName: string;
  weekday: number;
  startTime: string;
  endTime: string;
  classroom: string;
  teacher: string;
  notes: string;
  firstWeek: number;
  lastWeek: number;
  recurrenceType: RecurrenceType;
  customWeeks: number[];
};

function SemesterEditor({
  semester,
  onClose,
  onSave,
  saving,
  error,
}: {
  semester?: Semester;
  onClose: () => void;
  onSave: (input: SemesterInput) => Promise<void>;
  saving: boolean;
  error: string;
}) {
  const today = new Date();
  const defaultStart = `${today.getFullYear()}-09-01`;
  const [draft, setDraft] = useState<SemesterDraft>({
    semesterName: semester?.semesterName ?? `${today.getFullYear()} 秋季学期`,
    startDate: semester?.startDate ?? defaultStart,
    endDate: semester?.endDate ?? `${today.getFullYear()}-12-25`,
    firstWeekMonday: semester?.firstWeekMonday ?? mondayFor(defaultStart),
    isCurrent: semester?.isCurrent ?? true,
  });
  const update = <K extends keyof SemesterDraft>(
    key: K,
    value: SemesterDraft[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onSave(draft);
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        aria-modal="true"
        className="editor-modal planner-modal"
        role="dialog"
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">SEMESTER PLANNER</p>
            <h2>{semester ? '编辑学期' : '新建学期'}</h2>
          </div>
          <button
            aria-label="关闭"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>
        <form className="editor-form" onSubmit={submit}>
          <label className="field-label">
            学期名称
            <input
              autoFocus
              maxLength={120}
              onChange={(event) => update('semesterName', event.target.value)}
              required
              value={draft.semesterName}
            />
          </label>
          <div className="planner-field-row">
            <label className="field-label">
              开始日期
              <input
                onChange={(event) => update('startDate', event.target.value)}
                required
                type="date"
                value={draft.startDate}
              />
            </label>
            <label className="field-label">
              结束日期
              <input
                onChange={(event) => update('endDate', event.target.value)}
                required
                type="date"
                value={draft.endDate}
              />
            </label>
          </div>
          <label className="field-label">
            第一教学周星期一
            <input
              onChange={(event) =>
                update('firstWeekMonday', event.target.value)
              }
              required
              type="date"
              value={draft.firstWeekMonday}
            />
          </label>
          <label className="planner-check">
            <input
              checked={draft.isCurrent}
              onChange={(event) => update('isCurrent', event.target.checked)}
              type="checkbox"
            />
            设为当前学期
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button className="quiet-button" onClick={onClose} type="button">
              取消
            </button>
            <button className="primary-button" disabled={saving} type="submit">
              {saving ? '保存中…' : '保存学期'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function CourseEditor({
  semester,
  course,
  onClose,
  onSave,
  saving,
  error,
}: {
  semester: Semester;
  course?: Course;
  onClose: () => void;
  onSave: (input: CourseInput, policy: SeriesExceptionPolicy) => Promise<void>;
  saving: boolean;
  error: string;
}) {
  const weekCount = Math.max(
    1,
    Math.min(
      52,
      Math.floor(
        (new Date(`${semester.endDate}T00:00:00Z`).getTime() -
          new Date(`${semester.firstWeekMonday}T00:00:00Z`).getTime()) /
          604800000,
      ) + 1,
    ),
  );
  const [draft, setDraft] = useState<CourseDraft>({
    courseName: course?.courseName ?? '',
    weekday: course?.weekday ?? 1,
    startTime: course?.startTime ?? '09:00',
    endTime: course?.endTime ?? '10:30',
    classroom: course?.classroom ?? '',
    teacher: course?.teacher ?? '',
    notes: course?.notes ?? '',
    firstWeek: course?.firstWeek ?? 1,
    lastWeek: course?.lastWeek ?? weekCount,
    recurrenceType: course?.recurrenceType ?? 'ALL',
    customWeeks: course?.customWeeks ?? [],
  });
  const [exceptionPolicy, setExceptionPolicy] =
    useState<SeriesExceptionPolicy>('preserve-valid');
  const update = <K extends keyof CourseDraft>(key: K, value: CourseDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const toggleWeek = (week: number) => {
    update(
      'customWeeks',
      draft.customWeeks.includes(week)
        ? draft.customWeeks.filter((item) => item !== week)
        : [...draft.customWeeks, week].sort((a, b) => a - b),
    );
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onSave({ ...draft, semesterId: semester.id }, exceptionPolicy);
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        aria-modal="true"
        className="editor-modal planner-modal"
        role="dialog"
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">{semester.semesterName}</p>
            <h2>{course ? '编辑整个课程系列' : '新增课程'}</h2>
          </div>
          <button
            aria-label="关闭"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>
        <form className="editor-form" onSubmit={submit}>
          <label className="field-label">
            课程名称
            <input
              autoFocus
              maxLength={120}
              onChange={(event) => update('courseName', event.target.value)}
              required
              value={draft.courseName}
            />
          </label>
          <div className="planner-field-row">
            <label className="field-label">
              星期
              <select
                onChange={(event) =>
                  update('weekday', Number(event.target.value))
                }
                value={draft.weekday}
              >
                {weekdays.map((day, index) => (
                  <option key={day} value={index + 1}>
                    {day}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              重复方式
              <select
                onChange={(event) =>
                  update('recurrenceType', event.target.value as RecurrenceType)
                }
                value={draft.recurrenceType}
              >
                {Object.entries(recurrenceLabel).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="planner-field-row">
            <label className="field-label">
              开始时间
              <input
                onChange={(event) => update('startTime', event.target.value)}
                required
                type="time"
                value={draft.startTime}
              />
            </label>
            <label className="field-label">
              结束时间
              <input
                onChange={(event) => update('endTime', event.target.value)}
                required
                type="time"
                value={draft.endTime}
              />
            </label>
          </div>
          <div className="planner-field-row">
            <label className="field-label">
              从第几周
              <input
                max={weekCount}
                min={1}
                onChange={(event) =>
                  update('firstWeek', Number(event.target.value))
                }
                required
                type="number"
                value={draft.firstWeek}
              />
            </label>
            <label className="field-label">
              到第几周
              <input
                max={weekCount}
                min={1}
                onChange={(event) =>
                  update('lastWeek', Number(event.target.value))
                }
                required
                type="number"
                value={draft.lastWeek}
              />
            </label>
          </div>
          {draft.recurrenceType === 'CUSTOM' && (
            <fieldset className="week-picker">
              <legend>选择上课周次</legend>
              <div>
                {Array.from({ length: weekCount }, (_, index) => index + 1)
                  .filter(
                    (week) => week >= draft.firstWeek && week <= draft.lastWeek,
                  )
                  .map((week) => (
                    <label key={week}>
                      <input
                        checked={draft.customWeeks.includes(week)}
                        onChange={() => toggleWeek(week)}
                        type="checkbox"
                      />
                      {week}
                    </label>
                  ))}
              </div>
            </fieldset>
          )}
          <div className="planner-field-row">
            <label className="field-label">
              教室
              <input
                maxLength={120}
                onChange={(event) => update('classroom', event.target.value)}
                value={draft.classroom}
              />
            </label>
            <label className="field-label">
              教师
              <input
                maxLength={120}
                onChange={(event) => update('teacher', event.target.value)}
                value={draft.teacher}
              />
            </label>
          </div>
          <label className="field-label">
            备注
            <textarea
              maxLength={2000}
              onChange={(event) => update('notes', event.target.value)}
              value={draft.notes}
            />
          </label>
          {course && (
            <fieldset className="exception-policy">
              <legend>已有单次调整</legend>
              <label>
                <input
                  checked={exceptionPolicy === 'preserve-valid'}
                  onChange={() => setExceptionPolicy('preserve-valid')}
                  type="radio"
                />
                保留仍符合新规则的例外，移除不再对应课程的例外
              </label>
              <label>
                <input
                  checked={exceptionPolicy === 'clear-all'}
                  onChange={() => setExceptionPolicy('clear-all')}
                  type="radio"
                />
                清除全部单次调课和停课
              </label>
            </fieldset>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button className="quiet-button" onClick={onClose} type="button">
              取消
            </button>
            <button className="primary-button" disabled={saving} type="submit">
              {saving ? '保存中…' : '保存课程'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function SemesterPlanner({
  onCurrentSemesterChanged,
  onOpenDay,
}: Props) {
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [semesterId, setSemesterId] = useState('');
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [semesterEditor, setSemesterEditor] = useState<Semester | 'new' | null>(
    null,
  );
  const [courseEditor, setCourseEditor] = useState<Course | 'new' | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [editorError, setEditorError] = useState('');
  const selectedSemester =
    semesters.find((semester) => semester.id === semesterId) ?? null;
  const currentWeek = useMemo(() => {
    if (!selectedSemester) return null;
    const today = localDateKey(new Date());
    if (today < selectedSemester.startDate || today > selectedSemester.endDate)
      return null;
    return (
      Math.floor(
        (new Date(`${today}T00:00:00Z`).getTime() -
          new Date(`${selectedSemester.firstWeekMonday}T00:00:00Z`).getTime()) /
          604800000,
      ) + 1
    );
  }, [selectedSemester]);

  const loadSemesters = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await window.dayByDay.listSemesters();
      setSemesters(result);
      const current = result.find((item) => item.isCurrent) ?? result[0];
      setSemesterId((existing) =>
        result.some((item) => item.id === existing)
          ? existing
          : (current?.id ?? ''),
      );
    } catch (loadFailure) {
      setError(errorText(loadFailure));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSemesters();
  }, []);
  useEffect(() => {
    let live = true;
    if (!semesterId) {
      setCourses([]);
      return () => {
        live = false;
      };
    }
    setLoading(true);
    window.dayByDay
      .listCourses(semesterId)
      .then((result) => {
        if (live) setCourses(result);
      })
      .catch((loadFailure: unknown) => {
        if (live) setError(errorText(loadFailure));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [semesterId]);

  const saveSemester = async (input: SemesterInput) => {
    if (busy) return;
    setBusy(true);
    setEditorError('');
    try {
      const saved =
        semesterEditor && semesterEditor !== 'new'
          ? await window.dayByDay.updateSemester(semesterEditor.id, input)
          : await window.dayByDay.createSemester(input);
      await loadSemesters();
      setSemesterId(saved.id);
      setSemesterEditor(null);
      if (saved.isCurrent) onCurrentSemesterChanged();
    } catch (saveFailure) {
      setEditorError(errorText(saveFailure));
    } finally {
      setBusy(false);
    }
  };

  const makeCurrent = async () => {
    if (!selectedSemester || busy) return;
    setBusy(true);
    setError('');
    try {
      await window.dayByDay.setCurrentSemester(selectedSemester.id);
      await loadSemesters();
      onCurrentSemesterChanged();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  const saveCourse = async (
    input: CourseInput,
    policy: SeriesExceptionPolicy,
  ) => {
    if (!selectedSemester || busy) return;
    setBusy(true);
    setEditorError('');
    try {
      if (courseEditor && courseEditor !== 'new') {
        if (!window.confirm('这会修改整个课程系列。是否继续？')) {
          setBusy(false);
          return;
        }
        await window.dayByDay.updateCourseSeries(
          courseEditor.id,
          input,
          policy,
        );
      } else {
        await window.dayByDay.createCourse(input);
      }
      setCourses(await window.dayByDay.listCourses(selectedSemester.id));
      setCourseEditor(null);
      onCurrentSemesterChanged();
    } catch (saveFailure) {
      setEditorError(errorText(saveFailure));
    } finally {
      setBusy(false);
    }
  };

  const deleteCourse = async (course: Course) => {
    if (!window.confirm(`删除“${course.courseName}”整个课程系列及其单次调整？`))
      return;
    if (!window.confirm('请再次确认：整个学期的这门课程及其例外都会删除。'))
      return;
    setBusy(true);
    setError('');
    try {
      await window.dayByDay.deleteCourseSeries(course.id);
      setCourses(await window.dayByDay.listCourses(course.semesterId));
      onCurrentSemesterChanged();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  if (importOpen && selectedSemester) {
    return (
      <TimetableImport
        existingCourses={courses}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          void window.dayByDay
            .listCourses(selectedSemester.id)
            .then(setCourses)
            .catch((failure: unknown) => setError(errorText(failure)));
          onCurrentSemesterChanged();
        }}
        semester={selectedSemester}
      />
    );
  }

  return (
    <section aria-label="学期课程管理" className="planner-page">
      <div className="planner-page-heading">
        <div>
          <p className="eyebrow">SEMESTER PLANNER</p>
          <h1>学期课程</h1>
        </div>
        <button
          className="text-action"
          onClick={() => {
            setEditorError('');
            setSemesterEditor('new');
          }}
          type="button"
        >
          ＋ 新建学期
        </button>
      </div>
      {error && (
        <div className="error-message" role="alert">
          <span>{error}</span>
          <button
            className="retry-button"
            onClick={() => void loadSemesters()}
            type="button"
          >
            重试
          </button>
        </div>
      )}
      {loading && !selectedSemester ? (
        <p className="empty-state planner-card">正在读取学期…</p>
      ) : semesters.length === 0 ? (
        <div className="empty-state planner-card">
          还没有学期，先建立一个学期再添加课程。
        </div>
      ) : selectedSemester ? (
        <>
          <div className="semester-card">
            <label className="semester-select-label">
              查看学期
              <select
                onChange={(event) => setSemesterId(event.target.value)}
                value={selectedSemester.id}
              >
                {semesters.map((semester) => (
                  <option key={semester.id} value={semester.id}>
                    {semester.semesterName}
                    {semester.isCurrent ? ' · 当前' : ''}
                  </option>
                ))}
              </select>
            </label>
            <div className="semester-summary">
              <strong>{selectedSemester.semesterName}</strong>
              <span>
                {selectedSemester.startDate} — {selectedSemester.endDate}
              </span>
              <span>第 {currentWeek ?? '—'} 教学周</span>
            </div>
            <div className="planner-actions">
              <button
                className="quiet-button"
                onClick={() => setSemesterEditor(selectedSemester)}
                type="button"
              >
                编辑学期
              </button>
              {!selectedSemester.isCurrent && (
                <button
                  className="quiet-button"
                  disabled={busy}
                  onClick={() => void makeCurrent()}
                  type="button"
                >
                  设为当前学期
                </button>
              )}
              <button
                className="primary-button"
                onClick={() => {
                  setEditorError('');
                  setCourseEditor('new');
                }}
                type="button"
              >
                ＋ 新增课程
              </button>
            </div>
          </div>
          <div className="course-list-heading">
            <h2>我的课程</h2>
            <div className="course-list-tools">
              <button
                className="text-action"
                onClick={() => setImportOpen(true)}
                type="button"
              >
                Import timetable
              </button>
              <button
                className="text-action"
                onClick={() => onOpenDay(localDateKey(new Date()))}
                type="button"
              >
                查看今日安排
              </button>
            </div>
          </div>
          {courses.length === 0 ? (
            <div className="empty-state planner-card">
              <span>No classes yet.</span>
              <button
                className="text-action"
                onClick={() => {
                  setEditorError('');
                  setCourseEditor('new');
                }}
                type="button"
              >
                ＋ 新增课程
              </button>
            </div>
          ) : (
            <div className="planner-course-list">
              {courses.map((course) => (
                <article className="planner-course-card" key={course.id}>
                  <div className="course-card-copy">
                    <span className="course-time">
                      {weekdays[course.weekday - 1]} · {course.startTime}–
                      {course.endTime}
                    </span>
                    <strong>{course.courseName}</strong>
                    <span>
                      {course.classroom || '教室待定'}
                      {course.teacher ? ` · ${course.teacher}` : ''}
                    </span>
                    <span>
                      第 {course.firstWeek}–{course.lastWeek} 周 ·{' '}
                      {recurrenceLabel[course.recurrenceType]}
                      {course.recurrenceType === 'CUSTOM'
                        ? `（${course.customWeeks.join('、')}）`
                        : ''}
                    </span>
                  </div>
                  <div className="row-actions">
                    <button
                      aria-label={`编辑课程 ${course.courseName}`}
                      className="row-action"
                      onClick={() => {
                        setEditorError('');
                        setCourseEditor(course);
                      }}
                      title="编辑整个系列"
                      type="button"
                    >
                      ✎
                    </button>
                    <button
                      aria-label={`删除课程 ${course.courseName}`}
                      className="row-action delete-action"
                      disabled={busy}
                      onClick={() => void deleteCourse(course)}
                      title="删除整个系列"
                      type="button"
                    >
                      ×
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      ) : null}
      {semesterEditor && (
        <SemesterEditor
          error={editorError}
          onClose={() => setSemesterEditor(null)}
          onSave={saveSemester}
          saving={busy}
          semester={semesterEditor === 'new' ? undefined : semesterEditor}
        />
      )}
      {courseEditor && selectedSemester && (
        <CourseEditor
          course={courseEditor === 'new' ? undefined : courseEditor}
          error={editorError}
          onClose={() => setCourseEditor(null)}
          onSave={saveCourse}
          saving={busy}
          semester={selectedSemester}
        />
      )}
    </section>
  );
}
