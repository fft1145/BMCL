'use strict';

/**
 * 主题预设。只覆盖配色变量，不碰任何核心代码，
 * 玩家还能在「自定义」里逐项调色、粘贴自定义 CSS。
 */

const PRESETS = {
  default: {
    label: '默认（PCL 白蓝）',
    dark: false,
    vars: {
      bg: '#fbfbfb',
      side: '#eaf2fe',
      side2: '#e0eafd',
      card: '#ffffff',
      card2: '#f7fafd',
      line: '#dde6f0',
      text: '#343d4a',
      muted: '#737373',
      accent: '#1370f3',
      accentStrong: '#0b5bcb',
      accentSoft: '#e0eafd',
      titleFrom: '#1370f3',
      titleTo: '#0b5bcb'
    }
  },
  midnight: {
    label: '午夜黑',
    dark: true,
    vars: {
      bg: '#0f1115',
      side: '#151922',
      side2: '#1b2130',
      card: '#171b24',
      card2: '#1d222d',
      line: '#2a3040',
      text: '#e6e9ef',
      muted: '#9aa3b2',
      accent: '#6c8cff',
      accentStrong: '#4f6ef7',
      accentSoft: '#1e2740',
      titleFrom: '#202637',
      titleTo: '#151a24'
    }
  },
  ocean: {
    label: '深海蓝',
    dark: false,
    vars: {
      bg: '#eef6fb',
      side: '#dff0fa',
      side2: '#cfe7f6',
      card: '#ffffff',
      card2: '#f2f9fe',
      line: '#cfe1ee',
      text: '#22384a',
      muted: '#5f7688',
      accent: '#0f8bb8',
      accentStrong: '#0a6d92',
      accentSoft: '#d8eefb',
      titleFrom: '#0f9ec9',
      titleTo: '#086a90'
    }
  },
  sakura: {
    label: '樱花粉',
    dark: false,
    vars: {
      bg: '#fff7fa',
      side: '#ffeaf2',
      side2: '#ffdce8',
      card: '#ffffff',
      card2: '#fff5f8',
      line: '#f5d5e2',
      text: '#4a2f3a',
      muted: '#8a6d79',
      accent: '#e05a8a',
      accentStrong: '#c23f6d',
      accentSoft: '#ffe1ec',
      titleFrom: '#f07ba3',
      titleTo: '#d24d7c'
    }
  },
  forest: {
    label: '森野绿',
    dark: false,
    vars: {
      bg: '#f4faf4',
      side: '#e6f4e6',
      side2: '#d6ecd6',
      card: '#ffffff',
      card2: '#f3faf3',
      line: '#d3e6d3',
      text: '#2c4130',
      muted: '#647a68',
      accent: '#2f8f4e',
      accentStrong: '#226e3b',
      accentSoft: '#dff0e3',
      titleFrom: '#3fa862',
      titleTo: '#237a42'
    }
  }
};

function list() {
  return Object.keys(PRESETS).map((key) => ({
    key,
    label: PRESETS[key].label,
    dark: PRESETS[key].dark,
    vars: PRESETS[key].vars
  }));
}

function resolve(preset, customTheme) {
  if (preset === 'custom' && customTheme) {
    return {
      label: '自定义',
      dark: false,
      vars: {
        bg: customTheme.bg,
        side: customTheme.bg,
        side2: customTheme.card,
        card: customTheme.card,
        card2: customTheme.card,
        line: customTheme.muted,
        text: customTheme.text,
        muted: customTheme.muted,
        accent: customTheme.accent,
        accentStrong: customTheme.accent,
        accentSoft: customTheme.card,
        titleFrom: customTheme.titleFrom,
        titleTo: customTheme.titleTo
      }
    };
  }
  return PRESETS[preset] || PRESETS.default;
}

module.exports = { PRESETS, list, resolve };
