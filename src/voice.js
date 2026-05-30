const VoiceManager = {
  isEnabled: false,
  isWoken: false,
  mediaStream: null,
  audioContext: null,
  useNativeSDK: false,
  wakeWord: '小日历',
  silenceTimer: null,
  voiceConfig: {},

  async init() {
    this.voiceConfig = await window.electronAPI.voiceLoadConfig();
    this.bindEvents();
  },

  bindEvents() {
    document.getElementById('voice-toggle').addEventListener('change', async (e) => {
      if (e.target.checked) {
        await this.enableVoice();
      } else {
        this.disableVoice();
      }
    });

    window.electronAPI.onVoiceWakeupDetected((data) => {
      if (data && data.keyword) {
        this.onNativeWakeupDetected(data.keyword);
      }
    });
  },

  async enableVoice() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true
        }
      });

      this.mediaStream = stream;
      this.isEnabled = true;
      this.showVoiceStatus('正在初始化...', 'idle');

      if (this.voiceConfig.iflytek && this.voiceConfig.iflytek.appId) {
        await this.initNativeSDK();
      }

      this.showVoiceStatus('等待唤醒...说出"' + this.wakeWord + '"', 'idle');
      this.startWakeWordDetection();
    } catch (err) {
      alert('麦克风权限获取失败，请在系统设置中允许麦克风访问。');
      document.getElementById('voice-toggle').checked = false;
      this.isEnabled = false;
    }
  },

  async initNativeSDK() {
    const iflytekCfg = this.voiceConfig.iflytek;
    const result = await window.electronAPI.voiceIflytekInit({
      appId: iflytekCfg.appId,
      apiKey: iflytekCfg.apiKey,
      apiSecret: iflytekCfg.apiSecret
    });

    if (result.success && !result.fallback) {
      this.useNativeSDK = true;
      await window.electronAPI.voiceIflytekStart();
      console.log('[Voice] 科大讯飞原生SDK已启动');
    } else {
      console.log('[Voice] 使用浏览器内置语音识别');
    }
  },

  disableVoice() {
    this.isEnabled = false;
    this.isWoken = false;

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

    if (this.useNativeSDK) {
      window.electronAPI.voiceIflytekStop();
      this.useNativeSDK = false;
    }

    this.resetSilenceTimer();
    this.hideVoiceStatus();
  },

  onNativeWakeupDetected(keyword) {
    if (!this.isEnabled) return;
    this.isWoken = true;
    this.showVoiceStatus('我在！请说话...', 'listening');
    this.speakResponse('我在');

    setTimeout(() => {
      if (this.isWoken) {
        this.startVoiceListening();
      }
    }, 1500);
  },

  showVoiceStatus(text, state) {
    const statusEl = document.getElementById('voice-status');
    const textEl = document.getElementById('voice-status-text');
    const dotEl = statusEl.querySelector('.voice-status-dot');

    statusEl.classList.remove('hidden');
    textEl.textContent = text;

    dotEl.classList.remove('listening', 'speaking');
    if (state === 'listening') dotEl.classList.add('listening');
    if (state === 'speaking') dotEl.classList.add('speaking');
  },

  hideVoiceStatus() {
    document.getElementById('voice-status').classList.add('hidden');
  },

  startWakeWordDetection() {
    if (!this.isEnabled) return;

    if (this.useNativeSDK) {
      this.showVoiceStatus('等待唤醒...说出"' + this.wakeWord + '"', 'idle');
      return;
    }

    if (typeof window.webkitSpeechRecognition !== 'undefined') {
      this.useBrowserRecognition();
    } else if (typeof window.SpeechRecognition !== 'undefined') {
      window.webkitSpeechRecognition = window.SpeechRecognition;
      this.useBrowserRecognition();
    } else {
      this.showVoiceStatus('语音唤醒已启动（简化模式）', 'idle');
      this.useSimulatedRecognition();
    }
  },

  useBrowserRecognition() {
    const SpeechRecognition = window.webkitSpeechRecognition || window.SpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript.trim();
        if (transcript.includes(this.wakeWord)) {
          this.onWakeDetected();
          recognition.stop();
          return;
        }
      }
    };

    recognition.onerror = (event) => {
      if (event.error === 'not-allowed') {
        this.showVoiceStatus('语音识别被拒绝', 'idle');
        return;
      }
      setTimeout(() => {
        if (this.isEnabled && !this.isWoken && recognition) {
          try { recognition.start(); } catch (e) {}
        }
      }, 1000);
    };

    recognition.onend = () => {
      if (this.isEnabled && !this.isWoken) {
        setTimeout(() => {
          try { recognition.start(); } catch (e) {}
        }, 500);
      }
    };

    try {
      recognition.start();
      this._recognition = recognition;
      this.showVoiceStatus('等待唤醒...说出"' + this.wakeWord + '"', 'idle');
    } catch (e) {
      this.showVoiceStatus('唤醒词监听启动失败', 'idle');
    }
  },

  useSimulatedRecognition() {
    if (!this.isEnabled) return;

    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000
      });
    }

    const source = this.audioContext.createMediaStreamSource(this.mediaStream);
    const processor = this.audioContext.createScriptProcessor(4096, 1, 1);

    let consecutiveDetections = 0;

    processor.onaudioprocess = (event) => {
      if (!this.isEnabled || this.isWoken) return;

      const inputData = event.inputBuffer.getChannelData(0);
      const energy = this.calculateEnergy(inputData);
      const zcr = this.calculateZCR(inputData);

      if (energy > 0.02 && zcr > 0.02 && zcr < 0.12) {
        consecutiveDetections++;
        if (consecutiveDetections > 8) {
          consecutiveDetections = 0;
          this.onWakeDetected();
        }
      } else {
        consecutiveDetections = Math.max(0, consecutiveDetections - 1);
      }
    };

    source.connect(processor);
    processor.connect(this.audioContext.destination);
    this._processor = processor;
    this._source = source;
  },

  calculateEnergy(buffer) {
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      sum += buffer[i] * buffer[i];
    }
    return Math.sqrt(sum / buffer.length);
  },

  calculateZCR(buffer) {
    let crossings = 0;
    for (let i = 1; i < buffer.length; i++) {
      if (buffer[i] * buffer[i - 1] < 0) crossings++;
    }
    return crossings / buffer.length;
  },

  onWakeDetected() {
    this.isWoken = true;
    this.showVoiceStatus('我在！请说话...', 'listening');
    this.speakResponse('我在');

    setTimeout(() => {
      if (this.isWoken) {
        this.startVoiceListening();
      }
    }, 1500);
  },

  async startVoiceListening() {
    if (!this.isWoken) return;

    if (this.voiceConfig.qwen && this.voiceConfig.qwen.apiKey) {
      this.showVoiceStatus('请说出您的事件安排...', 'listening');
    }

    this.useLocalListening();
  },

  useLocalListening() {
    const SpeechRecognition = window.webkitSpeechRecognition || window.SpeechRecognition;

    if (typeof SpeechRecognition !== 'undefined') {
      const recognition = new SpeechRecognition();
      recognition.lang = 'zh-CN';
      recognition.continuous = false;
      recognition.interimResults = false;

      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript.trim();
        this.processVoiceInput(transcript);
      };

      recognition.onend = () => {
        this.resetWakeupState();
      };

      recognition.onerror = () => {
        this.resetWakeupState();
      };

      try {
        recognition.start();
        this._recognition = recognition;
      } catch (e) {
        this.showVoiceStatus('语音识别不可用', 'idle');
        setTimeout(() => this.resetWakeupState(), 3000);
      }
    } else {
      const text = prompt('请输入您的事件安排（例如：爷爷的生日在6月1日）：');
      if (text) {
        this.processVoiceInput(text);
      }
      this.resetWakeupState();
    }
  },

  async processVoiceInput(text) {
    if (!text) {
      this.resetWakeupState();
      return;
    }

    const qwenResult = await window.electronAPI.voiceQwenProcessText(text);

    if (qwenResult.results && qwenResult.results.length > 0) {
      for (const item of qwenResult.results) {
        const formattedDate = this.parseDateString(item.date);
        if (formattedDate && item.name.trim()) {
          await EventsManager.addParsedEvent(item.name.trim(), formattedDate);
          this.speakResponse('已为您添加事件：' + item.name.trim());
          this.showVoiceStatus('事件已添加！', 'idle');
        }
      }
      this.resetWakeupState();
      return;
    }

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
      if (name) {
        EventsManager.addParsedEvent(name, date);
        this.speakResponse('已为您添加事件：' + name);
        this.showVoiceStatus('事件已添加！', 'idle');
        return;
      }
    }

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
      this.resetWakeupState();
    }, 15000);
  },

  resetWakeupState() {
    this.isWoken = false;
    this.resetSilenceTimer();
    this.startWakeWordDetection();
  }
};