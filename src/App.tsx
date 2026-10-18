import { useEffect, useState } from 'react';
import './index.css';

type ScheduleItem = {
  time: string;
  title: string;
  detail: string;
  kind: 'class' | 'plan';
};

const sampleSchedule: ScheduleItem[] = [
  { time: '09:00', title: '设计基础', detail: '教学楼 · 302', kind: 'class' },
  { time: '13:30', title: '韩语会话', detail: '语言中心 · 205', kind: 'class' },
  { time: '16:00', title: '专注时间', detail: '临时安排', kind: 'plan' },
];

const sampleTodos = [
  { id: 'review', label: '整理今天的课堂笔记' },
  { id: 'email', label: '回复一封重要邮件' },
  { id: 'walk', label: '晚饭后出去散散步' },
];

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

function localDateKey(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function App() {
  const [today, setToday] = useState(() => new Date());
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [checkedTodos, setCheckedTodos] = useState<string[]>([]);
  const [controlMessage, setControlMessage] = useState('');

  useEffect(() => {
    let midnightTimer: number;

    const refreshDate = () => setToday(new Date());
    const scheduleMidnightRefresh = () => {
      window.clearTimeout(midnightTimer);
      const now = new Date();
      const nextMidnight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
        0,
        0,
        1,
      );
      midnightTimer = window.setTimeout(() => {
        refreshDate();
        scheduleMidnightRefresh();
      }, nextMidnight.getTime() - now.getTime());
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        refreshDate();
        scheduleMidnightRefresh();
      }
    };

    refreshDate();
    scheduleMidnightRefresh();
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearTimeout(midnightTimer);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, []);

  useEffect(() => {
    void window.dayByDay
      .getAlwaysOnTop()
      .then(setAlwaysOnTop)
      .catch(() => setControlMessage('窗口设置暂时无法读取。'));
  }, []);

  const toggleAlwaysOnTop = async () => {
    try {
      const nextValue = await window.dayByDay.toggleAlwaysOnTop();
      setAlwaysOnTop(nextValue);
      setControlMessage('');
    } catch {
      setControlMessage('置顶设置失败，请重新打开应用后再试。');
    }
  };

  const toggleTodo = (id: string) => {
    setCheckedTodos((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  };

  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(
    today,
  );
  const dateLabel = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
  }).format(today);

  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="brand" aria-label="daybyday.">
          <span aria-hidden="true" className="brand-mark">
            d
          </span>
          <span className="brand-name">daybyday.</span>
        </div>
        <div aria-hidden="true" className="drag-region" />
        <nav aria-label="窗口控制" className="window-controls">
          <button
            aria-label={alwaysOnTop ? '取消始终置顶' : '始终置顶'}
            aria-pressed={alwaysOnTop}
            className={`window-button pin-button${alwaysOnTop ? ' is-active' : ''}`}
            onClick={() => void toggleAlwaysOnTop()}
            title={alwaysOnTop ? '已始终置顶' : '始终置顶'}
            type="button"
          >
            <PinIcon />
          </button>
          <button
            aria-label="最小化窗口"
            className="window-button"
            onClick={() => void window.dayByDay.minimizeWindow()}
            title="最小化"
            type="button"
          >
            <MinimizeIcon />
          </button>
          <button
            aria-label="关闭窗口"
            className="window-button close-button"
            onClick={() => void window.dayByDay.closeWindow()}
            title="关闭"
            type="button"
          >
            <CloseIcon />
          </button>
        </nav>
      </header>

      <main className="scroll-content">
        <section aria-label="今天" className="date-section">
          <p className="date-weekday">{weekday}</p>
          <h1>{dateLabel}</h1>
          <time className="date-year" dateTime={localDateKey(today)}>
            {today.getFullYear()}
          </time>
          <p className="greeting">A little plan for today ♡</p>
        </section>

        {controlMessage && (
          <p className="control-message" role="status">
            {controlMessage}
          </p>
        )}

        <section aria-labelledby="schedule-heading" className="content-section">
          <div className="section-heading">
            <h2 id="schedule-heading">Today&apos;s schedule</h2>
            <span>示例安排</span>
          </div>
          <div className="schedule-card">
            {sampleSchedule.map((item, index) => (
              <article className="schedule-item" key={item.time}>
                <time className="schedule-time">{item.time}</time>
                <span
                  aria-hidden="true"
                  className={`timeline-dot ${item.kind === 'plan' ? 'timeline-dot-plan' : ''}`}
                />
                {index < sampleSchedule.length - 1 && (
                  <span aria-hidden="true" className="timeline-line" />
                )}
                <div className="schedule-copy">
                  <h3>{item.title}</h3>
                  <p>{item.detail}</p>
                </div>
                {item.kind === 'plan' && (
                  <span className="temporary-tag">临时</span>
                )}
              </article>
            ))}
          </div>
          <p className="sample-note">当前显示的是用于体验界面的示例内容。</p>
        </section>

        <section
          aria-labelledby="todo-heading"
          className="content-section todo-section"
        >
          <div className="section-heading">
            <h2 id="todo-heading">My to-do list</h2>
            <span>
              {checkedTodos.length}/{sampleTodos.length}
            </span>
          </div>
          <div className="todo-card">
            {sampleTodos.map((todo) => {
              const checked = checkedTodos.includes(todo.id);
              return (
                <label
                  className={`todo-item${checked ? ' is-checked' : ''}`}
                  key={todo.id}
                >
                  <input
                    checked={checked}
                    onChange={() => toggleTodo(todo.id)}
                    type="checkbox"
                  />
                  <span className="custom-checkbox" aria-hidden="true">
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
                  <span>{todo.label}</span>
                </label>
              );
            })}
          </div>
          <p className="sample-note">勾选可预览完成状态；示例数据不会保存。</p>
        </section>
      </main>

      <footer className="app-footer">
        <span aria-hidden="true" className="footer-sparkle">
          ✳
        </span>
        One small thing at a time ♡
      </footer>
    </div>
  );
}
