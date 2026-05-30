const WebSocket = typeof window !== 'undefined' ? window.WebSocket : require('ws');

class QwenVoiceClient {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.apiKey = '';
    this.wsUrl = 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime';
    this.onResultCallback = null;
    this.onStatusCallback = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
    this.taskId = '';
    this.audioQueue = [];
    this.isSending = false;
  }

  configure(config) {
    this.apiKey = config.apiKey || '';
    if (config.wsUrl) {
      this.wsUrl = config.wsUrl;
    }
  }

  setCallbacks(onResult, onStatus) {
    this.onResultCallback = onResult;
    this.onStatusCallback = onStatus;
  }

  async connect() {
    if (!this.apiKey) {
      this.notifyStatus('error', '请先配置通义千问 API Key');
      return false;
    }

    if (this.isConnected) {
      return true;
    }

    return new Promise((resolve) => {
      try {
        this.ws = new WebSocket(this.wsUrl);
      } catch (err) {
        this.notifyStatus('error', 'WebSocket连接创建失败');
        resolve(false);
        return;
      }

      this.ws.onopen = () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.taskId = 'smartcal-' + Date.now();
        this.notifyStatus('connected', '已连接通义千问语音服务');
        this.sendStartTask();
        resolve(true);
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleMessage(msg);
        } catch (e) {
          console.log('[通义千问] 非JSON消息:', event.data);
        }
      };

      this.ws.onerror = (err) => {
        console.error('[通义千问] WebSocket错误:', err);
        this.notifyStatus('error', '语音服务连接错误');
        this.isConnected = false;
      };

      this.ws.onclose = (event) => {
        this.isConnected = false;
        this.notifyStatus('disconnected', '语音服务已断开');
        console.log('[通义千问] WebSocket关闭:', event.code, event.reason);

        if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          setTimeout(() => this.connect(), 2000);
        }
      };
    });
  }

  sendStartTask() {
    if (!this.ws || !this.isConnected) return;

    const systemPrompt = `你是一个智能日历助手。当用户描述事件安排时，请按以下格式整理：
1. 将事件时间用双小括号包裹，如：((6月1日))、((2024-06-01))
2. 将事件名称用双中括号包裹，如：[[爷爷的生日]]、[[项目截止]]

示例：
用户说："帮我记一下，六月一号是爷爷的生日"
你回复："好的，已为您记录：((6月1日)) [[爷爷的生日]]"

用户说："下周五下午三点有个项目会"
你回复："好的，已为您记录：((下周五)) [[项目会]]

如果用户没有提到具体事件，就正常对话即可。请以友好的日历助手语气回复。`;

    const msg = {
      header: {
        action: 'run-task',
        task_id: this.taskId,
        streaming: 'duplex',
        model: 'qwen3-realtime'
      },
      payload: {
        task_group: 'audio',
        task: 'chat',
        input: {
          messages: [
            {
              role: 'system',
              content: systemPrompt
            }
          ]
        },
        parameters: {
          voice: 'longxiaochun',
          format: 'pcm',
          sample_rate: 16000
        }
      }
    };

    this.ws.send(JSON.stringify(msg));
    this.notifyStatus('ready', '准备就绪，请说话...');
  }

  sendAudioData(audioBase64) {
    if (!this.ws || !this.isConnected) return;

    const msg = {
      header: {
        action: 'continue-task',
        task_id: this.taskId,
        streaming: 'duplex'
      },
      payload: {
        task_group: 'audio',
        task: 'chat',
        input: {
          audio: audioBase64
        }
      }
    };

    this.ws.send(JSON.stringify(msg));
  }

  sendTextInput(text) {
    if (!this.ws || !this.isConnected) return;

    const msg = {
      header: {
        action: 'continue-task',
        task_id: this.taskId,
        streaming: 'duplex'
      },
      payload: {
        task_group: 'audio',
        task: 'chat',
        input: {
          messages: [
            {
              role: 'user',
              content: text
            }
          ]
        }
      }
    };

    this.ws.send(JSON.stringify(msg));
  }

  sendFinishTask() {
    if (!this.ws || !this.isConnected) return;

    const msg = {
      header: {
        action: 'finish-task',
        task_id: this.taskId
      }
    };

    this.ws.send(JSON.stringify(msg));
  }

  handleMessage(msg) {
    const header = msg.header;
    const payload = msg.payload;

    if (header && header.event === 'task-failed') {
      const errorMsg = payload && payload.error ? payload.error.message : '未知错误';
      console.error('[通义千问] 任务失败:', errorMsg);
      this.notifyStatus('error', '语音服务异常: ' + errorMsg);
      return;
    }

    if (payload && payload.output) {
      if (payload.output.text) {
        const text = payload.output.text;
        console.log('[通义千问] 输出文本:', text);
        this.onResultCallback && this.onResultCallback(text);
      }

      if (payload.output.audio) {
        this.notifyStatus('speaking', '正在回复...');
      }
    }

    if (header && header.event === 'task-finished') {
      this.notifyStatus('ready', '对话已完成');
    }
  }

  async disconnect() {
    if (this.ws && this.isConnected) {
      this.sendFinishTask();
      setTimeout(() => {
        if (this.ws) {
          this.ws.close(1000, '用户断开');
        }
      }, 500);
    }
    this.isConnected = false;
  }

  notifyStatus(state, text) {
    this.onStatusCallback && this.onStatusCallback(state, text);
  }
}

module.exports = QwenVoiceClient;