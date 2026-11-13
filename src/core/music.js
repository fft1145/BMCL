'use strict';

/**
 * 内置音乐播放器的音源：B 站搜索 + 音频流解析。
 * B 站接口需要 buvid Cookie 与 WBI 签名，否则会返回 412 / HTML。
 * 音频直链还需要 Referer 头，主进程里统一注入。
 */

const crypto = require('node:crypto');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const REFERER = 'https://www.bilibili.com/';
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52
];

let cookieCache = { value: '', at: 0 };
let wbiCache = { mixin: '', at: 0 };

async function getJson(url, extraHeaders = {}) {
  const cookie = await getCookie();
  const res = await fetch(url, {
    headers: Object.assign({
      'User-Agent': UA,
      Referer: REFERER,
      Cookie: cookie
    }, extraHeaders)
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('B 站接口返回异常（HTTP ' + res.status + '），可能是风控拦截，稍后再试');
  }
}

async function getCookie() {
  if (cookieCache.value && Date.now() - cookieCache.at < 30 * 60 * 1000) return cookieCache.value;
  const res = await fetch('https://api.bilibili.com/x/frontend/finger/spi', {
    headers: { 'User-Agent': UA, Referer: REFERER }
  });
  const data = await res.json().catch(() => ({}));
  const b3 = (data.data && data.data.b_3) || '';
  const b4 = (data.data && data.data.b_4) || '';
  cookieCache = { value: 'buvid3=' + b3 + '; buvid4=' + b4, at: Date.now() };
  return cookieCache.value;
}

async function getMixinKey() {
  if (wbiCache.mixin && Date.now() - wbiCache.at < 12 * 60 * 60 * 1000) return wbiCache.mixin;
  const data = await getJson('https://api.bilibili.com/x/web-interface/nav');
  const img = ((data.data && data.data.wbi_img && data.data.wbi_img.img_url) || '').split('/').pop().split('.')[0];
  const sub = ((data.data && data.data.wbi_img && data.data.wbi_img.sub_url) || '').split('/').pop().split('.')[0];
  if (!img || !sub) throw new Error('获取 B 站签名失败，请稍后再试');
  const raw = img + sub;
  const mixin = MIXIN_KEY_ENC_TAB.map((i) => raw[i]).join('').slice(0, 32);
  wbiCache = { mixin, at: Date.now() };
  return mixin;
}

async function signedQuery(params) {
  const mixin = await getMixinKey();
  const withTs = Object.assign({}, params, { wts: Math.floor(Date.now() / 1000) });
  const query = Object.keys(withTs)
    .sort()
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(String(withTs[k]).replace(/[!'()*]/g, '')))
    .join('&');
  const wRid = crypto.createHash('md5').update(query + mixin).digest('hex');
  return query + '&w_rid=' + wRid;
}

function stripHtml(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function formatDuration(seconds) {
  const total = Number(seconds) || 0;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m + ':' + String(s).padStart(2, '0');
}

/** 搜索视频（音乐向） */
async function search(keyword, page = 1) {
  const word = String(keyword || '').trim();
  if (!word) throw new Error('请输入要搜索的歌名');
  const query = await signedQuery({
    search_type: 'video',
    keyword: word,
    page: String(Math.max(1, Math.min(20, Number(page) || 1))),
    page_size: '20'
  });
  const data = await getJson('https://api.bilibili.com/x/web-interface/search/type?' + query);
  if (data.code !== 0) throw new Error(data.message || 'B 站搜索失败');
  const list = (data.data && data.data.result) || [];
  return list.map((item) => ({
    bvid: item.bvid,
    title: stripHtml(item.title),
    author: item.author,
    cover: String(item.pic || '').replace(/^\/\//, 'https://'),
    duration: item.duration,
    play: item.play,
    pubdate: item.pubdate
  }));
}

/** 解析视频为可播放的音频直链 */
async function resolveAudio(bvid) {
  const id = String(bvid || '').trim();
  if (!/^BV[0-9A-Za-z]+$/.test(id)) throw new Error('无效的 BV 号');
  const view = await getJson('https://api.bilibili.com/x/web-interface/view?bvid=' + id);
  if (view.code !== 0 || !view.data) throw new Error(view.message || '无法读取视频信息');
  const cid = view.data.cid;
  const play = await getJson(
    'https://api.bilibili.com/x/player/playurl?bvid=' + id + '&cid=' + cid + '&fnval=16&fourk=1&platform=pc'
  );
  if (play.code !== 0) throw new Error(play.message || '无法解析音频流');
  const dash = (play.data && play.data.dash) || {};
  const audios = Array.isArray(dash.audio) ? dash.audio.slice() : [];
  if (!audios.length) {
    const durl = (play.data && play.data.durl) || [];
    if (!durl.length) throw new Error('这个视频没有可用的音频流');
    return {
      bvid: id,
      url: durl[0].url,
      backupUrls: (durl[0].backup_url || []).filter(Boolean),
      title: view.data.title,
      author: (view.data.owner && view.data.owner.name) || '',
      cover: view.data.pic || '',
      duration: view.data.duration || 0
    };
  }
  audios.sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0));
  const best = audios[0];
  return {
    bvid: id,
    url: best.baseUrl || best.base_url,
    backupUrls: (best.backupUrl || best.backup_url || []).filter(Boolean),
    title: view.data.title,
    author: (view.data.owner && view.data.owner.name) || '',
    cover: view.data.pic || '',
    duration: view.data.duration || 0,
    quality: best.id
  };
}

module.exports = { search, resolveAudio, formatDuration, UA, REFERER };
