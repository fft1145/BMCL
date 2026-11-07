'use strict';

/**
 * Mojang 规则（rules）判定。
 * 规则数组严格按照官方语义：存在 rules 时默认不通过，
 * 按数组顺序应用 allow / disallow，最后命中的规则生效。
 */

function detectContext(platform = process.platform, arch = process.arch) {
  const name =
    platform === 'win32' ? 'windows' : platform === 'darwin' ? 'osx' : 'linux';
  const archName =
    arch === 'x64' ? 'x86_64' : arch === 'ia32' ? 'x86' : arch === 'arm64' ? 'arm64' : arch;
  return { os: { name, arch: archName, version: '' }, features: {} };
}

function ruleMatches(rule, ctx) {
  if (!rule || typeof rule !== 'object') return false;
  const ctxOs = (ctx && ctx.os) || {};
  const osRule = rule.os;
  if (osRule) {
    if (osRule.name && osRule.name !== ctxOs.name) return false;
    if (osRule.arch && osRule.arch !== ctxOs.arch) return false;
    if (osRule.version) {
      try {
        if (!new RegExp(osRule.version).test(ctxOs.version || '')) return false;
      } catch (e) {
        return false;
      }
    }
  }
  if (rule.features) {
    const features = (ctx && ctx.features) || {};
    for (const key of Object.keys(rule.features)) {
      if (Boolean(features[key]) !== Boolean(rule.features[key])) return false;
    }
  }
  return true;
}

function isAllowed(rules, ctx) {
  if (!Array.isArray(rules) || rules.length === 0) return true;
  let allowed = false;
  for (const rule of rules) {
    if (!ruleMatches(rule, ctx)) continue;
    allowed = rule.action === 'allow';
  }
  return allowed;
}

module.exports = { detectContext, ruleMatches, isAllowed };
