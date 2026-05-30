const path = require('path');
const fs = require('fs');

let iflytekNative = null;
try {
  iflytekNative = require('../../build/Release/iflytek_wakeup.node');
} catch (e) {
  console.log('科大讯飞SDK原生模块未编译，使用模拟模式');
}

class IflytekWakeup {
  constructor() {
    this.native = null;
    this.isInitialized = false;
    this.isRunning = false;
    this.onWakeupCallback = null;
    this.fallbackMode = !iflytekNative;
  }

  async initialize(config) {
    const { appId, apiKey, apiSecret, libPath, workDir } = config;

    if (this.fallbackMode) {
      console.log('[科大讯飞] 使用模拟模式运行');
      this.isInitialized = true;
      return true;
    }

    try {
      this.native = new iflytekNative.IflytekWakeup();

      const dllPath = libPath || path.join(__dirname, '..', '..', 'libs', 'iflytek', 'libs', 'x64', 'AIKit.dll');

      const initResult = this.native.initialize(dllPath, appId, apiKey, apiSecret);

      if (!initResult) {
        console.error('[科大讯飞] SDK初始化失败');
        this.fallbackMode = true;
        return false;
      }

      this.isInitialized = true;
      console.log('[科大讯飞] SDK初始化成功');
      return true;
    } catch (err) {
      console.error('[科大讯飞] SDK加载失败:', err.message);
      this.fallbackMode = true;
      return false;
    }
  }

  async startWakeup(onWakeup) {
    if (!this.isInitialized) {
      console.error('[科大讯飞] SDK未初始化');
      return false;
    }

    this.onWakeupCallback = onWakeup;

    if (this.fallbackMode) {
      console.log('[科大讯飞] 模拟模式：开始监听唤醒词');
      this.isRunning = true;
      return true;
    }

    try {
      const result = this.native.startWakeup((data) => {
        if (typeof data === 'string') {
          try {
            const parsed = JSON.parse(data);
            if (parsed.keyword) {
              console.log('[科大讯飞] 检测到唤醒词:', parsed.keyword);
              this.onWakeupCallback && this.onWakeupCallback(parsed);
            }
          } catch (e) {
            console.log('[科大讯飞] 唤醒结果:', data);
            this.onWakeupCallback && this.onWakeupCallback({ keyword: data });
          }
        }
      });

      if (!result) {
        console.error('[科大讯飞] 启动唤醒失败');
        return false;
      }

      this.isRunning = true;
      console.log('[科大讯飞] 唤醒监听已启动');
      return true;
    } catch (err) {
      console.error('[科大讯飞] 启动唤醒异常:', err.message);
      return false;
    }
  }

  async stopWakeup() {
    this.isRunning = false;

    if (this.fallbackMode) {
      return true;
    }

    try {
      if (this.native) {
        this.native.stopWakeup();
      }
      return true;
    } catch (err) {
      console.error('[科大讯飞] 停止唤醒异常:', err.message);
      return false;
    }
  }

  async writeAudio(audioBuffer) {
    if (!this.isRunning) return false;

    if (this.fallbackMode) {
      return true;
    }

    try {
      return this.native.writeAudio(audioBuffer);
    } catch (err) {
      return false;
    }
  }

  async dispose() {
    await this.stopWakeup();

    if (this.fallbackMode) return;

    try {
      if (this.native) {
        this.native.stopWakeup();
        this.native = null;
      }
    } catch (err) {
      console.error('[科大讯飞] 资源释放异常:', err.message);
    }
  }
}

module.exports = IflytekWakeup;