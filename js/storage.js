/**
 * storage.js —— 本地存储
 *
 * 把学习进度、每个单词的复习状态、统计信息保存到浏览器的 localStorage 里。
 * 这样关掉浏览器再打开，学习记录也不会丢（仅限本机）。
 */
(function () {
  const KEY = "kaoyanWordsState";

  const defaultState = {
    cards: {}, // key = 单词，value = SRS 状态
    stats: {
      streak: 0, // 连续打卡天数
      lastStudyDate: null, // 最近一次学习的日期
      totalLearned: 0, // 累计学过的单词数
      todayDate: null, // 今日学习日期（"YYYY-MM-DD"）
      todayWords: [], // 今日已学单词（去重）
      todayNewCount: 0, // 今日已学的新词数
      todayRepeat: {}, // 今日需要再次复习的词（word -> 已重排次数，最多 2）
    },
    settings: {
      newPerDay: 10, // 每天新学单词数
      orderMode: "alphabet", // 学习顺序：alphabet=字母序 / reverse=倒序 / random=乱序
      theme: "light", // 主题
    },
  };

  // 深拷贝默认状态，避免引用共享
  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return clone(defaultState);
      const s = JSON.parse(raw);
      const stats = Object.assign({}, defaultState.stats, s.stats || {});
      if (!Array.isArray(stats.todayWords)) stats.todayWords = [];
      if (!stats.todayRepeat || typeof stats.todayRepeat !== "object" || Array.isArray(stats.todayRepeat)) {
        stats.todayRepeat = {};
      }
      return {
        cards: s.cards || {},
        stats: stats,
        settings: Object.assign({}, defaultState.settings, s.settings || {}),
      };
    } catch (e) {
      // 数据损坏时退回默认状态
      return clone(defaultState);
    }
  }

  function saveState(state) {
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  // 清空所有学习记录（重新开始）
  function resetState() {
    localStorage.removeItem(KEY);
  }

  window.Store = { loadState, saveState, resetState };
})();
