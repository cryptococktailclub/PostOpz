(() => {
  const presenceFeed = document.querySelector('[data-premiere-presence-feed]');
  if (!presenceFeed) return;

  const productionId = presenceFeed.dataset.productionId;
  if (!productionId) return;
  const slackFeed = document.querySelector('[data-production-slack-feed]');
  const activeCount = document.querySelector('[data-premiere-active-count]');

  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  };

  const formatTime = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Awaiting data' : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  const emptyPresence = () => {
    const state = element('div', 'empty-state compact');
    state.append(element('span', 'empty-icon', 'Pr'));
    state.append(element('strong', '', 'No editor workstations are reporting'));
    state.append(element('p', '', 'Pair a workstation, then load the PostOpz Presence panel in Premiere.'));
    return state;
  };

  const renderPresence = (presence) => {
    presenceFeed.replaceChildren();
    if (!presence.length) {
      presenceFeed.append(emptyPresence());
      return;
    }
    for (const item of presence) {
      const row = element('article', 'premiere-presence-row');
      row.append(element('span', 'source-mark', 'Pr'));
      const copy = element('div');
      copy.append(element('strong', '', item.editorName || 'Premiere editor'));
      copy.append(element('p', '', `${item.projectName || 'No project detected'}${item.sequenceName ? ` · ${item.sequenceName}` : ''}`));
      copy.append(element('small', '', `${item.premiereVersion || 'Adobe Premiere Pro'} · ${item.active ? 'Active now' : `Last seen ${formatTime(item.lastHeartbeatAt)}`}`));
      row.append(copy);
      const status = element('span', `status-pill ${item.active ? 'healthy' : 'neutral'}`);
      status.append(element('i'));
      status.append(document.createTextNode(item.active ? 'Active' : 'Away'));
      row.append(status);
      presenceFeed.append(row);
    }
  };

  const renderSlack = (messages) => {
    if (!slackFeed) return;
    slackFeed.replaceChildren();
    if (!messages.length) {
      const state = element('div', 'empty-state compact');
      state.append(element('span', 'empty-icon', 'S'));
      state.append(element('strong', '', 'No production Slack messages yet'));
      state.append(element('p', '', 'New messages from this production’s mapped channel will appear here automatically after Slack indexes them.'));
      slackFeed.append(state);
      return;
    }
    for (const message of messages) {
      const row = element('article', 'slack-message');
      row.append(element('div', 'slack-avatar', (message.authorName || 'S').slice(0, 1).toUpperCase()));
      const copy = element('div');
      copy.append(element('strong', '', message.authorName || 'Slack member'));
      copy.append(element('time', '', formatTime(message.occurredAt)));
      copy.append(element('p', '', message.text || 'No readable message text.'));
      const actions = element('span', 'slack-actions');
      actions.append(element('span', '', `#${message.channelName || 'Slack'}`));
      if (message.slackUrl) {
        const link = element('a', '', 'Open in Slack ↗');
        link.href = message.slackUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        actions.append(link);
      }
      copy.append(actions);
      row.append(copy);
      slackFeed.append(row);
    }
  };

  let inFlight = false;
  const refresh = async () => {
    if (inFlight || document.hidden) return;
    inFlight = true;
    try {
      const url = `/console?view=productions&production_id=${encodeURIComponent(productionId)}&format=production_live`;
      const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!response.ok) return;
      const data = await response.json();
      renderPresence(Array.isArray(data.presence) ? data.presence : []);
      renderSlack(Array.isArray(data.messages) ? data.messages : []);
      if (activeCount) activeCount.textContent = String(data.activeEditors || 0);
    } catch (_) {
      // A transient network issue should never replace the last known state.
    } finally {
      inFlight = false;
    }
  };

  window.setInterval(refresh, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  refresh();
})();
