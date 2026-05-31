const App = {
  async init() {
    Calendar.init();
    await EventsManager.init();
    await SettingsManager.init();
    VoiceManager.init();

    Calendar.setEvents(EventsManager.events);
    this.bindWindowControls();
    this.bindCalendarDayClick();
    this.startUrgentCheck();
    this.startCountdownUpdate();

    Calendar._onEventsChanged = () => this._checkUrgent();
  },

  bindWindowControls() {
    document.getElementById('btn-minimize').addEventListener('click', () => {
      window.electronAPI.windowMinimize();
    });

    document.getElementById('btn-close').addEventListener('click', () => {
      window.electronAPI.windowClose();
    });
  },

  bindCalendarDayClick() {
    document.getElementById('days-grid').addEventListener('click', (e) => {
      const cell = e.target.closest('.day-cell');
      if (!cell) return;

      const dateStr = cell.dataset.date;
      if (!dateStr) return;

      Calendar.selectDate(dateStr);
      EventsManager.render();
    });
  },

  startUrgentCheck() {
    const checkUrgent = () => {
      const urgent = EventsManager.getUrgentEvent();
      const alertEl = document.getElementById('urgent-alert');
      const alertText = document.getElementById('urgent-alert-text');

      if (urgent) {
        alertEl.classList.remove('hidden');

        if (urgent.type === 'overdue') {
          alertText.textContent = `⚠ 事件已到期：${urgent.event.name}（${urgent.event.time}）`;
          alertEl.querySelector('.urgent-alert-content').style.animation =
            'alert-flash 0.5s infinite';
        } else if (urgent.type === 'urgent') {
          alertText.textContent = `⏰ 即将到期：${urgent.event.name}（${urgent.event.time}）`;
          alertEl.querySelector('.urgent-alert-content').style.animation =
            'alert-flash 1s infinite';
        } else {
          alertText.textContent = `📌 最近事件：${urgent.event.name}（${urgent.event.time}）`;
          alertEl.querySelector('.urgent-alert-content').style.animation = 'none';
          alertEl.querySelector('.urgent-alert-content').style.background = 'var(--accent-hover)';
          alertEl.querySelector('.urgent-alert-content').style.boxShadow = 'none';
        }
      } else {
        alertEl.classList.add('hidden');
      }
    };

    this._checkUrgent = checkUrgent;
    checkUrgent();
    setInterval(checkUrgent, 10000);
  },

  startCountdownUpdate() {
    setInterval(() => {
      const countdownEls = document.querySelectorAll('.countdown');
      const events = EventsManager.events;
      countdownEls.forEach((el, idx) => {
        if (idx < events.length) {
          el.textContent = EventsManager.getCountdown(events[idx].time);
        }
      });
    }, 60000);
  }
};

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});