const path = require('path');
const fs = require('fs');

let SnowboyDetect = null;
let Models = null;

try {
  const snowboy = require('snowboy');
  SnowboyDetect = snowboy.Detector;
  Models = snowboy.Models;
} catch (e) {
  console.log('[Snowboy] 原生模块未安装 (Windows不支持原生编译)，使用后备方案');
}

class SnowboyManager {
  constructor() {
    this.detector = null;
    this.models = null;
    this.isInitialized = false;
    this.isRunning = false;
    this.onWakeupCallback = null;
    this.fallbackMode = !SnowboyDetect;
    this.wakeWordModelPath = null;
    this.commonResPath = null;
  }

  async initialize(config) {
    const { modelPath, commonResPath, sensitivity } = config;

    if (this.fallbackMode) {
      console.log('[Snowboy] 运行于后备模式 (浏览器语音识别)');
      this.isInitialized = true;
      return { success: true, fallback: true };
    }

    try {
      const resolvedModelPath = modelPath ||
        path.join(__dirname, '..', 'assets', 'chongqi.pmdl');
      const resolvedResPath = commonResPath ||
        path.join(__dirname, '..', 'node_modules', 'snowboy', 'resources', 'common.res');

      if (!fs.existsSync(resolvedResPath)) {
        console.error('[Snowboy] common.res 未找到:', resolvedResPath);
        this.fallbackMode = true;
        this.isInitialized = true;
        return { success: true, fallback: true };
      }

      if (!fs.existsSync(resolvedModelPath)) {
        console.log('[Snowboy] 自定义唤醒词模型未找到，使用通用模型');
      }

      this.wakeWordModelPath = resolvedModelPath;
      this.commonResPath = resolvedResPath;

      this.models = new Models();
      this.models.add({
        file: resolvedModelPath,
        sensitivity: sensitivity || '0.5',
        hotwords: 'chongqi'
      });

      this.detector = new SnowboyDetect({
        resource: resolvedResPath,
        models: this.models,
        audioGain: 2.0,
        applyFrontend: true
      });

      this.detector.on('hotword', (index, hotword, buffer) => {
        console.log('[Snowboy] 检测到唤醒词:', hotword);
        if (this.onWakeupCallback) {
          this.onWakeupCallback({ keyword: hotword, index, confidence: 1.0 });
        }
      });

      this.detector.on('error', (err) => {
        console.error('[Snowboy] 检测错误:', err);
      });

      this.isInitialized = true;
      console.log('[Snowboy] 原生SDK初始化成功');
      return { success: true, fallback: false };
    } catch (err) {
      console.error('[Snowboy] SDK初始化失败:', err.message);
      this.fallbackMode = true;
      this.isInitialized = true;
      return { success: true, fallback: true };
    }
  }

  async startWakeup(onWakeup) {
    if (!this.isInitialized) {
      console.error('[Snowboy] 未初始化');
      return false;
    }

    this.onWakeupCallback = onWakeup;

    if (this.fallbackMode) {
      console.log('[Snowboy] 后备模式：由渲染进程负责唤醒词检测');
      this.isRunning = true;
      return true;
    }

    try {
      this.detector.resume();
      this.isRunning = true;
      console.log('[Snowboy] 唤醒监听已启动');
      return true;
    } catch (err) {
      console.error('[Snowboy] 启动唤醒异常:', err.message);
      return false;
    }
  }

  async stopWakeup() {
    this.isRunning = false;

    if (this.fallbackMode) {
      return true;
    }

    try {
      if (this.detector) {
        this.detector.pause();
      }
      return true;
    } catch (err) {
      console.error('[Snowboy] 停止唤醒异常:', err.message);
      return false;
    }
  }

  writeAudio(audioBuffer) {
    if (!this.isRunning) return false;

    if (this.fallbackMode) {
      return true;
    }

    try {
      if (this.detector) {
        this.detector.write(audioBuffer);
        return true;
      }
      return false;
    } catch (err) {
      return false;
    }
  }

  async dispose() {
    await this.stopWakeup();

    if (this.fallbackMode) return;

    try {
      if (this.detector) {
        this.detector.destroy();
        this.detector = null;
      }
    } catch (err) {
      console.error('[Snowboy] 资源释放异常:', err.message);
    }
  }
}

module.exports = SnowboyManager;