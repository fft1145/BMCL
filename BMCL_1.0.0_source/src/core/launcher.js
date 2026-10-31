'use strict';

/**
 * 启动参数构造（纯函数，便于单元测试）。
 * 同时兼容旧版 minecraftArguments 与新版 arguments.jvm / arguments.game。
 */

const crypto = require('node:crypto');
const path = require('node:path');
const { detectContext, isAllowed } = require('./rules');

/** 离线账户 UUID（等价于 Java 版 UUID.nameUUIDFromBytes("OfflinePlayer:<name>")） */
function offlineUuid(name) {
  const hash = crypto.createHash('md5').update('OfflinePlayer:' + name, 'utf8').digest();
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join('-');
}

function applyTokens(str, values) {
  if (typeof str !== 'string') return str;
  return str.replace(/\$\{([^}]+)\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      return values[key] == null ? '' : String(values[key]);
    }
    return match;
  });
}

function collectArgs(list, ctx, values) {
  const out = [];
  if (!Array.isArray(list)) return out;
  for (const item of list) {
    if (typeof item === 'string') {
      out.push(applyTokens(item, values));
      continue;
    }
    if (item && typeof item === 'object') {
      if (!isAllowed(item.rules, ctx)) continue;
      if (typeof item.value === 'string') out.push(applyTokens(item.value, values));
      else if (Array.isArray(item.value)) {
        for (const v of item.value) out.push(applyTokens(v, values));
      }
    }
  }
  return out;
}

function buildClasspath(libraryPaths, clientJar, separator) {
  const sep = separator || path.delimiter;
  return libraryPaths.concat(clientJar ? [clientJar] : []).filter(Boolean).join(sep);
}

function buildJvmArgs(options) {
  const versionJson = options.versionJson || {};
  const ctx = options.ctx || detectContext();
  const memoryMB = Math.max(512, Number(options.memoryMB) || 2048);
  const launcherName = options.launcherName || 'fft1145';
  const launcherVersion = options.launcherVersion || '1.0.0';
  const classpath = options.classpath || '';
  const nativesDir = options.nativesDir || '';
  const values = {
    natives_directory: nativesDir,
    launcher_name: launcherName,
    launcher_version: launcherVersion,
    classpath: classpath,
    classpath_separator: path.delimiter
  };

  const args = [
    '-Xmx' + memoryMB + 'M',
    '-Xms' + Math.min(memoryMB, 512) + 'M',
    '-Dminecraft.launcher.brand=' + launcherName,
    '-Dminecraft.launcher.version=' + launcherVersion
  ];
  if (Array.isArray(options.extraJvmArgs)) args.push.apply(args, options.extraJvmArgs);

  if (versionJson.arguments && Array.isArray(versionJson.arguments.jvm)) {
    const jvm = collectArgs(versionJson.arguments.jvm, ctx, values);
    // 官方 jvm 参数里已包含 -cp 与 natives；若裁掉了，补上
    if (jvm.indexOf('-cp') === -1 && jvm.indexOf('-classpath') === -1) {
      jvm.push('-Djava.library.path=' + nativesDir, '-cp', classpath);
    }
    args.push.apply(args, jvm);
  } else {
    args.push('-Djava.library.path=' + nativesDir, '-cp', classpath);
  }
  return args;
}

function buildGameArgs(options) {
  const versionJson = options.versionJson || {};
  const ctx = options.ctx || detectContext();
  const versionId = options.versionId || versionJson.id || '';
  const assetIndexId =
    options.assetIndexId || (versionJson.assetIndex && versionJson.assetIndex.id) || versionId;
  const values = {
    auth_player_name: options.playerName || 'Player',
    version_name: versionId,
    game_directory: options.gameDir || '',
    assets_root: options.assetsDir || '',
    assets_index_name: assetIndexId,
    auth_uuid: options.uuid || '',
    auth_access_token: options.accessToken || '0',
    auth_session: options.accessToken || '0',
    user_type: options.userType || 'legacy',
    version_type: versionJson.type || 'release',
    user_properties: '{}',
    clientid: '',
    auth_xuid: '',
    resolution_width: options.width || '',
    resolution_height: options.height || ''
  };

  if (Array.isArray(versionJson.arguments) && Array.isArray(versionJson.arguments.game)) {
    return collectArgs(versionJson.arguments.game, ctx, values);
  }
  if (typeof versionJson.minecraftArguments === 'string') {
    return versionJson.minecraftArguments
      .split(' ')
      .filter(Boolean)
      .map((token) => applyTokens(token, values));
  }
  // 兜底
  return [
    '--username', values.auth_player_name,
    '--version', versionId,
    '--gameDir', values.game_directory,
    '--assetsDir', values.assets_root,
    '--assetIndex', assetIndexId,
    '--uuid', values.auth_uuid,
    '--accessToken', values.auth_access_token,
    '--userType', values.user_type
  ];
}

/** 收集需要进入 classpath 的库文件绝对路径 */
function collectLibraryPaths(versionJson, librariesDir, ctx) {
  const out = [];
  const libs = (versionJson && versionJson.libraries) || [];
  for (const lib of libs) {
    if (!isAllowed(lib.rules, ctx)) continue;
    const artifact = lib.downloads && lib.downloads.artifact;
    if (artifact && artifact.path) {
      out.push(path.join(librariesDir, artifact.path));
      continue;
    }
    if (!lib.natives && lib.name) {
      const parts = String(lib.name).split(':');
      if (parts.length < 3) continue;
      const file = parts[3]
        ? parts[1] + '-' + parts[2] + '-' + parts[3] + '.jar'
        : parts[1] + '-' + parts[2] + '.jar';
      out.push(path.join(librariesDir, parts[0], parts[1], parts[2], file));
    }
  }
  return out;
}

/**
 * 组装完整启动命令。
 * 返回 { javaPath, args }，不含主类？包含 mainClass。
 */
function buildCommand(options) {
  const versionJson = options.versionJson || {};
  const jvm = buildJvmArgs(options);
  const game = buildGameArgs(options);
  const mainClass = versionJson.mainClass || '';
  const args = jvm.slice();
  if (mainClass) args.push(mainClass);
  args.push.apply(args, game);
  return { javaPath: options.javaPath || 'java', args };
}

module.exports = {
  offlineUuid,
  applyTokens,
  collectArgs,
  buildClasspath,
  collectLibraryPaths,
  buildJvmArgs,
  buildGameArgs,
  buildCommand
};
