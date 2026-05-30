const SettingsManager = {
  config: {},

  async init() {
    this.config = await window.electronAPI.voiceLoadConfig();
    this.bindEvents();
  },

  bindEvents() {
    document.getElementById('btn-settings').addEventListener('click', () => {
      this.showSettings();
    });

    document.getElementById('btn-settings-close').addEventListener('click', () => {
      this.hideSettings();
    });

    document.getElementById('btn-settings-cancel').addEventListener('click', () => {
      this.hideSettings();
    });

    document.getElementById('btn-settings-save').addEventListener('click', () => {
      this.saveSettings();
    });

    document.getElementById('settings-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'settings-overlay') {
        this.hideSettings();
      }
    });

    document.getElementById('link-qwen-doc').addEventListener('click', (e) => {
      e.preventDefault();
    });
  },

  showSettings() {
    const overlay = document.getElementById('settings-overlay');
    overlay.classList.remove('hidden');

    if (this.config.iflytek) {
      document.getElementById('iflytek-appid').value = this.config.iflytek.appId || '';
      document.getElementById('iflytek-apikey').value = this.config.iflytek.apiKey || '';
      document.getElementById('iflytek-apisecret').value = this.config.iflytek.apiSecret || '';
    }
    if (this.config.qwen) {
      document.getElementById('qwen-apikey').value = this.config.qwen.apiKey || '';
    }
  },

  hideSettings() {
    document.getElementById('settings-overlay').classList.add('hidden');
  },

  async saveSettings() {
    const iflytek = {
      appId: document.getElementById('iflytek-appid').value.trim(),
      apiKey: document.getElementById('iflytek-apikey').value.trim(),
      apiSecret: document.getElementById('iflytek-apisecret').value.trim()
    };

    const qwen = {
      apiKey: document.getElementById('qwen-apikey').value.trim()
    };

    const config = {};
    if (iflytek.appId) config.iflytek = iflytek;
    if (qwen.apiKey) config.qwen = qwen;

    this.config = config;
    await window.electronAPI.voiceSaveConfig(config);

    if (VoiceManager) {
      VoiceManager.voiceConfig = config;
    }

    this.hideSettings();
    alert('语音服务设置已保存！');
  }
};