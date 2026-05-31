const WebSocket = require('ws');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function loadApiKeys() {
  const keyPath = path.join(__dirname, '..', 'assets', 'miyao.txt');
  try {
    const content = fs.readFileSync(keyPath, 'utf-8');
    const keys = {};
    content.split('\n').forEach(line => {
      const match = line.match(/^(APIKey|APISecret|APPID)\s*:\s*(.+)/);
      if (match) {
        keys[match[1]] = match[2].trim();
      }
    });
    return keys;
  } catch (e) {
    console.error('[iFlytekASR] 无法读取密钥文件:', e.message);
    return null;
  }
}

function getBeijingTime() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+0800`;
}

function generateSignature(apiSecret, baseString) {
  const hmac = crypto.createHmac('sha1', apiSecret);
  hmac.update(baseString, 'utf8');
  return hmac.digest('base64');
}

function buildBaseString(params) {
  const sorted = Object.keys(params).sort();
  const parts = sorted.map(k => {
    const encodedKey = encodeURIComponent(k);
    const encodedVal = encodeURIComponent(params[k]);
    return `${encodedKey}=${encodedVal}`;
  });
  return parts.join('&');
}

class IFlytekASRManager {
  constructor() {
    this.ws = null;
    this.isRunning = false;
    this.keys = null;
    this.currentSessionText = '';
    this._audioQueue = [];
    this._sendTimer = null;
    this._resultCallback = null;
    this._statusCallback = null;
    this.sessionId = '';
    this._audioRemainder = Buffer.alloc(0);
    this._audioBlocked = false;
  }

  async initialize() {
    this.keys = loadApiKeys();
    if (!this.keys || !this.keys.APPID || !this.keys.APIKey || !this.keys.APISecret) {
      console.error('[iFlytekASR] 密钥不完整');
      return false;
    }
    console.log('[iFlytekASR] 密钥加载成功, APPID=' + this.keys.APPID);
    return true;
  }

  buildWebSocketUrl() {
    const K = this.keys;
    const utc = getBeijingTime();
    const uuid = crypto.randomUUID().replace(/-/g, '');

    const params = {
      appId: K.APPID,
      accessKeyId: K.APIKey,
      uuid: uuid,
      utc: utc,
      lang: 'autodialect',
      audio_encode: 'pcm_s16le',
      samplerate: '16000'
    };

    const baseString = buildBaseString(params);
    const signature = generateSignature(K.APISecret, baseString);
    const fullParams = baseString + '&' + encodeURIComponent('signature') + '=' + encodeURIComponent(signature);

    const url = `wss://office-api-ast-dx.iflyaisol.com/ast/communicate/v1?${fullParams}`;
    console.log('[iFlytekASR] 生成签名, utc=' + utc);
    console.log('[iFlytekASR] baseString=' + baseString);
    console.log('[iFlytekASR] signature=' + signature);
    return url;
  }

  connect() {
    return new Promise((resolve, reject) => {
      if (this.ws) {
        try { this.ws.close(); } catch (e) {}
      }

      const url = this.buildWebSocketUrl();
      console.log('[iFlytekASR] 完整URL=' + url);

      const ws = new WebSocket(url);
      this.ws = ws;
      this.currentSessionText = '';
      this._audioRemainder = Buffer.alloc(0);

      ws.on('open', () => {
        console.log('[iFlytekASR] WebSocket 已连接');
        this.isRunning = true;
        this._startAudioSender();
        resolve(true);
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this._handleMessage(msg);
        } catch (e) {
          console.error('[iFlytekASR] 解析消息失败:', e.message, '原始数据:', data.toString().substring(0, 200));
        }
      });

      ws.on('error', (err) => {
        console.error('[iFlytekASR] WebSocket 错误:', err.message);
        if (this._statusCallback) {
          this._statusCallback('error', '连接错误: ' + err.message);
        }
        reject(err);
      });

      ws.on('close', (code, reason) => {
        const reasonStr = reason ? reason.toString() : '';
        console.log('[iFlytekASR] WebSocket 关闭, code=' + code + ', reason=' + reasonStr);
        this.isRunning = false;
        this._stopAudioSender();
        if (this._statusCallback) {
          this._statusCallback('closed', '连接已关闭 (code=' + code + ')');
        }
      });

      ws.on('unexpected-response', (request, response) => {
        console.error('[iFlytekASR] 服务器拒绝连接, status=' + response.statusCode);
        let body = '';
        response.on('data', chunk => { body += chunk.toString(); });
        response.on('end', () => {
          console.error('[iFlytekASR] 服务器返回:', body.substring(0, 500));
        });
        reject(new Error('服务器拒绝连接, HTTP ' + response.statusCode));
      });

      setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          reject(new Error('WebSocket 连接超时(10s)'));
        }
      }, 10000);
    });
  }

  _handleMessage(msg) {
    if (msg.msg_type === 'result' && msg.res_type === 'asr' && msg.data) {
      try {
        const result = this._extractText(msg.data);
        if (result) {
          this.currentSessionText = result.text;
          console.log('[iFlytekASR] 转写: "' + result.text + '" (type=' + result.type + ')');
          if (this._resultCallback) {
            this._resultCallback({
              text: result.text,
              fullText: this.currentSessionText,
              isFinal: result.type === '0'
            });
          }
        }
      } catch (e) {
        console.error('[iFlytekASR] 解析转写结果失败:', e.message);
      }
    } else if (msg.action === 'started') {
      this.sessionId = msg.data && msg.data.sessionId ? msg.data.sessionId : '';
      console.log('[iFlytekASR] 握手成功, sid=' + (msg.sid || 'unknown') + ', sessionId=' + this.sessionId);
      if (this._statusCallback) {
        this._statusCallback('started', '转写已启动');
      }
    } else if (msg.msg_type === 'result' && msg.res_type === 'frc') {
      console.error('[iFlytekASR] 引擎错误:', JSON.stringify(msg));
      if (this._statusCallback) {
        this._statusCallback('error', msg.data && msg.data.desc ? msg.data.desc : '转写引擎错误');
      }
    } else if (msg.action === 'error') {
      console.error('[iFlytekASR] 服务端错误:', JSON.stringify(msg));
      if (this._statusCallback) {
        this._statusCallback('error', msg.desc || '服务端错误');
      }
    } else if (msg.msg_type === 'action') {
      if (msg.data && msg.data.sessionId) {
        this.sessionId = msg.data.sessionId;
        console.log('[iFlytekASR] 获取sessionId=' + this.sessionId);
      }
    } else {
      console.log('[iFlytekASR] 未知消息类型:', JSON.stringify(msg).substring(0, 200));
    }
  }

  _extractText(data) {
    if (data.cn && data.cn.st && data.cn.st.rt) {
      const words = [];
      for (const rt of data.cn.st.rt) {
        if (rt.ws) {
          for (const ws of rt.ws) {
            if (ws.cw) {
              for (const cw of ws.cw) {
                if (cw.w) {
                  words.push(cw.w);
                }
              }
            }
          }
        }
      }
      const text = words.join('');
      const type = data.cn.st.type || '0';
      return { text, type };
    }
    return null;
  }

  setResultCallback(callback) {
    this._resultCallback = callback;
  }

  setStatusCallback(callback) {
    this._statusCallback = callback;
  }

  feedAudio(pcmBuffer) {
    if (!this.isRunning || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    if (this._audioBlocked) {
      return;
    }

    let buf = Buffer.concat([this._audioRemainder, Buffer.from(pcmBuffer)]);

    while (buf.length >= 1280) {
      this._audioQueue.push(Buffer.from(buf.subarray(0, 1280)));
      buf = buf.subarray(1280);
    }

    this._audioRemainder = buf;
  }

  _startAudioSender() {
    this._stopAudioSender();
    this._sendTimer = setInterval(() => {
      if (!this.isRunning || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      if (this._audioQueue.length > 0) {
        const chunk = this._audioQueue.shift();
        try {
          this.ws.send(chunk);
        } catch (e) {
          console.error('[iFlytekASR] 发送音频失败:', e.message);
        }
      }
    }, 40);
  }

  _stopAudioSender() {
    if (this._sendTimer) {
      clearInterval(this._sendTimer);
      this._sendTimer = null;
    }
    this._audioQueue = [];
  }

  stop() {
    this._stopAudioSender();
    this.isRunning = false;

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const endMsg = JSON.stringify({ end: true, sessionId: this.sessionId });
      try {
        this.ws.send(endMsg);
      } catch (e) {}
      try {
        this.ws.close();
      } catch (e) {}
    }
    this.ws = null;
    this.currentSessionText = '';
    this.sessionId = '';

    if (this._resultCallback) this._resultCallback = null;
    if (this._statusCallback) this._statusCallback = null;
    console.log('[iFlytekASR] 已停止');
  }

  resetSessionText() {
    this.currentSessionText = '';
  }

  blockAudio() {
    this._audioBlocked = true;
    this._audioQueue = [];
    this._audioRemainder = Buffer.alloc(0);
    console.log('[iFlytekASR] 音频输入已阻塞，队列已清空');
  }

  unblockAudio() {
    this._audioBlocked = false;
    console.log('[iFlytekASR] 音频输入已恢复');
  }
}

module.exports = IFlytekASRManager;