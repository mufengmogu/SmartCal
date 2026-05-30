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

      const eventsOnDate = EventsManager.events.filter(ev => ev.date === dateStr);

      if (eventsOnDate.length === 1) {
        const event = eventsOnDate[0];
        if (event.status !== '已完成') {
          EventsManager.toggleStatus(event.id);
        }
      } else if (eventsOnDate.length > 1) {
        this.showDayEvents(dateStr, eventsOnDate);
      } else {
        EventsManager.showAddModal(dateStr);
      }
    });
  },

  showDayEvents(dateStr, events) {
    const names = events.map(e =>
      `${e.status === '已完成' ? '[✓]' : '[ ]'} ${e.name}`
    ).join('\n');
    alert(`${dateStr} 的事件：\n${names}`);
  },

  startUrgentCheck() {
    const checkUrgent = () => {
      const urgent = EventsManager.getUrgentEvent();
      const alertEl = document.getElementById('urgent-alert');
      const alertText = document.getElementById('urgent-alert-text');

      if (urgent) {
        alertEl.classList.remove('hidden');

        if (urgent.type === 'overdue') {
          alertText.textContent = `⚠ 事件已到期：${urgent.event.name}（${urgent.event.date}）`;
          alertEl.querySelector('.urgent-alert-content').style.animation =
            'alert-flash 0.5s infinite';
        } else if (urgent.type === 'urgent') {
          alertText.textContent = `⏰ 即将到期：${urgent.event.name}（${urgent.event.date}）`;
          alertEl.querySelector('.urgent-alert-content').style.animation =
            'alert-flash 1s infinite';
        } else {
          alertText.textContent = `📌 最近事件：${urgent.event.name}（${urgent.event.date}）`;
          alertEl.querySelector('.urgent-alert-content').style.animation = 'none';
          alertEl.querySelector('.urgent-alert-content').style.background = 'var(--bg-card)';
          alertEl.querySelector('.urgent-alert-content').style.boxShadow = 'none';
        }
      } else {
        alertEl.classList.add('hidden');
      }
    };

    checkUrgent();
    setInterval(checkUrgent, 10000);
  },

  startCountdownUpdate() {
    setInterval(() => {
      const countdownEls = document.querySelectorAll('.countdown');
      const events = EventsManager.events;
      countdownEls.forEach((el, idx) => {
        if (idx < events.length) {
          el.textContent = EventsManager.getCountdown(events[idx].date);
        }
      });
    }, 60000);
  }
};

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});