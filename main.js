const { app, BrowserWindow, ipcMain, dialog, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let qwenClient = null;
let iflytekWakeup = null;

try {
  qwenClient = require('./src/qwen.js');
} catch (e) {
  console.log('通义千问模块加载失败，语音对话功能不可用');
}

try {
  const IflytekWakeup = require('./src/iflytek.js');
  iflytekWakeup = new IflytekWakeup();
} catch (e) {
  console.log('科大讯飞模块加载失败，将使用浏览器内置语音识别');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 500,
    height: 730,
    resizable: false,
    frame: false,
    transparent: false,
    alwaysOnTop: false,
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.center();
  mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

const DATA_DIR = path.join(app.getPath('userData'), 'data');
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(EVENTS_FILE)) {
    fs.writeFileSync(EVENTS_FILE, '[]', 'utf-8');
  }
}

ensureDataDir();

function readEvents() {
  try {
    ensureDataDir();
    const raw = fs.readFileSync(EVENTS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function writeEvents(events) {
  ensureDataDir();
  fs.writeFileSync(EVENTS_FILE, JSON.stringify(events, null, 2), 'utf-8');
}

ipcMain.handle('get-events', () => {
  return readEvents();
});

ipcMain.handle('add-event', (event, newEvent) => {
  const events = readEvents();
  const eventWithId = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
    name: newEvent.name,
    date: newEvent.date,
    status: '未完成',
    voiceRemind: newEvent.voiceRemind || false,
    createdAt: new Date().toISOString()
  };
  events.push(eventWithId);
  writeEvents(events);
  return eventWithId;
});

ipcMain.handle('delete-event', (event, eventId) => {
  let events = readEvents();
  events = events.filter(e => e.id !== eventId);
  writeEvents(events);
  return true;
});

ipcMain.handle('toggle-event-status', (event, eventId) => {
  const events = readEvents();
  const target = events.find(e => e.id === eventId);
  if (target) {
    target.status = target.status === '已完成' ? '未完成' : '已完成';
    writeEvents(events);
  }
  return target;
});

ipcMain.handle('update-event', (event, updatedEvent) => {
  const events = readEvents();
  const idx = events.findIndex(e => e.id === updatedEvent.id);
  if (idx !== -1) {
    events[idx] = { ...events[idx], ...updatedEvent };
    writeEvents(events);
  }
  return events[idx];
});

ipcMain.handle('window-minimize', () => {
  mainWindow.minimize();
});

ipcMain.handle('window-close', () => {
  app.quit();
});

ipcMain.handle('check-mic-permission', async () => {
  if (process.platform !== 'win32') {
    const status = systemPreferences.getMediaAccessStatus('microphone');
    return status === 'granted';
  }
  return true;
});

ipcMain.handle('request-mic-permission', async () => {
  try {
    const granted = await systemPreferences.askForMediaAccess('microphone');
    return granted;
  } catch (e) {
    return false;
  }
});

ipcMain.handle('voice-iflytek-init', async (event, config) => {
  if (!iflytekWakeup) {
    return { success: false, error: '科大讯飞SDK不可用' };
  }
  try {
    const result = await iflytekWakeup.initialize(config);
    return { success: result, fallback: iflytekWakeup.fallbackMode };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('voice-iflytek-start', async () => {
  if (!iflytekWakeup) {
    return { success: false, error: '科大讯飞SDK不可用' };
  }
  try {
    const result = await iflytekWakeup.startWakeup((wakeupResult) => {
      if (mainWindow) {
        mainWindow.webContents.send('voice-wakeup-detected', wakeupResult);
      }
    });
    return { success: result };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('voice-iflytek-stop', async () => {
  if (!iflytekWakeup) return { success: true };
  try {
    await iflytekWakeup.stopWakeup();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('voice-qwen-configure', async (event, config) => {
  return { success: true, available: !!qwenClient };
});

ipcMain.handle('voice-qwen-process-text', async (event, text) => {
  const datePattern = /\(\((.+?)\)\)/g;
  const namePattern = /\[\[(.+?)\]\]/g;

  const dateMatches = [...text.matchAll(datePattern)];
  const nameMatches = [...text.matchAll(namePattern)];

  const results = [];
  const maxLen = Math.max(dateMatches.length, nameMatches.length);

  for (let i = 0; i < maxLen; i++) {
    const dateStr = dateMatches[i] ? dateMatches[i][1].trim() : null;
    const name = nameMatches[i] ? nameMatches[i][1].trim() : null;
    if (dateStr && name) {
      results.push({ date: dateStr, name });
    }
  }

  return { results, rawText: text };
});

ipcMain.handle('voice-get-config-path', () => {
  const configPath = path.join(app.getPath('userData'), 'voice-config.json');
  return configPath;
});

ipcMain.handle('voice-save-config', (event, config) => {
  const configPath = path.join(app.getPath('userData'), 'voice-config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  return true;
});

ipcMain.handle('voice-load-config', () => {
  const configPath = path.join(app.getPath('userData'), 'voice-config.json');
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch (e) {}
  return {};
});