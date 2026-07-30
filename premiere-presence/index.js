/* global require */
const statusNode = document.getElementById('status');
const contextNode = document.getElementById('context');
const fields = {
  endpoint: document.getElementById('endpoint'),
  agentId: document.getElementById('agent-id'),
  token: document.getElementById('pairing-token'),
  editorName: document.getElementById('editor-name')
};
const stored = JSON.parse(localStorage.getItem('postopz-premiere-presence') || '{}');
fields.endpoint.value = stored.endpoint || '';
fields.agentId.value = stored.agentId || '';
fields.token.value = stored.token || '';
fields.editorName.value = stored.editorName || '';

function setStatus(message, kind = '') { statusNode.textContent = message; statusNode.className = `status ${kind}`; }
function simple(value, maximum) { return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum); }
async function maybe(value) { return value && typeof value.then === 'function' ? value : Promise.resolve(value); }

async function premiereContext() {
  try {
    const premiere = require('premierepro');
    const project = premiere.Project && premiere.Project.getActiveProject
      ? await maybe(premiere.Project.getActiveProject())
      : premiere.project;
    const sequence = project && project.getActiveSequence
      ? await maybe(project.getActiveSequence())
      : project && project.activeSequence;
    const projectName = simple(project && (project.name || (project.getName && await maybe(project.getName()))), 240);
    const sequenceName = simple(sequence && (sequence.name || (sequence.getName && await maybe(sequence.getName()))), 240);
    const version = simple((premiere && (premiere.version || premiere.versionString)) || 'Adobe Premiere Pro', 80);
    return { project_name: projectName || null, sequence_name: sequenceName || null, premiere_version: version || 'Adobe Premiere Pro' };
  } catch (_) {
    return { project_name: null, sequence_name: null, premiere_version: 'Adobe Premiere Pro' };
  }
}

function pairing() {
  return { endpoint: fields.endpoint.value.trim().replace(/\/$/, ''), agentId: fields.agentId.value.trim(), token: fields.token.value.trim(), editorName: fields.editorName.value.trim() };
}
async function sendPresence() {
  const current = pairing();
  if (!/^https:\/\//.test(current.endpoint) || !current.agentId || current.token.length < 32 || !current.editorName) {
    setStatus('Enter the Console endpoint, workstation ID, pairing token, and your name first.', 'error');
    return;
  }
  const context = await premiereContext();
  contextNode.textContent = context.project_name
    ? `Open project: ${context.project_name}${context.sequence_name ? ` · Sequence: ${context.sequence_name}` : ''}`
    : 'No active project detected yet. A presence update will still identify this editor.';
  try {
    const response = await fetch(current.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${current.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: current.agentId, editor_name: current.editorName, status: context.project_name ? 'active' : 'idle', ...context })
    });
    if (!response.ok) throw new Error('presence request rejected');
    setStatus(`Presence sent at ${new Date().toLocaleTimeString()}.`, 'ok');
  } catch (_) {
    setStatus('Console could not accept this update. Check the endpoint and pairing details.', 'error');
  }
}

async function savePairing() {
  const current = pairing();
  localStorage.setItem('postopz-premiere-presence', JSON.stringify(current));
  await sendPresence();
}
document.getElementById('save-pairing').addEventListener('click', savePairing);
document.getElementById('send-now').addEventListener('click', sendPresence);
setInterval(() => {
  const current = pairing();
  if (/^https:\/\//.test(current.endpoint) && current.agentId && current.token.length >= 32 && current.editorName) sendPresence();
}, 60 * 1000);
premiereContext().then((context) => {
  contextNode.textContent = context.project_name ? `Open project: ${context.project_name}` : 'Open a Premiere project, then pair this panel to Console.';
});
