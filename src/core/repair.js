'use strict';

/**
 * 一键修复启动器（只修启动器自身）。
 *
 * 约束：
 * - 只在启动器数据目录（userData）内写入；
 * - 绝不进入 versions / libraries / assets / mods / saves 等游戏目录；
 * - 每一步单独容错，单项失败不中断整体；
 * - 幂等，重复执行只处理仍然存在的问题。
 */

const fs = require('node:fs');
const path = require('node:path');

const settingsCore = require('./settings');
const crashGuard = require('./crash-guard');

const STATUS = {
  OK: 'ok',        // 本来就正常
  FIXED: 'fixed',  // 已自动修复
  FAIL: 'fail',    // 需要人工处理
  SKIP: 'skip'     // 没有可执行的修复
};

function exists(file) {
  try { return fs.existsSync(file); } catch (e) { return false; }
}

function isDir(dir) {
  try { return fs.statSync(dir).isDirectory(); } catch (e) { return false; }
}

function writable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.bmcl-write-test');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch (e) {
    return false;
  }
}

function readJson(file) {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (e) {
    return { ok: false, value: null, error: e.message };
  }
}

function item(id, title, status, detail) {
  return { id, title, status, detail: detail || '' };
}

/**
 * 扫描：只检查，不修改任何文件。
 * @param {object} ctx
 * @param {string} ctx.userDataDir  启动器数据目录
 * @param {string} ctx.settingsFile  settings.json 路径
 * @param {string} ctx.sessionFile   session.json 路径
 * @param {string} ctx.appDir        启动器程序目录
 * @param {string[]} [ctx.appFiles]  需要存在的启动器文件
 * @param {function} [ctx.probeJava] 可选，注入的 Java 探测函数
 */
function scan(ctx) {
  const c = ctx || {};
  const issues = [];

  // 1. 程序文件是否齐全（只读检查，不修复）
  const appFiles = c.appFiles || ['main.js', 'preload.js', 'src/core/launcher.js', 'renderer/index.html'];
  const missing = appFiles.filter((rel) => !exists(path.join(c.appDir || '', rel)));
  issues.push(item(
    'app-files',
    '启动器程序文件完整',
    missing.length ? STATUS.FAIL : STATUS.OK,
    missing.length ? '缺少：' + missing.join('、') + '（请重新下载便携版，游戏文件不受影响）' : '全部存在'
  ));

  // 2. 数据目录可写
  const dirOk = c.userDataDir ? writable(c.userDataDir) : false;
  issues.push(item(
    'user-data',
    '数据目录可写',
    dirOk ? STATUS.OK : STATUS.FAIL,
    dirOk ? c.userDataDir : '无法写入：' + (c.userDataDir || '(未配置)') + '，请检查权限或更换安装位置'
  ));

  // 3. 配置文件可解析
  const raw = c.settingsFile ? readJson(c.settingsFile) : { ok: false };
  let settings = null;
  if (c.settingsFile && exists(c.settingsFile)) {
    if (raw.ok) {
      settings = raw.value || {};
      const normalized = settingsCore.normalize(settings);
      const changed = ['memoryMB', 'source'].some((k) => normalized[k] !== settings[k]);
      issues.push(item(
        'settings-json',
        '配置文件可解析',
        changed ? STATUS.SKIP : STATUS.OK,
        changed ? '配置值越界（内存或下载源），修复时会归一为合法值' : '正常'
      ));
    } else {
      issues.push(item(
        'settings-json',
        '配置文件可解析',
        STATUS.SKIP,
        'settings.json 已损坏（' + raw.error + '），修复时会用默认配置重建'
      ));
    }
  } else {
    issues.push(item(
      'settings-json',
      '配置文件可解析',
      STATUS.SKIP,
      'settings.json 不存在，修复时会生成默认配置'
    ));
  }

  const effective = settingsCore.normalize(settings || {});

  // 4. 游戏目录
  const gameDir = c.gameDir || effective.gameDir;
  if (!gameDir) {
    issues.push(item('game-dir', '游戏目录可用', STATUS.SKIP, '未配置游戏目录，修复时会指向默认目录'));
  } else if (!isDir(gameDir)) {
    issues.push(item('game-dir', '游戏目录可用', STATUS.SKIP, '目录不存在，修复时会创建'));
  } else if (!writable(gameDir)) {
    issues.push(item('game-dir', '游戏目录可用', STATUS.FAIL, '目录不可写：' + gameDir));
  } else {
    issues.push(item('game-dir', '游戏目录可用', STATUS.OK, gameDir));
  }

  // 5. Java 路径（只在显式配置了路径时检查）
  const javaPath = effective.javaPath;
  if (!javaPath) {
    issues.push(item('java-path', 'Java 路径有效', STATUS.OK, '留空，使用自动探测'));
  } else if (!exists(javaPath)) {
    issues.push(item('java-path', 'Java 路径有效', STATUS.SKIP, '配置的 Java 已不存在，修复时会清空并改为自动探测'));
  } else {
    issues.push(item('java-path', 'Java 路径有效', STATUS.OK, javaPath));
  }

  // 6. 上次选择的版本是否还装着
  const versionId = effective.versionId;
  if (!versionId) {
    issues.push(item('selected-version', '上次选择的版本存在', STATUS.OK, '未设置'));
  } else if (!gameDir) {
    issues.push(item('selected-version', '上次选择的版本存在', STATUS.SKIP, '游戏目录未配置，修复时会清空版本选择'));
  } else {
    const versionDir = path.join(gameDir, 'versions', versionId);
    issues.push(item(
      'selected-version',
      '上次选择的版本存在',
      exists(versionDir) ? STATUS.OK : STATUS.SKIP,
      exists(versionDir) ? versionId : '版本 ' + versionId + ' 已不存在，修复时会清空选择'
    ));
  }

  // 7. 上次会话残留
  if (c.sessionFile && exists(c.sessionFile)) {
    const prev = crashGuard.detectPreviousCrash(c.sessionFile);
    issues.push(item(
      'session',
      '上次会话状态正常',
      prev && prev.crashed ? STATUS.SKIP : STATUS.OK,
      prev && prev.crashed ? '上次异常退出，修复时会标记为已结束' : '正常'
    ));
  } else {
    issues.push(item('session', '上次会话状态正常', STATUS.OK, '无会话记录'));
  }

  // 8. 更新残留
  const tmpDir = path.join(c.userDataDir || '', 'update-tmp');
  issues.push(item(
    'update-tmp',
    '无更新残留',
    exists(tmpDir) ? STATUS.SKIP : STATUS.OK,
    exists(tmpDir) ? '存在 update-tmp 目录，修复时会清理' : '正常'
  ));

  // 9. 探针残留
  const probeFile = path.join(c.userDataDir || '', '.write-test');
  issues.push(item(
    'probe',
    '无探针残留',
    exists(probeFile) ? STATUS.SKIP : STATUS.OK,
    exists(probeFile) ? '存在 .write-test 文件，修复时会删除' : '正常'
  ));

  // 10. 日志体积
  const logFile = path.join(c.userDataDir || '', 'latest.log');
  let logSize = 0;
  try { logSize = fs.statSync(logFile).size; } catch (e) { logSize = 0; }
  issues.push(item(
    'log-size',
    '日志体积正常',
    logSize > 8 * 1024 * 1024 ? STATUS.SKIP : STATUS.OK,
    logSize > 8 * 1024 * 1024 ? '日志超过 8 MB，修复时会归档' : '正常'
  ));

  return {
    ok: issues.every((i) => i.status === STATUS.OK),
    needFix: issues.some((i) => i.status === STATUS.SKIP),
    issues,
    settings: effective
  };
}

/**
 * 执行修复：对 scan 中标记为 SKIP 的项逐项处理。
 * 返回修复后的逐项结果。
 */
function repair(ctx) {
  const c = ctx || {};
  const before = scan(c);
  const results = [];
  let settings = settingsCore.normalize(readSettingsSafe(c.settingsFile));
  let changedSettings = false;

  // 1. 程序文件：无法自动修复
  for (const it of before.issues.filter((i) => i.id === 'app-files')) {
    results.push(it.status === STATUS.OK ? item(it.id, it.title, STATUS.OK, it.detail)
      : item(it.id, it.title, STATUS.FAIL, it.detail));
  }

  // 2. 数据目录
  for (const it of before.issues.filter((i) => i.id === 'user-data')) {
    if (it.status === STATUS.OK) {
      results.push(item(it.id, it.title, STATUS.OK, it.detail));
    } else {
      const ok = c.userDataDir ? writable(c.userDataDir) : false;
      results.push(ok
        ? item(it.id, it.title, STATUS.FIXED, '已创建并可写')
        : item(it.id, it.title, STATUS.FAIL, it.detail));
    }
  }

  // 3. 配置文件
  const settingsItem = before.issues.find((i) => i.id === 'settings-json');
  if (settingsItem && settingsItem.status !== STATUS.OK) {
    const rebuilt = settingsCore.normalize(settings);
    settings = rebuilt;
    changedSettings = true;
    results.push(item('settings-json', '配置文件可解析', STATUS.FIXED, '已用默认配置重建 / 归一非法值'));
  } else if (settingsItem) {
    results.push(item('settings-json', '配置文件可解析', STATUS.OK, settingsItem.detail));
  }

  // 4. 游戏目录
  const gdItem = before.issues.find((i) => i.id === 'game-dir');
  if (gdItem) {
    if (gdItem.status === STATUS.OK) {
      results.push(item('game-dir', '游戏目录可用', STATUS.OK, gdItem.detail));
    } else if (!c.gameDir) {
      const fallback = path.join(c.userDataDir || '', 'game');
      settings.gameDir = fallback;
      changedSettings = true;
      const ok = writable(fallback);
      results.push(ok
        ? item('game-dir', '游戏目录可用', STATUS.FIXED, '已改为默认目录：' + fallback)
        : item('game-dir', '游戏目录可用', STATUS.FAIL, '默认目录也无法创建：' + fallback));
    } else {
      const ok = writable(c.gameDir);
      results.push(ok
        ? item('game-dir', '游戏目录可用', STATUS.FIXED, '已创建游戏目录：' + c.gameDir)
        : item('game-dir', '游戏目录可用', STATUS.FAIL, '目录不可写：' + c.gameDir));
    }
  }

  // 5. Java 路径
  const javaItem = before.issues.find((i) => i.id === 'java-path');
  if (javaItem) {
    if (javaItem.status === STATUS.OK) {
      results.push(item('java-path', 'Java 路径有效', STATUS.OK, javaItem.detail));
    } else {
      settings.javaPath = '';
      changedSettings = true;
      results.push(item('java-path', 'Java 路径有效', STATUS.FIXED, '已清空配置，改为自动探测'));
    }
  }

  // 6. 上次选择的版本
  const verItem = before.issues.find((i) => i.id === 'selected-version');
  if (verItem) {
    if (verItem.status === STATUS.OK) {
      results.push(item('selected-version', '上次选择的版本存在', STATUS.OK, verItem.detail));
    } else {
      settings.versionId = '';
      changedSettings = true;
      results.push(item('selected-version', '上次选择的版本存在', STATUS.FIXED, '已清空失效的版本选择'));
    }
  }

  // 7. 会话残留
  const sesItem = before.issues.find((i) => i.id === 'session');
  if (sesItem) {
    if (sesItem.status === STATUS.OK) {
      results.push(item('session', '上次会话状态正常', STATUS.OK, sesItem.detail));
    } else {
      try {
        crashGuard.markSessionEnd(c.sessionFile);
        results.push(item('session', '上次会话状态正常', STATUS.FIXED, '已标记为正常结束'));
      } catch (e) {
        results.push(item('session', '上次会话状态正常', STATUS.FAIL, '写回失败：' + e.message));
      }
    }
  }

  // 8. update-tmp
  const tmpItem = before.issues.find((i) => i.id === 'update-tmp');
  if (tmpItem) {
    if (tmpItem.status === STATUS.OK) {
      results.push(item('update-tmp', '无更新残留', STATUS.OK, tmpItem.detail));
    } else {
      const tmpDir = path.join(c.userDataDir || '', 'update-tmp');
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        results.push(item('update-tmp', '无更新残留', STATUS.FIXED, '已清理 update-tmp'));
      } catch (e) {
        results.push(item('update-tmp', '无更新残留', STATUS.FAIL, '清理失败：' + e.message));
      }
    }
  }

  // 9. 探针残留
  const probeItem = before.issues.find((i) => i.id === 'probe');
  if (probeItem) {
    if (probeItem.status === STATUS.OK) {
      results.push(item('probe', '无探针残留', STATUS.OK, probeItem.detail));
    } else {
      try {
        fs.rmSync(path.join(c.userDataDir || '', '.write-test'), { force: true });
        results.push(item('probe', '无探针残留', STATUS.FIXED, '已删除 .write-test'));
      } catch (e) {
        results.push(item('probe', '无探针残留', STATUS.FAIL, '删除失败：' + e.message));
      }
    }
  }

  // 10. 日志体积
  const logItem = before.issues.find((i) => i.id === 'log-size');
  if (logItem) {
    if (logItem.status === STATUS.OK) {
      results.push(item('log-size', '日志体积正常', STATUS.OK, logItem.detail));
    } else {
      const logFile = path.join(c.userDataDir || '', 'latest.log');
      const oldFile = path.join(c.userDataDir || '', 'latest.old.log');
      try {
        fs.rmSync(oldFile, { force: true });
        fs.renameSync(logFile, oldFile);
        fs.writeFileSync(logFile, '', 'utf8');
        results.push(item('log-size', '日志体积正常', STATUS.FIXED, '已归档为 latest.old.log'));
      } catch (e) {
        results.push(item('log-size', '日志体积正常', STATUS.FAIL, '归档失败：' + e.message));
      }
    }
  }

  // 写回配置（只写 settings.json）
  if (changedSettings && c.settingsFile) {
    try {
      settingsCore.save(c.settingsFile, settings);
    } catch (e) {
      results.push(item('settings-write', '配置写回', STATUS.FAIL, '写入失败：' + e.message));
    }
  }

  return {
    ok: results.every((r) => r.status === STATUS.OK || r.status === STATUS.FIXED),
    changedSettings,
    fixed: results.filter((r) => r.status === STATUS.FIXED).length,
    failed: results.filter((r) => r.status === STATUS.FAIL).length,
    issues: results,
    settings
  };
}

function readSettingsSafe(file) {
  if (!file) return {};
  const raw = readJson(file);
  return raw.ok && raw.value ? raw.value : {};
}

module.exports = { STATUS, scan, repair };
