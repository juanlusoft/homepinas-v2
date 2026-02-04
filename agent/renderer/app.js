/**
 * HomePiNAS Backup Agent - Renderer (UI Logic)
 */

// Elements
const stepConnect = document.getElementById('step-connect');
const stepConfig = document.getElementById('step-config');
const stepDashboard = document.getElementById('step-dashboard');
const connectionStatus = document.getElementById('connection-status');
const loading = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');

// State
let currentConfig = {};

// ── Helpers ──
function showStep(step) {
  [stepConnect, stepConfig, stepDashboard].forEach(s => {
    s.classList.remove('active');
    s.classList.add('hidden');
  });
  step.classList.remove('hidden');
  step.classList.add('active');
}

function showLoading(text = 'Cargando...') {
  loadingText.textContent = text;
  loading.classList.remove('hidden');
}

function hideLoading() {
  loading.classList.add('hidden');
}

function setStatus(connected, text) {
  connectionStatus.textContent = text;
  connectionStatus.className = `status ${connected ? 'connected' : 'disconnected'}`;
}

function formatDate(iso) {
  if (!iso) return 'Nunca';
  const d = new Date(iso);
  return d.toLocaleDateString('es-ES') + ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function scheduleToText(cron) {
  const map = {
    '0 3 * * *': 'Diario a las 3:00',
    '0 2 * * *': 'Diario a las 2:00',
    '0 12 * * *': 'Diario a las 12:00',
    '0 3 * * 1': 'Lunes a las 3:00',
    '0 3 * * 1,4': 'Lun/Jue a las 3:00',
    '0 3 1 * *': 'Día 1 a las 3:00',
  };
  return map[cron] || cron;
}

// ── Init ──
async function init() {
  currentConfig = await window.api.getConfig();

  if (currentConfig.deviceId && currentConfig.nasAddress) {
    // Already configured — show dashboard
    setStatus(true, `Conectado a ${currentConfig.nasAddress}`);
    showDashboard();
  } else if (currentConfig.nasAddress) {
    // Connected but not registered
    setStatus(true, `Conectado a ${currentConfig.nasAddress}`);
    showStep(stepConfig);
  } else {
    setStatus(false, 'Sin conexión');
    showStep(stepConnect);
  }
}

// ── Step 1: Discovery ──
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
      item.innerHTML = `
        <div>
          <div class="nas-item-info">🏠 ${nas.name || 'HomePiNAS'}</div>
          <div class="nas-item-addr">${nas.address}:${nas.port} (${nas.method})</div>
        </div>
        <span>→</span>
      `;
      item.addEventListener('click', () => {
        document.getElementById('nas-address').value = nas.address;
        document.getElementById('nas-port').value = nas.port;
        connectToNAS(nas.address, nas.port);
      });
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
  showLoading('Conectando al NAS...');

  const result = await window.api.testConnection({ address, port });
  hideLoading();

  if (result.success) {
    document.getElementById('login-form').classList.remove('hidden');
    document.getElementById('nas-address').value = address;
    document.getElementById('nas-port').value = port;
  } else {
    alert(`No se pudo conectar: ${result.error}`);
  }
}

document.getElementById('btn-login').addEventListener('click', async () => {
  const address = document.getElementById('nas-address').value.trim();
  const port = parseInt(document.getElementById('nas-port').value) || 3001;
  const username = document.getElementById('nas-user').value.trim();
  const password = document.getElementById('nas-pass').value;

  if (!username || !password) {
    alert('Introduce usuario y contraseña');
    return;
  }

  showLoading('Iniciando sesión...');
  const result = await window.api.login({ address, port, username, password });
  hideLoading();

  if (result.success) {
    setStatus(true, `Conectado a ${address}`);
    currentConfig = await window.api.getConfig();
    showStep(stepConfig);
  } else {
    alert(`Login fallido: ${result.error}`);
  }
});

// ── Step 2: Configuration ──
const backupTypeRadios = document.querySelectorAll('input[name="backup-type"]');
const filePathsSection = document.getElementById('file-paths-section');

backupTypeRadios.forEach(radio => {
  radio.addEventListener('change', () => {
    if (radio.value === 'files') {
      filePathsSection.classList.remove('hidden');
    } else {
      filePathsSection.classList.add('hidden');
    }
  });
});

document.getElementById('btn-add-path').addEventListener('click', () => {
  const list = document.getElementById('backup-paths-list');
  const item = document.createElement('div');
  item.className = 'path-item';
  item.innerHTML = `
    <input type="text" class="backup-path" placeholder="C:\\Users\\tu-usuario\\Documents">
    <button class="btn-remove" onclick="this.parentElement.remove()">✕</button>
  `;
  list.appendChild(item);
});

document.getElementById('btn-save-config').addEventListener('click', async () => {
  const deviceName = document.getElementById('device-name').value.trim() || 'Mi PC';
  const backupType = document.querySelector('input[name="backup-type"]:checked').value;
  const schedule = document.getElementById('schedule-select').value;
  const retention = parseInt(document.getElementById('retention-select').value);

  let paths = [];
  if (backupType === 'files') {
    paths = Array.from(document.querySelectorAll('.backup-path'))
      .map(input => input.value.trim())
      .filter(p => p);
    
    if (paths.length === 0) {
      alert('Añade al menos una carpeta para respaldar');
      return;
    }
  }

  showLoading('Registrando dispositivo en el NAS...');

  // Register device
  const regResult = await window.api.registerDevice({
    name: deviceName,
    backupType,
    paths,
  });

  if (!regResult.success) {
    hideLoading();
    alert(`Error al registrar: ${regResult.error}`);
    return;
  }

  // Save settings
  await window.api.saveSettings({ schedule, retention, backupType, backupPaths: paths });

  hideLoading();
  currentConfig = await window.api.getConfig();
  showDashboard();
});

// ── Step 3: Dashboard ──
function showDashboard() {
  showStep(stepDashboard);

  document.getElementById('dash-nas-addr').textContent = currentConfig.nasAddress || '—';
  document.getElementById('dash-last-backup').textContent = formatDate(currentConfig.lastBackup);
  document.getElementById('dash-next').textContent = scheduleToText(currentConfig.schedule);

  if (currentConfig.lastResult === 'success') {
    document.getElementById('dash-status-icon').textContent = '✅';
    document.getElementById('dash-status').textContent = 'OK';
  } else if (currentConfig.lastResult === 'error') {
    document.getElementById('dash-status-icon').textContent = '❌';
    document.getElementById('dash-status').textContent = 'Error';
  } else {
    document.getElementById('dash-status-icon').textContent = '⏸️';
    document.getElementById('dash-status').textContent = 'En espera';
  }
}

document.getElementById('btn-backup-now').addEventListener('click', async () => {
  if (!confirm('¿Iniciar backup ahora?')) return;

  document.getElementById('dash-status-icon').textContent = '⏳';
  document.getElementById('dash-status').textContent = 'En progreso...';
  document.getElementById('btn-backup-now').disabled = true;

  await window.api.runBackup();

  currentConfig = await window.api.getConfig();
  showDashboard();
  document.getElementById('btn-backup-now').disabled = false;
});

document.getElementById('btn-settings').addEventListener('click', () => {
  showStep(stepConfig);
  // Pre-fill
  document.getElementById('device-name').value = currentConfig.deviceName || '';
  const type = currentConfig.backupType || 'image';
  document.querySelector(`input[name="backup-type"][value="${type}"]`).checked = true;
  if (type === 'files') filePathsSection.classList.remove('hidden');
  document.getElementById('schedule-select').value = currentConfig.schedule || '0 3 * * *';
  document.getElementById('retention-select').value = currentConfig.retention || 3;
});

document.getElementById('btn-disconnect').addEventListener('click', async () => {
  if (!confirm('¿Desconectar del NAS? Se detendrán los backups automáticos.')) return;
  await window.api.disconnect();
  setStatus(false, 'Sin conexión');
  showStep(stepConnect);
});

// ── Start ──
init();
