export {};

declare global {
  interface Window {
    dayByDay: {
      getAlwaysOnTop: () => Promise<boolean>;
      toggleAlwaysOnTop: () => Promise<boolean>;
      minimizeWindow: () => Promise<void>;
      closeWindow: () => Promise<void>;
    };
  }
}
