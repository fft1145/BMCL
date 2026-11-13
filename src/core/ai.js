'use strict';

/**
 * DeepSeek AI 助手。
 * Key 由玩家在设置里自己填，只保存在本地 settings.json，不上传任何地方。
 */

const DEFAULT_BASE = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';
const SYSTEM_PROMPT = [
  '你是 BMCL 启动器内置的 Minecraft 技术助手。',
  '回答要简洁、可执行，优先给出具体步骤，不要长篇大论。',
  '涉及启动器功能时，用「设置 → xxx」这样的路径描述，不要编造不存在的按钮。',
  '不知道的就说不知道，不要虚构报错原因。'
].join('');

function normalizeMessages(input) {
  const list = Array.isArray(input) ? input : [];
  return list
    .filter((m) => m && typeof m.content === 'string' && m.content.trim())
    .slice(-20)
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content.slice(0, 12000) }));
}

async function chat(options = {}) {
  const apiKey = String(options.apiKey || '').trim();
  if (!apiKey) throw new Error('还没有填 DeepSeek API Key，请到「设置 → AI 助手」填写');
  const base = /^https?:\/\//.test(options.baseUrl || '') ? options.baseUrl.replace(/\/+$/, '') : DEFAULT_BASE;
  const model = options.model || DEFAULT_MODEL;
  const messages = normalizeMessages(options.messages);
  if (!messages.length) throw new Error('没有可发送的内容');
  const system = options.system ? String(options.system) : SYSTEM_PROMPT;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const res = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: system }].concat(messages),
        temperature: 0.3,
        max_tokens: 1800,
        stream: false
      }),
      signal: controller.signal
    });
    const text = await res.text();
    let data = {};
    try { data = JSON.parse(text); } catch (e) { /* 非 JSON 响应 */ }
    if (!res.ok) {
      const msg = (data.error && data.error.message) || ('AI 接口返回 HTTP ' + res.status);
      if (res.status === 401) throw new Error('API Key 无效或已过期');
      if (res.status === 402) throw new Error('DeepSeek 账户余额不足');
      if (res.status === 429) throw new Error('请求太频繁，稍后再试');
      throw new Error(msg);
    }
    const reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!reply) throw new Error('AI 没有返回内容');
    return {
      reply: String(reply).trim(),
      model: data.model || model,
      usage: data.usage || null
    };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('AI 请求超时，请检查网络');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** 把崩溃诊断结果整理成给 AI 的提问 */
function buildCrashQuestion(diagnosis) {
  const d = diagnosis || {};
  const lines = ['我的 Minecraft 启动后崩溃了，请帮我分析原因并给出修复步骤。'];
  if (d.summary) lines.push('诊断摘要：' + d.summary);
  if (d.exitCode != null) lines.push('退出码：' + d.exitCode);
  if (Array.isArray(d.causes) && d.causes.length) {
    lines.push('启动器已匹配到的可能原因：' + d.causes.map((c) => c.cause).join('、'));
  }
  if (Array.isArray(d.causedBy) && d.causedBy.length) {
    lines.push('Caused by：\n' + d.causedBy.slice(0, 6).join('\n'));
  }
  if (Array.isArray(d.stack) && d.stack.length) {
    lines.push('堆栈：\n' + d.stack.slice(0, 10).join('\n'));
  }
  if (d.logTail) lines.push('日志末尾：\n' + String(d.logTail).slice(-4000));
  return lines.join('\n');
}

module.exports = { chat, buildCrashQuestion, SYSTEM_PROMPT };
