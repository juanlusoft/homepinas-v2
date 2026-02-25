/**
 * Backup & Scheduler Module
 * Backup management and scheduled tasks
 */
(function(window) {
    'use strict';
    
    const state = window.AppState;
    const API_BASE = window.API_BASE;
    const escapeHtml = window.AppUtils.escapeHtml;

// =============================================================================

async function renderBackupView() {
    const container = document.createElement('div');
    container.style.cssText = 'display: contents;';

    // === Backup Jobs Card ===
    const backupCard = document.createElement('div');
    backupCard.className = 'glass-card';
    backupCard.style.cssText = 'grid-column: 1 / -1;';

    const bHeader = document.createElement('div');
    bHeader.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;';
    const bTitle = document.createElement('h3');
    bTitle.textContent = '💾 Trabajos de Backup';
    const addJobBtn = document.createElement('button');
    addJobBtn.className = 'btn-primary btn-sm';
    addJobBtn.textContent = '+ Nuevo Backup';
    addJobBtn.addEventListener('click', () => showBackupJobForm());
    bHeader.appendChild(bTitle);
    bHeader.appendChild(addJobBtn);
    backupCard.appendChild(bHeader);

    const jobsList = document.createElement('div');
    jobsList.id = 'backup-jobs-list';
    backupCard.appendChild(jobsList);
    container.appendChild(backupCard);

    // === Task Scheduler Card ===
    const schedCard = document.createElement('div');
    schedCard.className = 'glass-card';
    schedCard.style.cssText = 'grid-column: 1 / -1;';

    const sHeader = document.createElement('div');
    sHeader.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;';
    const sTitle = document.createElement('h3');
    sTitle.textContent = '⏰ Programador de Tareas';
    const addTaskBtn = document.createElement('button');
    addTaskBtn.className = 'btn-primary btn-sm';
    addTaskBtn.textContent = '+ Nueva Tarea';
    addTaskBtn.addEventListener('click', () => showTaskForm());
    sHeader.appendChild(sTitle);
    sHeader.appendChild(addTaskBtn);
    schedCard.appendChild(sHeader);

    const tasksList = document.createElement('div');
    tasksList.id = 'scheduler-tasks-list';
    schedCard.appendChild(tasksList);
    container.appendChild(schedCard);

    dashboardContent.appendChild(container);
    await loadBackupJobs();
    await loadSchedulerTasks();
}

async function loadBackupJobs() {
    const list = document.getElementById('backup-jobs-list');
    if (!list) return;
    list.innerHTML = '<div style="padding: 20px; color: var(--text-dim);">Cargando...</div>';

    try {
        const res = await authFetch(`${API_BASE}/backup/jobs`);
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();
        const jobs = data.jobs || data || [];

        if (!jobs || jobs.length === 0) {
            list.innerHTML = '<div style="padding: 30px; text-align: center; color: var(--text-dim);">No hay trabajos de backup configurados</div>';
            return;
        }

        list.innerHTML = '';
        jobs.forEach(job => {
            const card = document.createElement('div');
            card.style.cssText = 'display: flex; align-items: center; gap: 15px; padding: 15px; border: 1px solid var(--border); border-radius: 10px; margin-bottom: 10px;';

            const statusDot = document.createElement('span');
            statusDot.style.cssText = `width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; background: ${
                job.lastStatus === 'running' ? '#f59e0b' : job.lastStatus === 'success' ? '#10b981' : job.lastStatus === 'failed' ? '#ef4444' : '#94a3b8'
            };`;

            const info = document.createElement('div');
            info.style.cssText = 'flex: 1; min-width: 0;';
            info.innerHTML = `
                <div style="font-weight: 600;">${escapeHtml(job.name)}</div>
                <div style="font-size: 0.85rem; color: var(--text-dim);">${escapeHtml(job.type)} • ${escapeHtml(job.source)} → ${escapeHtml(job.destination)}</div>
                <div style="font-size: 0.8rem; color: var(--text-dim);">${job.schedule?.enabled ? '⏰ ' + escapeHtml(job.schedule.cron) : 'Manual'}${job.lastRun ? ' • Última: ' + new Date(job.lastRun).toLocaleString('es-ES') : ''}</div>
            `;

            const actions = document.createElement('div');
            actions.style.cssText = 'display: flex; gap: 6px; flex-shrink: 0;';

            const runBtn = document.createElement('button');
            runBtn.className = 'btn-primary btn-sm';
            runBtn.textContent = '▶ Ejecutar';
            runBtn.style.cssText = 'padding: 5px 12px; font-size: 0.8rem;';
            runBtn.addEventListener('click', () => runBackupJob(job.id));

            const delBtn = document.createElement('button');
            delBtn.className = 'btn-primary btn-sm';
            delBtn.style.cssText = 'padding: 5px 12px; font-size: 0.8rem; background: #ef4444;';
            delBtn.textContent = '🗑';
            delBtn.addEventListener('click', () => deleteBackupJob(job.id));

            actions.appendChild(runBtn);
            actions.appendChild(delBtn);

            card.appendChild(statusDot);
            card.appendChild(info);
            card.appendChild(actions);
            list.appendChild(card);
        });
    } catch (e) {
        list.innerHTML = '<div style="padding: 20px; color: #ef4444;">Error cargando backups</div>';
    }
}

function showBackupJobForm(editJob = null) {
    const existing = document.getElementById('backup-form-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'backup-form-modal';
    modal.className = 'modal active';
    modal.style.cssText = 'display: flex; position: fixed; inset: 0; z-index: 1000; align-items: center; justify-content: center; background: rgba(0,0,0,0.5);';

    modal.innerHTML = `
        <div class="glass-card modal-content" style="max-width: 500px; width: 90%;">
            <header class="modal-header" style="display: flex; justify-content: space-between; align-items: center;">
                <h3>${editJob ? 'Editar Backup' : 'Nuevo Backup'}</h3>
                <button class="btn-close" id="close-backup-form">&times;</button>
            </header>
            <form id="backup-create-form" style="display: flex; flex-direction: column; gap: 12px; margin-top: 15px;">
                <div class="input-group">
                    <input type="text" id="bj-name" required placeholder=" " value="${editJob?.name || ''}">
                    <label>Nombre</label>
                </div>
                <div class="input-group">
                    <input type="text" id="bj-source" required placeholder=" " value="${editJob?.source || '/mnt/storage'}">
                    <label>Origen</label>
                </div>
                <div class="input-group">
                    <input type="text" id="bj-dest" required placeholder=" " value="${editJob?.destination || '/mnt/backup'}">
                    <label>Destino</label>
                </div>
                <select id="bj-type" style="padding: 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text);">
                    <option value="rsync" ${editJob?.type === 'rsync' ? 'selected' : ''}>Rsync (incremental)</option>
                    <option value="tar" ${editJob?.type === 'tar' ? 'selected' : ''}>Tar (comprimido)</option>
                </select>
                <div style="display: flex; gap: 10px; align-items: center;">
                    <input type="checkbox" id="bj-scheduled" ${editJob?.schedule?.enabled ? 'checked' : ''}>
                    <label for="bj-scheduled" style="margin: 0;">Programar</label>
                    <input type="text" id="bj-cron" placeholder="0 2 * * *" value="${editJob?.schedule?.cron || '0 2 * * *'}" style="flex: 1; padding: 8px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text);">
                </div>
                <div class="input-group">
                    <input type="text" id="bj-excludes" placeholder=" " value="${editJob?.excludes?.join(', ') || ''}">
                    <label>Exclusiones (separadas por coma)</label>
                </div>
                <button type="submit" class="btn-primary">${editJob ? 'Guardar' : 'Crear Backup'}</button>
            </form>
        </div>
    `;

    document.body.appendChild(modal);
    document.getElementById('close-backup-form').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    document.getElementById('backup-create-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const body = {
            name: document.getElementById('bj-name').value.trim(),
            source: document.getElementById('bj-source').value.trim(),
            destination: document.getElementById('bj-dest').value.trim(),
            type: document.getElementById('bj-type').value,
            schedule: {
                enabled: document.getElementById('bj-scheduled').checked,
                cron: document.getElementById('bj-cron').value.trim()
            },
            excludes: document.getElementById('bj-excludes').value.split(',').map(s => s.trim()).filter(Boolean)
        };

        try {
            const url = editJob ? `${API_BASE}/backup/jobs/${editJob.id}` : `${API_BASE}/backup/jobs`;
            const method = editJob ? 'PUT' : 'POST';
            const res = await authFetch(url, { method, body: JSON.stringify(body) });
            if (!res.ok) throw new Error('Failed');
            modal.remove();
            await loadBackupJobs();
        } catch (err) {
            alert('Error al guardar backup');
        }
    });
}

async function runBackupJob(id) {
    try {
        const res = await authFetch(`${API_BASE}/backup/jobs/${id}/run`, { method: 'POST' });
        if (!res.ok) throw new Error('Failed');
        alert('Backup iniciado');
        setTimeout(() => loadBackupJobs(), 2000);
    } catch (e) {
        alert('Error al ejecutar backup');
    }
}

async function deleteBackupJob(id) {
    const confirmed = await showConfirmModal('Eliminar backup', '¿Eliminar este trabajo de backup?');
    if (!confirmed) return;
    try {
        await authFetch(`${API_BASE}/backup/jobs/${id}`, { method: 'DELETE' });
        await loadBackupJobs();
    } catch (e) {
        alert('Error al eliminar');
    }
}

// --- Task Scheduler ---

async function loadSchedulerTasks() {
    const list = document.getElementById('scheduler-tasks-list');
    if (!list) return;
    list.innerHTML = '<div style="padding: 20px; color: var(--text-dim);">Cargando...</div>';

    try {
        const res = await authFetch(`${API_BASE}/scheduler/tasks`);
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();
        const tasks = data.tasks || data || [];

        if (!tasks || tasks.length === 0) {
            list.innerHTML = '<div style="padding: 30px; text-align: center; color: var(--text-dim);">No hay tareas programadas</div>';
            return;
        }

        list.innerHTML = '';
        tasks.forEach(task => {
            const row = document.createElement('div');
            row.style.cssText = 'display: flex; align-items: center; gap: 15px; padding: 12px; border: 1px solid var(--border); border-radius: 10px; margin-bottom: 8px;';

            const toggle = document.createElement('input');
            toggle.type = 'checkbox';
            toggle.checked = task.enabled;
            toggle.style.cssText = 'width: 18px; height: 18px; cursor: pointer;';
            toggle.addEventListener('change', () => toggleTask(task.id));

            const info = document.createElement('div');
            info.style.cssText = 'flex: 1; min-width: 0;';
            info.innerHTML = `
                <div style="font-weight: 600;">${escapeHtml(task.name)}</div>
                <div style="font-size: 0.85rem; color: var(--text-dim); font-family: monospace;">${escapeHtml(task.command)}</div>
                <div style="font-size: 0.8rem; color: var(--text-dim);">⏰ ${escapeHtml(task.schedule)}</div>
            `;

            const actions = document.createElement('div');
            actions.style.cssText = 'display: flex; gap: 6px; flex-shrink: 0;';

            const runBtn = document.createElement('button');
            runBtn.className = 'btn-primary btn-sm';
            runBtn.style.cssText = 'padding: 5px 12px; font-size: 0.8rem;';
            runBtn.textContent = '▶';
            runBtn.addEventListener('click', () => runTask(task.id));

            const delBtn = document.createElement('button');
            delBtn.style.cssText = 'padding: 5px 12px; font-size: 0.8rem; background: #ef4444; border: none; color: white; border-radius: 6px; cursor: pointer;';
            delBtn.textContent = '🗑';
            delBtn.addEventListener('click', () => deleteTask(task.id));

            actions.appendChild(runBtn);
            actions.appendChild(delBtn);

            row.appendChild(toggle);
            row.appendChild(info);
            row.appendChild(actions);
            list.appendChild(row);
        });
    } catch (e) {
        list.innerHTML = '<div style="padding: 20px; color: #ef4444;">Error cargando tareas</div>';
    }
}

function showTaskForm() {
    const existing = document.getElementById('task-form-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'task-form-modal';
    modal.className = 'modal active';
    modal.style.cssText = 'display: flex; position: fixed; inset: 0; z-index: 1000; align-items: center; justify-content: center; background: rgba(0,0,0,0.5);';

    modal.innerHTML = `
        <div class="glass-card modal-content" style="max-width: 450px; width: 90%;">
            <header class="modal-header" style="display: flex; justify-content: space-between; align-items: center;">
                <h3>Nueva Tarea Programada</h3>
                <button class="btn-close" id="close-task-form">&times;</button>
            </header>
            <form id="task-create-form" style="display: flex; flex-direction: column; gap: 12px; margin-top: 15px;">
                <div class="input-group">
                    <input type="text" id="tf-name" required placeholder=" ">
                    <label>Nombre</label>
                </div>
                <div class="input-group">
                    <input type="text" id="tf-command" required placeholder=" ">
                    <label>Comando</label>
                </div>
                <div class="input-group">
                    <input type="text" id="tf-schedule" required placeholder=" " value="0 * * * *">
                    <label>Expresión Cron</label>
                </div>
                <div style="font-size: 0.8rem; color: var(--text-dim); padding: 0 4px;">
                    Formato: minuto hora día mes día-semana (ej: <code>0 2 * * *</code> = cada día a las 2:00)
                </div>
                <button type="submit" class="btn-primary">Crear Tarea</button>
            </form>
        </div>
    `;

    document.body.appendChild(modal);
    document.getElementById('close-task-form').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    document.getElementById('task-create-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            const res = await authFetch(`${API_BASE}/scheduler/tasks`, {
                method: 'POST',
                body: JSON.stringify({
                    name: document.getElementById('tf-name').value.trim(),
                    command: document.getElementById('tf-command').value.trim(),
                    schedule: document.getElementById('tf-schedule').value.trim(),
                    enabled: true
                })
            });
            if (!res.ok) throw new Error('Failed');
            modal.remove();
            await loadSchedulerTasks();
        } catch (err) {
            alert('Error al crear tarea');
        }
    });
}

async function toggleTask(id) {
    try {
        await authFetch(`${API_BASE}/scheduler/tasks/${id}/toggle`, { method: 'POST' });
    } catch (e) { console.error('Toggle task error:', e); }
}

async function runTask(id) {
    try {
        const res = await authFetch(`${API_BASE}/scheduler/tasks/${id}/run`, { method: 'POST' });
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();
        alert(data.output ? `Resultado:\n${data.output.substring(0, 500)}` : 'Tarea ejecutada');
    } catch (e) {
        alert('Error al ejecutar tarea');
    }
}

async function deleteTask(id) {
    const confirmed = await showConfirmModal('Eliminar tarea', '¿Eliminar esta tarea programada?');
    if (!confirmed) return;
    try {
        await authFetch(`${API_BASE}/scheduler/tasks/${id}`, { method: 'DELETE' });
        await loadSchedulerTasks();
    } catch (e) {
        alert('Error al eliminar tarea');
    }
}


    // Expose to window
    window.AppBackup = {
        render: renderBackupView
    };
    
})(window);
