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
}

function showLoading(text) {
  loadingText.textContent = text;
  loading.classList.remove('hidden');
}

function hideLoading() {
  loading.classList.add('hidden');
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
  const data = await window.api.getStatus();

  if (data.status === 'approved') {
    showDashboard(data);
  } else if (data.status === 'pending') {
    showStep(stepPending);
  } else {
    showStep(stepConnect);
  }
}

function showDashboard(data) {
  showStep(stepDashboard);
  document.getElementById('dash-nas').textContent = `NAS: ${data.nasAddress || '—'}`;
  document.getElementById('dash-last').textContent = formatDate(data.lastBackup);
  document.getElementById('dash-schedule').textContent = scheduleToText(data.schedule);
  document.getElementById('dash-type').textContent = data.backupType === 'image' ? 'Imagen completa' : 'Archivos';

  if (data.lastResult === 'success') {
    document.getElementById('dash-status-icon').textContent = '✅';
    document.getElementById('dash-status').textContent = 'OK';
  } else if (data.lastResult === 'error') {
    document.getElementById('dash-status-icon').textContent = '❌';
    document.getElementById('dash-status').textContent = 'Error';
  } else {
    document.getElementById('dash-status-icon').textContent = '⏸️';
    document.getElementById('dash-status').textContent = 'En espera';
  }
}

// ── Discover NAS ──
document.getElementById('btn-discover').addEventListener('click', async () => {
  showLoading('Buscando HomePiNAS en tu red...');
  const result = await window.api.discoverNAS();
  hideLoading();

  const nasList = document.getElementById('nas-list');
  const resultsDiv = document.getElementById('discover-results');

  if (result.success && result.results.length > 0) {
    nasList.innerHTML = '';
    result.results.forEach(nas => {
      const item = document.createElement('div');
      item.className = 'nas-item';
      item.innerHTML = `<div><strong>🏠 ${nas.name || 'HomePiNAS'}</strong><br><small>${nas.address}:${nas.port}</small></div><span>→</span>`;
      item.addEventListener('click', () => connectToNAS(nas.address, nas.port));
      nasList.appendChild(item);
    });
    resultsDiv.classList.remove('hidden');
  } else {
    nasList.innerHTML = '<p style="color:#999;font-size:13px">No se encontró ningún NAS. Introduce la dirección manualmente.</p>';
    resultsDiv.classList.remove('hidden');
  }
});

document.getElementById('btn-connect').addEventListener('click', () => {
  const addr = document.getElementById('nas-address').value.trim();
  const port = parseInt(document.getElementById('nas-port').value) || 3001;
  if (!addr) return;
  connectToNAS(addr, port);
});

async function connectToNAS(address, port) {
  showLoading('Conectando y registrando en el NAS...');
  const result = await window.api.connectNAS({ address, port });
  hideLoading();

  if (result.success) {
    if (result.status === 'approved') {
      const data = await window.api.getStatus();
      showDashboard(data);
    } else {
      showStep(stepPending);
    }
  } else {
    alert(`Error: ${result.error}`);
  }
}

// ── Dashboard actions ──
document.getElementById('btn-backup-now').addEventListener('click', async () => {
  if (!confirm('¿Iniciar backup ahora?')) return;
  document.getElementById('dash-status-icon').textContent = '⏳';
  document.getElementById('dash-status').textContent = 'En progreso...';
  document.getElementById('btn-backup-now').disabled = true;
  await window.api.runBackup();
  const data = await window.api.getStatus();
  showDashboard(data);
  document.getElementById('btn-backup-now').disabled = false;
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
