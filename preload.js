const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getEvents: () => ipcRenderer.invoke('get-events'),
  addEvent: (event) => ipcRenderer.invoke('add-event', event),
  deleteEvent: (id) => ipcRenderer.invoke('delete-event', id),
  toggleEventStatus: (id) => ipcRenderer.invoke('toggle-event-status', id),
  updateEvent: (event) => ipcRenderer.invoke('update-event', event),
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  checkMicPermission: () => ipcRenderer.invoke('check-mic-permission'),
  requestMicPermission: () => ipcRenderer.invoke('request-mic-permission'),

  voiceIflytekInit: (config) => ipcRenderer.invoke('voice-iflytek-init', config),
  voiceIflytekStart: () => ipcRenderer.invoke('voice-iflytek-start'),
  voiceIflytekStop: () => ipcRenderer.invoke('voice-iflytek-stop'),
  voiceQwenConfigure: (config) => ipcRenderer.invoke('voice-qwen-configure', config),
  voiceQwenProcessText: (text) => ipcRenderer.invoke('voice-qwen-process-text', text),
  voiceSaveConfig: (config) => ipcRenderer.invoke('voice-save-config', config),
  voiceLoadConfig: () => ipcRenderer.invoke('voice-load-config'),

  onVoiceWakeupDetected: (callback) => {
    ipcRenderer.on('voice-wakeup-detected', (event, data) => callback(data));
  }
});