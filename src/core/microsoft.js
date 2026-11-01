'use strict';

/**
 * 微软正版登录（设备代码流）。
 * 链路：Microsoft Entra ID → Xbox Live 用户认证 → XSTS → Minecraft Services。
 *
 * 所有联网函数都支持注入 fetchImpl，方便单元测试。
 */

const fs = require('node:fs');
const path = require('node:path');

// PCL CE 使用的公共应用 ID（仅作默认值，设置里可填自己的 Azure 应用 ID）
const DEFAULT_CLIENT_ID = 'c14b0370-8d75-42f8-b329-5b60d39e319f';
const AUTHORITY = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const SCOPE = 'XboxLive.signin offline_access';
const XBL_USER_AUTH = 'https://user.auth.xboxlive.com/user/authenticate';
const XSTS_AUTH = 'https://xsts.auth.xboxlive.com/xsts/authorize';
const MC_LOGIN = 'https://api.minecraftservices.com/authentication/login_with_xbox';
const MC_PROFILE = 'https://api.minecraftservices.com/minecraft/profile';
const MC_ENTITLEMENTS = 'https://api.minecraftservices.com/entitlements/mcstore';
const MC_SKIN = 'https://api.minecraftservices.com/minecraft/profile/skins';

function resolveClientId(options = {}) {
  return String(options.clientId || process.env.BMCL_MS_CLIENT_ID || DEFAULT_CLIENT_ID).trim();
}

function fetchOf(options = {}) {
  return options.fetchImpl || globalThis.fetch;
}

async function readJson(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (e) {
    return { error: text };
  }
}

async function postJson(url, body, options, headers) {
  const res = await fetchOf(options)(url, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json', Accept: 'application/json' }, headers || {}),
    body: JSON.stringify(body)
  });
  const data = await readJson(res);
  if (!res.ok) {
    const err = new Error(data.error_description || data.error || data.Message || ('HTTP ' + res.status));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function postForm(url, form, options) {
  const res = await fetchOf(options)(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(form).toString()
  });
  return { ok: res.ok, status: res.status, data: await readJson(res) };
}

async function getJson(url, token, options) {
  const res = await fetchOf(options)(url, {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }
  });
  const data = await readJson(res);
  if (!res.ok) {
    const err = new Error(data.error_description || data.error || data.errorMessage || ('HTTP ' + res.status));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/** 申请设备代码 */
async function requestDeviceCode(options = {}) {
  const clientId = resolveClientId(options);
  const { ok, status, data } = await postForm(AUTHORITY + '/devicecode', {
    client_id: clientId,
    scope: SCOPE
  }, options);
  if (!ok || !data.device_code) {
    throw new Error(data.error_description || data.error || ('微软设备代码请求失败 HTTP ' + status));
  }
  return {
    clientId,
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri || 'https://microsoft.com/devicelogin',
    expiresIn: Number(data.expires_in) || 900,
    interval: Number(data.interval) || 5,
    message: data.message || ''
  };
}

/** 轮询设备代码（单次）。pending=true 表示还没授权，slowDown 表示应放慢轮询频率 */
async function pollDeviceCode(device, options = {}) {
  const clientId = device.clientId || resolveClientId(options);
  const { ok, data } = await postForm(AUTHORITY + '/token', {
    client_id: clientId,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    device_code: device.deviceCode
  }, options);
  if (ok && data.access_token) {
    return {
      pending: false,
      accessToken: data.access_token,
      refreshToken: data.refresh_token || '',
      expiresIn: Number(data.expires_in) || 0
    };
  }
  const code = String(data.error || '');
  if (code === 'authorization_pending') return { pending: true };
  if (code === 'slow_down') return { pending: true, slowDown: true, interval: Number(device.interval || 5) + 5 };
  if (code === 'expired_token') throw new Error('设备代码已过期，请重新发起登录');
  if (code === 'authorization_declined' || code === 'access_denied') throw new Error('你已在浏览器里拒绝授权');
  throw new Error(data.error_description || code || '微软登录失败');
}

/** 用 refresh token 续期 */
async function refreshOAuth(refreshToken, options = {}) {
  const clientId = resolveClientId(options);
  const { ok, status, data } = await postForm(AUTHORITY + '/token', {
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: SCOPE
  }, options);
  if (!ok || !data.access_token) {
    throw new Error(data.error_description || data.error || ('微软令牌刷新失败 HTTP ' + status));
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresIn: Number(data.expires_in) || 0
  };
}

/** Xbox Live 用户认证，返回 XBL Token 与用户哈希 */
async function authenticateXboxLive(msAccessToken, options = {}) {
  const data = await postJson(XBL_USER_AUTH, {
    Properties: {
      AuthMethod: 'RPS',
      SiteName: 'user.auth.xboxlive.com',
      RpsTicket: 'd=' + msAccessToken
    },
    TokenType: 'JWT'
  }, options);
  const xui = (data.DisplayClaims && data.DisplayClaims.xui) || [];
  if (!data.Token) throw new Error('Xbox Live 没有返回 Token');
  return { token: data.Token, userHash: (xui[0] && xui[0].uhs) || '' };
}

/** XSTS 授权，获取 Minecraft 依赖方令牌 */
async function authorizeXsts(xblToken, options = {}) {
  const res = await fetchOf(options)(XSTS_AUTH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT'
    })
  });
  const data = await readJson(res);
  if (!res.ok) {
    const xerr = Number(data.XErr);
    const hints = {
      2148916233: '这个微软账号还没有注册 Xbox 账号，请先在 xbox.com 创建',
      2148916235: '所在地区不支持 Xbox Live',
      2148916236: '需要先完成 Xbox 家长验证',
      2148916237: '需要先完成 Xbox 家长验证',
      2148916238: '未成年人账号需要家长批准'
    };
    throw new Error(hints[xerr] || data.error_description || data.error || ('XSTS 授权失败 HTTP ' + res.status));
  }
  const xui = (data.DisplayClaims && data.DisplayClaims.xui) || [];
  if (!data.Token) throw new Error('XSTS 没有返回 Token');
  return { token: data.Token, userHash: (xui[0] && xui[0].uhs) || '' };
}

/** 用 XSTS 换取 Minecraft 访问令牌 */
async function loginMinecraft(xstsToken, userHash, options = {}) {
  const data = await postJson(MC_LOGIN, {
    identityToken: 'XBL3.0 x=' + userHash + ';' + xstsToken
  }, options);
  if (!data.access_token) throw new Error('Minecraft 登录没有返回访问令牌');
  return {
    accessToken: data.access_token,
    tokenType: data.token_type || 'Bearer',
    expiresIn: Number(data.expires_in) || 0,
    userName: data.username || ''
  };
}

/** 检查账号是否拥有 Minecraft（Java 版） */
async function checkEntitlements(mcAccessToken, options = {}) {
  const data = await getJson(MC_ENTITLEMENTS, mcAccessToken, options);
  const items = Array.isArray(data.items) ? data.items : [];
  const owns = items.some((item) => String(item.name || '').includes('game_minecraft'));
  if (!owns) throw new Error('这个微软账号没有购买 Minecraft Java 版');
  return true;
}

/** 拉取正版档案（名字 / UUID / 皮肤 / 披风） */
async function fetchProfile(mcAccessToken, options = {}) {
  const data = await getJson(MC_PROFILE, mcAccessToken, options);
  if (!data.id || !data.name) throw new Error('无法读取 Minecraft 档案，请检查账号');
  return {
    name: data.name,
    uuid: data.id,
    skins: data.skins || [],
    capes: data.capes || []
  };
}

/** 完整链路：OAuth 结果 → 可保存的正版账号 */
async function completeLogin(oauth, options = {}) {
  if (!oauth || !oauth.accessToken) throw new Error('缺少微软访问令牌');
  const xbl = await authenticateXboxLive(oauth.accessToken, options);
  const xsts = await authorizeXsts(xbl.token, options);
  const userHash = xsts.userHash || xbl.userHash;
  if (!userHash) throw new Error('XSTS 没有返回用户哈希');
  const mc = await loginMinecraft(xsts.token, userHash, options);
  await checkEntitlements(mc.accessToken, options);
  const profile = await fetchProfile(mc.accessToken, options);
  return {
    type: 'microsoft',
    name: profile.name,
    uuid: profile.uuid,
    accessToken: mc.accessToken,
    refreshToken: oauth.refreshToken || '',
    tokenType: mc.tokenType,
    expiresAt: mc.expiresIn ? new Date(Date.now() + mc.expiresIn * 1000).toISOString() : '',
    skins: profile.skins,
    updatedAt: new Date().toISOString()
  };
}

/** 刷新已保存的正版账号（重新走一遍 XBL/XSTS/MC 链路） */
async function refreshAccount(account, options = {}) {
  if (!account || !account.refreshToken) throw new Error('账号没有 refresh token，请重新登录');
  const oauth = await refreshOAuth(account.refreshToken, options);
  const fresh = await completeLogin(oauth, options);
  return Object.assign({}, account, fresh, { id: account.id, createdAt: account.createdAt });
}

/** 上传皮肤（variant: classic | slim） */
async function uploadSkin(mcAccessToken, uuid, filePath, variant, options = {}) {
  if (!mcAccessToken) throw new Error('请先登录正版账号');
  if (!filePath || !fs.existsSync(filePath)) throw new Error('皮肤文件不存在');
  const stat = fs.statSync(filePath);
  if (stat.size > 5 * 1024 * 1024) throw new Error('皮肤文件不能超过 5 MB');
  const form = new FormData();
  form.append('variant', variant === 'slim' ? 'slim' : 'classic');
  form.append('file', new Blob([fs.readFileSync(filePath)], { type: 'image/png' }), path.basename(filePath));
  const res = await fetchOf(options)(MC_SKIN, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + mcAccessToken },
    body: form
  });
  const data = await readJson(res);
  if (!res.ok) throw new Error(data.errorMessage || data.error_description || ('皮肤上传失败 HTTP ' + res.status));
  return { ok: true, uuid: uuid || '', data };
}

/** 恢复默认皮肤 */
async function resetSkin(mcAccessToken, options = {}) {
  if (!mcAccessToken) throw new Error('请先登录正版账号');
  const res = await fetchOf(options)(MC_SKIN + '/active', {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + mcAccessToken }
  });
  if (!res.ok && res.status !== 204) throw new Error('恢复默认皮肤失败 HTTP ' + res.status);
  return { ok: true };
}

module.exports = {
  DEFAULT_CLIENT_ID,
  resolveClientId,
  requestDeviceCode,
  pollDeviceCode,
  refreshOAuth,
  authenticateXboxLive,
  authorizeXsts,
  loginMinecraft,
  checkEntitlements,
  fetchProfile,
  completeLogin,
  refreshAccount,
  uploadSkin,
  resetSkin
};
