const EventsManager = {
  events: [],

  async init() {
    this.events = await window.electronAPI.getEvents();
    this.render();
    this.bindEvents();
  },

  setEvents(events) {
    this.events = events;
    this.render();
  },

  sortEvents() {
    this.events.sort((a, b) => {
      if (a.status === '已完成' && b.status !== '已完成') return 1;
      if (a.status !== '已完成' && b.status === '已完成') return -1;
      return new Date(a.date) - new Date(b.date);
    });
  },

  async addEvent(name, date, voiceRemind) {
    const newEvent = await window.electronAPI.addEvent({ name, date, voiceRemind });
    this.events.push(newEvent);
    this.sortEvents();
    this.render();
    Calendar.setEvents(this.events);
    return newEvent;
  },

  async deleteEvent(eventId) {
    await window.electronAPI.deleteEvent(eventId);
    this.events = this.events.filter(e => e.id !== eventId);
    this.render();
    Calendar.setEvents(this.events);
  },

  async toggleStatus(eventId) {
    const updated = await window.electronAPI.toggleEventStatus(eventId);
    const target = this.events.find(e => e.id === eventId);
    if (target) {
      target.status = updated.status;
    }
    this.sortEvents();
    this.render();
    Calendar.setEvents(this.events);
  },

  async findEventByName(name) {
    const event = await window.electronAPI.findEventByName(name);
    return event;
  },

  async updateEventByName(oldName, newName, newDate) {
    const result = await window.electronAPI.updateEventByName(oldName, newName, newDate);
    if (result.success) {
      this.events = await window.electronAPI.getEvents();
      this.sortEvents();
      this.render();
      Calendar.setEvents(this.events);
    }
    return result;
  },

  async markEventCompletedByName(name) {
    const event = await window.electronAPI.findEventByName(name);
    if (event) {
      const updated = await window.electronAPI.toggleEventStatus(event.id);
      const target = this.events.find(e => e.id === event.id);
      if (target) {
        target.status = updated.status;
      }
      this.sortEvents();
      this.render();
      Calendar.setEvents(this.events);
      return { success: true };
    }
    return { success: false, error: '未找到事件: ' + name };
  },

  render() {
    const eventsList = document.getElementById('events-list');
    const noEvents = document.getElementById('no-events');
    eventsList.innerHTML = '';

    const selectedDate = Calendar.getSelectedDate();
    const activeEvents = this.events.filter(e =>
      e.status !== '已完成' && e.date === selectedDate
    );

    if (activeEvents.length === 0) {
      noEvents.classList.remove('hidden');
      return;
    }
    noEvents.classList.add('hidden');

    activeEvents.forEach(event => {
      eventsList.appendChild(this.createEventItem(event));
    });
  },

  createEventItem(event) {
    const item = document.createElement('div');
    item.className = 'event-item' + (event.status === '已完成' ? ' completed' : '');
    item.dataset.id = event.id;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'event-checkbox';
    checkbox.checked = event.status === '已完成';
    checkbox.addEventListener('change', () => this.toggleStatus(event.id));

    const info = document.createElement('div');
    info.className = 'event-info';

    const nameEl = document.createElement('div');
    nameEl.className = 'event-name';
    nameEl.textContent = event.name;

    const meta = document.createElement('div');
    meta.className = 'event-meta';

    const dateEl = document.createElement('span');
    dateEl.textContent = '📅 ' + event.date;

    const countdownEl = document.createElement('span');
    countdownEl.className = 'countdown';
    countdownEl.textContent = this.getCountdown(event.date);

    const voiceIcon = event.voiceRemind ? ' 🔊' : '';
    meta.appendChild(dateEl);
    meta.appendChild(countdownEl);
    if (event.voiceRemind) {
      const voiceSpan = document.createElement('span');
      voiceSpan.textContent = voiceIcon;
      voiceSpan.title = '语音提醒已开启';
      meta.appendChild(voiceSpan);
    }

    info.appendChild(nameEl);
    info.appendChild(meta);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'event-delete-btn';
    deleteBtn.innerHTML = '&#x2715;';
    deleteBtn.title = '删除事件';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.deleteEvent(event.id);
    });

    item.appendChild(checkbox);
    item.appendChild(info);
    item.appendChild(deleteBtn);

    return item;
  },

  getCountdown(dateStr) {
    const now = new Date();
    const target = new Date(dateStr + 'T23:59:59');
    const diff = target - now;

    if (diff < 0) {
      return '已过期';
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    if (days === 0) {
      return hours === 0 ? '即将到期!' : `剩余 ${hours} 小时`;
    }

    if (days <= 3) {
      return `剩余 ${days} 天 ${hours} 小时`;
    }

    return `剩余 ${days} 天`;
  },

  getUrgentEvent() {
    const now = new Date();
    const active = this.events
      .filter(e => e.status !== '已完成')
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    for (const event of active) {
      const target = new Date(event.date + 'T23:59:59');
      const diff = target - now;

      if (diff <= 0) {
        return { event, type: 'overdue' };
      }

      if (diff <= 24 * 60 * 60 * 1000) {
        return { event, type: 'urgent' };
      }

      return { event, type: 'upcoming' };
    }

    return null;
  },

  bindEvents() {
    document.getElementById('btn-add-event').addEventListener('click', () => {
      this.showAddModal();
    });

    document.getElementById('btn-modal-close').addEventListener('click', () => {
      this.hideAddModal();
    });

    document.getElementById('btn-cancel').addEventListener('click', () => {
      this.hideAddModal();
    });

    document.getElementById('btn-save').addEventListener('click', () => {
      this.handleSave();
    });

    document.getElementById('add-event-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'add-event-overlay') {
        this.hideAddModal();
      }
    });
  },

  showAddModal(dateStr) {
    const overlay = document.getElementById('add-event-overlay');
    overlay.classList.remove('hidden');
    document.getElementById('event-name').focus();

    if (dateStr) {
      document.getElementById('event-date').value = dateStr;
    } else {
      const today = new Date();
      document.getElementById('event-date').value =
        Calendar.formatDateStr(today.getFullYear(), today.getMonth(), today.getDate());
    }
  },

  hideAddModal() {
    document.getElementById('add-event-overlay').classList.add('hidden');
    document.getElementById('event-name').value = '';
    document.getElementById('voice-remind').checked = false;
  },

  async handleSave() {
    const name = document.getElementById('event-name').value.trim();
    const date = document.getElementById('event-date').value;
    const voiceRemind = document.getElementById('voice-remind').checked;

    if (!name) {
      alert('请输入事件名称');
      return;
    }
    if (!date) {
      alert('请选择事件提醒时间');
      return;
    }

    await this.addEvent(name, date, voiceRemind);
    this.hideAddModal();
  },

  async addParsedEvent(name, dateStr) {
    if (!name || !dateStr) return;
    const voiceRemind = true;
    await this.addEvent(name, dateStr, voiceRemind);
  }
};