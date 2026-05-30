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

  voiceAsrStart: () => ipcRenderer.invoke('voice-asr-start'),
  voiceAsrStop: () => ipcRenderer.invoke('voice-asr-stop'),
  voiceAsrReset: () => ipcRenderer.invoke('voice-asr-reset'),
  voiceAsrSendAudio: (audioData) => ipcRenderer.send('voice-asr-audio', audioData),

  voiceQwenConfigure: (config) => ipcRenderer.invoke('voice-qwen-configure', config),
  voiceQwenProcessText: (text) => ipcRenderer.invoke('voice-qwen-process-text', text),
  voiceAiProcess: (text) => ipcRenderer.invoke('voice-ai-process', { text }),
  findEventByName: (name) => ipcRenderer.invoke('find-event-by-name', name),
  updateEventByName: (oldName, newName, newDate) => ipcRenderer.invoke('update-event-by-name', { oldName, newName, newDate }),
  voiceSaveConfig: (config) => ipcRenderer.invoke('voice-save-config', config),
  voiceLoadConfig: () => ipcRenderer.invoke('voice-load-config'),

  onVoiceAsrResult: (callback) => {
    ipcRenderer.on('voice-asr-result', (event, data) => callback(data));
  },
  onVoiceAsrStatus: (callback) => {
    ipcRenderer.on('voice-asr-status', (event, data) => callback(data));
  },
  logToMain: (level, msg) => ipcRenderer.send('renderer-log', { level, msg })
});