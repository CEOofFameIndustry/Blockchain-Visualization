// Компактний журнал подій: нові записи зверху.

const LIMIT = 40;

export function createLog(list) {
  return {
    add(text, tone = 'info') {
      const item = document.createElement('li');
      item.dataset.tone = tone;
      const time = document.createElement('time');
      time.textContent = new Date().toLocaleTimeString('uk-UA', { hour12: false });
      const span = document.createElement('span');
      span.textContent = text;
      item.append(time, span);
      list.prepend(item);
      list.scrollTop = 0;
      while (list.children.length > LIMIT) list.lastElementChild.remove();
    },
  };
}
