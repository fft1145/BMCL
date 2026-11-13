'use strict';

/**
 * electron-builder afterPack：Linux 下无法调用 rcedit，
 * 用 resedit 直接写入 exe 的版本信息与图标。
 */

const fs = require('node:fs');
const path = require('node:path');
const { NtExecutable, NtExecutableResource, Resource } = require('resedit');

const APP_VERSION = require('../package.json').version;

exports.default = async function afterPack(context) {
  const appOutDir = context.appOutDir;
  const exeName = (context.packager.appInfo.productFilename || 'Better MC Launcher') + '.exe';
  const exePath = path.join(appOutDir, exeName);
  if (!fs.existsSync(exePath)) {
    console.warn('[afterpack] 找不到 exe：' + exePath);
    return;
  }

  const exe = NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = NtExecutableResource.from(exe);

  // 版本信息
  const versionInfos = Resource.VersionInfo.fromEntries(res.entries);
  if (versionInfos.length) {
    const info = versionInfos[0];
    const lang = { lang: 1033, codepage: 1200 };
    info.setStringValues(lang, {
      ProductName: 'BMCL',
      FileDescription: 'BMCL - Better MC Launcher',
      CompanyName: 'fft1145',
      LegalCopyright: 'Copyright (C) 2026 fft1145',
      OriginalFilename: 'Better-MC-Launcher.exe',
      InternalName: 'BMCL',
      FileVersion: APP_VERSION,
      ProductVersion: APP_VERSION
    }, true);
    info.setFileVersion(APP_VERSION);
    info.setProductVersion(APP_VERSION);
    info.outputToResourceEntries(res.entries);
  }

  // 图标
  const icoPath = path.join(__dirname, '..', 'build', 'icon.ico');
  if (fs.existsSync(icoPath)) {
    try {
      // resedit 的 IconFile 只在 ESM 入口导出，这里动态加载
      const { pathToFileURL } = require('node:url');
      const mod = await import(pathToFileURL(
        path.join(__dirname, '..', 'node_modules', 'resedit', 'dist', 'data', 'IconFile.js')
      ).href);
      const ico = mod.default.from(fs.readFileSync(icoPath));
      const icons = ico.icons.map((item) => item.data).filter(Boolean);
      if (icons.length) {
        Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, icons);
        console.log('[afterpack] 已写入 ' + icons.length + ' 张图标');
      }
    } catch (err) {
      console.warn('[afterpack] 写入图标失败：' + err.message);
    }
  }

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log('[afterpack] 已写入版本信息 ' + APP_VERSION);
};
