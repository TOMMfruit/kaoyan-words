/**
 * app.js —— 应用主逻辑
 *
 * 负责三个页面的交互：
 *   1. 学习页：翻卡片 + 间隔重复自评 + 发音 + 学习设置 + 键盘快捷键
 *   2. 测试页：看词选义 / 看义拼写（只从已学单词选题，含进度与错题回顾）
 *   3. 词库页：搜索、总览、标记状态、排序
 */
(function () {
  "use strict";

  // ---------- 全局状态 ----------
  const state = Store.loadState();
  let studyQueue = []; // 今天要学习的单词队列
  let currentWord = null; // 当前正在学习的单词

  // 测试相关
  let testMode = "choice";
  let testQuestions = [];
  let testIndex = 0;
  let testScore = 0;
  let answered = false;
  let testWrong = []; // 本轮测试的错题

  // ---------- DOM 引用 ----------
  const $ = (sel) => document.querySelector(sel);
  const cardEl = $("#flashcard");
  const cardWrap = $(".card-wrap");
  const gradeBtns = $("#gradeBtns");
  const gradeLow = $("#gradeLow");
  const gradeMid = $("#gradeMid");
  const gradeHigh = $("#gradeHigh");
  const studyEmpty = $("#studyEmpty");
  const quizBox = $("#quizBox");
  const quizResult = $("#quizResult");
  const searchInput = $("#searchInput");
  const filterLearned = $("#filterLearned");
  const totalWords = $("#totalWords");
  const wordList = $("#wordList");
  const themeBtn = $("#themeBtn");
  const newPerDayInput = $("#newPerDayInput");
  const orderModeSelect = $("#orderModeSelect");
  const applySettingsBtn = $("#applySettings");
  const speakBtn = $("#speakBtn");
  const learnedCountEl = $("#learnedCount");
  const todayLearnedEl = $("#todayLearned");
  const resetBtn = $("#resetBtn");
  const sortSelect = $("#sortSelect");
  const exportBtn = $("#exportBtn");
  const importBtn = $("#importBtn");
  const importFile = $("#importFile");

  // ---------- 工具函数 ----------
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // 统计已学（非 new 状态）的单词数
  function countLearned() {
    return Object.values(state.cards).filter((c) => c.status !== "new").length;
  }

  // 更新连续打卡天数
  function updateStreak() {
    const today = SRS.dateToStr(new Date());
    if (state.stats.lastStudyDate === today) return; // 今天已打过卡
    const yesterday = SRS.dateToStr(SRS.addDays(new Date(), -1));
    state.stats.streak =
      state.stats.lastStudyDate === yesterday ? state.stats.streak + 1 : 1;
    state.stats.lastStudyDate = today;
  }

  // 跨天时重置「今日」统计，返回今天日期
  function resetTodayIfNeeded() {
    const today = SRS.dateToStr(new Date());
    if (state.stats.todayDate !== today) {
      state.stats.todayDate = today;
      state.stats.todayWords = [];
      state.stats.todayNewCount = 0;
      state.stats.todayRepeat = {};
    }
    return today;
  }

  // ---------- 发音（Web Speech API） ----------
  function speak(word) {
    if (!word || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(word);
    u.lang = "en-US";
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
  }

  // ---------- 释义按词性分行渲染 ----------
  function renderTrans(container, trans) {
    container.innerHTML = "";
    (trans || []).forEach((t) => {
      const line = document.createElement("div");
      line.className = "trans-item";
      const m = t.match(/^([a-zA-Z]+(?:\s+[a-zA-Z]+)?\.)\s*([\s\S]*)$/);
      if (m) {
        const posSpan = document.createElement("span");
        posSpan.className = "tpos";
        posSpan.textContent = m[1];
        line.appendChild(posSpan);
        line.appendChild(document.createTextNode(m[2]));
      } else {
        line.textContent = t;
      }
      container.appendChild(line);
    });
  }

  // ---------- 主题 ----------
  function applyTheme() {
    document.documentElement.setAttribute("data-theme", state.settings.theme);
    themeBtn.textContent = state.settings.theme === "dark" ? "☀️" : "🌙";
  }

  // ---------- 页面导航 ----------
  function switchPage(page) {
    document.querySelectorAll(".nav-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.page === page)
    );
    document.querySelectorAll(".page").forEach((p) =>
      p.classList.toggle("active", p.id === "page-" + page)
    );
    if (page === "library") renderLibrary();
    if (page === "study") updateStudyHeader();
    if (page === "test") startTest();
  }

  // ============================================
  //  学习页
  // ============================================
  // 生成今天的学习队列：先到期复习，再当天重排，最后新词（按目标补齐）
  function getTodayQueue() {
    const today = resetTodayIfNeeded();
    const due = [];
    const fresh = [];
    const repeat = [];
    for (const w of WORDS) {
      const card = state.cards[w.word];
      if (!card || card.status === "new") {
        fresh.push(w);
      } else if (SRS.isDue(card, today)) {
        due.push(w);
      }
      // 今日需要再次复习的词（持久化的 todayRepeat）
      const rc = (state.stats.todayRepeat && state.stats.todayRepeat[w.word]) || 0;
      if (rc > 0 && card && card.status !== "new") {
        repeat.push(w);
      }
    }
    // 新词按设置的学习顺序排列
    if (state.settings.orderMode === "alphabet") {
      fresh.sort((a, b) => a.word.localeCompare(b.word));
    } else if (state.settings.orderMode === "reverse") {
      fresh.sort((a, b) => b.word.localeCompare(a.word));
    } else {
      shuffle(fresh);
    }
    // 今日还需学的新词数 = 目标 - 今日已学新词数（不为负）
    const remainingNew = Math.max(
      0,
      state.settings.newPerDay - (state.stats.todayNewCount || 0)
    );

    // 去重后拼装队列，避免任何单词重复出现
    const queue = [];
    const seen = new Set();
    const pushUnique = (w) => {
      if (!seen.has(w.word)) {
        seen.add(w.word);
        queue.push(w);
      }
    };
    due.forEach(pushUnique);
    repeat.forEach(pushUnique);
    fresh.slice(0, remainingNew).forEach(pushUnique);
    return queue;
  }

  function updateStudyHeader() {
    $("#todayCount").textContent = studyQueue.length;
    $("#streak").textContent = state.stats.streak;
    todayLearnedEl.textContent = (state.stats.todayWords || []).length;
    learnedCountEl.textContent = countLearned();
  }

  // 根据当前单词是新学还是复习，更新自评按钮文案
  function updateGradeLabels(w) {
    const card = state.cards[w.word];
    const isNew = !card || card.status === "new";
    if (isNew) {
      gradeLow.textContent = "😵 不认识";
      gradeMid.textContent = "🤔 不确定";
      gradeHigh.textContent = "😎 认识";
    } else {
      gradeLow.textContent = "😵 忘记";
      gradeMid.textContent = "🤔 模糊";
      gradeHigh.textContent = "😎 记得";
    }
  }

  // 显示一张单词卡片（翻回正面）
  function showCard(w) {
    currentWord = w;
    cardEl.classList.remove("flipped");
    gradeBtns.classList.remove("show");
    $("#cardWord").textContent = w.word;
    $("#cardPhonetic").textContent = w.phonetic;
    $("#backWord").textContent = w.word;
    // 释义按词性分行显示
    renderTrans($("#cardTrans"), w.trans);
    // 例句可能为空
    $("#cardExample").textContent = w.example || "";
    $("#cardExampleCn").textContent = w.exampleCn || "";
    $("#cardExample").style.display = w.example ? "block" : "none";
    $("#cardExampleCn").style.display = w.exampleCn ? "block" : "none";
    // 自评按钮文案区分新学/复习
    updateGradeLabels(w);
  }

  // 翻转卡片
  function toggleCard() {
    cardEl.classList.toggle("flipped");
    gradeBtns.classList.toggle("show", cardEl.classList.contains("flipped"));
  }

  // 进入下一张卡片
  function nextCard() {
    if (studyQueue.length === 0) {
      currentWord = null;
      cardWrap.style.display = "none";
      gradeBtns.classList.remove("show");
      studyEmpty.style.display = "block";
      updateStudyHeader();
      return;
    }
    studyEmpty.style.display = "none";
    cardWrap.style.display = "block";
    showCard(studyQueue.shift());
    updateStudyHeader();
  }

  function initStudy() {
    studyQueue = getTodayQueue();
    nextCard();
  }

  // 自评：更新间隔重复状态，记录今日统计，保存，进入下一词
  function handleGrade(quality) {
    if (!currentWord) return;
    const word = currentWord.word;
    const old = state.cards[word] || SRS.newCard();
    const wasNew = old.status === "new";
    state.cards[word] = SRS.grade(old, quality, new Date());
    state.stats.totalLearned = countLearned();
    updateStreak();

    // 记录今日已学
    resetTodayIfNeeded();
    if (!state.stats.todayWords.includes(word)) {
      state.stats.todayWords.push(word);
    }
    if (wasNew) {
      state.stats.todayNewCount += 1;
    }

    // 忘记/模糊：当天再安排一次复习（持久化，每个词当天最多重复 2 次）
    if (quality <= 3) {
      const cnt = state.stats.todayRepeat[word] || 0;
      if (cnt < 2) {
        state.stats.todayRepeat[word] = cnt + 1;
        studyQueue.push(currentWord); // 排到队尾，稍后再次出现
      }
    } else {
      delete state.stats.todayRepeat[word]; // 认识/记得，不再重排
    }

    Store.saveState(state);
    nextCard();
  }

  // ============================================
  //  测试页
  // ============================================
  function pickDistractors(target) {
    const pool = WORDS.filter((w) => w.word !== target.word && w.meaning !== target.meaning);
    const result = [];
    for (const w of shuffle(pool)) {
      if (result.length >= 3) break;
      result.push(w);
    }
    return result;
  }

  function startTest() {
    quizResult.style.display = "none";
    quizBox.style.display = "block";

    // 只从已学过的单词中选题
    const learned = WORDS.filter((w) => {
      const card = state.cards[w.word];
      return card && card.status !== "new";
    });

    if (learned.length === 0) {
      quizBox.innerHTML =
        '<div class="empty-tip">📖 还没有学过的单词，请先到「学习」页学习一些单词再来测试～</div>';
      testQuestions = [];
      return;
    }

    testQuestions = shuffle(learned).slice(0, 10);
    testIndex = 0;
    testScore = 0;
    testWrong = [];
    answered = false;
    renderQuestion();
  }

  // 进入下一题
  function nextQuestion() {
    answered = false;
    testIndex++;
    renderQuestion();
  }

  function addNextButton() {
    const actions = document.createElement("div");
    actions.className = "quiz-actions";
    const btn = document.createElement("button");
    btn.className = "primary-btn";
    btn.textContent = testIndex + 1 >= testQuestions.length ? "查看结果" : "下一题";
    btn.onclick = nextQuestion;
    actions.appendChild(btn);
    quizBox.appendChild(actions);
  }

  function renderQuestion() {
    if (testIndex >= testQuestions.length) {
      showResult();
      return;
    }
    quizBox.innerHTML = "";
    const w = testQuestions[testIndex];
    const progress = `<div class="quiz-progress">第 ${testIndex + 1} / ${testQuestions.length} 题</div>`;

    if (testMode === "choice") {
      // 看词选义：选项按词性分行显示释义
      const options = shuffle([w, ...pickDistractors(w)]);
      quizBox.innerHTML = progress + `<div class="quiz-word">${w.word}</div>
        <div class="quiz-question">请选择正确的中文释义</div>`;
      const opts = document.createElement("div");
      opts.className = "options";
      options.forEach((optWord) => {
        const btn = document.createElement("button");
        btn.className = "option";
        btn.dataset.word = optWord.word;
        renderTrans(btn, optWord.trans);
        btn.onclick = () => answerChoice(btn, w.word);
        opts.appendChild(btn);
      });
      quizBox.appendChild(opts);
    } else {
      // 看义拼写：释义按词性分行显示
      quizBox.innerHTML = progress + `
        <div class="quiz-question">请拼写英文单词（首字母：${w.word[0].toUpperCase()}）</div>
        <div class="trans-list" id="quizTrans"></div>
        <input type="text" class="spell-input" id="spellInput" placeholder="输入英文单词..." autocomplete="off" />
        <div class="quiz-actions"><button class="primary-btn" id="spellSubmit">提交</button></div>
        <div class="feedback" id="feedback" style="display:none"></div>`;
      renderTrans($("#quizTrans"), w.trans);
      $("#spellSubmit").onclick = submitSpell;
      $("#spellInput").addEventListener("keydown", (e) => {
        if (e.key === "Enter") submitSpell();
      });
      $("#spellInput").focus();
    }
  }

  function answerChoice(btn, correctWord) {
    if (answered) return;
    answered = true;
    quizBox.querySelectorAll(".option").forEach((o) => {
      o.disabled = true;
      if (o.dataset.word === correctWord) o.classList.add("correct");
    });
    if (btn.dataset.word === correctWord) {
      testScore++;
      showFeedback(true);
    } else {
      btn.classList.add("wrong");
      showFeedback(false);
      recordWrong(testQuestions[testIndex]);
    }
    addNextButton();
  }

  function submitSpell() {
    if (answered) return;
    const input = $("#spellInput");
    const w = testQuestions[testIndex];
    answered = true;
    const fb = $("#feedback");
    fb.style.display = "block";
    // 规范化答案：忽略大小写、空格、全角空格和连字符
    const norm = (s) => String(s).trim().toLowerCase().replace(/[\s\u3000-]+/g, "");
    if (norm(input.value) === norm(w.word)) {
      testScore++;
      fb.textContent = "✅ 正确！";
      fb.className = "feedback ok";
    } else {
      recordWrong(w);
      fb.textContent = `❌ 错误，正确答案：${w.word}`;
      fb.className = "feedback no";
    }
    input.blur(); // 交还焦点，让全局 Enter 快捷键接管「下一题」
    // 把「提交」按钮换成「下一题」
    const actions = quizBox.querySelector(".quiz-actions");
    actions.innerHTML = "";
    const btn = document.createElement("button");
    btn.className = "primary-btn";
    btn.textContent = testIndex + 1 >= testQuestions.length ? "查看结果" : "下一题";
    btn.onclick = nextQuestion;
    actions.appendChild(btn);
  }

  function recordWrong(w) {
    if (!testWrong.some((x) => x.word === w.word)) {
      testWrong.push(w);
    }
  }

  function showFeedback(ok) {
    const fb = document.createElement("div");
    fb.className = "feedback " + (ok ? "ok" : "no");
    fb.textContent = ok ? "✅ 回答正确！" : "❌ 回答错误";
    quizBox.appendChild(fb);
  }

  function showResult() {
    quizBox.style.display = "none";
    quizResult.style.display = "block";
    const total = testQuestions.length;
    const rate = total ? Math.round((testScore / total) * 100) : 0;

    let wrongHtml = "";
    if (testWrong.length) {
      const items = testWrong
        .map((w) => {
          const meaning = (w.trans && w.trans[0]) || w.meaning || "";
          return `<li><span class="w-word">${w.word}</span><span class="w-phonetic">${w.phonetic}</span><span class="w-meaning">${meaning}</span></li>`;
        })
        .join("");
      wrongHtml = `<div class="wrong-review"><h3>📝 错题回顾（${testWrong.length}）</h3><ul>${items}</ul></div>`;
    }

    quizResult.innerHTML = `
      <div class="score">${testScore} / ${total}</div>
      <p style="margin:8px 0 16px;color:var(--text-sub)">正确率 ${rate}%</p>
      ${wrongHtml}
      <button class="primary-btn" id="retryBtn" style="margin-top:12px">再来一轮</button>`;
    $("#retryBtn").onclick = startTest;
  }

  // ============================================
  //  词库页
  // ============================================
  const STATUS_TEXT = { new: "未学", learning: "学习中", review: "复习中", mastered: "已掌握" };

  function renderLibrary() {
    const q = searchInput.value.trim().toLowerCase();
    const onlyLearned = filterLearned.checked;

    const list = WORDS.filter((w) => {
      const card = state.cards[w.word];
      const learned = card && card.status !== "new";
      if (onlyLearned && !learned) return false;
      if (q && !(w.word.toLowerCase().includes(q) || w.meaning.includes(q))) return false;
      return true;
    });

    // 按选择的顺序排序
    if (sortSelect.value === "alphabet") {
      list.sort((a, b) => a.word.localeCompare(b.word));
    } else if (sortSelect.value === "reverse") {
      list.sort((a, b) => b.word.localeCompare(a.word));
    }

    totalWords.textContent = list.length;
    wordList.innerHTML = "";

    if (list.length === 0) {
      wordList.innerHTML = '<li class="empty-tip" style="list-style:none">没有匹配的单词</li>';
      return;
    }

    list.forEach((w) => {
      const card = state.cards[w.word];
      const status = card ? card.status : "new";
      const brief = (w.trans && w.trans[0]) || w.meaning;
      const li = document.createElement("li");
      li.className = "word-item";
      li.style.flexWrap = "wrap";
      li.innerHTML = `
        <div class="w">${w.word}</div>
        <div class="p">${w.phonetic}</div>
        <div class="m">${brief}</div>
        <span class="badge">${STATUS_TEXT[status]}</span>`;
      li.onclick = () => toggleDetail(li, w);
      wordList.appendChild(li);
    });
  }

  // 点击词条展开/收起释义与例句
  function toggleDetail(li, w) {
    const existing = li.querySelector(".detail");
    if (existing) {
      existing.remove();
      return;
    }
    const div = document.createElement("div");
    div.className = "detail";
    div.style.cssText =
      "flex-basis:100%;padding-top:8px;color:var(--text-sub);font-size:14px;line-height:1.6;";
    const transWrap = document.createElement("div");
    transWrap.className = "trans-list";
    renderTrans(transWrap, w.trans);
    div.appendChild(transWrap);
    if (w.example) {
      const ex = document.createElement("div");
      ex.style.cssText = "margin-top:8px;color:var(--text-sub);";
      ex.textContent = w.example + (w.exampleCn ? "　" + w.exampleCn : "");
      div.appendChild(ex);
    }
    li.appendChild(div);
  }

  // ============================================
  //  数据导入 / 导出
  // ============================================
  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kaoyan-words-backup-${SRS.dateToStr(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data.cards || !data.settings) throw new Error("格式错误");
        const merged = {
          cards: data.cards || {},
          stats: Object.assign(
            { streak: 0, lastStudyDate: null, totalLearned: 0, todayDate: null, todayWords: [], todayNewCount: 0, todayRepeat: {} },
            data.stats || {}
          ),
          settings: Object.assign(
            { newPerDay: 10, orderMode: "alphabet", theme: "light" },
            data.settings || {}
          ),
        };
        if (!Array.isArray(merged.stats.todayWords)) merged.stats.todayWords = [];
        if (!merged.stats.todayRepeat || typeof merged.stats.todayRepeat !== "object" || Array.isArray(merged.stats.todayRepeat)) {
          merged.stats.todayRepeat = {};
        }
        Store.saveState(merged);
        location.reload();
      } catch (e) {
        alert("导入失败：文件格式不正确");
      }
    };
    reader.readAsText(file);
  }

  // ============================================
  //  初始化
  // ============================================
  function init() {
    applyTheme();

    // 导航切换
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.onclick = () => switchPage(btn.dataset.page);
    });

    // 主题切换
    themeBtn.onclick = () => {
      state.settings.theme = state.settings.theme === "dark" ? "light" : "dark";
      applyTheme();
      Store.saveState(state);
    };

    // 学习设置：初始化输入值
    newPerDayInput.value = state.settings.newPerDay;
    orderModeSelect.value = state.settings.orderMode;

    // 学习设置：点击「应用」才生效
    applySettingsBtn.onclick = () => {
      let v = parseInt(newPerDayInput.value, 10);
      if (isNaN(v) || v < 1) v = 1;
      if (v > 100) v = 100;
      newPerDayInput.value = v;
      state.settings.newPerDay = v;
      state.settings.orderMode = orderModeSelect.value;
      Store.saveState(state);
      initStudy(); // 重新生成学习队列
      applySettingsBtn.textContent = "已应用 ✓";
      setTimeout(() => (applySettingsBtn.textContent = "应用"), 1500);
    };

    // 重置学习记录（二次确认防误触）
    resetBtn.onclick = () => {
      if (confirm("确定要重置所有学习记录吗？\n此操作会清空学习进度、统计和设置，且无法恢复！")) {
        Store.resetState();
        location.reload();
      }
    };

    // 数据导出 / 导入
    exportBtn.onclick = exportData;
    importBtn.onclick = () => importFile.click();
    importFile.addEventListener("change", (e) => {
      if (e.target.files && e.target.files[0]) importData(e.target.files[0]);
      e.target.value = "";
    });

    // 学习页：点击卡片翻转
    cardEl.addEventListener("click", toggleCard);

    // 发音按钮（阻止冒泡，避免触发卡片翻转）
    speakBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (currentWord) speak(currentWord.word);
    });

    // 自评按钮
    gradeBtns.querySelectorAll(".grade").forEach((btn) => {
      btn.onclick = () => handleGrade(Number(btn.dataset.quality));
    });

    // 键盘快捷键
    document.addEventListener("keydown", (e) => {
      const page = document.querySelector(".page.active")?.id;
      const isTyping = ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName);

      if (page === "page-study") {
        if (isTyping) return;
        if ((e.key === " " || e.key === "Enter") && currentWord) {
          e.preventDefault();
          toggleCard();
        } else if (["1", "2", "3"].includes(e.key) && currentWord && cardEl.classList.contains("flipped")) {
          e.preventDefault();
          handleGrade({ "1": 1, "2": 3, "3": 5 }[e.key]);
        }
      } else if (page === "page-test") {
        if (isTyping) return;
        if (e.key === "Enter" && answered) {
          e.preventDefault();
          nextQuestion();
        }
      }
    });

    // 测试模式切换
    document.querySelectorAll(".mode-btn").forEach((btn) => {
      btn.onclick = () => {
        document.querySelectorAll(".mode-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        testMode = btn.dataset.mode;
        startTest();
      };
    });

    // 词库搜索（防抖）与过滤、排序
    let debounceTimer = null;
    searchInput.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(renderLibrary, 200);
    });
    filterLearned.addEventListener("change", renderLibrary);
    sortSelect.addEventListener("change", renderLibrary);

    // 初始渲染
    initStudy();
    renderLibrary();
  }

  init();
})();
