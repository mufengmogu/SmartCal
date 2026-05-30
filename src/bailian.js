const https = require('https');
const fs = require('fs');
const path = require('path');

const SYSTEM_PROMPT = `把发给你的这段话关于日历事件管理的话中的关键词提炼出给我，提炼规则如下：
1、如果是对日历事件的添加要求，则把句子中的事件名称和事件时间提炼出来，以 添加：name-XXX，time-X.X 的形式返回
2、如果是对日历事件的修改要求，则把句子中修改前和修改后的事件提炼出来，以 修改前：name-XXX；修改后：name-XXX，time-X.X 的形式返回
3、如果是对日历事件的删除要求，则把句子中的事件名称提炼出来，以 删除：name-XXX，time-X.X  的形式返回
4、如果是与日历事件管理无关的话，则返回 抱歉，请您再说一遍`;

function loadApiKey() {
  const keyPath = path.join(__dirname, '..', 'assets', 'miyao.txt');
  try {
    const content = fs.readFileSync(keyPath, 'utf-8');
    const match = content.match(/ALI.*?APIKEY.*?([a-zA-Z0-9\-]+)/);
    if (match) {
      return match[1].trim();
    }
    return null;
  } catch (e) {
    console.error('[Bailian] 无法读取密钥:', e.message);
    return null;
  }
}

function callQwenModel(userText) {
  return new Promise((resolve, reject) => {
    const apiKey = loadApiKey();
    if (!apiKey) {
      reject(new Error('未找到阿里云百炼 API Key，请检查 assets/miyao.txt'));
      return;
    }

    const body = JSON.stringify({
      model: 'qwen3.6-flash',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userText }
      ]
    });

    const req = https.request({
      hostname: 'dashscope.aliyuncs.com',
      path: '/compatible-mode/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 30000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk.toString());
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            reject(new Error('百炼API错误: ' + json.error.message));
            return;
          }
          const content = json.choices && json.choices[0] && json.choices[0].message
            ? json.choices[0].message.content
            : '';
          console.log('[Bailian] AI响应: ' + content);
          resolve(content);
        } catch (e) {
          reject(new Error('解析百炼响应失败: ' + e.message + ', 原始数据: ' + data.substring(0, 200)));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error('百炼请求失败: ' + err.message));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('百炼请求超时(30s)'));
    });

    req.write(body);
    req.end();
  });
}

function parseAiResponse(response) {
  response = response.trim();

  const addMatch = response.match(/^添加[：:]\s*name-(.+?)[，,]\s*time-(.+)$/);
  if (addMatch) {
    return { action: 'add', name: addMatch[1].trim(), time: addMatch[2].trim() };
  }

  const deleteMatch = response.match(/^删除[：:]\s*name-(.+?)[，,]\s*time-(.+)$/);
  if (deleteMatch) {
    return { action: 'delete', name: deleteMatch[1].trim(), time: deleteMatch[2].trim() };
  }

  const modifyMatch = response.match(/^修改前[：:]\s*name-(.+?)[；;]\s*修改后[：:]\s*name-(.+?)[，,]\s*time-(.+)$/);
  if (modifyMatch) {
    return {
      action: 'modify',
      oldName: modifyMatch[1].trim(),
      name: modifyMatch[2].trim(),
      time: modifyMatch[3].trim()
    };
  }

  if (response.includes('抱歉') || response.includes('再说一遍')) {
    return { action: 'unknown', message: response };
  }

  if (response.startsWith('添加')) {
    const simpleAdd = response.match(/name-?\s*(.+?)[，,]\s*time-?\s*(.+)/);
    if (simpleAdd) {
      return { action: 'add', name: simpleAdd[1].trim(), time: simpleAdd[2].trim() };
    }
  }
  if (response.startsWith('删除')) {
    const simpleDel = response.match(/name-?\s*(.+?)[，,]\s*time-?\s*(.+)/);
    if (simpleDel) {
      return { action: 'delete', name: simpleDel[1].trim(), time: simpleDel[2].trim() };
    }
  }

  return { action: 'unknown', message: response };
}

module.exports = { callQwenModel, parseAiResponse };