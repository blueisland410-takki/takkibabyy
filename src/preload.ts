import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('dayByDay', {
  getAlwaysOnTop: (): Promise<boolean> =>
    ipcRenderer.invoke('window:get-always-on-top'),
  toggleAlwaysOnTop: (): Promise<boolean> =>
    ipcRenderer.invoke('window:toggle-always-on-top'),
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  closeWindow: (): Promise<void> => ipcRenderer.invoke('window:close'),
});
