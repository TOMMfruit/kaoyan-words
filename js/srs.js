/**
 * srs.js —— 间隔重复记忆算法（SM-2，Anki 同款简化版）
 *
 * 原理：根据你对每个单词的自评（忘记/模糊/认识），
 * 动态计算它下次该什么时候复习，符合艾宾浩斯遗忘曲线。
 *
 * 每个单词的学习状态（card）结构：
 *   interval    : 距离下次复习的天数
 *   repetitions : 连续答对的次数
 *   easeFactor  : 难度因子（默认 2.5，越大代表越容易记住）
 *   dueDate     : 下次复习日期（字符串 "YYYY-MM-DD"）
 *   status      : new(未学) / learning(学习中) / review(复习) / mastered(已掌握)
 */
(function () {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  // 把 Date 转成 "YYYY-MM-DD" 字符串
  function dateToStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  // 把 "YYYY-MM-DD" 字符串转成 Date
  function strToDate(s) {
    return new Date(s + "T00:00:00");
  }

  // 给日期加上 N 天
  function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  window.SRS = {
    dateToStr,
    strToDate,
    addDays,

    // 创建一个全新的学习状态
    newCard() {
      return {
        interval: 0,
        repetitions: 0,
        easeFactor: 2.5,
        dueDate: dateToStr(new Date()),
        status: "new",
      };
    },

    /**
     * 根据自评质量更新卡片
     * @param {object} card    当前卡片状态
     * @param {number} quality 自评分数 0~5（1=忘记 3=模糊 5=认识）
     * @param {Date}   now     当前日期
     * @returns {object} 更新后的卡片状态
     */
    grade(card, quality, now) {
      const q = Number(quality);
      let { repetitions, easeFactor, interval } = card;
      let ef = easeFactor;

      // 更新难度因子（SM-2 核心公式）
      ef = ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
      if (ef < 1.3) ef = 1.3;

      if (q < 3) {
        // 没记住：从头再来，明天就复习
        repetitions = 0;
        interval = 1;
      } else {
        // 记住了：间隔逐渐拉长
        if (repetitions === 0) interval = 1;
        else if (repetitions === 1) interval = 6;
        else interval = Math.round(interval * ef) || 1;
        repetitions++;
      }

      // 根据间隔判断当前学习阶段
      let status = "learning";
      if (interval >= 30) status = "mastered";
      else if (repetitions >= 2) status = "review";

      return {
        interval,
        repetitions,
        easeFactor: ef,
        dueDate: dateToStr(addDays(now, interval)),
        status,
      };
    },

    // 判断卡片今天是否该复习
    isDue(card, todayStr) {
      return card.dueDate <= todayStr;
    },
  };
})();
