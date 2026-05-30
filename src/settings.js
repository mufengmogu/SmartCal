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

    if (this.config.qwen) {
      document.getElementById('qwen-apikey').value = this.config.qwen.apiKey || '';
    }
  },

  hideSettings() {
    document.getElementById('settings-overlay').classList.add('hidden');
  },

  async saveSettings() {
    const qwen = {
      apiKey: document.getElementById('qwen-apikey').value.trim()
    };

    const config = {};
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