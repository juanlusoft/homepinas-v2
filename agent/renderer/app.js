/**
 * HomePiNAS Backup Agent - UI
 * Simple: connect → pending → dashboard
 */

const stepConnect = document.getElementById('step-connect');
const stepPending = document.getElementById('step-pending');
const stepDashboard = document.getElementById('step-dashboard');
const loading = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');

function showStep(step) {
  [stepConnect, stepPending, stepDashboard].forEach(s => {
    s.classList.remove('active');
    s.classList.add('hidden');
  });
  step.classList.remove('hidden');
  step.classList.add('active');
  // Auto-resize window to fit content
  setTimeout(() => { try { window.api.resizeToFit(); } catch(e) {} }, 50);
}

function showLoading(text) {
  loadingText.textContent = text;
  loading.classList.remove('hidden');
}

function hideLoading() {
  loading.classList.add('hidden');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(iso) {
  if (!iso) return 'Nunca';
  const d = new Date(iso);
  return d.toLocaleDateString('es-ES') + ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function scheduleToText(cron) {
  if (!cron) return '—';
  const map = {
    '0 3 * * *': 'Diario 3:00',
    '0 2 * * *': 'Diario 2:00',
    '0 12 * * *': 'Diario 12:00',
    '0 3 * * 1': 'Lunes 3:00',
    '0 3 * * 1,4': 'Lun/Jue 3:00',
    '0 3 1 * *': 'Día 1 3:00',
  };
  return map[cron] || cron;
}

// ── Init ──
async function init() {
  try {
    const data = await window.api.getStatus();

    if (data.status === 'approved') {
      showDashboard(data);
    } else if (data.status === 'pending') {
      showStep(stepPending);
    } else {
      showStep(stepConnect);
    }
  } catch (err) {
    console.error('Init failed:', err);
    showStep(stepConnect);
  }
}

async function showDashboard(data) {
  showStep(stepDashboard);
  document.getElementById('dash-nas').textContent = `NAS: ${data.nasAddress || '—'}`;
  try {
    const ver = await window.api.getVersion();
    document.getElementById('dash-version').textContent = `v${ver}`;
  } catch(e) {}
  document.getElementById('dash-last').textContent = formatDate(data.lastBackup);
  document.getElementById('dash-schedule').textContent = scheduleToText(data.schedule);
  document.getElementById('dash-type').textContent = data.backupType === 'image' ? 'Imagen completa' : 'Archivos';

  const errorBar = document.getElementById('dash-error-bar');
  const errorText = document.getElementById('dash-error-text');

  if (data.lastResult === 'success') {
    document.getElementById('dash-status-icon').textContent = '✅';
    document.getElementById('dash-status').textContent = 'OK';
    errorBar.classList.add('hidden');
  } else if (data.lastResult === 'error') {
    document.getElementById('dash-status-icon').textContent = '❌';
    document.getElementById('dash-status').textContent = 'Error';
    // Show error details
    try {
      const lastErr = await window.api.getLastError();
      if (lastErr) {
        errorText.textContent = lastErr.length > 150 ? lastErr.substring(0, 150) + '...' : lastErr;
        errorBar.classList.remove('hidden');
      }
    } catch(e) {}
  } else {
    document.getElementById('dash-status-icon').textContent = '⏸️';
    document.getElementById('dash-status').textContent = 'En espera';
    errorBar.classList.add('hidden');
  }
}

// ── Discover NAS ──
document.getElementById('btn-discover').addEventListener('click', async () => {
  showLoading('Buscando HomePiNAS en tu red...');
  try {
    const result = await window.api.discoverNAS();

    const nasList = document.getElementById('nas-list');
    const resultsDiv = document.getElementById('discover-results');

    if (result.success && result.results.length > 0) {
      nasList.innerHTML = '';
      result.results.forEach(nas => {
        const item = document.createElement('div');
        item.className = 'nas-item';
        item.innerHTML = `<div><strong>🏠 ${escapeHtml(nas.name || 'HomePiNAS')}</strong><br><small>${escapeHtml(nas.address)}:${escapeHtml(String(nas.port))}</small></div><span>→</span>`;
        item.addEventListener('click', () => connectToNAS(nas.address, nas.port));
        nasList.appendChild(item);
      });
      resultsDiv.classList.remove('hidden');
    } else {
      nasList.innerHTML = '<p style="color:#999;font-size:13px">No se encontró ningún NAS. Introduce la dirección manualmente.</p>';
      resultsDiv.classList.remove('hidden');
    }
  } catch (err) {
    console.error('Discovery failed:', err);
    alert('Error al buscar NAS: ' + (err.message || err));
  } finally {
    hideLoading();
  }
});

document.getElementById('btn-connect').addEventListener('click', () => {
  const addr = document.getElementById('nas-address').value.trim();
  const port = parseInt(document.getElementById('nas-port').value) || 443;
  if (!addr) return;
  if (port < 1 || port > 65535) {
    alert('Puerto inválido (debe ser entre 1 y 65535)');
    return;
  }
  connectToNAS(addr, port);
});

let selectedNAS = null;

async function connectToNAS(address, port) {
  // Show auth section for user to enter credentials
  selectedNAS = { address, port };
  document.getElementById('auth-section').style.display = 'block';
  document.getElementById('nas-user').focus();
}

async function doAuthConnect() {
  if (!selectedNAS) return;
  const user = document.getElementById('nas-user').value.trim();
  const pass = document.getElementById('nas-pass').value;
  if (!user || !pass) { alert('Introduce usuario y contraseña'); return; }

  showLoading('Conectando y registrando en el NAS...');
  try {
    const result = await window.api.connectNAS({ 
      address: selectedNAS.address, 
      port: selectedNAS.port,
      username: user,
      password: pass
    });

    if (result.success) {
      document.getElementById('auth-section').style.display = 'none';
      if (result.status === 'approved') {
        const data = await window.api.getStatus();
        showDashboard(data);
      } else {
        showStep(stepPending);
      }
    } else {
      alert('Error: ' + result.error);
    }
  } catch (err) {
    console.error('Connect failed:', err);
    alert('Error al conectar: ' + (err.message || err));
  } finally {
    hideLoading();
  }
}

// ── Auth connect ──
document.getElementById('btn-auth-connect').addEventListener('click', doAuthConnect);
document.getElementById('nas-pass').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doAuthConnect();
});

// ── Dashboard actions ──
document.getElementById('btn-backup-now').addEventListener('click', async () => {
  if (!confirm('¿Iniciar backup ahora?')) return;
  document.getElementById('dash-status-icon').textContent = '⏳';
  document.getElementById('dash-status').textContent = 'En progreso...';
  document.getElementById('btn-backup-now').disabled = true;
  try {
    const result = await window.api.runBackup();
    if (result && result.error) {
      alert('Error al ejecutar backup:\n\n' + result.error);
    }
    const data = await window.api.getStatus();
    showDashboard(data);
  } catch (err) {
    console.error('Backup failed:', err);
    alert('Error al ejecutar backup:\n\n' + (err.message || err));
  } finally {
    document.getElementById('btn-backup-now').disabled = false;
  }
});

document.getElementById('btn-open-log').addEventListener('click', () => {
  window.api.openLogFile();
});

document.getElementById('btn-open-folder').addEventListener('click', () => {
  window.api.openLogFolder();
});

document.getElementById('btn-disconnect').addEventListener('click', async () => {
  if (!confirm('¿Desconectar del NAS? Se detendrán los backups automáticos.')) return;
  await window.api.disconnect();
  showStep(stepConnect);
});

// ── Listen for status updates from main process ──
window.api.onStatusUpdate((data) => {
  if (data.status === 'approved') {
    window.api.getStatus().then(showDashboard);
  } else if (data.status === 'pending') {
    showStep(stepPending);
  } else if (data.status === 'disconnected') {
    showStep(stepConnect);
  }
  // Update dashboard if just backup result
  if (data.lastBackup || data.lastResult) {
    window.api.getStatus().then(showDashboard);
  }
});

// ── Start ──
init();
