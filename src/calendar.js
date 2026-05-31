const Calendar = {
  currentDate: new Date(),
  selectedDate: '',
  events: [],

  init() {
    const now = new Date();
    this.currentDate = new Date(now.getFullYear(), now.getMonth(), 1);
    this.selectedDate = this.formatDateStr(now.getFullYear(), now.getMonth(), now.getDate());
    this.render();
    this.bindEvents();
  },

  setEvents(events) {
    this.events = events;
    this.render();
    if (this._onEventsChanged) this._onEventsChanged();
  },

  render() {
    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth();
    const today = new Date();
    const todayStr = this.formatDateStr(today.getFullYear(), today.getMonth(), today.getDate());

    document.getElementById('month-year-display').textContent =
      `${year}年 ${month + 1}月`;

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const grid = document.getElementById('days-grid');
    grid.innerHTML = '';

    for (let i = firstDay - 1; i >= 0; i--) {
      const day = daysInPrevMonth - i;
      const dateStr = month === 0
        ? this.formatDateStr(year - 1, 11, day)
        : this.formatDateStr(year, month - 1, day);
      let cls = 'other-month';
      if (dateStr === this.selectedDate) {
        cls += ' selected';
      }
      if (this.hasEvent(dateStr)) {
        cls += ' has-event';
      }
      grid.appendChild(this.createDayCell(day, cls, dateStr));
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = this.formatDateStr(year, month, day);
      let cls = '';
      if (dateStr === todayStr) {
        cls = 'today';
      }
      if (dateStr === this.selectedDate) {
        cls += (cls ? ' ' : '') + 'selected';
      }
      if (this.hasEvent(dateStr)) {
        cls += (cls ? ' ' : '') + 'has-event';
      }
      grid.appendChild(this.createDayCell(day, cls, dateStr));
    }

    const remainingCells = 42 - firstDay - daysInMonth;
    for (let day = 1; day <= remainingCells; day++) {
      const dateStr = month === 11
        ? this.formatDateStr(year + 1, 0, day)
        : this.formatDateStr(year, month + 1, day);
      let cls = 'other-month';
      if (dateStr === this.selectedDate) {
        cls += ' selected';
      }
      if (this.hasEvent(dateStr)) {
        cls += ' has-event';
      }
      grid.appendChild(this.createDayCell(day, cls, dateStr));
    }
  },

  createDayCell(day, cls, dateStr) {
    const cell = document.createElement('div');
    cell.className = 'day-cell' + (cls ? ' ' + cls : '');
    cell.textContent = day;
    cell.dataset.date = dateStr;
    return cell;
  },

  hasEvent(dateStr) {
    return this.events.some(e => e.time === dateStr && e.state !== '已完成');
  },

  formatDateStr(year, month, day) {
    const m = String(month + 1).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    return `${year}-${m}-${d}`;
  },

  bindEvents() {
    document.getElementById('btn-prev-month').addEventListener('click', () => {
      this.currentDate.setMonth(this.currentDate.getMonth() - 1);
      this.render();
    });

    document.getElementById('btn-next-month').addEventListener('click', () => {
      this.currentDate.setMonth(this.currentDate.getMonth() + 1);
      this.render();
    });
  },

  setMonth(year, month) {
    this.currentDate = new Date(year, month, 1);
    this.render();
  },

  selectDate(dateStr) {
    this.selectedDate = dateStr;
    this.render();
  },

  getSelectedDate() {
    return this.selectedDate;
  },

  getEventsForDate(dateStr) {
    return this.events.filter(e => e.time === dateStr && e.state !== '已完成');
  }
};