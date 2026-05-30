const VoiceManager = {
  isEnabled: false,
  isWoken: false,
  mediaStream: null,
  audioContext: null,
  wakeWord: '重启',
  silenceTimer: null,
  voiceConfig: {},
  puppyAwakeTimer: null,
  detectionMethod: 'iflytek-asr',
  _debugLogs: [],
  _audioProcessor: null,
  _asrConnected: false,
  _lastText: '',

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

    window.electronAPI.onVoiceAsrResult((data) => {
      if (!data || !data.text) return;

      if (data.text) {
        console.log('[ASR转写] ' + data.text + (data.isFinal ? ' [最终]' : ''));
      }

      const transcriptEl = document.getElementById('asr-transcript');
      const transcriptTextEl = document.getElementById('asr-transcript-text');
      if (transcriptEl && transcriptTextEl && data.fullText) {
        transcriptEl.classList.remove('hidden');
        transcriptTextEl.textContent = data.fullText;
      }

      if (data.fullText && data.fullText.includes(this.wakeWord)) {
        this.log('event', '>>> 检测到关键词"' + this.wakeWord + '"！完整文本: ' + data.fullText);
        if (!this.isWoken) {
          this.onWakeupDetected();
        }
      }
    });

    window.electronAPI.onVoiceAsrStatus((data) => {
      if (data.status === 'started') {
        this._asrConnected = true;
        this.showVoiceStatus('转写已启动，等待关键词..."' + this.wakeWord + '"', 'idle');
        this.log('info', '讯飞转写已启动');
      } else if (data.status === 'error') {
        this.log('error', '讯飞转写错误: ' + data.msg);
        this.showVoiceStatus('转写出错: ' + data.msg, 'idle');
      } else if (data.status === 'closed') {
        this._asrConnected = false;
        this.log('warn', '讯飞连接已关闭');
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

      this.showVoiceStatus('正在连接讯飞实时转写...', 'idle');
      const startResult = await window.electronAPI.voiceAsrStart();

      if (!startResult.success) {
        this.log('error', '讯飞 ASR 启动失败: ' + (startResult.error || '未知错误'));
        this.showVoiceStatus('转写连接失败: ' + startResult.error, 'idle');
        return;
      }

      this.log('info', '讯飞 ASR 连接成功，开始音频流传输');
      this.showVoiceStatus('等待关键词..."' + this.wakeWord + '"', 'idle');

      this.startAudioStream();
    } catch (err) {
      this.log('error', '麦克风权限失败: ' + err.message);
      alert('麦克风权限获取失败，请在系统设置中允许麦克风访问。');
      document.getElementById('voice-toggle').checked = false;
      this.isEnabled = false;
    }
  },

  startAudioStream() {
    if (!this.mediaStream || !this.isEnabled) return;

    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000
      });
    } catch (e) {
      this.log('error', '无法创建 AudioContext: ' + e.message);
      return;
    }

    const source = this.audioContext.createMediaStreamSource(this.mediaStream);

    const bufferSize = 2048;
    const processor = source.context.createScriptProcessor(bufferSize, 1, 1);
    this._audioProcessor = processor;

    processor.onaudioprocess = (event) => {
      if (!this.isEnabled) return;

      const input = event.inputBuffer.getChannelData(0);
      const pcmBuffer = this.float32ToInt16(input);

      window.electronAPI.voiceAsrSendAudio(pcmBuffer.buffer);
    };

    source.connect(processor);
    processor.connect(source.context.destination);

    this.log('info', '音频流传输已启动, bufferSize=' + bufferSize + ', sampleRate=16000');
  },

  float32ToInt16(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16Array;
  },

  disableVoice() {
    this.log('info', '关闭语音...');
    this.isEnabled = false;
    this.isWoken = false;
    this._asrConnected = false;
    this.setPuppySleeping();

    if (this.puppyAwakeTimer) {
      clearTimeout(this.puppyAwakeTimer);
      this.puppyAwakeTimer = null;
    }

    if (this._audioProcessor) {
      this._audioProcessor.disconnect();
      this._audioProcessor = null;
    }

    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    window.electronAPI.voiceAsrStop();

    this.detectionMethod = 'none';
    this.resetSilenceTimer();
    this.hideVoiceStatus();
    this.hideTranscript();
    this.log('info', '语音已完全关闭');
  },

  onWakeupDetected() {
    this.log('event', '>>> 关键词"' + this.wakeWord + '"被检测到！');
    if (!this.isEnabled) {
      this.log('warn', '检测到关键词但语音未启用，忽略');
      return;
    }
    this.isWoken = true;

    this.wakePuppy();
    this.showVoiceStatus('我在！请说事件...', 'listening');
    this.speakResponse('我在');
    this.log('info', '小狗唤醒 + TTS 播报"我在"');

    this.puppyAwakeTimer = setTimeout(() => {
      if (this.isWoken) {
        this.log('info', '唤醒后流程：事件输入');
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

  hideTranscript() {
    const el = document.getElementById('asr-transcript');
    const textEl = document.getElementById('asr-transcript-text');
    if (el) el.classList.add('hidden');
    if (textEl) textEl.textContent = '';
  },

  async startVoiceListening() {
    if (!this.isWoken) return;
    this.log('info', '唤醒后流程：等待用户说出事件');
    this.useLocalListening();
  },

  useLocalListening() {
    this.log('info', '事件输入语音识别开始');
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
        this.log('debug', '事件语音识别结束，重置为监听状态');
        this.resetWakeupState();
      };

      recognition.onerror = (e) => {
        this.log('warn', '事件语音识别错误: ' + e.error);
        this.showTextFallback();
      };

      try {
        recognition.start();
        this._recognition = recognition;
        this.log('info', '事件语音识别已启动');
      } catch (e) {
        this.log('error', '事件语音识别启动失败: ' + e.message);
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
      this.log('debug', '静默超时(15s)，重置唤醒状态');
      this.resetWakeupState();
    }, 15000);
  },

  resetWakeupState() {
    this.isWoken = false;
    this.setPuppySleeping();
    this.resetSilenceTimer();
    this.hideTranscript();
    window.electronAPI.voiceAsrReset();
    this.log('info', '重置唤醒状态，继续监听关键词');
  }
};