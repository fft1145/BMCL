'use strict';

/**
 * DeepSeek AI 助手。
 * 启动器不内置 Key：没有填写自己的 Key 时，会先从官网接口拉取一份公共 Key
 * （放在网站数据库里，可随时更换，不用发新版本），并在内存里缓存 10 分钟。
 * 玩家自己的 Key 只保存在本地 settings.json。
 */

const DEFAULT_BASE = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';
// 公共 Key 的拉取地址（网站上的接口文件）
const BUILTIN_URL = 'https://fft1145.github.io/bmcl-site/api/ai-key.json';
const BUILTIN_TTL = 10 * 60 * 1000;
let builtinCache = null;
let builtinCacheAt = 0;
let builtinCacheUrl = '';
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

function normalizeBase(url) {
  return /^https?:\/\//.test(url || '') ? String(url).replace(/\/+$/, '') : DEFAULT_BASE;
}

/** 从网站上拉公共 Key，带 10 分钟缓存；失败时回退到过期缓存 */
async function fetchBuiltin(options = {}) {
  const url = options.builtinUrl || BUILTIN_URL;
  const now = Date.now();
  if (builtinCache && builtinCacheUrl === url && now - builtinCacheAt < BUILTIN_TTL) {
    return builtinCache;
  }
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('当前环境不支持 fetch');
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 8000) : null;
  try {
    const res = await fetchImpl(url, controller ? { signal: controller.signal } : {});
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const apiKey = String((data && data.apiKey) || '').trim();
    if (!apiKey) throw new Error('接口里没有 apiKey');
    builtinCache = { apiKey, baseUrl: normalizeBase(data.baseUrl), model: data.model || DEFAULT_MODEL };
    builtinCacheAt = now;
    builtinCacheUrl = url;
    return builtinCache;
  } catch (err) {
    if (builtinCache && builtinCacheUrl === url) return builtinCache;
    throw new Error(
      '拉取公共 AI Key 失败（' + ((err && err.message) ? err.message : String(err)) +
      '），请检查网络，或在「实用 → AI 助手」填写自己的 Key'
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 有自定义 Key 用自定义的，没有就从网站拉公共 Key */
async function resolveConfig(options = {}) {
  const customKey = String(options.apiKey || '').trim();
  if (customKey) {
    return { apiKey: customKey, baseUrl: normalizeBase(options.baseUrl), model: options.model || DEFAULT_MODEL, builtin: false };
  }
  const remote = await fetchBuiltin(options);
  return { apiKey: remote.apiKey, baseUrl: remote.baseUrl, model: remote.model, builtin: true };
}

async function chat(options = {}) {
  const cfg = await resolveConfig(options);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const base = cfg.baseUrl;
  const model = cfg.model;
  const messages = normalizeMessages(options.messages);
  if (!messages.length) throw new Error('没有可发送的内容');
  const system = options.system ? String(options.system) : SYSTEM_PROMPT;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const res = await fetchImpl(base + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + cfg.apiKey
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
      if (res.status === 401) {
        throw new Error(cfg.builtin
          ? '公共 Key 已失效，请到「实用 → AI 助手」填写自己的 API Key'
          : 'API Key 无效或已过期');
      }
      if (res.status === 402) throw new Error('DeepSeek 账户余额不足');
      if (res.status === 429) throw new Error('请求太频繁，稍后再试');
      throw new Error(msg);
    }
    const choice = (data.choices && data.choices[0]) || {};
    const message = choice.message || {};
    const reply = message.content;
    if ((!reply || !String(reply).trim()) && choice.finish_reason === 'length') {
      throw new Error('AI 回答被截断，请把问题缩短后再试');
    }
    if (!reply) throw new Error('AI 没有返回内容');
    return {
      reply: String(reply).trim(),
      model: data.model || model,
      builtin: cfg.builtin,
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

function resetBuiltinCache() {
  builtinCache = null;
  builtinCacheAt = 0;
  builtinCacheUrl = '';
}

module.exports = {
  chat,
  buildCrashQuestion,
  resolveConfig,
  fetchBuiltin,
  resetBuiltinCache,
  BUILTIN_URL,
  SYSTEM_PROMPT
};
