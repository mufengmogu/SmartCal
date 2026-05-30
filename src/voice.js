const VoiceManager = {
  isEnabled: false,
  isWoken: false,
  mediaStream: null,
  audioContext: null,
  wakeWord: '重启',
  silenceTimer: null,
  voiceConfig: {},
  useSnowboySDK: false,
  useBrowserFallback: true,
  puppyAwakeTimer: null,
  detectionMethod: 'none',
  _debugLogs: [],

  log(level, msg) {
    const ts = new Date().toLocaleTimeString();
    const entry = `[Voice ${ts}] [${level}] ${msg}`;
    this._debugLogs.push(entry);
    if (this._debugLogs.length > 200) this._debugLogs.shift();
    console.log(entry);
    if (window.electronAPI && window.electronAPI.logToMain) {
      window.electronAPI.logToMain(level, msg);
    }
  },

  async init() {
    this.voiceConfig = await window.electronAPI.voiceLoadConfig();
    this.log('info', '初始化完成, config=' + JSON.stringify(this.voiceConfig));
    this.bindEvents();
    window.VoiceManager = this;
    window.simulateWakeup = () => this.testWakeup();
    window.showVoiceLogs = () => {
      console.table(this._debugLogs.map((l, i) => ({ idx: i, log: l })));
    };
  },

  bindEvents() {
    document.getElementById('voice-toggle').addEventListener('change', async (e) => {
      if (e.target.checked) {
        this.log('info', '语音开关 -> 打开');
        await this.enableVoice();
      } else {
        this.log('info', '语音开关 -> 关闭');
        this.disableVoice();
      }
    });

    window.electronAPI.onVoiceWakeupDetected((data) => {
      this.log('event', '主进程 Snowboy 回调收到: ' + JSON.stringify(data));
      if (data && data.keyword) {
        this.onWakeupDetected();
      }
    });
  },

  async enableVoice() {
    try {
      this.log('info', '正在请求麦克风权限...');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true
        }
      });

      this.log('info', '麦克风权限已获取, audioTracks=' + stream.getAudioTracks().length);
      this.mediaStream = stream;
      this.isEnabled = true;

      this.showVoiceStatus('正在初始化唤醒引擎...', 'idle');
      await this.initSnowboySDK();

      this.showVoiceStatus('等待唤醒...说出"重启"', 'idle');
      this.startWakeWordDetection();
    } catch (err) {
      this.log('error', '麦克风权限失败: ' + err.message);
      alert('麦克风权限获取失败，请在系统设置中允许麦克风访问。');
      document.getElementById('voice-toggle').checked = false;
      this.isEnabled = false;
    }
  },

  async initSnowboySDK() {
    const snowboyCfg = this.voiceConfig.snowboy || {};
    this.log('info', '正在初始化 Snowboy SDK...');
    const result = await window.electronAPI.voiceSnowboyInit({
      modelPath: snowboyCfg.modelPath || null,
      sensitivity: snowboyCfg.sensitivity || '0.5'
    });

    this.log('info', 'Snowboy init 结果: ' + JSON.stringify(result));

    if (result.success && !result.fallback) {
      this.useSnowboySDK = true;
      this.useBrowserFallback = false;
      await window.electronAPI.voiceSnowboyStart();
      this.log('info', 'Snowboy 原生SDK已启动 (非后备模式)');
    } else {
      this.useSnowboySDK = false;
      this.useBrowserFallback = true;
      this.log('info', '使用浏览器内置语音识别作为后备方案');
    }
  },

  disableVoice() {
    this.log('info', '关闭语音...');
    this.isEnabled = false;
    this.isWoken = false;
    this.setPuppySleeping();

    if (this.puppyAwakeTimer) {
      clearTimeout(this.puppyAwakeTimer);
      this.puppyAwakeTimer = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    if (this._recognition) {
      this._recognition.stop();
      this._recognition = null;
    }

    if (this._processor) {
      this._processor.disconnect();
      this._processor = null;
    }

    if (this.useSnowboySDK) {
      window.electronAPI.voiceSnowboyStop();
      this.useSnowboySDK = false;
    }

    this.detectionMethod = 'none';
    this.resetSilenceTimer();
    this.hideVoiceStatus();
    this.log('info', '语音已完全关闭');
  },

  onWakeupDetected() {
    this.log('event', '>>> 唤醒词"' + this.wakeWord + '"被检测到！');
    if (!this.isEnabled) {
      this.log('warn', '检测到唤醒词但语音未启用，忽略');
      return;
    }
    this.isWoken = true;

    this.wakePuppy();
    this.showVoiceStatus('我在！请说话...', 'listening');
    this.speakResponse('我在');
    this.log('info', '小狗唤醒 + TTS 播报"我在"');

    this.puppyAwakeTimer = setTimeout(() => {
      if (this.isWoken) {
        this.log('info', 'TTS完毕，开始语音事件输入');
        this.startVoiceListening();
      }
    }, 1500);
  },

  testWakeup() {
    this.log('debug', '>>> 手动触发模拟唤醒测试');
    if (!this.isEnabled) {
      this.log('warn', '模拟测试失败：语音未开启。请先打开语音开关');
      return 'FAIL: 语音未开启，请先打开语音开关';
    }
    this.onWakeupDetected();
    return 'OK: 唤醒已触发，小狗应醒来并播报"我在"';
  },

  setPuppySleeping() {
    const puppy = document.getElementById('puppy-container');
    if (puppy) {
      puppy.classList.remove('awake');
      puppy.classList.add('sleeping');
    }
  },

  wakePuppy() {
    const puppy = document.getElementById('puppy-container');
    if (puppy) {
      puppy.classList.remove('sleeping');
      puppy.classList.add('awake');
    }
  },

  showVoiceStatus(text, state) {
    const statusEl = document.getElementById('voice-status');
    const textEl = document.getElementById('voice-status-text');
    if (!statusEl || !textEl) return;
    const dotEl = statusEl.querySelector('.voice-status-dot');

    statusEl.classList.remove('hidden');
    textEl.textContent = text;

    dotEl.classList.remove('listening', 'speaking');
    if (state === 'listening') dotEl.classList.add('listening');
    if (state === 'speaking') dotEl.classList.add('speaking');
  },

  hideVoiceStatus() {
    const el = document.getElementById('voice-status');
    if (el) el.classList.add('hidden');
  },

  startWakeWordDetection() {
    if (!this.isEnabled) return;
    this.log('info', '启动唤醒词检测, snowboy=' + this.useSnowboySDK + ', fallback=' + this.useBrowserFallback);

    if (this.useSnowboySDK) {
      this.log('info', '路径A: Snowboy原生模式，唤醒词检测由主进程处理');
      this.detectionMethod = 'snowboy-native';
      this.showVoiceStatus('等待唤醒...说出"' + this.wakeWord + '"', 'idle');
      return;
    }

    if (typeof window.webkitSpeechRecognition !== 'undefined') {
      this.log('info', '路径B: webkitSpeechRecognition 可用，启动浏览器语音持续监听');
      this.useBrowserRecognition();
    } else if (typeof window.SpeechRecognition !== 'undefined') {
      window.webkitSpeechRecognition = window.SpeechRecognition;
      this.log('info', '路径B: SpeechRecognition 可用，启动浏览器语音持续监听');
      this.useBrowserRecognition();
    } else {
      this.log('warn', '路径C: 语音识别API不可用，使用Web Audio离线模式（仅检测人声）');
      this.showVoiceStatus('语音唤醒已启动（离线模式）', 'idle');
      this.useAudioEnergyDetection();
    }
  },

  useBrowserRecognition() {
    this.log('info', 'useBrowserRecognition 开始');
    const SpeechRecognition = window.webkitSpeechRecognition || window.SpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;

    let networkFailCount = 0;

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript.trim();
        const confidence = event.results[i][0].confidence || 0;
        this.log('debug', '识别到: "' + transcript + '" 置信度: ' + confidence.toFixed(2) + ' 最终: ' + event.results[i].isFinal);
        if (transcript.includes(this.wakeWord)) {
          this.log('event', '>>> 在浏览器语音识别中匹配到唤醒词"' + this.wakeWord + '"！原文: "' + transcript + '"');
          this.detectionMethod = 'browser-speech';
          this.onWakeupDetected();
          recognition.stop();
          return;
        }
      }
    };

    recognition.onerror = (event) => {
      this.log('warn', '浏览器语音识别错误: ' + event.error + ' ' + (event.message || ''));

      if (event.error === 'network') {
        networkFailCount++;
        this.log('warn', '网络连接失败 (' + networkFailCount + '/3)');
        if (networkFailCount >= 3) {
          this.log('event', '>>> 语音识别网络连续失败，降级为离线能量检测');
          this._recognition = null;
          recognition.stop();
          this.useAudioEnergyDetection();
          return;
        }
      }

      if (event.error === 'not-allowed') {
        this.showVoiceStatus('语音识别被拒绝', 'idle');
        return;
      }
      if (event.error === 'no-speech') {
        return;
      }
    };

    recognition.onend = () => {
      this.log('debug', '浏览器语音识别周期结束');
      if (this.isEnabled && !this.isWoken && this._recognition === recognition) {
        setTimeout(() => {
          try {
            if (this._recognition === recognition) {
              recognition.start();
            }
          } catch (e) {
            this.log('error', '重启语音识别失败: ' + e.message);
          }
        }, 500);
      }
    };

    try {
      recognition.start();
      this._recognition = recognition;
      this.detectionMethod = 'browser-speech';
      this.showVoiceStatus('等待唤醒...说出"' + this.wakeWord + '"', 'idle');
      this.log('info', '浏览器语音识别已启动, 监听唤醒词: ' + this.wakeWord + ', lang=zh-CN');
    } catch (e) {
      this.log('error', '启动语音识别异常: ' + e.message);
      this.showVoiceStatus('唤醒词监听启动失败', 'idle');
    }
  },

  useAudioEnergyDetection() {
    this.log('info', 'useAudioEnergyDetection 开始 (仅检测人声能量)');
    this.detectionMethod = 'energy';
    if (!this.isEnabled) return;

    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000
      });
    }

    const source = this.audioContext.createMediaStreamSource(this.mediaStream);

    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);

    let consecutiveDetections = 0;
    let silentFrames = 0;
    const bufferSize = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferSize);

    const checkAudio = () => {
      if (!this.isEnabled || this.isWoken) return;

      analyser.getByteFrequencyData(dataArray);

      let sum = 0;
      let lowSum = 0;
      let midSum = 0;
      for (let i = 0; i < bufferSize; i++) {
        sum += dataArray[i];
        if (i < 32) lowSum += dataArray[i];
        else if (i < 96) midSum += dataArray[i];
      }
      const avg = sum / bufferSize;
      const lowRatio = lowSum / (sum || 1);
      const midRatio = midSum / (sum || 1);

      const isHumanSpeech = (avg > 30 && lowRatio > 0.3 && lowRatio < 0.7 && midRatio > 0.15);

      if (isHumanSpeech) {
        consecutiveDetections++;
        silentFrames = 0;
        if (consecutiveDetections === 1) {
          this.log('debug', '检测到人声开始, avg=' + avg.toFixed(1));
        }
        if (consecutiveDetections > 12) {
          this.log('event', '>>> 持续人声触发唤醒 (离线能量检测, ' + consecutiveDetections + '帧)');
          consecutiveDetections = 0;
          this.onWakeupDetected();
          return;
        }
      } else {
        if (consecutiveDetections > 0) {
          silentFrames++;
          if (silentFrames > 4) {
            this.log('debug', '人声停止, 持续帧=' + consecutiveDetections + ' (需要>12帧触发)');
            consecutiveDetections = 0;
            silentFrames = 0;
          } else {
            consecutiveDetections++;
          }
        }
      }

      requestAnimationFrame(checkAudio);
    };

    checkAudio();
    this._analyser = analyser;
    this._source = source;
    this.log('info', 'Web Audio能量检测已启动 (离线模式, 需持续人声12帧触发)');
  },

  async startVoiceListening() {
    if (!this.isWoken) return;

    this.log('info', '开始语音事件输入环节');

    if (this.voiceConfig.qwen && this.voiceConfig.qwen.apiKey) {
      this.showVoiceStatus('请说出您的事件安排...', 'listening');
    }

    this.useLocalListening();
  },

  useLocalListening() {
    this.log('info', 'useLocalListening 开始');
    const SpeechRecognition = window.webkitSpeechRecognition || window.SpeechRecognition;

    if (typeof SpeechRecognition !== 'undefined') {
      const recognition = new SpeechRecognition();
      recognition.lang = 'zh-CN';
      recognition.continuous = false;
      recognition.interimResults = false;

      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript.trim();
        this.log('info', '事件语音输入识别结果: "' + transcript + '"');
        this.processVoiceInput(transcript);
      };

      recognition.onend = () => {
        this.log('debug', '事件语音识别结束');
        this.resetWakeupState();
      };

      recognition.onerror = (e) => {
        this.log('warn', '事件语音识别错误: ' + e.error);
        this.resetWakeupState();
      };

      try {
        recognition.start();
        this._recognition = recognition;
        this.log('info', '事件语音识别已启动');
      } catch (e) {
        this.log('error', '事件语音识别启动失败: ' + e.message);
        this.showVoiceStatus('语音识别不可用', 'idle');
        this.showTextFallback();
      }
    } else {
      this.log('warn', 'SpeechRecognition不可用，使用文本输入后备');
      this.showTextFallback();
    }
  },

  showTextFallback() {
    setTimeout(() => {
      const text = prompt('请输入您的事件安排（例如：爷爷的生日在6月1日）：');
      if (text) {
        this.log('info', '文本输入: "' + text + '"');
        this.processVoiceInput(text);
      }
      this.resetWakeupState();
    }, 500);
  },

  async processVoiceInput(text) {
    this.log('info', 'processVoiceInput: "' + text + '"');
    if (!text) {
      this.resetWakeupState();
      return;
    }

    const qwenResult = await window.electronAPI.voiceQwenProcessText(text);
    this.log('debug', 'Qwen解析结果: ' + JSON.stringify(qwenResult));

    if (qwenResult.results && qwenResult.results.length > 0) {
      for (const item of qwenResult.results) {
        this.log('info', 'Qwen格式解析 -> name: "' + item.name + '", date: "' + item.date + '"');
        const formattedDate = this.parseDateString(item.date);
        if (formattedDate && item.name.trim()) {
          await EventsManager.addParsedEvent(item.name.trim(), formattedDate);
          this.speakResponse('已为您添加事件：' + item.name.trim());
          this.showVoiceStatus('事件已添加！', 'idle');
          this.log('info', '事件已通过Qwen格式添加');
        }
      }
      this.resetWakeupState();
      return;
    }

    this.log('info', 'Qwen无结果，尝试自然语言解析');
    this.processNaturalLanguage(text);
    this.resetWakeupState();
  },

  processNaturalLanguage(text) {
    const today = new Date();
    const currentYear = today.getFullYear();

    const patterns = [
      {
        regex: /(.+?)(?:在|于)(\d{1,2})月(\d{1,2})[日号]/,
        handler: (m) => ({ name: m[1], date: `${currentYear}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}` })
      },
      {
        regex: /(\d{1,2})月(\d{1,2})[日号](.+)/,
        handler: (m) => ({ name: m[3], date: `${currentYear}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}` })
      },
      {
        regex: /(.+?)(?:明天|明日)/,
        handler: (m) => {
          const t = new Date(today); t.setDate(t.getDate() + 1);
          return { name: m[1], date: Calendar.formatDateStr(t.getFullYear(), t.getMonth(), t.getDate()) };
        }
      },
      {
        regex: /(.+?)(?:后天)/,
        handler: (m) => {
          const t = new Date(today); t.setDate(t.getDate() + 2);
          return { name: m[1], date: Calendar.formatDateStr(t.getFullYear(), t.getMonth(), t.getDate()) };
        }
      },
      {
        regex: /(.+?)(?:今天|今日)/,
        handler: (m) => ({
          name: m[1], date: Calendar.formatDateStr(today.getFullYear(), today.getMonth(), today.getDate())
        })
      }
    ];

    for (const { regex, handler } of patterns) {
      const match = text.match(regex);
      if (match) {
        const result = handler(match);
        this.log('info', 'NL匹配: pattern=' + regex.source + ', name="' + result.name + '", date=' + result.date);
        if (result.name && result.name.trim()) {
          EventsManager.addParsedEvent(result.name.trim(), result.date);
          this.speakResponse('已为您添加事件：' + result.name.trim());
          this.showVoiceStatus('事件已添加！', 'idle');
          return;
        }
      }
    }

    const datePattern = /(\d{1,2})[月\.](\d{1,2})/;
    const dateMatch = text.match(datePattern);
    if (dateMatch) {
      const month = dateMatch[1].padStart(2, '0');
      const day = dateMatch[2].padStart(2, '0');
      const date = `${currentYear}-${month}-${day}`;
      const name = text.replace(datePattern, '').trim().replace(/^(在|于|的)/, '').trim();
      this.log('info', '日期模式兜底: name="' + name + '", date=' + date);
      if (name) {
        EventsManager.addParsedEvent(name, date);
        this.speakResponse('已为您添加事件：' + name);
        this.showVoiceStatus('事件已添加！', 'idle');
        return;
      }
    }

    this.log('warn', '无法解析输入: "' + text + '"');
    this.speakResponse('抱歉，没有理解您的事件安排，请尝试说"事件名称 在 X月X日"');
    this.showVoiceStatus('未能解析事件，请重试', 'idle');
  },

  parseDateString(dateStr) {
    const today = new Date();
    const currentYear = today.getFullYear();

    let match = dateStr.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
    if (match) return `${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`;

    match = dateStr.match(/^(\d{1,2})[.\-/](\d{1,2})$/);
    if (match) return `${currentYear}-${match[1].padStart(2,'0')}-${match[2].padStart(2,'0')}`;

    match = dateStr.match(/(\d{1,2})月(\d{1,2})[日号]?/);
    if (match) return `${currentYear}-${match[1].padStart(2,'0')}-${match[2].padStart(2,'0')}`;

    return null;
  },

  speakResponse(text) {
    this.log('info', 'TTS播报: "' + text + '"');
    if (typeof window.speechSynthesis !== 'undefined') {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'zh-CN';
      utterance.rate = 1.0;
      utterance.pitch = 1.1;
      utterance.volume = 1;

      const voices = window.speechSynthesis.getVoices();
      const zhVoice = voices.find(v => v.lang.startsWith('zh'));
      if (zhVoice) utterance.voice = zhVoice;

      window.speechSynthesis.speak(utterance);
    }
  },

  resetSilenceTimer() {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    this.silenceTimer = setTimeout(() => {
      this.log('debug', '静默超时(15s)，重置唤醲状态');
      this.resetWakeupState();
    }, 15000);
  },

  resetWakeupState() {
    this.isWoken = false;
    this.setPuppySleeping();
    this.resetSilenceTimer();
    this.log('info', '重置唤醒状态，重新开始监听唤醒词');
    this.startWakeWordDetection();
  }
};