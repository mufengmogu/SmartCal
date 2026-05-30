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

    document.getElementById('link-snowboy-train').addEventListener('click', (e) => {
      e.preventDefault();
    });
  },

  showSettings() {
    const overlay = document.getElementById('settings-overlay');
    overlay.classList.remove('hidden');

    if (this.config.snowboy) {
      document.getElementById('snowboy-model').value = this.config.snowboy.modelPath || '';
      document.getElementById('snowboy-sensitivity').value = this.config.snowboy.sensitivity || '0.5';
    }
    if (this.config.qwen) {
      document.getElementById('qwen-apikey').value = this.config.qwen.apiKey || '';
    }
  },

  hideSettings() {
    document.getElementById('settings-overlay').classList.add('hidden');
  },

  async saveSettings() {
    const snowboy = {
      modelPath: document.getElementById('snowboy-model').value.trim(),
      sensitivity: document.getElementById('snowboy-sensitivity').value.trim() || '0.5'
    };

    const qwen = {
      apiKey: document.getElementById('qwen-apikey').value.trim()
    };

    const config = {};
    if (snowboy.modelPath || snowboy.sensitivity !== '0.5') config.snowboy = snowboy;
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