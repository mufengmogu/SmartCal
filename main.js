process.stdout.setDefaultEncoding('utf-8');
process.stderr.setDefaultEncoding('utf-8');

const { app, BrowserWindow, ipcMain, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let qwenClient = null;
let asrManager = null;
let bailian = null;

try {
  qwenClient = require('./src/qwen.js');
} catch (e) {
  console.log('通义千问模块加载失败，语音对话功能不可用');
}

try {
  const IFlytekASRManager = require('./src/iflytek-asr.js');
  asrManager = new IFlytekASRManager();
  asrManager.initialize().then(ok => {
    if (ok) console.log('讯飞实时语音转写模块初始化成功');
    else console.log('讯飞实时语音转写模块初始化失败，请检查密钥文件');
  });
} catch (e) {
  console.log('讯飞 ASR 模块加载失败:', e.message);
}

try {
  bailian = require('./src/bailian.js');
  console.log('阿里云百炼模块加载成功');
} catch (e) {
  console.log('阿里云百炼模块加载失败:', e.message);
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

ipcMain.on('renderer-log', (event, { level, msg }) => {
  console.log(`[Renderer ${level}] ${msg}`);
});

app.on('window-all-closed', () => {
  if (asrManager) asrManager.stop();
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

ipcMain.handle('get-events', () => readEvents());

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

ipcMain.handle('window-minimize', () => { mainWindow.minimize(); });
ipcMain.handle('window-close', () => { app.quit(); });

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

ipcMain.handle('voice-asr-start', async () => {
  if (!asrManager) {
    return { success: false, error: '讯飞 ASR 模块不可用' };
  }
  try {
    asrManager.setResultCallback((result) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('voice-asr-result', result);
      }
    });
    asrManager.setStatusCallback((status, msg) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('voice-asr-status', { status, msg });
      }
    });
    await asrManager.connect();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('voice-asr-stop', async () => {
  if (!asrManager) return { success: true };
  try {
    asrManager.stop();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('voice-asr-reset', async () => {
  if (asrManager) {
    asrManager.resetSessionText();
    return { success: true };
  }
  return { success: false, error: 'ASR模块未初始化' };
});

ipcMain.on('voice-asr-audio', (event, audioData) => {
  if (asrManager && asrManager.isRunning) {
    asrManager.feedAudio(audioData);
  }
});

ipcMain.handle('voice-qwen-configure', async (event, config) => {
  return { success: true, available: !!qwenClient };
});

ipcMain.handle('voice-ai-process', async (event, { text }) => {
  if (!bailian) {
    return { success: false, error: '阿里云百炼模块未加载' };
  }
  try {
    const rawResponse = await bailian.callQwenModel(text);
    const parsed = bailian.parseAiResponse(rawResponse);
    console.log('[AI处理] 输入: "' + text + '" → 动作: ' + parsed.action);
    return { success: true, ...parsed };
  } catch (e) {
    console.error('[AI处理] 失败:', e.message);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('find-event-by-name', (event, name) => {
  const events = readEvents();
  const match = events.find(e => e.name === name && e.status !== '已完成');
  return match || null;
});

ipcMain.handle('update-event-by-name', (event, { oldName, newName, newDate }) => {
  const events = readEvents();
  const idx = events.findIndex(e => e.name === oldName && e.status !== '已完成');
  if (idx === -1) {
    return { success: false, error: '未找到事件: ' + oldName };
  }
  if (newName) events[idx].name = newName;
  if (newDate) events[idx].date = newDate;
  writeEvents(events);
  return { success: true, event: events[idx] };
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