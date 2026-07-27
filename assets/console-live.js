(() => {
  const feed = document.querySelector('[data-live-activity]');
  if (!feed) return;

  let signature = '';
  const formatTime = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  const render = (items) => {
    if (!items.length) return;
    const nextSignature = JSON.stringify(items.map((item) => [item.id, item.title, item.detail, item.severity, item.occurred_at]));
    if (nextSignature === signature) return;
    signature = nextSignature;
    feed.replaceChildren();
    items.forEach((item) => {
      const row = document.createElement('article');
      row.className = 'event';

      const dot = document.createElement('span');
      dot.className = `event-dot ${item.severity || 'info'}`;
      row.append(dot);

      const content = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = item.title || 'Activity update';
      const detail = document.createElement('p');
      detail.textContent = item.detail || 'No additional details';
      content.append(title, detail);
      row.append(content);

      const time = document.createElement('time');
      time.textContent = formatTime(item.occurred_at);
      row.append(time);
      feed.append(row);
    });
  };

  const refresh = async () => {
    if (document.hidden) return;
    try {
      const response = await fetch('/console?format=activity', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) return;
      const payload = await response.json();
      if (Array.isArray(payload.activity)) render(payload.activity);
    } catch (_) {
      // A transient refresh error should never interrupt Console use.
    }
  };

  refresh();
  window.setInterval(refresh, 5000);
})();
