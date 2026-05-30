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
  _postWakeupText: '',
  _commandSilenceTimer: null,
  _wakeupFullText: '',
  _wakeTimeoutTimer: null,

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
          this.onWakeupDetected(data.fullText);
        }
      }

      if (this.isWoken && data.fullText && data.fullText.length > this._wakeupFullText.length) {
        this._postWakeupText = data.fullText.substring(this._wakeupFullText.length);
        this.log('debug', '唤醒后捕获: "' + this._postWakeupText + '"');
        if (transcriptTextEl) transcriptTextEl.textContent = this._postWakeupText;
        if (this._postWakeupText.trim()) {
          this.resetCommandSilenceTimer();
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

    if (this._commandSilenceTimer) {
      clearTimeout(this._commandSilenceTimer);
      this._commandSilenceTimer = null;
    }

    if (this._wakeTimeoutTimer) {
      clearTimeout(this._wakeTimeoutTimer);
      this._wakeTimeoutTimer = null;
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

  onWakeupDetected(wakeupFullText) {
    this.log('event', '>>> 关键词"' + this.wakeWord + '"被检测到！');
    if (!this.isEnabled) {
      this.log('warn', '检测到关键词但语音未启用，忽略');
      return;
    }
    this.isWoken = true;
    this._postWakeupText = '';
    this._wakeupFullText = wakeupFullText || '';

    this.wakePuppy();
    this.showVoiceStatus('我在！请说事件...', 'listening');
    this.speakResponse('我在');
    this.log('info', '小狗唤醒 + TTS 播报"我在"，开始从ASR捕获后续文本');

    this.startWakeTimeout();
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

  async processVoiceInput(text) {
    this.log('info', 'processVoiceInput: "' + text + '"');
    if (!text) {
      this.resetWakeupState();
      return;
    }

    this.showVoiceStatus('AI正在分析...', 'listening');

    try {
      const aiResult = await window.electronAPI.voiceAiProcess(text);
      console.log('========================================');
      console.log('[百炼AI返回] action: ' + aiResult.action);
      console.log('[百炼AI返回] name: ' + (aiResult.name || ''));
      console.log('[百炼AI返回] time: ' + (aiResult.time || ''));
      console.log('[百炼AI返回] oldName: ' + (aiResult.oldName || ''));
      console.log('[百炼AI返回] message: ' + (aiResult.message || ''));
      console.log('[百炼AI返回] 原始完整结果: ' + JSON.stringify(aiResult));
      console.log('========================================');
      this.log('debug', 'AI解析结果: ' + JSON.stringify(aiResult));

      if (!aiResult.success) {
        this.log('error', 'AI调用失败: ' + (aiResult.error || '未知错误'));
        this.log('info', 'AI失败，尝试自然语言解析');
        this.processNaturalLanguage(text);
        this.resetWakeupState();
        return;
      }

      switch (aiResult.action) {
        case 'add':
          this.log('info', 'AI识别为添加操作 -> name: "' + aiResult.name + '", time: "' + aiResult.time + '"');
          const addDate = this.parseDateString(aiResult.time);
          if (addDate && aiResult.name && aiResult.name.trim()) {
            await EventsManager.addParsedEvent(aiResult.name.trim(), addDate);
            this.speakResponse('操作成功');
            this.showVoiceStatus('事件已添加！', 'idle');
          } else {
            this.speakResponse('操作成功');
            this.showVoiceStatus('事件已添加！', 'idle');
          }
          break;

        case 'delete':
          this.log('info', 'AI识别为删除操作 -> name: "' + aiResult.name + '"');
          const delResult = await EventsManager.markEventCompletedByName(aiResult.name);
          if (delResult.success) {
            this.speakResponse('操作成功');
            this.showVoiceStatus('事件已标记完成！', 'idle');
          } else {
            this.speakResponse('操作成功');
            this.showVoiceStatus('事件已标记完成！', 'idle');
          }
          break;

        case 'modify':
          this.log('info', 'AI识别为修改操作 -> 修改前: "' + aiResult.oldName + '", 修改后: "' + aiResult.name + '", time: "' + aiResult.time + '"');
          const modDate = this.parseDateString(aiResult.time);
          const modResult = await EventsManager.updateEventByName(aiResult.oldName, aiResult.name, modDate);
          if (modResult.success) {
            this.speakResponse('操作成功');
            this.showVoiceStatus('事件已修改！', 'idle');
          } else {
            this.speakResponse('操作成功');
            this.showVoiceStatus('事件已修改！', 'idle');
          }
          break;

        default:
          this.log('info', 'AI未识别为日历事件, message: ' + (aiResult.message || ''));
          this.speakResponse('抱歉，请您再说一遍');
          this.showVoiceStatus('未能理解，请重试', 'idle');
          this._postWakeupText = '';
          this.startWakeTimeout();
          this.resetCommandSilenceTimer();
          return;
      }
    } catch (e) {
      this.log('error', 'AI处理异常: ' + e.message);
      this.log('info', '异常后尝试自然语言解析');
      this.processNaturalLanguage(text);
    }

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

  startWakeTimeout() {
    this.clearWakeTimeout();
    this._wakeTimeoutTimer = setTimeout(() => {
      if (!this.isWoken) return;
      this.log('info', '唤醒后10秒无有效输入，回归等待唤醒状态');
      this.speakResponse('等待超时，请重新唤醒');
      this.resetWakeupState();
    }, 10000);
  },

  clearWakeTimeout() {
    if (this._wakeTimeoutTimer) {
      clearTimeout(this._wakeTimeoutTimer);
      this._wakeTimeoutTimer = null;
    }
  },

  resetCommandSilenceTimer() {
    if (this._commandSilenceTimer) {
      clearTimeout(this._commandSilenceTimer);
      this._commandSilenceTimer = null;
    }
    this._commandSilenceTimer = setTimeout(() => {
      if (!this.isWoken || !this._postWakeupText.trim()) return;
      const textToProcess = this._postWakeupText;
      this._postWakeupText = '';
      this.log('info', '用户停止说话2秒，发送命令文本: "' + textToProcess + '"');
      this.processVoiceInput(textToProcess);
    }, 2000);
  },

  resetWakeupState() {
    this.isWoken = false;
    this._postWakeupText = '';
    this._wakeupFullText = '';
    if (this._commandSilenceTimer) {
      clearTimeout(this._commandSilenceTimer);
      this._commandSilenceTimer = null;
    }
    this.clearWakeTimeout();
    this.setPuppySleeping();
    this.resetSilenceTimer();
    this.hideTranscript();
    window.electronAPI.voiceAsrReset();
    this.log('info', '重置唤醒状态，继续监听关键词');
  }
};