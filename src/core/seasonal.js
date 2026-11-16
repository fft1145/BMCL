'use strict';

/**
 * 节日彩蛋：愚人节与春节。
 *
 * 只做界面层面的小玩笑与装饰，不修改存档、不改变启动参数、
 * 不写入任何游戏文件。所有效果都能在设置里关闭。
 */

/** 春节（正月初一）对应的公历日期，覆盖常用年份 */
const SPRING_FESTIVAL = [
  '2023-01-22', '2024-02-10', '2025-01-29', '2026-02-17',
  '2027-02-06', '2028-01-26', '2029-02-13', '2030-02-03',
  '2031-01-23', '2032-02-11', '2033-01-31', '2034-02-19',
  '2035-02-08', '2036-01-28', '2037-02-15'
];

const GREETINGS = [
  '新春快乐，愿红石永远不炸',
  '愿你今年的存档永不崩溃',
  '祝你挖到钻石，也挖到好运',
  '红灯笼高挂，方块世界也要热闹',
  '除夕夜，先备份存档再吃饺子',
  '愿你每一次落地，脚下都刚好有水',
  '新春吉庆，愿苦力怕离你远远的',
  '祝你今年附魔全是神级词条',
  '愿末影龙也给你让一条路',
  '灯笼亮起，愿你在服务器里被温柔对待',
  '愿你的帧数稳，延迟低，队友不坑',
  '新年第一镐，挖到的都是远古残骸'
];

const APRIL_BUGS = [
  { id: 'jitter', label: '按钮好像挪了一下' },
  { id: 'navSwap', label: '导航文字短暂串门' },
  { id: 'avatarFlip', label: '头像被悄悄照了镜子' },
  { id: 'versionSuffix', label: '版本号多了个小尾巴' },
  { id: 'toast', label: '弹出一句没头没尾的话' },
  { id: 'titleGlitch', label: '标题栏闪了一下' },
  { id: 'progressTwist', label: '进度文字自己改了台词' },
  { id: 'cursorGhost', label: '鼠标旁边多了个影子' }
];

const APRIL_TOASTS = [
  '刚才那个按钮是不是动了一下？',
  '你的鼠标没有坏，真的。',
  '别慌，只是愚人节。',
  '今天所有 bug 都是特意的。',
  '这个提示没有含义，就像今天。',
  '如果哪里不对，明天就对了。'
];

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseDate(value) {
  const [y, m, d] = String(value).split('-').map((n) => parseInt(n, 10));
  return new Date(y, (m || 1) - 1, d || 1);
}

function dayDiff(a, b) {
  return Math.round((startOfDay(a) - startOfDay(b)) / 86400000);
}

function fmtDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

/** 春节窗口：除夕到正月十五 */
function springWindow(date) {
  const year = date.getFullYear();
  for (const yearOffset of [-1, 0, 1]) {
    const entry = SPRING_FESTIVAL.find((item) => parseInt(item.slice(0, 4), 10) === year + yearOffset);
    if (!entry) continue;
    const firstDay = parseDate(entry);
    const start = new Date(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate() - 1);
    const end = new Date(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate() + 14);
    const diff = dayDiff(date, start);
    if (diff >= 0 && diff <= 15) return { start, end, firstDay, day: diff };
  }
  return null;
}

function isAprilFools(date) {
  return date.getMonth() === 3 && date.getDate() === 1;
}

/**
 * 解析当前应展示的节日。
 * mode: auto（按日期自动）| april | spring | off
 */
function resolveFestival(mode, now) {
  const date = now instanceof Date ? now : new Date();
  const setting = ['auto', 'april', 'spring', 'off'].includes(mode) ? mode : 'auto';
  const spring = springWindow(date);
  const april = isAprilFools(date);

  let id = '';
  if (setting === 'april') id = 'april';
  else if (setting === 'spring') id = 'spring';
  else if (setting === 'auto') {
    if (spring) id = 'spring';
    else if (april) id = 'april';
  }

  if (!id) {
    return {
      id: '',
      active: false,
      mode: setting,
      name: '',
      greeting: '',
      greetings: [],
      bugs: [],
      toasts: [],
      date: fmtDate(date),
      springWindow: spring ? { start: fmtDate(spring.start), end: fmtDate(spring.end) } : null
    };
  }

  if (id === 'april') {
    return {
      id,
      active: true,
      mode: setting,
      name: '愚人节',
      greeting: '今天的一切都可能是假的，除了这个提示。',
      greetings: APRIL_TOASTS,
      bugs: APRIL_BUGS.map((b) => b.id),
      toasts: APRIL_TOASTS,
      date: fmtDate(date),
      springWindow: null
    };
  }

  // 春节：祝福语按天轮换，避免每次打开都一样
  const offset = spring ? ((spring.day % GREETINGS.length) + GREETINGS.length) % GREETINGS.length : 0;
  const rotated = GREETINGS.slice(offset).concat(GREETINGS.slice(0, offset));
  return {
    id,
    active: true,
    mode: setting,
    name: '春节',
    greeting: rotated[0],
    greetings: rotated,
    bugs: [],
    toasts: [],
    date: fmtDate(date),
    springWindow: spring ? { start: fmtDate(spring.start), end: fmtDate(spring.end) } : null,
    day: spring ? spring.day : null
  };
}

module.exports = {
  SPRING_FESTIVAL,
  GREETINGS,
  APRIL_BUGS,
  APRIL_TOASTS,
  springWindow,
  isAprilFools,
  resolveFestival
};
