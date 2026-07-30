(() => {
  const feed = document.querySelector('[data-production-slack-feed]');
  if (!feed || !feed.dataset.productionId) return;

  const emptyState = () => {
    const state = document.createElement('div');
    state.className = 'empty-state compact';
    state.innerHTML = '<span class="empty-icon">S</span><strong>No production Slack messages yet</strong><p>New messages from this production’s mapped channel will appear here automatically after Slack indexes them.</p>';
    return state;
  };

  const messageRow = (message) => {
    const row = document.createElement('article');
    row.className = 'slack-message';
    const avatar = document.createElement('div');
    avatar.className = 'slack-avatar';
    avatar.textContent = String(message.authorName || 'S').slice(0, 1).toUpperCase();
    const content = document.createElement('div');
    const author = document.createElement('strong');
    author.textContent = message.authorName || 'Slack member';
    const time = document.createElement('time');
    time.textContent = message.occurredAt ? new Date(message.occurredAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Awaiting data';
    const text = document.createElement('p');
    text.textContent = message.text || 'No readable message text.';
    const actions = document.createElement('span');
    actions.className = 'slack-actions';
    const channel = document.createElement('span');
    channel.textContent = `#${message.channelName || 'Slack'}`;
    actions.append(channel);
    if (message.slackUrl) {
      const link = document.createElement('a');
      link.href = message.slackUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Open in Slack ↗';
      actions.append(link);
    }
    content.append(author, time, text, actions);
    row.append(avatar, content);
    return row;
  };

  let signature = '';
  const update = async () => {
    try {
      const response = await fetch(`/console?format=production_slack&production_id=${encodeURIComponent(feed.dataset.productionId)}`, { headers: { Accept: 'application/json' } });
      if (!response.ok) return;
      const payload = await response.json();
      const messages = Array.isArray(payload.messages) ? payload.messages : [];
      const nextSignature = messages.map((message) => `${message.id}:${message.occurredAt}`).join('|');
      if (nextSignature === signature) return;
      signature = nextSignature;
      feed.replaceChildren(...(messages.length ? messages.map(messageRow) : [emptyState()]));
    } catch (_) {
      // A brief network failure should never interrupt the production workspace.
    }
  };

  update();
  window.setInterval(update, 4000);
})();
