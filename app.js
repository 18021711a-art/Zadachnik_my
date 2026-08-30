(function () {
  "use strict";

  var STORAGE_KEY = "zadachnik.tasks.v1";
  var MAX_BACKFILL_DAYS = 3650; // safety guard against runaway loops

  var WEEKDAY_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  var MONTH_NOM = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
  var MONTH_GEN = ["янв","фев","мар","апр","мая","июн","июл","авг","сен","окт","ноя","дек"];

  // ---------- date helpers (local time, no UTC drift) ----------
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function toISO(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function todayISO() { return toISO(new Date()); }
  function parseISO(s) {
    var parts = s.split("-");
    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  }
  function addDaysISO(s, n) {
    var d = parseISO(s);
    d.setDate(d.getDate() + n);
    return toISO(d);
  }
  function isoCompare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

  function dayLabel(dateStr) {
    var today = todayISO();
    if (dateStr === today) return "Сегодня";
    if (dateStr === addDaysISO(today, 1)) return "Завтра";
    if (dateStr === addDaysISO(today, -1)) return "Вчера";
    var d = parseISO(dateStr);
    var wd = WEEKDAY_SHORT[d.getDay()];
    var yearSuffix = d.getFullYear() !== new Date().getFullYear() ? " " + d.getFullYear() : "";
    return wd + ", " + d.getDate() + " " + MONTH_GEN[d.getMonth()] + "." + yearSuffix;
  }

  // ---------- storage ----------
  function loadTasks() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }
  function saveTasks(tasks) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  }
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  var tasks = loadTasks();

  // ---------- occurrences: a plain task shows on its own date; a daily
  // repeating task shows on every date from its start date through today ----------
  function occurrencesForDate(dateStr) {
    var list = [];
    tasks.forEach(function (t) {
      if (t.repeat === "daily") {
        if (isoCompare(t.date, dateStr) <= 0) {
          var completedDates = t.completedDates || [];
          list.push({ task: t, date: dateStr, isRepeat: true, completed: completedDates.indexOf(dateStr) !== -1 });
        }
      } else if (t.date === dateStr) {
        list.push({ task: t, date: dateStr, isRepeat: false, completed: !!t.completed });
      }
    });
    list.sort(function (a, b) { return a.task.createdAt - b.task.createdAt; });
    return list;
  }

  function collectFeedDates() {
    var today = todayISO();
    var dateSet = {};
    dateSet[today] = true;
    tasks.forEach(function (t) {
      if (t.repeat === "daily") {
        var d = t.date;
        var guard = 0;
        while (isoCompare(d, today) <= 0 && guard < MAX_BACKFILL_DAYS) {
          dateSet[d] = true;
          d = addDaysISO(d, 1);
          guard++;
        }
      } else {
        dateSet[t.date] = true;
      }
    });
    return dateSet;
  }

  // ---------- DOM helpers ----------
  function el(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // ---------- navigation ----------
  var views = { feed: document.getElementById("view-feed"), calendar: document.getElementById("view-calendar"), search: document.getElementById("view-search") };
  var navButtons = document.querySelectorAll(".nav-btn");
  var topbarTitle = document.getElementById("topbarTitle");
  var TITLES = { feed: "Главная", calendar: "Календарь", search: "Поиск" };

  function switchView(name) {
    Object.keys(views).forEach(function (k) { views[k].classList.toggle("active", k === name); });
    navButtons.forEach(function (b) { b.classList.toggle("active", b.dataset.view === name); });
    topbarTitle.textContent = TITLES[name];
    if (name === "calendar") renderCalendar();
    if (name === "search") renderSearch();
  }
  navButtons.forEach(function (b) {
    b.addEventListener("click", function () { switchView(b.dataset.view); });
  });

  // ---------- task row rendering (shared by feed + calendar panel + search) ----------
  function buildTaskRow(occ, opts) {
    opts = opts || {};
    var task = occ.task;
    var overdue = !occ.completed && isoCompare(occ.date, todayISO()) < 0;
    var row = el("div", "task-row" + (occ.completed ? " done" : "") + (overdue ? " overdue" : ""));

    var check = el("button", "task-check" + (occ.completed ? " checked" : ""));
    check.setAttribute("aria-label", "Отметить выполненной");
    if (occ.completed) check.textContent = "✓";
    check.addEventListener("click", function () {
      if (occ.isRepeat) {
        task.completedDates = task.completedDates || [];
        var idx = task.completedDates.indexOf(occ.date);
        if (idx === -1) task.completedDates.push(occ.date);
        else task.completedDates.splice(idx, 1);
      } else {
        task.completed = !task.completed;
        task.completedAt = task.completed ? Date.now() : null;
      }
      saveTasks(tasks);
      opts.onChange && opts.onChange();
    });

    var title = el("button", "task-title");
    title.appendChild(el("span", "task-title-text", task.title));
    if (task.repeat) {
      var badge = el("span", "repeat-badge", "🔁");
      badge.title = "Повторяющаяся задача";
      title.appendChild(badge);
    }
    title.addEventListener("click", function () { openTaskModal(task); });

    var menuBtn = el("button", "task-menu-btn", "⋯");
    menuBtn.setAttribute("aria-label", "Действия с задачей");
    menuBtn.addEventListener("click", function () { openTaskActions(occ, opts.onChange); });

    row.appendChild(check);
    if (opts.showDate) {
      var wrap = el("div");
      wrap.style.flex = "1";
      wrap.style.display = "flex";
      wrap.style.flexDirection = "column";
      wrap.style.alignItems = "flex-start";
      wrap.appendChild(title);
      wrap.appendChild(el("span", "search-result-date", dayLabel(occ.date)));
      row.appendChild(wrap);
    } else {
      row.appendChild(title);
    }
    row.appendChild(menuBtn);
    return row;
  }

  // ---------- task actions bottom sheet ----------
  function openTaskActions(occ, onChange) {
    var task = occ.task;
    var overlay = el("div", "task-actions-overlay");
    var sheet = el("div", "task-actions-sheet");

    var editBtn = el("button", null, "Изменить");
    editBtn.addEventListener("click", function () { close(); openTaskModal(task); });
    sheet.appendChild(editBtn);

    if (!occ.isRepeat) {
      var tomorrowStr = addDaysISO(todayISO(), 1);
      var tomorrowBtn = el("button", null, "Перенести на завтра");
      tomorrowBtn.addEventListener("click", function () {
        task.date = tomorrowStr;
        saveTasks(tasks);
        close();
        onChange && onChange();
      });
      sheet.appendChild(tomorrowBtn);

      var pickBtn = el("button", null, "Перенести на другую дату…");
      pickBtn.addEventListener("click", function () {
        close();
        openDatePicker(task.date, function (newDate) {
          task.date = newDate;
          saveTasks(tasks);
          onChange && onChange();
        });
      });
      sheet.appendChild(pickBtn);
    }

    var deleteBtn = el("button", null, task.repeat ? "Удалить повторяющуюся задачу" : "Удалить задачу");
    deleteBtn.addEventListener("click", function () {
      var msg = task.repeat
        ? "Удалить повторяющуюся задачу «" + task.title + "» и всю её историю?"
        : "Удалить задачу «" + task.title + "»?";
      if (confirm(msg)) {
        tasks = tasks.filter(function (t) { return t.id !== task.id; });
        saveTasks(tasks);
        close();
        onChange && onChange();
      } else {
        close();
      }
    });
    sheet.appendChild(deleteBtn);

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    function close() { overlay.remove(); }
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
  }

  // ---------- FEED ----------
  var feedList = document.getElementById("feedList");
  var feedEmpty = document.getElementById("feedEmpty");

  function renderFeed() {
    feedList.innerHTML = "";
    var today = todayISO();
    var dateSet = collectFeedDates();

    var dates = Object.keys(dateSet).filter(function (d) {
      if (isoCompare(d, today) < 0) {
        return occurrencesForDate(d).some(function (o) { return !o.completed; });
      }
      return true;
    }).sort(isoCompare);

    if (dates.length === 0) {
      feedEmpty.classList.remove("hidden");
      return;
    }
    feedEmpty.classList.add("hidden");

    dates.forEach(function (dateStr) {
      var occs = occurrencesForDate(dateStr);
      var card = el("div", "day-card" + (dateStr === today ? " is-today" : ""));

      var header = el("div", "day-card-header");
      var titleWrap = el("div", "day-card-title", dayLabel(dateStr));
      header.appendChild(titleWrap);
      if (occs.length > 0) {
        var done = occs.filter(function (o) { return o.completed; }).length;
        header.appendChild(el("div", "day-card-progress", done + "/" + occs.length + " выполнено"));
      }
      card.appendChild(header);

      occs.forEach(function (occ) {
        card.appendChild(buildTaskRow(occ, { onChange: renderFeed }));
      });

      var addBtn = el("button", "add-inline-btn", "+ Добавить задачу");
      addBtn.addEventListener("click", function () { openTaskModal(null, dateStr); });
      card.appendChild(addBtn);

      feedList.appendChild(card);
    });
  }

  // ---------- CALENDAR ----------
  var calGrid = document.getElementById("calGrid");
  var calMonthLabel = document.getElementById("calMonthLabel");
  var calDayPanel = document.getElementById("calDayPanel");
  var calYear, calMonth, calSelected;

  (function initCalState() {
    var now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth();
    calSelected = todayISO();
  })();

  document.getElementById("calPrev").addEventListener("click", function () { shiftCalMonth(-1); });
  document.getElementById("calNext").addEventListener("click", function () { shiftCalMonth(1); });
  function shiftCalMonth(delta) {
    calMonth += delta;
    if (calMonth < 0) { calMonth = 11; calYear--; }
    if (calMonth > 11) { calMonth = 0; calYear++; }
    renderCalendar();
  }

  function buildMonthGrid(gridEl, year, month, opts) {
    gridEl.innerHTML = "";
    var first = new Date(year, month, 1);
    var startOffset = (first.getDay() + 6) % 7; // Monday-first
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var today = todayISO();

    for (var i = 0; i < startOffset; i++) {
      gridEl.appendChild(el("div", "cal-cell empty"));
    }
    for (var day = 1; day <= daysInMonth; day++) {
      var dateStr = year + "-" + pad(month + 1) + "-" + pad(day);
      var dayOccs = occurrencesForDate(dateStr);
      var cell = el("div", "cal-cell");
      if (dateStr === today) cell.classList.add("today");
      if (opts.selectedDate && dateStr === opts.selectedDate) cell.classList.add("selected");
      var hasOverdue = dayOccs.some(function (o) { return !o.completed; }) && isoCompare(dateStr, today) < 0;
      if (hasOverdue) cell.classList.add("has-overdue");
      cell.appendChild(el("span", null, "" + day));
      if (dayOccs.length > 0) cell.appendChild(el("span", "cal-dot"));
      cell.addEventListener("click", function (ds) {
        return function () { opts.onSelect(ds); };
      }(dateStr));
      gridEl.appendChild(cell);
    }
  }

  function renderCalendar() {
    calMonthLabel.textContent = MONTH_NOM[calMonth] + " " + calYear;
    buildMonthGrid(calGrid, calYear, calMonth, {
      selectedDate: calSelected,
      onSelect: function (dateStr) {
        calSelected = dateStr;
        renderCalendar();
      }
    });
    renderCalDayPanel();
  }

  function renderCalDayPanel() {
    calDayPanel.innerHTML = "";
    var heading = el("h3", null, dayLabel(calSelected));
    calDayPanel.appendChild(heading);
    var dayOccs = occurrencesForDate(calSelected);
    dayOccs.forEach(function (occ) {
      calDayPanel.appendChild(buildTaskRow(occ, { onChange: function () { renderCalendar(); } }));
    });
    var addBtn = el("button", "add-inline-btn", "+ Добавить задачу на этот день");
    addBtn.addEventListener("click", function () { openTaskModal(null, calSelected); });
    calDayPanel.appendChild(addBtn);
  }

  // ---------- SEARCH ----------
  var searchInput = document.getElementById("searchInput");
  var searchResults = document.getElementById("searchResults");
  var searchEmpty = document.getElementById("searchEmpty");
  var searchFilter = "all";

  document.querySelectorAll("#view-search .chip").forEach(function (chip) {
    chip.addEventListener("click", function () {
      document.querySelectorAll("#view-search .chip").forEach(function (c) { c.classList.remove("active"); });
      chip.classList.add("active");
      searchFilter = chip.dataset.filter;
      renderSearch();
    });
  });
  searchInput.addEventListener("input", renderSearch);

  // one representative occurrence per task: today's status for repeating tasks
  // (or their start date, if that hasn't arrived yet), the task's own date otherwise
  function searchOccurrences() {
    var today = todayISO();
    return tasks.map(function (t) {
      if (t.repeat === "daily") {
        var occDate = isoCompare(t.date, today) > 0 ? t.date : today;
        var completedDates = t.completedDates || [];
        return { task: t, date: occDate, isRepeat: true, completed: completedDates.indexOf(occDate) !== -1 };
      }
      return { task: t, date: t.date, isRepeat: false, completed: !!t.completed };
    });
  }

  function renderSearch() {
    searchResults.innerHTML = "";
    var q = searchInput.value.trim().toLowerCase();
    var results = searchOccurrences().filter(function (occ) {
      if (q && occ.task.title.toLowerCase().indexOf(q) === -1) return false;
      if (searchFilter === "active" && occ.completed) return false;
      if (searchFilter === "done" && !occ.completed) return false;
      return true;
    }).sort(function (a, b) { return isoCompare(a.date, b.date) || a.task.createdAt - b.task.createdAt; });

    if (results.length === 0) {
      searchEmpty.classList.remove("hidden");
      return;
    }
    searchEmpty.classList.add("hidden");
    results.forEach(function (occ) {
      searchResults.appendChild(buildTaskRow(occ, { onChange: renderSearch, showDate: true }));
    });
  }

  // ---------- TASK MODAL (add/edit) ----------
  var taskModal = document.getElementById("taskModal");
  var taskModalTitle = document.getElementById("taskModalTitle");
  var taskTitleInput = document.getElementById("taskTitleInput");
  var taskDateBtn = document.getElementById("taskDateBtn");
  var taskRepeatCheckbox = document.getElementById("taskRepeatCheckbox");
  var taskDeleteBtn = document.getElementById("taskDeleteBtn");
  var editingTask = null;
  var modalDate = todayISO();

  function updateDateBtnLabel() {
    var prefix = taskRepeatCheckbox.checked ? "Начало повторения: " : "";
    taskDateBtn.textContent = prefix + dayLabel(modalDate);
  }
  taskRepeatCheckbox.addEventListener("change", updateDateBtnLabel);

  function openTaskModal(task, defaultDate) {
    editingTask = task || null;
    modalDate = task ? task.date : (defaultDate || todayISO());
    taskModalTitle.textContent = task ? "Задача" : "Новая задача";
    taskTitleInput.value = task ? task.title : "";
    taskRepeatCheckbox.checked = task ? !!task.repeat : false;
    updateDateBtnLabel();
    taskDeleteBtn.textContent = task && task.repeat ? "Удалить повторяющуюся задачу" : "Удалить задачу";
    taskDeleteBtn.classList.toggle("hidden", !task);
    taskModal.classList.remove("hidden");
    setTimeout(function () { taskTitleInput.focus(); }, 50);
  }
  function closeTaskModal() { taskModal.classList.add("hidden"); editingTask = null; }

  document.getElementById("taskModalCancel").addEventListener("click", closeTaskModal);
  taskModal.addEventListener("click", function (e) { if (e.target === taskModal) closeTaskModal(); });

  taskDateBtn.addEventListener("click", function () {
    openDatePicker(modalDate, function (newDate) {
      modalDate = newDate;
      updateDateBtnLabel();
    });
  });

  document.getElementById("taskModalSave").addEventListener("click", function () {
    var title = taskTitleInput.value.trim();
    if (!title) { taskTitleInput.focus(); return; }
    var repeat = taskRepeatCheckbox.checked;

    if (editingTask) {
      editingTask.title = title;
      if (repeat) {
        if (!editingTask.repeat) {
          editingTask.completedDates = editingTask.completed ? [editingTask.date] : [];
        }
        editingTask.repeat = "daily";
        editingTask.date = modalDate;
      } else {
        if (editingTask.repeat) {
          var completedDates = editingTask.completedDates || [];
          editingTask.completed = completedDates.indexOf(editingTask.date) !== -1;
          editingTask.completedAt = editingTask.completed ? Date.now() : null;
          delete editingTask.completedDates;
        }
        editingTask.repeat = null;
        editingTask.date = modalDate;
      }
    } else {
      var newTask = { id: uid(), title: title, date: modalDate, completed: false, completedAt: null, createdAt: Date.now(), repeat: repeat ? "daily" : null };
      if (repeat) newTask.completedDates = [];
      tasks.push(newTask);
    }
    saveTasks(tasks);
    closeTaskModal();
    refreshCurrentView();
  });

  taskDeleteBtn.addEventListener("click", function () {
    if (!editingTask) return;
    var msg = editingTask.repeat
      ? "Удалить повторяющуюся задачу «" + editingTask.title + "» и всю её историю?"
      : "Удалить задачу «" + editingTask.title + "»?";
    if (confirm(msg)) {
      tasks = tasks.filter(function (t) { return t.id !== editingTask.id; });
      saveTasks(tasks);
      closeTaskModal();
      refreshCurrentView();
    }
  });

  function refreshCurrentView() {
    renderFeed();
    if (views.calendar.classList.contains("active")) renderCalendar();
    if (views.search.classList.contains("active")) renderSearch();
  }

  // ---------- DATE PICKER MODAL ----------
  var dateModal = document.getElementById("dateModal");
  var pickerGrid = document.getElementById("pickerGrid");
  var pickerMonthLabel = document.getElementById("pickerMonthLabel");
  var pickerYear, pickerMonth, pickerSelected, datePickerCallback;

  document.getElementById("pickerPrev").addEventListener("click", function () { shiftPickerMonth(-1); });
  document.getElementById("pickerNext").addEventListener("click", function () { shiftPickerMonth(1); });
  function shiftPickerMonth(delta) {
    pickerMonth += delta;
    if (pickerMonth < 0) { pickerMonth = 11; pickerYear--; }
    if (pickerMonth > 11) { pickerMonth = 0; pickerYear++; }
    renderPicker();
  }

  function openDatePicker(initialDate, callback) {
    datePickerCallback = callback;
    pickerSelected = initialDate;
    var d = parseISO(initialDate);
    pickerYear = d.getFullYear();
    pickerMonth = d.getMonth();
    renderPicker();
    dateModal.classList.remove("hidden");
  }
  function closeDatePicker() { dateModal.classList.add("hidden"); }

  function renderPicker() {
    pickerMonthLabel.textContent = MONTH_NOM[pickerMonth] + " " + pickerYear;
    buildMonthGrid(pickerGrid, pickerYear, pickerMonth, {
      selectedDate: pickerSelected,
      onSelect: function (dateStr) {
        pickerSelected = dateStr;
        datePickerCallback && datePickerCallback(dateStr);
        closeDatePicker();
      }
    });
  }

  document.getElementById("dateModalCancel").addEventListener("click", closeDatePicker);
  dateModal.addEventListener("click", function (e) { if (e.target === dateModal) closeDatePicker(); });
  document.querySelectorAll(".quick-dates .chip").forEach(function (chip) {
    chip.addEventListener("click", function () {
      var dateStr = chip.dataset.quick === "today" ? todayISO() : addDaysISO(todayISO(), 1);
      datePickerCallback && datePickerCallback(dateStr);
      closeDatePicker();
    });
  });

  // ---------- FAB ----------
  document.getElementById("fab").addEventListener("click", function () {
    var defaultDate = views.calendar.classList.contains("active") ? calSelected : todayISO();
    openTaskModal(null, defaultDate);
  });

  // ---------- init ----------
  renderFeed();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("service-worker.js").catch(function () {});
    });
  }
})();
