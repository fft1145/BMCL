'use strict';

/**
 * 节日彩蛋判定。
 * 愚人节（4 月 1 日）与春节（农历正月初一前后）只在中文环境下触发。
 */

/** 农历春节对应的公历日期（2024 - 2040） */
const LUNAR_NEW_YEAR = {
  2024: '02-10',
  2025: '01-29',
  2026: '02-17',
  2027: '02-06',
  2028: '01-26',
  2029: '02-13',
  2030: '02-03',
  2031: '01-23',
  2032: '02-11',
  2033: '01-31',
  2034: '02-19',
  2035: '02-08',
  2036: '01-28',
  2037: '02-15',
  2038: '02-04',
  2039: '01-24',
  2040: '02-12'
};

const CHINESE_LOCALES = /^zh(-|_|$)/i;

function pad(value) {
  return String(value).padStart(2, '0');
}

function dateKey(date) {
  return pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

function dayNumber(date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
}

/** 春节窗口：除夕前 1 天到正月初六，共 8 天 */
function isSpringFestival(date) {
  const key = LUNAR_NEW_YEAR[date.getFullYear()];
  if (!key) return false;
  const [month, day] = key.split('-').map(Number);
  const start = Date.UTC(date.getFullYear(), month - 1, day) / 86400000;
  const today = dayNumber(date);
  return today >= start - 1 && today <= start + 5;
}

function isAprilFools(date) {
  return date.getMonth() === 3 && date.getDate() === 1;
}

function isChineseLocale(locale) {
  return CHINESE_LOCALES.test(String(locale || ''));
}

/**
 * @param {{locale?: string, date?: Date}} options
 * @returns {{season: ''|'aprilfools'|'spring', chinese: boolean, locale: string, active: boolean}}
 */
function getInfo(options = {}) {
  const date = options.date instanceof Date ? options.date : new Date();
  const locale = String(options.locale || '');
  let season = '';
  if (isAprilFools(date)) season = 'aprilfools';
  else if (isSpringFestival(date)) season = 'spring';
  const chinese = isChineseLocale(locale);
  return {
    season,
    chinese,
    locale,
    // 只有中文环境才启用彩蛋
    active: Boolean(season) && chinese
  };
}

module.exports = { LUNAR_NEW_YEAR, isChineseLocale, isAprilFools, isSpringFestival, getInfo };
