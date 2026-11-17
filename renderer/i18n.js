'use strict';

/**
 * BMCL 界面多语言。
 * 覆盖导航、下载页、设置页与主要按钮；动态内容保持原样。
 */

const LANGUAGES = [
  { id: 'auto', name: '跟随系统 Follow System' },
  { id: 'zh-CN', name: '简体中文' },
  { id: 'zh-TW', name: '繁體中文（中國台灣）' },
  { id: 'zh-HK', name: '繁體中文（香港、澳門）' },
  { id: 'en-US', name: 'English (en-US)' },
  { id: 'en-GB', name: 'English (en-GB)' },
  { id: 'en-AU', name: 'English (en-AU)' },
  { id: 'ja-JP', name: '日本語' },
  { id: 'de-DE', name: 'Deutsch' }
];

const zhTW = {
  '启动': '啟動', '主页': '首頁', '实用': '實用', '管理': '管理', '下载': '下載',
  '账号': '帳號', '联机': '聯機', '增强': '增強', '设置': '設定', '工具': '工具',
  '更多': '更多', '退出': '退出',
  '原版': '原版', '模组': '模組', '整合包': '整合包', '地图': '地圖', '材质': '材質',
  '光影': '光影', '游戏': '遊戲', '社区资源': '社群資源', '数据包': '資料包',
  '资源包': '資源包', '材质包': '材質包', '世界': '世界', '存档': '存檔',
  '收藏夹': '收藏夾', '安装包': '安裝包', '正版加载器': '正版載入器',
  '启动参数': '啟動參數', 'JVM环境': 'JVM 環境', '个性化': '個人化', '外观': '外觀',
  '语言': '語言', '杂项': '雜項', '软件信息': '軟體資訊', '软件更新': '軟體更新',
  '反馈': '回饋', '查看日志': '查看日誌',
  '启动游戏': '啟動遊戲', '结束游戏': '結束遊戲', '游戏正在运行': '遊戲正在執行',
  '实例选择': '實例選擇', '实例设置': '實例設定',
  '界面语言': '介面語言', '跟随系统': '跟隨系統',
  '启动器语言': '啟動器語言'
};

const zhHK = Object.assign({}, zhTW, {
  '游戏': '遊戲', '正版加载器': '正版載入器', '软件信息': '軟件資訊', '软件更新': '軟件更新',
  '反馈': '意見', '游戏正在运行': '遊戲正在運行', '实例选择': '實例選擇', '实例设置': '實例設定'
});

const en = {
  '启动': 'Launch', '主页': 'Home', '实用': 'Utilities', '管理': 'Manage', '下载': 'Download',
  '账号': 'Account', '联机': 'Multiplayer', '增强': 'Extras', '设置': 'Settings', '工具': 'Tools',
  '更多': 'More', '退出': 'Quit',
  '原版': 'Vanilla', '模组': 'Mods', '整合包': 'Modpacks', '地图': 'Maps', '材质': 'Textures',
  '光影': 'Shaders', '游戏': 'Game', '社区资源': 'Community', '数据包': 'Datapacks',
  '资源包': 'Resource Packs', '材质包': 'Texture Packs', '世界': 'Worlds', '存档': 'Saves',
  '收藏夹': 'Favorites', '安装包': 'Installs', '正版加载器': 'Loaders',
  '启动参数': 'Launch Options', 'JVM环境': 'JVM', '个性化': 'Appearance', '外观': 'Appearance',
  '语言': 'Language', '杂项': 'Misc', '软件信息': 'About', '软件更新': 'Updates',
  '反馈': 'Feedback', '查看日志': 'Logs',
  '启动游戏': 'Launch Game', '结束游戏': 'Stop Game', '游戏正在运行': 'Game is running',
  '实例选择': 'Instances', '实例设置': 'Instance Settings',
  '界面语言': 'Interface language', '跟随系统': 'Follow system',
  '启动器语言': 'Launcher language'
};

const ja = {
  '启动': '起動', '主页': 'ホーム', '实用': 'ユーティリティ', '管理': '管理', '下载': 'ダウンロード',
  '账号': 'アカウント', '联机': 'マルチプレイ', '增强': '拡張', '设置': '設定', '工具': 'ツール',
  '更多': 'その他', '退出': '終了',
  '原版': 'バニラ', '模组': 'MOD', '整合包': 'MODパック', '地图': 'マップ', '材质': 'テクスチャ',
  '光影': 'シェーダー', '游戏': 'ゲーム', '社区资源': 'コミュニティ', '数据包': 'データパック',
  '资源包': 'リソースパック', '材质包': 'テクスチャパック', '世界': 'ワールド', '存档': 'セーブ',
  '收藏夹': 'お気に入り', '安装包': 'インストール', '正版加载器': 'ローダー',
  '启动参数': '起動オプション', 'JVM环境': 'JVM 環境', '个性化': '外観', '外观': '外観',
  '语言': '言語', '杂项': 'その他', '软件信息': 'ソフト情報', '软件更新': 'アップデート',
  '反馈': 'フィードバック', '查看日志': 'ログ',
  '启动游戏': 'ゲームを起動', '结束游戏': 'ゲームを終了', '游戏正在运行': 'ゲーム実行中',
  '实例选择': 'インスタンス', '实例设置': 'インスタンス設定',
  '界面语言': '表示言語', '跟随系统': 'システムに従う',
  '启动器语言': 'ランチャーの言語'
};

const de = {
  '启动': 'Start', '主页': 'Home', '实用': 'Extras', '管理': 'Verwaltung', '下载': 'Download',
  '账号': 'Konto', '联机': 'Mehrspieler', '增强': 'Erweiterungen', '设置': 'Einstellungen',
  '工具': 'Werkzeuge', '更多': 'Mehr', '退出': 'Beenden',
  '原版': 'Vanilla', '模组': 'Mods', '整合包': 'Modpacks', '地图': 'Karten', '材质': 'Texturen',
  '光影': 'Shader', '游戏': 'Spiel', '社区资源': 'Community', '数据包': 'Datenpakete',
  '资源包': 'Ressourcenpakete', '材质包': 'Texturpakete', '世界': 'Welten', '存档': 'Spielstände',
  '收藏夹': 'Favoriten', '安装包': 'Installationen', '正版加载器': 'Loader',
  '启动参数': 'Startoptionen', 'JVM环境': 'JVM-Umgebung', '个性化': 'Darstellung',
  '外观': 'Darstellung', '语言': 'Sprache', '杂项': 'Sonstiges', '软件信息': 'Über',
  '软件更新': 'Updates', '反馈': 'Feedback', '查看日志': 'Protokolle',
  '启动游戏': 'Spiel starten', '结束游戏': 'Spiel beenden', '游戏正在运行': 'Spiel läuft',
  '实例选择': 'Instanzen', '实例设置': 'Instanz-Einstellungen',
  '界面语言': 'Sprache der Oberfläche', '跟随系统': 'System folgen',
  '启动器语言': 'Launcher-Sprache'
};

const DICTS = {
  'zh-CN': null,
  'zh-TW': zhTW,
  'zh-HK': zhHK,
  'en-US': en,
  'en-GB': Object.assign({}, en, { '个性化': 'Appearance', '收藏夹': 'Favourites' }),
  'en-AU': en,
  'ja-JP': ja,
  'de-DE': de
};

const CONTAINERS = [
  '.tb-nav', '.dl-bmcl-tabs', '.dl-bmcl-loaders', '.dl-cats',
  '.set-side', '.launch-cta', '.lang-card'
];

let currentLocale = 'zh-CN';

function normalizeLocale(raw) {
  const value = String(raw || '').replace('_', '-');
  if (/^zh-(tw|hant)/i.test(value)) return 'zh-TW';
  if (/^zh-(hk|mo)/i.test(value)) return 'zh-HK';
  if (/^zh/i.test(value)) return 'zh-CN';
  if (/^en-(gb|uk)/i.test(value)) return 'en-GB';
  if (/^en-au/i.test(value)) return 'en-AU';
  if (/^en/i.test(value)) return 'en-US';
  if (/^ja/i.test(value)) return 'ja-JP';
  if (/^de/i.test(value)) return 'de-DE';
  return 'zh-CN';
}

/** 根据设置和系统语言得到最终语言 */
function resolveLocale(setting, systemLocale) {
  if (setting && setting !== 'auto' && DICTS[setting] !== undefined) return setting;
  return normalizeLocale(systemLocale);
}

function t(text) {
  const dict = DICTS[currentLocale];
  if (!dict) return text;
  return dict[text] || text;
}

const ORIGINALS = new WeakMap();

function replaceIn(root) {
  if (!root) return;
  const dict = DICTS[currentLocale];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (!ORIGINALS.has(node)) ORIGINALS.set(node, node.nodeValue);
    const original = ORIGINALS.get(node);
    const key = original.trim();
    if (key && dict && dict[key]) {
      node.nodeValue = original.replace(key, dict[key]);
    } else {
      node.nodeValue = original;
    }
  }
  root.querySelectorAll('option').forEach((option) => {
    if (!ORIGINALS.has(option)) ORIGINALS.set(option, option.textContent);
    const original = ORIGINALS.get(option);
    const key = original.trim();
    option.textContent = dict && dict[key] ? dict[key] : original;
  });
  root.querySelectorAll('input[placeholder]').forEach((input) => {
    if (!ORIGINALS.has(input)) ORIGINALS.set(input, input.getAttribute('placeholder'));
    const original = ORIGINALS.get(input);
    input.setAttribute('placeholder', dict && dict[original] ? dict[original] : original);
  });
}

function apply(locale) {
  currentLocale = DICTS[locale] === undefined ? 'zh-CN' : locale;
  document.documentElement.lang = currentLocale;
  for (const selector of CONTAINERS) {
    document.querySelectorAll(selector).forEach(replaceIn);
  }
  renderLanguageSelect();
}

function renderLanguageSelect() {
  const select = document.getElementById('setLanguage');
  if (!select) return;
  if (!select.options.length || select.options.length !== LANGUAGES.length) {
    select.innerHTML = LANGUAGES.map((lang) =>
      '<option value="' + lang.id + '">' + lang.name + '</option>'
    ).join('');
  }
}

function getLocale() {
  return currentLocale;
}

window.BMCL_I18N = { LANGUAGES, normalizeLocale, resolveLocale, apply, t, getLocale };
