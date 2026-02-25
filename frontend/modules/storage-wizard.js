/**
 * Storage Wizard Module
 * Step-by-step storage configuration wizard
 * 
 * NOTE: This file exceeds 300 lines due to complex wizard workflow
 * with multiple steps and state management. Keeping cohesive for now.
 */
(function(window) {
    'use strict';
    
    const state = window.AppState;
    const API_BASE = window.API_BASE;
    const escapeHtml = window.AppUtils.escapeHtml;

// =============================================================================

const wizardState = {
    currentStep: 1,
    totalSteps: 7,
    disks: [],
    selectedDataDisks: [],
    selectedParityDisk: null,
    selectedCacheDisk: null,
    isConfiguring: false
};

// Load wizard state from localStorage
function loadWizardState() {
    try {
        const saved = localStorage.getItem('homepinas-wizard-state');
        if (saved) {
            const parsed = JSON.parse(saved);
            Object.assign(wizardState, parsed);
            return true;
        }
    } catch (e) {
        console.warn('Could not load wizard state:', e);
    }
    return false;
}

// Save wizard state to localStorage
function saveWizardState() {
    try {
        localStorage.setItem('homepinas-wizard-state', JSON.stringify({
            currentStep: wizardState.currentStep,
            selectedDataDisks: wizardState.selectedDataDisks,
            selectedParityDisk: wizardState.selectedParityDisk,
            selectedCacheDisk: wizardState.selectedCacheDisk
        }));
    } catch (e) {
        console.warn('Could not save wizard state:', e);
    }
}

// Clear wizard state
function clearWizardState() {
    wizardState.currentStep = 1;
    wizardState.selectedDataDisks = [];
    wizardState.selectedParityDisk = null;
    wizardState.selectedCacheDisk = null;
    localStorage.removeItem('homepinas-wizard-state');
}

// Initialize the storage wizard
function initStorageSetup() {
    console.log('[Wizard] Initializing storage setup wizard');
    
    // Load any saved state
    const hasSavedState = loadWizardState();
    
    // IMPORTANT: Reset all wizard steps to ensure only one is active
    document.querySelectorAll('.wizard-step').forEach(step => {
        step.classList.remove('active', 'exit');
    });
    
    // Set only step 1 as active initially (or saved step)
    const targetStep = (hasSavedState && wizardState.currentStep >= 1 && wizardState.currentStep <= 5) 
        ? wizardState.currentStep 
        : 1;
    const targetStepEl = document.querySelector(`.wizard-step[data-step="${targetStep}"]`);
    if (targetStepEl) {
        targetStepEl.classList.add('active');
    }
    wizardState.currentStep = targetStep;
    updateWizardProgress(targetStep);
    
    // Start disk detection
    detectDisksForWizard();
    
    // Setup wizard navigation
    setupWizardNavigation();
}

// Detect disks and populate the wizard
async function detectDisksForWizard() {
    const detectionContainer = document.getElementById('wizard-disk-detection');
    if (!detectionContainer) return;
    
    // Show loading spinner
    detectionContainer.innerHTML = `
        <div class="wizard-detecting">
            <div class="wizard-spinner"></div>
            <p class="wizard-detecting-text">${t('wizard.detectingDisks', 'Detectando discos conectados...')}</p>
        </div>
    `;
    
    try {
        const res = await fetch(`${API_BASE}/system/disks`);
        if (!res.ok) throw new Error('Failed to fetch disks');
        
        wizardState.disks = await res.json();
        state.disks = wizardState.disks; // Keep global state in sync
        
        // Short delay for UX (show the spinner briefly)
        await new Promise(r => setTimeout(r, 800));
        
        if (wizardState.disks.length === 0) {
            detectionContainer.innerHTML = `
                <div class="wizard-no-disks">
                    <div class="wizard-no-disks-icon">💿</div>
                    <p>${t('wizard.noDisks', 'No se detectaron discos disponibles')}</p>
                    <button class="wizard-btn wizard-btn-next" data-action="retry-detect" style="margin-top: 16px;">
                        🔄 ${t('wizard.retry', 'Reintentar')}
                    </button>
                </div>
            `;
            detectionContainer.querySelector('[data-action="retry-detect"]')?.addEventListener('click', () => detectDisksForWizard());
            return;
        }
        
        // Show detected disks summary
        detectionContainer.innerHTML = `
            <div style="text-align: center; padding: 20px 0;">
                <div style="font-size: 3rem; margin-bottom: 16px;">✅</div>
                <p style="font-size: 1.1rem; color: var(--text-primary); margin-bottom: 8px;">
                    <strong>${wizardState.disks.length}</strong> ${t('wizard.disksDetected', 'disco(s) detectado(s)')}
                </p>
                <div style="display: flex; justify-content: center; gap: 16px; margin-top: 16px; flex-wrap: wrap;">
                    ${wizardState.disks.map(d => `
                        <div style="background: var(--hover-bg); padding: 8px 16px; border-radius: 8px; font-size: 0.9rem;">
                            ${getDiskIcon(d.type)} ${escapeHtml(d.model || d.id)} <span style="color: var(--primary); font-weight: 600;">${escapeHtml(d.size)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        
        // Enable next button
        const nextBtn = document.getElementById('wizard-next-1');
        if (nextBtn) nextBtn.disabled = false;
        
        // Populate disk lists for other steps
        populateWizardDiskLists();
        
        // Restore selections if we have saved state
        if (wizardState.selectedDataDisks.length > 0 || wizardState.selectedParityDisk || wizardState.selectedCacheDisk) {
            restoreWizardSelections();
        }
        
    } catch (e) {
        console.error('[Wizard] Disk detection error:', e);
        detectionContainer.innerHTML = `
            <div class="wizard-no-disks">
                <div class="wizard-no-disks-icon">❌</div>
                <p>${t('wizard.detectionError', 'Error al detectar discos')}</p>
                <button class="wizard-btn wizard-btn-next" data-action="retry-detect" style="margin-top: 16px;">
                    🔄 ${t('wizard.retry', 'Reintentar')}
                </button>
            </div>
        `;
        detectionContainer.querySelector('[data-action="retry-detect"]')?.addEventListener('click', () => detectDisksForWizard());
    }
}

// Get appropriate icon for disk type
function getDiskIcon(type) {
    switch (type?.toUpperCase()) {
        case 'NVME': return '⚡';
        case 'SSD': return '💾';
        case 'HDD': return '💿';
        default: return '📀';
    }
}

// Populate disk selection lists for all wizard steps
function populateWizardDiskLists() {
    // Data disks (all disks available)
    const dataList = document.getElementById('wizard-data-disks');
    if (dataList) {
        dataList.innerHTML = wizardState.disks.map(disk => createDiskCard(disk, 'checkbox', 'data')).join('');
        setupDiskCardListeners(dataList, 'data');
    }
    
    // Parity disks (all disks, but will filter based on data selection)
    const parityList = document.getElementById('wizard-parity-disks');
    if (parityList) {
        parityList.innerHTML = wizardState.disks.map(disk => createDiskCard(disk, 'radio', 'parity')).join('');
        setupDiskCardListeners(parityList, 'parity');
    }
    
    // Cache disks (only SSD/NVMe)
    const cacheList = document.getElementById('wizard-cache-disks');
    const noCacheMsg = document.getElementById('wizard-no-cache-disks');
    if (cacheList) {
        const ssdDisks = wizardState.disks.filter(d => d.type === 'NVMe' || d.type === 'SSD');
        if (ssdDisks.length > 0) {
            cacheList.innerHTML = ssdDisks.map(disk => createDiskCard(disk, 'radio', 'cache')).join('');
            cacheList.style.display = 'flex';
            if (noCacheMsg) noCacheMsg.style.display = 'none';
            setupDiskCardListeners(cacheList, 'cache');
        } else {
            cacheList.style.display = 'none';
            if (noCacheMsg) noCacheMsg.style.display = 'block';
        }
    }
}

// Create a disk selection card
function createDiskCard(disk, inputType, role) {
    const typeClass = (disk.type || 'hdd').toLowerCase();
    const selectorClass = inputType === 'checkbox' ? 'wizard-disk-checkbox' : 'wizard-disk-radio';
    
    return `
        <div class="wizard-disk-card" data-disk-id="${escapeHtml(disk.id)}" data-role="${role}">
            <div class="${selectorClass}"></div>
            <div class="wizard-disk-icon">${getDiskIcon(disk.type)}</div>
            <div class="wizard-disk-info">
                <div class="wizard-disk-name">
                    ${escapeHtml(disk.model || t('common.unknown', 'Disco Desconocido'))}
                    <span class="wizard-disk-badge ${typeClass}">${escapeHtml(disk.type || 'HDD')}</span>
                </div>
                <div class="wizard-disk-details">
                    /dev/${escapeHtml(disk.id)} • ${disk.temp ? disk.temp + '°C' : 'N/A'}
                </div>
            </div>
            <div class="wizard-disk-size">${escapeHtml(disk.size)}</div>
        </div>
    `;
}

// Setup click listeners for disk cards
function setupDiskCardListeners(container, role) {
    container.querySelectorAll('.wizard-disk-card').forEach(card => {
        card.addEventListener('click', () => handleDiskSelection(card, role));
    });
}

// Handle disk selection
function handleDiskSelection(card, role) {
    const diskId = card.dataset.diskId;
    const disk = wizardState.disks.find(d => d.id === diskId);
    if (!disk) return;
    
    if (role === 'data') {
        // Checkbox behavior - toggle selection
        card.classList.toggle('selected');
        
        if (card.classList.contains('selected')) {
            if (!wizardState.selectedDataDisks.includes(diskId)) {
                wizardState.selectedDataDisks.push(diskId);
            }
        } else {
            wizardState.selectedDataDisks = wizardState.selectedDataDisks.filter(id => id !== diskId);
        }
        
        // Update next button state
        const nextBtn = document.getElementById('wizard-next-2');
        if (nextBtn) nextBtn.disabled = wizardState.selectedDataDisks.length === 0;
        
        // Update parity disk options (disable selected data disks)
        updateParityDiskOptions();
        
    } else if (role === 'parity') {
        // Radio behavior - single selection
        const container = card.parentElement;
        container.querySelectorAll('.wizard-disk-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        wizardState.selectedParityDisk = diskId;
        
    } else if (role === 'cache') {
        // Radio behavior - single selection
        const container = card.parentElement;
        container.querySelectorAll('.wizard-disk-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        wizardState.selectedCacheDisk = diskId;
    }
    
    saveWizardState();
}

// Update parity disk options based on data disk selection
function updateParityDiskOptions() {
    const parityList = document.getElementById('wizard-parity-disks');
    if (!parityList) return;
    
    // Get the largest selected data disk size
    const selectedDataDiskSizes = wizardState.selectedDataDisks.map(id => {
        const disk = wizardState.disks.find(d => d.id === id);
        return disk ? parseDiskSize(disk.size) : 0;
    });
    const largestDataSize = Math.max(...selectedDataDiskSizes, 0);
    
    // Update each parity disk card
    parityList.querySelectorAll('.wizard-disk-card').forEach(card => {
        const diskId = card.dataset.diskId;
        const disk = wizardState.disks.find(d => d.id === diskId);
        
        // Disable if selected as data disk
        const isDataDisk = wizardState.selectedDataDisks.includes(diskId);
        // Disable if smaller than largest data disk
        const isTooSmall = disk && parseDiskSize(disk.size) < largestDataSize;
        
        if (isDataDisk || isTooSmall) {
            card.classList.add('disabled');
            card.classList.remove('selected');
            if (wizardState.selectedParityDisk === diskId) {
                wizardState.selectedParityDisk = null;
            }
        } else {
            card.classList.remove('disabled');
        }
    });
    
    // Also update cache disk options
    updateCacheDiskOptions();
}

// Update cache disk options based on selections
function updateCacheDiskOptions() {
    const cacheList = document.getElementById('wizard-cache-disks');
    if (!cacheList) return;
    
    cacheList.querySelectorAll('.wizard-disk-card').forEach(card => {
        const diskId = card.dataset.diskId;
        const isDataDisk = wizardState.selectedDataDisks.includes(diskId);
        const isParityDisk = wizardState.selectedParityDisk === diskId;
        
        if (isDataDisk || isParityDisk) {
            card.classList.add('disabled');
            card.classList.remove('selected');
            if (wizardState.selectedCacheDisk === diskId) {
                wizardState.selectedCacheDisk = null;
            }
        } else {
            card.classList.remove('disabled');
        }
    });
}

// Parse disk size string to bytes for comparison
function parseDiskSize(sizeStr) {
    if (!sizeStr) return 0;
    const match = sizeStr.match(/^([\d.]+)\s*(TB|GB|MB|KB|B)?$/i);
    if (!match) return 0;
    const num = parseFloat(match[1]);
    const unit = (match[2] || 'B').toUpperCase();
    const multipliers = { B: 1, KB: 1024, MB: 1024**2, GB: 1024**3, TB: 1024**4 };
    return num * (multipliers[unit] || 1);
}

// Restore saved selections when disk lists are populated
function restoreWizardSelections() {
    // Restore data disk selections
    wizardState.selectedDataDisks.forEach(diskId => {
        const card = document.querySelector(`#wizard-data-disks .wizard-disk-card[data-disk-id="${diskId}"]`);
        if (card) card.classList.add('selected');
    });
    
    // Update next button
    const nextBtn2 = document.getElementById('wizard-next-2');
    if (nextBtn2) nextBtn2.disabled = wizardState.selectedDataDisks.length === 0;
    
    // Restore parity selection
    if (wizardState.selectedParityDisk) {
        const card = document.querySelector(`#wizard-parity-disks .wizard-disk-card[data-disk-id="${wizardState.selectedParityDisk}"]`);
        if (card && !card.classList.contains('disabled')) card.classList.add('selected');
    }
    
    // Restore cache selection
    if (wizardState.selectedCacheDisk) {
        const card = document.querySelector(`#wizard-cache-disks .wizard-disk-card[data-disk-id="${wizardState.selectedCacheDisk}"]`);
        if (card && !card.classList.contains('disabled')) card.classList.add('selected');
    }
    
    // Update dependent options
    updateParityDiskOptions();
}

// Setup wizard navigation buttons
function setupWizardNavigation() {
    // Step 1 -> 2
    document.getElementById('wizard-next-1')?.addEventListener('click', () => navigateWizard(2));
    
    // Step 2
    document.getElementById('wizard-back-2')?.addEventListener('click', () => navigateWizard(1));
    document.getElementById('wizard-next-2')?.addEventListener('click', () => {
        updateParityDiskOptions();
        navigateWizard(3);
    });
    
    // Step 3
    document.getElementById('wizard-back-3')?.addEventListener('click', () => navigateWizard(2));
    document.getElementById('wizard-next-3')?.addEventListener('click', () => {
        updateCacheDiskOptions();
        navigateWizard(4);
    });
    document.getElementById('wizard-skip-parity')?.addEventListener('click', () => {
        wizardState.selectedParityDisk = null;
        document.querySelectorAll('#wizard-parity-disks .wizard-disk-card').forEach(c => c.classList.remove('selected'));
        updateCacheDiskOptions();
        navigateWizard(4);
    });
    
    // Step 4
    document.getElementById('wizard-back-4')?.addEventListener('click', () => navigateWizard(3));
    document.getElementById('wizard-next-4')?.addEventListener('click', () => {
        updateSummary();
        navigateWizard(5);
    });
    document.getElementById('wizard-skip-cache')?.addEventListener('click', () => {
        wizardState.selectedCacheDisk = null;
        document.querySelectorAll('#wizard-cache-disks .wizard-disk-card').forEach(c => c.classList.remove('selected'));
        updateSummary();
        navigateWizard(5);
    });
    
    // Step 5
    document.getElementById('wizard-back-5')?.addEventListener('click', () => navigateWizard(4));
    document.getElementById('wizard-create-pool')?.addEventListener('click', createStoragePool);
    
    // Step 7 (completed)
    document.getElementById('wizard-go-dashboard')?.addEventListener('click', () => {
        clearWizardState();
        if (state.sessionId) {
            state.isAuthenticated = true;
            switchView('dashboard');
        } else {
            switchView('login');
        }
    });
}

// Navigate to a specific wizard step
function navigateWizard(step) {
    const currentStepEl = document.querySelector(`.wizard-step[data-step="${wizardState.currentStep}"]`);
    const nextStepEl = document.querySelector(`.wizard-step[data-step="${step}"]`);
    
    if (!currentStepEl || !nextStepEl) return;
    
    // Animate out current step
    currentStepEl.classList.add('exit');
    
    setTimeout(() => {
        currentStepEl.classList.remove('active', 'exit');
        nextStepEl.classList.add('active');
        
        // Update progress indicator
        updateWizardProgress(step);
        
        wizardState.currentStep = step;
        saveWizardState();
    }, 300);
}

// Update the progress dots
function updateWizardProgress(step) {
    const progressContainer = document.getElementById('wizard-progress');
    if (!progressContainer) return;
    
    // For steps 6 and 7 (progress and completion), hide the progress indicator
    if (step >= 6) {
        progressContainer.style.display = 'none';
        return;
    }
    progressContainer.style.display = 'flex';
    
    const dots = progressContainer.querySelectorAll('.wizard-progress-dot');
    const lines = progressContainer.querySelectorAll('.wizard-progress-line');
    
    dots.forEach((dot, index) => {
        const dotStep = index + 1;
        dot.classList.remove('active', 'completed');
        dot.textContent = dotStep;
        
        if (dotStep < step) {
            dot.classList.add('completed');
            dot.textContent = '';
        } else if (dotStep === step) {
            dot.classList.add('active');
        }
    });
    
    lines.forEach((line, index) => {
        line.classList.toggle('completed', index < step - 1);
    });
}

// Update the summary step
function updateSummary() {
    // Data disks summary
    const dataContainer = document.getElementById('summary-data-disks');
    if (dataContainer) {
        if (wizardState.selectedDataDisks.length > 0) {
            dataContainer.innerHTML = wizardState.selectedDataDisks.map(id => {
                const disk = wizardState.disks.find(d => d.id === id);
                return `
                    <div class="wizard-summary-disk">
                        ${getDiskIcon(disk?.type)} ${escapeHtml(disk?.model || id)}
                        <span class="disk-role data">${escapeHtml(disk?.size || 'N/A')}</span>
                    </div>
                `;
            }).join('');
        } else {
            dataContainer.innerHTML = '<span class="wizard-summary-empty">Ninguno seleccionado</span>';
        }
    }
    
    // Parity disk summary
    const parityContainer = document.getElementById('summary-parity-disk');
    if (parityContainer) {
        if (wizardState.selectedParityDisk) {
            const disk = wizardState.disks.find(d => d.id === wizardState.selectedParityDisk);
            parityContainer.innerHTML = `
                <div class="wizard-summary-disk">
                    ${getDiskIcon(disk?.type)} ${escapeHtml(disk?.model || wizardState.selectedParityDisk)}
                    <span class="disk-role parity">${escapeHtml(disk?.size || 'N/A')}</span>
                </div>
            `;
        } else {
            parityContainer.innerHTML = '<span class="wizard-summary-empty">Sin paridad (no protegido)</span>';
        }
    }
    
    // Cache disk summary
    const cacheContainer = document.getElementById('summary-cache-disk');
    if (cacheContainer) {
        if (wizardState.selectedCacheDisk) {
            const disk = wizardState.disks.find(d => d.id === wizardState.selectedCacheDisk);
            cacheContainer.innerHTML = `
                <div class="wizard-summary-disk">
                    ${getDiskIcon(disk?.type)} ${escapeHtml(disk?.model || wizardState.selectedCacheDisk)}
                    <span class="disk-role cache">${escapeHtml(disk?.size || 'N/A')}</span>
                </div>
            `;
        } else {
            cacheContainer.innerHTML = '<span class="wizard-summary-empty">Sin caché</span>';
        }
    }
    
    // Total capacity
    const totalContainer = document.getElementById('summary-total-capacity');
    if (totalContainer) {
        let totalBytes = 0;
        wizardState.selectedDataDisks.forEach(id => {
            const disk = wizardState.disks.find(d => d.id === id);
            if (disk) totalBytes += parseDiskSize(disk.size);
        });
        totalContainer.textContent = formatBytes(totalBytes);
    }
}

// Format bytes to human readable
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Create the storage pool
async function createStoragePool() {
    if (wizardState.isConfiguring) return;
    if (wizardState.selectedDataDisks.length === 0) {
        showNotification('Debes seleccionar al menos un disco de datos', 'error');
        return;
    }
    
    wizardState.isConfiguring = true;
    
    // Navigate to progress step
    navigateWizard(6);
    
    // Build disk selections
    const selections = [];
    
    wizardState.selectedDataDisks.forEach(id => {
        selections.push({ id, role: 'data', format: true });
    });
    
    if (wizardState.selectedParityDisk) {
        selections.push({ id: wizardState.selectedParityDisk, role: 'parity', format: true });
    }
    
    if (wizardState.selectedCacheDisk) {
        selections.push({ id: wizardState.selectedCacheDisk, role: 'cache', format: true });
    }
    
    const tasks = ['format', 'mount', 'snapraid', 'mergerfs', 'fstab', 'sync'];
    
    try {
        // Update task: format
        updateWizardTask('format', 'running', 'Formateando discos...');
        await new Promise(r => setTimeout(r, 500));
        
        // Call the API to configure the pool
        const res = await authFetch(`${API_BASE}/storage/pool/configure`, {
            method: 'POST',
            body: JSON.stringify({ disks: selections })
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Error al configurar el pool');
        }
        
        // Simulate progress through tasks
        updateWizardTask('format', 'done', 'Discos formateados');
        await new Promise(r => setTimeout(r, 300));
        
        updateWizardTask('mount', 'running', 'Montando particiones...');
        await new Promise(r => setTimeout(r, 500));
        updateWizardTask('mount', 'done', 'Particiones montadas');
        
        updateWizardTask('snapraid', 'running', 'Configurando SnapRAID...');
        await new Promise(r => setTimeout(r, 500));
        updateWizardTask('snapraid', 'done', 'SnapRAID configurado');
        
        updateWizardTask('mergerfs', 'running', 'Configurando MergerFS...');
        await new Promise(r => setTimeout(r, 500));
        updateWizardTask('mergerfs', 'done', 'MergerFS configurado');
        
        updateWizardTask('fstab', 'running', 'Actualizando /etc/fstab...');
        await new Promise(r => setTimeout(r, 500));
        updateWizardTask('fstab', 'done', '/etc/fstab actualizado');
        
        updateWizardTask('sync', 'running', 'Sincronización inicial...');
        
        // Start sync in background if parity is configured
        if (wizardState.selectedParityDisk) {
            try {
                await authFetch(`${API_BASE}/storage/snapraid/sync`, { method: 'POST' });
                // Poll for sync progress (simplified)
                await new Promise(r => setTimeout(r, 2000));
                updateWizardTask('sync', 'done', 'Sincronización completada');
            } catch (syncError) {
                console.warn('Sync skipped:', syncError);
                updateWizardTask('sync', 'done', 'Sincronización programada');
            }
        } else {
            updateWizardTask('sync', 'done', 'Sin paridad - omitido');
        }
        
        // Update state
        state.storageConfig = selections;
        
        // Wait a moment then show completion
        await new Promise(r => setTimeout(r, 1000));
        navigateWizard(7);
        
        // Celebrate!
        celebrateWithConfetti();
        showNotification('¡Pool de almacenamiento creado exitosamente!', 'success', 5000);
        
    } catch (e) {
        console.error('[Wizard] Pool creation error:', e);
        showNotification('Error: ' + e.message, 'error');
        
        // Mark current task as error
        tasks.forEach(task => {
            const item = document.querySelector(`.wizard-progress-item[data-task="${task}"]`);
            if (item) {
                const icon = item.querySelector('.wizard-progress-icon');
                if (icon && icon.classList.contains('running')) {
                    updateWizardTask(task, 'error', 'Error: ' + e.message);
                }
            }
        });
        
        wizardState.isConfiguring = false;
    }
}

// Update a task in the progress list
function updateWizardTask(taskName, status, message) {
    const item = document.querySelector(`.wizard-progress-item[data-task="${taskName}"]`);
    if (!item) return;
    
    const icon = item.querySelector('.wizard-progress-icon');
    const statusEl = item.querySelector('.wizard-progress-status');
    
    // Update icon
    icon.classList.remove('pending', 'running', 'done', 'error');
    icon.classList.add(status);
    
    switch (status) {
        case 'pending':
            icon.textContent = '⏳';
            break;
        case 'running':
            icon.textContent = '🔄';
            break;
        case 'done':
            icon.textContent = '✅';
            break;
        case 'error':
            icon.textContent = '❌';
            break;
    }
    
    // Update status text
    if (statusEl && message) {
        statusEl.textContent = message;
    }
}

// Legacy function for compatibility
function updateSummaryLegacy() {
    const roles = { data: 0, parity: 0, cache: 0 };
    document.querySelectorAll('.role-btn.active').forEach(btn => {
        const role = btn.dataset.role;
        if (role !== 'none') roles[role]++;
    });
    const dataCount = document.getElementById('data-count');
    const parityCount = document.getElementById('parity-count');
    const cacheCount = document.getElementById('cache-count');
    if (dataCount) dataCount.textContent = roles.data;
    if (parityCount) parityCount.textContent = roles.parity;
    if (cacheCount) cacheCount.textContent = roles.cache;
}

// Storage Progress Modal Functions
const progressModal = document.getElementById('storage-progress-modal');
const progressSteps = {
    format: document.getElementById('step-format'),
    mount: document.getElementById('step-mount'),
    snapraid: document.getElementById('step-snapraid'),
    mergerfs: document.getElementById('step-mergerfs'),
    fstab: document.getElementById('step-fstab'),
    sync: document.getElementById('step-sync')
};

function showProgressModal() {
    if (progressModal) {
        progressModal.classList.add('active');
        // Reset all steps
        Object.values(progressSteps).forEach(step => {
            if (step) {
                step.classList.remove('active', 'completed', 'error');
                const icon = step.querySelector('.step-icon');
                if (icon) icon.textContent = '⏳';
            }
        });
    }
}

function hideProgressModal() {
    if (progressModal) progressModal.classList.remove('active');
}

function updateProgressStep(stepId, status) {
    const step = progressSteps[stepId];
    if (!step) return;

    const icon = step.querySelector('.step-icon');

    step.classList.remove('active', 'completed', 'error');

    if (status === 'active') {
        step.classList.add('active');
        if (icon) icon.textContent = '';
    } else if (status === 'completed') {
        step.classList.add('completed');
        if (icon) icon.textContent = '';
    } else if (status === 'error') {
        step.classList.add('error');
        if (icon) icon.textContent = '';
    }
}

function updateSyncProgress(percent, statusText) {
    const fill = document.getElementById('sync-progress-fill');
    const status = document.getElementById('sync-status');
    const percentValue = Math.min(100, Math.max(0, percent || 0));

    if (fill) {
        fill.style.width = `${percentValue}%`;
    }
    if (status) {
        if (statusText && statusText.length > 0) {
            status.textContent = `${percentValue}% - ${statusText}`;
        } else {
            status.textContent = `${percentValue}% complete`;
        }
    }
}

async function pollSyncProgress() {
    return new Promise((resolve) => {
        // Poll more frequently at start for better responsiveness
        let pollCount = 0;

        const pollInterval = setInterval(async () => {
            pollCount++;
            try {
                const res = await fetch(`${API_BASE}/storage/snapraid/sync/progress`);
                const data = await res.json();

                // Always update the progress display
                updateSyncProgress(data.progress || 0, data.status || 'Sincronizando...');

                if (!data.running) {
                    clearInterval(pollInterval);
                    if (data.error) {
                        updateProgressStep('sync', 'error');
                        resolve({ success: false, error: data.error });
                    } else {
                        // Ensure we show 100% at completion
                        updateSyncProgress(100, data.status || 'Sync completed');
                        updateProgressStep('sync', 'completed');
                        resolve({ success: true });
                    }
                }

                // Safety timeout after 5 minutes of polling
                if (pollCount > 150) {
                    clearInterval(pollInterval);
                    updateProgressStep('sync', 'completed');
                    updateSyncProgress(100, 'Tiempo de sincronización agotado - puede seguir ejecutándose en segundo plano');
                    resolve({ success: true });
                }
            } catch (e) {
                // Don't fail immediately on network errors, retry a few times
                if (pollCount > 5) {
                    clearInterval(pollInterval);
                    resolve({ success: false, error: e.message });
                }
            }
        }, 1000); // Poll every second for better UI responsiveness
    });
}

const saveStorageBtn = document.getElementById('save-storage-btn');
if (saveStorageBtn) {
    saveStorageBtn.addEventListener('click', async () => {
        const selections = [];
        document.querySelectorAll('.role-selector').forEach(sel => {
            const diskId = sel.dataset.disk;
            const activeBtn = sel.querySelector('.role-btn.active');
            const role = activeBtn ? activeBtn.dataset.role : 'none';
            if (role !== 'none') {
                selections.push({
                    id: diskId,
                    role,
                    format: true
                });
            }
        });

        const dataDisks = selections.filter(s => s.role === 'data');
        const parityDisks = selections.filter(s => s.role === 'parity');

        if (dataDisks.length === 0) {
            alert('Please assign at least one disk as "Data" to create a pool.');
            return;
        }

        // Parity is optional, but if selected, must be >= largest data disk
        if (parityDisks.length > 0) {
            // Helper function to parse disk size to bytes
            const parseSize = (sizeStr) => {
                if (!sizeStr) return 0;
                const match = sizeStr.match(/^([\d.]+)\s*(TB|GB|MB|KB|B)?$/i);
                if (!match) return 0;
                const num = parseFloat(match[1]);
                const unit = (match[2] || 'B').toUpperCase();
                const multipliers = { B: 1, KB: 1024, MB: 1024**2, GB: 1024**3, TB: 1024**4 };
                return num * (multipliers[unit] || 1);
            };

            // Get disk sizes from state
            const getDiskSize = (diskId) => {
                const disk = state.disks.find(d => d.id === diskId);
                return disk ? parseSize(disk.size) : 0;
            };

            const largestDataSize = Math.max(...dataDisks.map(d => getDiskSize(d.id)));
            const smallestParitySize = Math.min(...parityDisks.map(d => getDiskSize(d.id)));

            if (smallestParitySize < largestDataSize) {
                alert('El disco de paridad debe ser igual o mayor que el disco de datos más grande.\n\nParity disk must be equal or larger than the largest data disk.');
                return;
            }
        }

        const diskList = selections.map(s => `${s.id} (${s.role})`).join(', ');
        const confirmed = await showConfirmModal('Formatear discos', `Se formatearán: ${diskList}\n\n¡Todos los datos serán BORRADOS!`);
        if (!confirmed) return;

        saveStorageBtn.disabled = true;
        showProgressModal();

        try {
            // Step 1: Format
            updateProgressStep('format', 'active');
            await new Promise(r => setTimeout(r, 500));

            // Call configure endpoint
            const res = await authFetch(`${API_BASE}/storage/pool/configure`, {
                method: 'POST',
                body: JSON.stringify({ disks: selections })
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Configuration failed');
            }

            // Update steps based on results
            updateProgressStep('format', 'completed');
            await new Promise(r => setTimeout(r, 300));

            updateProgressStep('mount', 'active');
            await new Promise(r => setTimeout(r, 500));
            updateProgressStep('mount', 'completed');

            updateProgressStep('snapraid', 'active');
            await new Promise(r => setTimeout(r, 500));
            updateProgressStep('snapraid', 'completed');

            updateProgressStep('mergerfs', 'active');
            await new Promise(r => setTimeout(r, 500));
            updateProgressStep('mergerfs', 'completed');

            updateProgressStep('fstab', 'active');
            await new Promise(r => setTimeout(r, 500));
            updateProgressStep('fstab', 'completed');

            // Step 6: SnapRAID initial sync
            updateProgressStep('sync', 'active');
            updateSyncProgress(0, 'Starting initial sync...');

            // Start sync in background
            try {
                await authFetch(`${API_BASE}/storage/snapraid/sync`, { method: 'POST' });
                // Poll for progress
                const syncResult = await pollSyncProgress();

                if (!syncResult.success) {
                    console.warn('Sync warning:', syncResult.error);
                    // Don't fail the whole process, sync can be run later
                    updateProgressStep('sync', 'completed');
                    updateSyncProgress(100, 'Sync will complete in background');
                }
            } catch (syncError) {
                console.warn('Sync skipped:', syncError);
                updateProgressStep('sync', 'completed');
                updateSyncProgress(100, 'Sync scheduled for later');
            }

            state.storageConfig = selections;

            // Update progress message
            const progressMsg = document.getElementById('progress-message');
            if (progressMsg) {
                // SECURITY: Escape poolMount to prevent XSS
                progressMsg.innerHTML = `✅ <strong>Storage Pool Created!</strong><br>Pool mounted at: ${escapeHtml(data.poolMount)}`;
            }

            // Show continue button
            const progressFooter = document.querySelector('.progress-footer');
            if (progressFooter) {
                progressFooter.classList.add('complete');
                const continueBtn = document.createElement('button');
                continueBtn.className = 'btn-primary';
                continueBtn.textContent = t('progress.continueToDashboard', 'Continuar al Panel');
                continueBtn.onclick = () => {
                    hideProgressModal();
                    if (state.sessionId) {
                        state.isAuthenticated = true;
                        switchView('dashboard');
                    } else {
                        switchView('login');
                    }
                };
                progressFooter.appendChild(continueBtn);
            }

        } catch (e) {
            console.error('Storage config error:', e);
            const progressMsg = document.getElementById('progress-message');
            if (progressMsg) {
                progressMsg.innerHTML = `❌ <strong>${t('progress.configurationFailed', 'Configuración Fallida')}:</strong><br>${escapeHtml(e.message)}`;
            }

            // Add retry button
            const progressFooter = document.querySelector('.progress-footer');
            if (progressFooter) {
                progressFooter.classList.add('complete');
                const retryBtn = document.createElement('button');
                retryBtn.className = 'btn-primary';
                retryBtn.textContent = t('progress.closeAndRetry', 'Cerrar y Reintentar');
                retryBtn.onclick = () => {
                    hideProgressModal();
                    saveStorageBtn.disabled = false;
                };
                progressFooter.appendChild(retryBtn);
            }
        }
    });
}

// Authentication
if (loginForm) {
    // Track pending 2FA state
    let pending2FAToken = null;

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        const totpCode = document.getElementById('login-totp-code')?.value.trim();
        const btn = e.target.querySelector('button[type="submit"]');
        const totpGroup = document.getElementById('totp-input-group');

        btn.textContent = t('auth.hardwareAuth', 'Autenticando...');
        btn.disabled = true;

        try {
            // If we have a pending 2FA token, complete 2FA verification
            if (pending2FAToken && totpCode) {
                const res = await fetch(`${API_BASE}/login/2fa`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pendingToken: pending2FAToken, totpCode })
                });
                const data = await res.json();

                if (!res.ok || !data.success) {
                    alert(data.message || 'Código 2FA incorrecto');
                    btn.textContent = 'Verificar 2FA';
                    btn.disabled = false;
                    return;
                }

                // 2FA verified - save session and proceed
                saveSession(data.sessionId, data.csrfToken);
                state.isAuthenticated = true;
                state.user = data.user;
                pending2FAToken = null;
                if (totpGroup) totpGroup.style.display = 'none';
                switchView('dashboard');
                return;
            }

            // Regular login
            const res = await fetch(`${API_BASE}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                alert(data.message || t('common.error', 'Error de seguridad: Credenciales rechazadas.'));
                btn.textContent = t('auth.accessGateway', 'Acceder al Sistema');
                btn.disabled = false;
                return;
            }

            // Check if 2FA is required
            if (data.requires2FA) {
                pending2FAToken = data.pendingToken;
                if (totpGroup) {
                    totpGroup.style.display = 'block';
                    document.getElementById('login-totp-code').focus();
                }
                btn.textContent = 'Verificar 2FA';
                btn.disabled = false;
                return;
            }

            // No 2FA - save session and proceed
            if (data.sessionId) {
                saveSession(data.sessionId, data.csrfToken);
            }

            state.isAuthenticated = true;
            state.user = data.user;
            switchView('dashboard');
        } catch (e) {
            console.error('Login error:', e);
            alert(t('common.error', 'Servidor de seguridad no disponible o conexión interrumpida'));
            btn.textContent = t('auth.accessGateway', 'Acceder al Sistema');
            btn.disabled = false;
        }
    });
}

// Navigation - supports multiple nav-links groups (Synology-style layout)
const allNavLinks = document.querySelectorAll('.nav-links li[data-view]');
allNavLinks.forEach(link => {
    link.addEventListener('click', () => {
        // Remove active from ALL nav items across all groups
        allNavLinks.forEach(l => l.classList.remove('active'));
        link.classList.add('active');
        const view = link.dataset.view;

        // Update URL
        const path = view === 'dashboard' ? '/' : '/' + view;
        navigateTo(path);

        viewTitle.textContent = viewsMap[view] || 'HomePiNAS';
        renderContent(view);
        updateHeaderIPVisibility();
    });
});

// Sidebar Toggle (Synology-style)
const sidebarToggle = document.getElementById('sidebar-toggle');
const mainSidebar = document.getElementById('main-sidebar');
const mainContent = document.getElementById('main-content');

if (sidebarToggle && mainSidebar) {
    sidebarToggle.addEventListener('click', () => {
        mainSidebar.classList.toggle('collapsed');
        if (mainContent) mainContent.classList.toggle('sidebar-collapsed');
        // Save preference
        localStorage.setItem('sidebarCollapsed', mainSidebar.classList.contains('collapsed'));
    });
    
    // Restore preference
    if (localStorage.getItem('sidebarCollapsed') === 'true') {
        mainSidebar.classList.add('collapsed');
        if (mainContent) mainContent.classList.add('sidebar-collapsed');
    }
}

// Header theme toggle
const headerThemeToggle = document.getElementById('header-theme-toggle');
if (headerThemeToggle) {
    headerThemeToggle.addEventListener('click', () => {
        const html = document.documentElement;
        const currentTheme = html.getAttribute('data-theme') || 'light';
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        html.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        headerThemeToggle.textContent = newTheme === 'dark' ? '☀️' : '🌙';
    });
    
    // Set initial icon
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    headerThemeToggle.textContent = currentTheme === 'dark' ? '☀️' : '🌙';
}

// Update user avatar letter
function updateUserAvatar() {
    const avatarEl = document.getElementById('user-avatar-letter');
    const usernameEl = document.getElementById('username-display');
    if (avatarEl && state.username) {
        avatarEl.textContent = state.username.charAt(0).toUpperCase();
    }
    if (usernameEl && state.username) {
        usernameEl.textContent = state.username;
    }
}

async function renderContent(view) {
    state.currentView = view;
    dashboardContent.innerHTML = '';
    
    // Clear storage polling when leaving storage view
    if (state.pollingIntervals.storage) {
        clearInterval(state.pollingIntervals.storage);
        state.pollingIntervals.storage = null;
    }
    
    if (view === 'dashboard') await renderDashboard();
    else if (view === 'docker') await renderDockerManager();
    else if (view === 'storage') await renderStorageDashboard();
    else if (view === 'files') await renderFilesView();
    else if (view === 'terminal') await renderTerminalView();
    else if (view === 'network') {
        await renderNetworkManager();
        // Append Samba + DDNS sections after network interfaces
        await renderSambaSection(dashboardContent);
        await renderDDNSSection(dashboardContent);
    }
    else if (view === 'backup') await renderBackupView();
    else if (view === 'active-backup') await renderActiveBackupView();
    else if (view === 'active-directory') await renderActiveDirectoryView();
    else if (view === 'cloud-sync') await renderCloudSyncView();
    else if (view === 'cloud-backup') await renderCloudBackupView();
    else if (view === 'homestore') await renderHomeStoreView();
    else if (view === 'logs') await renderLogsView();
    else if (view === 'users') await renderUsersView();
    else if (view === 'system') {
        await renderSystemView();
        // Append UPS + Notifications after system view
        setTimeout(async () => {
            await renderUPSSection(dashboardContent);
            await renderNotificationsSection(dashboardContent);
        }, 100);
    }
}

// Real-Time Dashboard
async function renderDashboard() {
    const stats = state.globalStats;
    const cpuTemp = Number(stats.cpuTemp) || 0;
    const cpuLoad = Number(stats.cpuLoad) || 0;
    const ramUsedPercent = Number(stats.ramUsedPercent) || 0;
    const publicIP = escapeHtml(state.publicIP);
    
    // Fetch real LAN IP if not already loaded
    if (!state.network.interfaces || state.network.interfaces.length === 0 || state.network.interfaces[0]?.ip === '192.168.1.100') {
        try {
            const res = await fetch(`${API_BASE}/network/interfaces`);
            if (res.ok) {
                state.network.interfaces = await res.json();
            }
        } catch (e) {
            console.warn('Could not fetch network interfaces:', e);
        }
    }
    
    const lanIP = escapeHtml(state.network.interfaces[0]?.ip || 'No disponible');
    const ddnsCount = (state.network.ddns || []).filter(d => d.enabled).length;

    // CPU Model - save once and reuse (CPU doesn't change)
    if (stats.cpuModel && stats.cpuModel !== 'Unknown CPU') {
        localStorage.setItem('cpuModel', stats.cpuModel);
    }
    const cpuModel = localStorage.getItem('cpuModel') || stats.cpuModel || t('common.unknown', 'CPU Desconocido');

    // Format uptime intelligently
    const uptimeSeconds = Number(stats.uptime) || 0;
    const days = Math.floor(uptimeSeconds / 86400);
    const hours = Math.floor((uptimeSeconds % 86400) / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    let uptimeStr;
    if (days > 0) {
        uptimeStr = `${days} día${days > 1 ? 's' : ''} ${hours}h`;
    } else if (hours > 0) {
        uptimeStr = `${hours} hora${hours > 1 ? 's' : ''} ${minutes}m`;
    } else {
        uptimeStr = `${minutes} minuto${minutes !== 1 ? 's' : ''}`;
    }

    // Generate core loads HTML (compact version)
    let coreLoadsHtml = '';
    if (stats.coreLoads && stats.coreLoads.length > 0) {
        coreLoadsHtml = stats.coreLoads.map((core, i) => `
            <div class="core-bar-mini">
                <span>C${i}</span>
                <div class="core-progress-mini">
                    <div class="core-fill-mini" style="width: ${core.load}%; background: ${core.load > 80 ? '#ef4444' : core.load > 50 ? '#f59e0b' : '#10b981'}"></div>
                </div>
                <span>${core.load}%</span>
            </div>
        `).join('');
    }

    // Fetch fan mode
    let fanMode = 'balanced';
    try {
        const fanModeRes = await authFetch(`${API_BASE}/system/fan/mode`);
        if (fanModeRes.ok) {
            const fanModeData = await fanModeRes.json();
            fanMode = fanModeData.mode || 'balanced';
        }
    } catch (e) {
        console.error('Error fetching fan mode:', e);
    }

    // Generate fan mode selector HTML (only mode buttons, no RPM display)
    const fansFullHtml = `
        <div class="fan-mode-selector">
            <button class="fan-mode-btn ${fanMode === 'silent' ? 'active' : ''}" data-mode="silent">
                <span class="mode-icon">🤫</span>
                <span class="mode-name">Silent</span>
            </button>
            <button class="fan-mode-btn ${fanMode === 'balanced' ? 'active' : ''}" data-mode="balanced">
                <span class="mode-icon">⚖️</span>
                <span class="mode-name">Balanced</span>
            </button>
            <button class="fan-mode-btn ${fanMode === 'performance' ? 'active' : ''}" data-mode="performance">
                <span class="mode-icon">🚀</span>
                <span class="mode-name">Performance</span>
            </button>
        </div>
    `;

    // Fetch disks for storage section
    let disksHtml = '';
    try {
        const disksRes = await fetch(`${API_BASE}/system/disks`);
        if (disksRes.ok) {
            const disks = await disksRes.json();

            // Group disks by role
            const disksByRole = { data: [], parity: [], cache: [], none: [] };
            disks.forEach(disk => {
                const config = state.storageConfig.find(s => s.id === disk.id);
                const role = config ? config.role : 'none';
                if (disksByRole[role]) {
                    disksByRole[role].push({ ...disk, role });
                } else {
                    disksByRole.none.push({ ...disk, role: 'none' });
                }
            });

            // Generate HTML for each role section
            const roleLabels = { data: '💾 ' + t('storage.data', 'Datos'), parity: '🛡️ ' + t('storage.parity', 'Paridad'), cache: '⚡ ' + t('storage.cache', 'Caché'), none: '📦 ' + t('storage.none', 'Sin asignar') };
            const roleColors = { data: '#6366f1', parity: '#f59e0b', cache: '#10b981', none: '#64748b' };

            for (const [role, roleDisks] of Object.entries(disksByRole)) {
                if (roleDisks.length > 0) {
                    disksHtml += `
                        <div class="disk-role-section">
                            <div class="disk-role-header" style="border-left: 3px solid ${roleColors[role]}">
                                <span>${roleLabels[role]}</span>
                                <span class="disk-count">${roleDisks.length} ${t('wizard.disksDetected', 'disco(s)')}</span>
                            </div>
                            <div class="disk-role-items">
                                ${roleDisks.map(disk => `
                                    <div class="disk-item-compact">
                                        <div class="disk-item-info">
                                            <span class="disk-name">${escapeHtml(disk.model || t('common.unknown', 'Desconocido'))}</span>
                                            <span class="disk-details">${escapeHtml(disk.id)} • ${escapeHtml(disk.size)} • ${escapeHtml(disk.type)}</span>
                                        </div>
                                        <div class="disk-item-temp ${disk.temp > 45 ? 'hot' : disk.temp > 38 ? 'warm' : 'cool'}">
                                            ${disk.temp || 0}°C
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `;
                }
            }
        }
    } catch (e) {
        console.error('Error fetching disks:', e);
        disksHtml = `<div class="no-disks">${t('storage.unableToLoad', 'No se pudo cargar la información de discos')}</div>`;
    }

    dashboardContent.innerHTML = `
        <div class="glass-card overview-card" style="grid-column: 1 / -1;">
            <div class="overview-header">
                <h3>${t('dashboard.systemOverview', 'Resumen del Sistema')}</h3>
                <div class="system-info-badge">
                    <span>${escapeHtml(stats.hostname || 'HomePiNAS')}</span>
                    <span class="separator">|</span>
                    <span>${escapeHtml(stats.distro || 'Linux')}</span>
                    <span class="separator">|</span>
                    <span>${t('dashboard.uptime', 'Tiempo Activo')}: ${uptimeStr}</span>
                </div>
            </div>
        </div>

        <div class="dashboard-grid-4">
            <div class="glass-card card-compact">
                <h3>🖥️ ${t('dashboard.cpu', 'CPU')}</h3>
                <div class="cpu-model-compact">${escapeHtml(cpuModel)}</div>
                <div class="cpu-specs-row">
                    <span>${stats.cpuPhysicalCores || 0} ${t('dashboard.cores', 'Núcleos')}</span>
                    <span>${stats.cpuCores || 0} ${t('dashboard.threads', 'Hilos')}</span>
                    <span>${stats.cpuSpeed || 0} GHz</span>
                    <span class="temp-badge ${cpuTemp > 70 ? 'hot' : cpuTemp > 55 ? 'warm' : 'cool'}">${cpuTemp}°C</span>
                </div>
                <div class="load-section">
                    <div class="load-header">
                        <span>${t('dashboard.load', 'Carga')}</span>
                        <span style="color: ${cpuLoad > 80 ? '#ef4444' : cpuLoad > 50 ? '#f59e0b' : '#10b981'}">${cpuLoad}%</span>
                    </div>
                    <div class="progress-bar-mini">
                        <div class="progress-fill-mini" style="width: ${Math.min(cpuLoad, 100)}%; background: ${cpuLoad > 80 ? '#ef4444' : cpuLoad > 50 ? '#f59e0b' : 'var(--primary)'}"></div>
                    </div>
                </div>
                ${coreLoadsHtml ? `<div class="core-loads-mini">${coreLoadsHtml}</div>` : ''}
            </div>

            <div class="glass-card card-compact">
                <h3>💾 ${t('dashboard.memory', 'Memoria')}</h3>
                <div class="memory-compact">
                    <div class="memory-circle-small">
                        <svg viewBox="0 0 36 36">
                            <path class="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>
                            <path class="circle-fill" stroke="${ramUsedPercent > 80 ? '#ef4444' : ramUsedPercent > 60 ? '#f59e0b' : '#10b981'}"
                                  stroke-dasharray="${ramUsedPercent}, 100"
                                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>
                        </svg>
                        <span class="memory-percent-small">${ramUsedPercent}%</span>
                    </div>
                    <div class="memory-details-compact">
                        <div class="mem-row"><span>${t('dashboard.used', 'Usado')}</span><span>${stats.ramUsed || 0} GB</span></div>
                        <div class="mem-row"><span>${t('dashboard.free', 'Libre')}</span><span>${stats.ramFree || 0} GB</span></div>
                        <div class="mem-row"><span>${t('dashboard.total', 'Total')}</span><span>${stats.ramTotal || 0} GB</span></div>
                        ${stats.swapTotal && parseFloat(stats.swapTotal) > 0 ? `<div class="mem-row swap"><span>${t('dashboard.swap', 'Swap')}</span><span>${stats.swapUsed || 0}/${stats.swapTotal || 0} GB</span></div>` : ''}
                    </div>
                </div>
            </div>

            <div class="glass-card card-compact">
                <h3>🌀 ${t('dashboard.fans', 'Ventiladores')}</h3>
                <div class="fans-compact">
                    ${fansFullHtml}
                </div>
            </div>

            <div class="glass-card card-compact">
                <h3>🌐 ${t('dashboard.network', 'Red')}</h3>
                <div class="network-compact">
                    <div class="net-row"><span>${t('dashboard.publicIP', 'IP Pública')}</span><span class="ip-value">${publicIP}</span></div>
                    <div class="net-row"><span>${t('dashboard.lanIP', 'IP Local')}</span><span>${lanIP}</span></div>
                    <div class="net-row"><span>${t('dashboard.ddns', 'DDNS')}</span><span>${ddnsCount} ${t('dashboard.services', 'Servicio(s)')}</span></div>
                </div>
            </div>
        </div>

        <div class="glass-card storage-overview" style="grid-column: 1 / -1;">
            <h3>💿 ${t('storage.connectedDisks', 'Discos Conectados')}</h3>
            <div class="disks-by-role">
                ${disksHtml || `<div class="no-disks">${t('storage.noDisksDetected', 'No se detectaron discos')}</div>`}
            </div>
        </div>
    `;

    // Add fan mode button event listeners
    dashboardContent.querySelectorAll('.fan-mode-btn[data-mode]').forEach(btn => {
        btn.addEventListener('click', () => setFanMode(btn.dataset.mode));
    });
}

// Fan speed control - update percentage display while dragging
function updateFanPercent(fanId, value) {
    const percentEl = document.getElementById(`fan-percent-${fanId}`);
    if (percentEl) {
        percentEl.textContent = `${value}%`;
    }
}

// Fan speed control - apply speed when released
async function setFanSpeed(fanId, speed) {
    const percentEl = document.getElementById(`fan-percent-${fanId}`);
    if (percentEl) {
        percentEl.textContent = `${speed}% ⏳`;
    }

    try {
        const res = await authFetch(`${API_BASE}/system/fan`, {
            method: 'POST',
            body: JSON.stringify({ fanId, speed: parseInt(speed) })
        });
        const data = await res.json();

        if (percentEl) {
            if (res.ok) {
                percentEl.textContent = `${speed}% ✓`;
                setTimeout(() => {
                    percentEl.textContent = `${speed}%`;
                }, 1500);
            } else {
                percentEl.textContent = `${speed}% ✗`;
                console.error('Fan control error:', data.error);
            }
        }
    } catch (e) {
        console.error('Fan control error:', e);
        if (percentEl) {
            percentEl.textContent = `${speed}% ✗`;
        }
    }
}

window.updateFanPercent = updateFanPercent;
window.setFanSpeed = setFanSpeed;

// Fan mode control
async function setFanMode(mode) {
    // Update UI immediately
    document.querySelectorAll('.fan-mode-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.mode === mode) {
            btn.classList.add('active');
            btn.innerHTML = `<span class="mode-icon">${btn.querySelector('.mode-icon').textContent}</span><span class="mode-name">⏳</span>`;
        }
    });

    try {
        const res = await authFetch(`${API_BASE}/system/fan/mode`, {
            method: 'POST',
            body: JSON.stringify({ mode })
        });
        const data = await res.json();

        if (res.ok) {
            // Update button to show success
            document.querySelectorAll('.fan-mode-btn').forEach(btn => {
                if (btn.dataset.mode === mode) {
                    const modeNames = { silent: 'Silent', balanced: 'Balanced', performance: 'Performance' };
                    btn.innerHTML = `<span class="mode-icon">${btn.querySelector('.mode-icon').textContent}</span><span class="mode-name">${modeNames[mode]} ✓</span>`;
                    setTimeout(() => {
                        btn.innerHTML = `<span class="mode-icon">${mode === 'silent' ? '🤫' : mode === 'balanced' ? '⚖️' : '🚀'}</span><span class="mode-name">${modeNames[mode]}</span>`;
                    }, 1500);
                }
            });
        } else {
            console.error('Fan mode error:', data.error);
            // Revert UI on error
            renderDashboard();
        }
    } catch (e) {
        console.error('Fan mode error:', e);
        renderDashboard();
    }
}

window.setFanMode = setFanMode;

// Real Storage Telemetry
async function renderStorageDashboard() {
    // Clear content to prevent duplication on refresh
    dashboardContent.innerHTML = '';
    
    try {
        // Fetch disks and pool status
        const [disksRes, poolRes] = await Promise.all([
            authFetch(`${API_BASE}/system/disks`),
            authFetch(`${API_BASE}/storage/pool/status`)
        ]);
        
        if (disksRes.ok) state.disks = await disksRes.json();
        let poolStatus = {};
        if (poolRes.ok) poolStatus = await poolRes.json();

        // Storage Array Header (Cockpit style)
        const arrayCard = document.createElement('div');
        arrayCard.className = 'glass-card storage-array-view';
        arrayCard.style.gridColumn = '1 / -1';

        const arrayHeader = document.createElement('div');
        arrayHeader.className = 'storage-array-header';
        arrayHeader.innerHTML = `
            <h3>💾 ${t('storage.storageArray', 'Array de Almacenamiento')}</h3>
            <div class="storage-total-stats">
                <div class="storage-total-stat">
                    <span class="label">${t('storage.total', 'Total')}</span>
                    <span class="value">${escapeHtml(poolStatus.poolSize || 'N/A')}</span>
                </div>
                <div class="storage-total-stat">
                    <span class="label">${t('storage.used', 'Usado')}</span>
                    <span class="value">${escapeHtml(poolStatus.poolUsed || 'N/A')}</span>
                </div>
                <div class="storage-total-stat">
                    <span class="label">${t('storage.available', 'Disponible')}</span>
                    <span class="value" style="color: #10b981;">${escapeHtml(poolStatus.poolFree || 'N/A')}</span>
                </div>
            </div>
        `;
        arrayCard.appendChild(arrayHeader);

        // Mount points grid
        const mountsGrid = document.createElement('div');
        mountsGrid.className = 'storage-array-grid';

        // Pool mount (if configured)
        if (poolStatus.configured && poolStatus.running) {
            // Use backend-calculated percentage (avoids GB/TB unit mismatch)
            const poolPercent = poolStatus.usedPercent || 0;
            const poolFillClass = poolPercent > 90 ? 'high' : poolPercent > 70 ? 'medium' : 'low';

            const poolRow = document.createElement('div');
            poolRow.className = 'storage-mount-row pool';
            poolRow.innerHTML = `
                <div class="mount-info">
                    <span class="mount-path">${escapeHtml(poolStatus.poolMount || '/mnt/storage')}</span>
                    <span class="mount-device">MergerFS Pool</span>
                </div>
                <div class="mount-bar-container">
                    <div class="mount-bar">
                        <div class="mount-bar-fill ${poolFillClass}" style="width: ${poolPercent}%"></div>
                    </div>
                    <div class="mount-bar-text">
                        <span>${poolPercent}% ${t('storage.used', 'usado')}</span>
                        <span>${escapeHtml(poolStatus.poolFree || 'N/A')} ${t('storage.available', 'disponible')}</span>
                    </div>
                </div>
                <div class="mount-size">
                    <span class="available">${escapeHtml(poolStatus.poolFree || 'N/A')}</span>
                    <span class="total">de ${escapeHtml(poolStatus.poolSize || 'N/A')}</span>
                </div>
                <div class="mount-type">
                    <span class="mount-type-badge mergerfs">MergerFS</span>
                </div>
            `;
            mountsGrid.appendChild(poolRow);
        }

        // Individual disk mounts
        state.disks.forEach((disk, index) => {
            const config = state.storageConfig.find(s => s.id === disk.id);
            const role = config ? config.role : 'none';
            if (role === 'none') return;

            const usage = Math.min(Math.max(Number(disk.usage) || 0, 0), 100);
            const fillClass = usage > 90 ? 'high' : usage > 70 ? 'medium' : 'low';
            const mountPoint = role === 'data' ? `/mnt/disks/disk${index + 1}` : 
                              role === 'parity' ? `/mnt/parity${index + 1}` :
                              `/mnt/disks/cache${index + 1}`;

            const diskRow = document.createElement('div');
            diskRow.className = `storage-mount-row ${role}`;
            diskRow.innerHTML = `
                <div class="mount-info">
                    <span class="mount-path">${escapeHtml(mountPoint)}</span>
                    <span class="mount-device">/dev/${escapeHtml(disk.id)} • ${escapeHtml(disk.model || t('common.unknown', 'Desconocido'))}</span>
                </div>
                <div class="mount-bar-container">
                    <div class="mount-bar">
                        <div class="mount-bar-fill ${fillClass}" style="width: ${usage}%"></div>
                    </div>
                    <div class="mount-bar-text">
                        <span>${usage}% ${t('storage.used', 'usado')}</span>
                        <span>${escapeHtml(disk.size || 'N/A')}</span>
                    </div>
                </div>
                <div class="mount-size">
                    <span class="available">${escapeHtml(disk.size || 'N/A')}</span>
                    <span class="total">${role.toUpperCase()}</span>
                </div>
                <div class="mount-type">
                    <span class="mount-type-badge ext4">ext4</span>
                </div>
            `;
            mountsGrid.appendChild(diskRow);
        });

        arrayCard.appendChild(mountsGrid);
        dashboardContent.appendChild(arrayCard);

        // Disk cards grid (detailed view)
        const grid = document.createElement('div');
        grid.className = 'telemetry-grid';
        grid.style.marginTop = '20px';

        state.disks.forEach(disk => {
            const config = state.storageConfig.find(s => s.id === disk.id);
            const role = config ? config.role : 'none';
            const temp = Number(disk.temp) || 0;
            const tempClass = temp > 45 ? 'hot' : (temp > 38 ? 'warm' : 'cool');
            const usage = Math.min(Math.max(Number(disk.usage) || 0, 0), 100);

            const card = document.createElement('div');
            card.className = 'glass-card disk-card-advanced';

            // Create header
            const header = document.createElement('div');
            header.className = 'disk-header-adv';

            const headerInfo = document.createElement('div');
            const h4 = document.createElement('h4');
            h4.textContent = disk.model || t('common.unknown', 'Desconocido');
            const infoSpan = document.createElement('span');
            infoSpan.style.cssText = 'font-size: 0.8rem; color: var(--text-dim); display: block;';
            infoSpan.textContent = `${disk.id || 'N/A'} • ${disk.type || t('common.unknown', 'Desconocido')} • ${disk.size || 'N/A'}`;
            const serialSpan2 = document.createElement('span');
            serialSpan2.style.cssText = 'font-size: 0.75rem; color: var(--primary); display: block; margin-top: 4px; font-family: monospace;';
            serialSpan2.textContent = `SN: ${disk.serial || 'N/A'}`;
            headerInfo.appendChild(h4);
            headerInfo.appendChild(infoSpan);
            headerInfo.appendChild(serialSpan2);

            const roleBadge = document.createElement('span');
            roleBadge.className = `role-badge ${escapeHtml(role)}`;
            const roleTranslations = { data: t('storage.data', 'Data'), parity: t('storage.parity', 'Parity'), cache: t('storage.cache', 'Cache'), none: t('storage.none', 'None') };
            roleBadge.textContent = roleTranslations[role] || role;

            header.appendChild(headerInfo);
            header.appendChild(roleBadge);

            // Create progress container
            const progressContainer = document.createElement('div');
            progressContainer.className = 'disk-progress-container';
            progressContainer.innerHTML = `
                <div class="telemetry-stats-row"><span>${t('storage.healthStatus', 'Estado de Salud')}</span><span style="color:#10b981">${t('storage.optimal', 'Óptimo')}</span></div>
                <div class="disk-usage-bar"><div class="disk-usage-fill" style="width: ${usage}%; background: ${getRoleColor(role)}"></div></div>
            `;

            // Create telemetry row (only temperature, SN is in header)
            const telemetryRow = document.createElement('div');
            telemetryRow.className = 'telemetry-stats-row';

            const tempIndicator = document.createElement('div');
            tempIndicator.className = `temp-indicator ${tempClass}`;
            tempIndicator.innerHTML = `<span>🌡️</span><span>${temp}°C</span>`;

            telemetryRow.appendChild(tempIndicator);

            // Add configure button for unconfigured disks
            if (role === 'none') {
                const configBtn = document.createElement('button');
                configBtn.style.cssText = `
                    margin-left: auto;
                    padding: 6px 12px;
                    background: transparent;
                    border: 1px solid var(--primary, #0078d4);
                    color: var(--primary, #0078d4);
                    border-radius: 6px;
                    font-size: 12px;
                    cursor: pointer;
                    transition: all 0.2s;
                    white-space: nowrap;
                `;
                configBtn.textContent = '⚙️ Configurar';
                configBtn.addEventListener('mouseenter', () => {
                    configBtn.style.background = 'var(--primary, #0078d4)';
                    configBtn.style.color = '#fff';
                });
                configBtn.addEventListener('mouseleave', () => {
                    configBtn.style.background = 'transparent';
                    configBtn.style.color = 'var(--primary, #0078d4)';
                });
                configBtn.addEventListener('click', () => {
                    // Normalize disk object for showDiskActionModal (same format as /disks/detect)
                    detectedNewDisks = [{
                        id: disk.id,
                        model: disk.model || 'Disco',
                        size: disk.size,
                        sizeFormatted: disk.size || 'N/A',
                        transport: disk.type || 'unknown', // SSD/HDD -> treat as transport hint
                        serial: disk.serial,
                        hasData: true, // Assume existing disk has data (safer default)
                        partitions: []
                    }];
                    showDiskActionModal();
                });
                telemetryRow.appendChild(configBtn);
            }
            
            // Add "Remove from pool" button for disks in pool
            if (role !== 'none') {
                const removeBtn = document.createElement('button');
                removeBtn.style.cssText = `
                    margin-left: auto;
                    padding: 6px 12px;
                    background: transparent;
                    border: 1px solid var(--danger, #dc3545);
                    color: var(--danger, #dc3545);
                    border-radius: 6px;
                    font-size: 12px;
                    cursor: pointer;
                    transition: all 0.2s;
                    white-space: nowrap;
                `;
                removeBtn.textContent = '🗑️ Quitar del pool';
                removeBtn.addEventListener('mouseenter', () => {
                    removeBtn.style.background = 'var(--danger, #dc3545)';
                    removeBtn.style.color = '#fff';
                });
                removeBtn.addEventListener('mouseleave', () => {
                    removeBtn.style.background = 'transparent';
                    removeBtn.style.color = 'var(--danger, #dc3545)';
                });
                removeBtn.addEventListener('click', async () => {
                    if (!confirm(`¿Seguro que quieres quitar ${disk.model || disk.id} del pool?\n\nEl disco seguirá montado pero no formará parte del almacenamiento compartido.`)) {
                        return;
                    }
                    
                    removeBtn.disabled = true;
                    removeBtn.textContent = '⏳ Quitando...';
                    
                    try {
                        const res = await authFetch(`${API_BASE}/storage/disks/remove-from-pool`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ diskId: disk.id })
                        });
                        
                        const data = await res.json();
                        
                        if (res.ok && data.success) {
                            alert(`✅ ${data.message}`);
                            renderStorageDashboard(); // Refresh view
                        } else {
                            alert(`❌ Error: ${data.error || t('common.unknown', 'Error desconocido')}`);
                            removeBtn.disabled = false;
                            removeBtn.textContent = '🗑️ Quitar del pool';
                        }
                    } catch (e) {
                        alert(`❌ Error: ${e.message}`);
                        removeBtn.disabled = false;
                        removeBtn.textContent = '🗑️ Quitar del pool';
                    }
                });
                telemetryRow.appendChild(removeBtn);
            }

            card.appendChild(header);
            card.appendChild(progressContainer);
            card.appendChild(telemetryRow);
            grid.appendChild(card);
        });

        dashboardContent.appendChild(grid);
        
        // Start auto-refresh polling (every 30 seconds)
        if (!state.pollingIntervals.storage) {
            state.pollingIntervals.storage = setInterval(async () => {
                if (state.currentView === 'storage') {
                    await renderStorageDashboard();
                }
            }, 30000);
        }
    } catch (e) {
        console.error('Storage dashboard error:', e);
        dashboardContent.innerHTML = `<div class="glass-card"><h3>${t('common.error', 'Error al cargar datos de almacenamiento')}</h3></div>`;
    }
}

// Real Docker Logic
async function renderDockerManager() {
    // Show loading immediately
    dashboardContent.innerHTML = "<div class=\"glass-card\" style=\"grid-column: 1 / -1; text-align: center; padding: 40px;\"><h3>" + t("common.loading", "Cargando...") + "</h3></div>";
    // Fetch containers and update status
    let updateStatus = { lastCheck: null, updatesAvailable: 0 };
    try {
        const [containersRes, updateRes] = await Promise.all([
            authFetch(`${API_BASE}/docker/containers`),
            authFetch(`${API_BASE}/docker/update-status`)
        ]);
        if (containersRes.ok) state.dockers = await containersRes.json();
        if (updateRes.ok) updateStatus = await updateRes.json();
    } catch (e) {
        console.error('Docker unreachable:', e);
        state.dockers = [];
    }

    // Fetch compose files
    let composeFiles = [];
    try {
        const composeRes = await authFetch(`${API_BASE}/docker/compose/list`);
        if (composeRes.ok) composeFiles = await composeRes.json();
    } catch (e) {
        console.error('Compose list error:', e);
    }

    // Header with actions
    const headerCard = document.createElement('div');
    headerCard.className = 'glass-card';
    headerCard.style.cssText = 'grid-column: 1 / -1; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px;';

    const headerLeft = document.createElement('div');
    const h3 = document.createElement('h3');
    h3.style.margin = '0';
    h3.textContent = t('docker.containers', 'Contenedores');
    const updateInfo = document.createElement('span');
    updateInfo.style.cssText = 'font-size: 0.8rem; color: var(--text-dim); display: block; margin-top: 5px;';
    updateInfo.textContent = updateStatus.lastCheck
        ? `${t('docker.lastCheck', 'Última comprobación')}: ${new Date(updateStatus.lastCheck).toLocaleString()}`
        : t('docker.notCheckedYet', 'Actualizaciones no comprobadas aún');
    headerLeft.appendChild(h3);
    headerLeft.appendChild(updateInfo);

    const headerRight = document.createElement('div');
    headerRight.style.cssText = 'display: flex; gap: 10px; flex-wrap: wrap;';

    const checkUpdatesBtn = document.createElement('button');
    checkUpdatesBtn.className = 'btn-primary';
    checkUpdatesBtn.style.cssText = 'background: #6366f1; padding: 8px 16px; font-size: 0.85rem;';
    checkUpdatesBtn.innerHTML = '🔄 ' + t('docker.checkUpdates', 'Buscar Actualizaciones');
    checkUpdatesBtn.addEventListener('click', checkDockerUpdates);

    const importComposeBtn = document.createElement('button');
    importComposeBtn.className = 'btn-primary';
    importComposeBtn.style.cssText = 'background: #10b981; padding: 8px 16px; font-size: 0.85rem;';
    importComposeBtn.innerHTML = '📦 ' + t('docker.importCompose', 'Importar Compose');
    importComposeBtn.addEventListener('click', openComposeModal);

    const stacksBtn = document.createElement('button');
    stacksBtn.className = 'btn-primary';
    stacksBtn.style.cssText = 'background: #f59e0b; padding: 8px 16px; font-size: 0.85rem;';
    stacksBtn.innerHTML = '🗂️ Stacks';
    stacksBtn.addEventListener('click', openStacksManager);

    headerRight.appendChild(checkUpdatesBtn);
    headerRight.appendChild(importComposeBtn);
    headerRight.appendChild(stacksBtn);
    headerCard.appendChild(headerLeft);
    headerCard.appendChild(headerRight);
    
    // Clear loading message before adding content
    dashboardContent.innerHTML = '';
    dashboardContent.appendChild(headerCard);

    // Containers section
    if (state.dockers.length === 0) {
        const emptyCard = document.createElement('div');
        emptyCard.className = 'glass-card';
        emptyCard.style.cssText = 'grid-column: 1/-1; text-align:center; padding: 40px;';
        emptyCard.innerHTML = `
            <h4 style="color: var(--text-dim);">${t("docker.noContainers", "No Containers Detected")}</h4>
            <p style="color: var(--text-dim); font-size: 0.9rem;">Import a docker-compose file or run containers manually.</p>
        `;
        dashboardContent.appendChild(emptyCard);
    } else {
        const containerGrid = document.createElement('div');
        containerGrid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 20px; grid-column: 1 / -1;';

        state.dockers.forEach(container => {
            const card = document.createElement('div');
            card.className = 'glass-card docker-card';
            card.style.padding = '20px';

            const isRunning = container.status === 'running';
            const hasUpdate = container.hasUpdate;

            // Header row
            const header = document.createElement('div');
            header.style.cssText = 'display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px;';

            const info = document.createElement('div');
            const nameRow = document.createElement('div');
            nameRow.style.cssText = 'display: flex; align-items: center; gap: 8px;';
            const h4 = document.createElement('h4');
            h4.style.margin = '0';
            h4.textContent = container.name || t('common.unknown', 'Desconocido');
            nameRow.appendChild(h4);

            if (hasUpdate) {
                const updateBadge = document.createElement('span');
                updateBadge.style.cssText = 'background: #10b981; color: white; font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; font-weight: 600;';
                updateBadge.textContent = t('docker.update', 'ACTUALIZACIÓN');
                nameRow.appendChild(updateBadge);
            }

            const imageSpan = document.createElement('span');
            imageSpan.style.cssText = 'font-size: 0.8rem; color: var(--text-dim); display: block; margin-top: 4px;';
            imageSpan.textContent = container.image || 'N/A';
            info.appendChild(nameRow);
            info.appendChild(imageSpan);

            const statusSpan = document.createElement('span');
            statusSpan.style.cssText = `
                padding: 4px 10px;
                border-radius: 12px;
                font-size: 0.75rem;
                font-weight: 600;
                background: ${isRunning ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'};
                color: ${isRunning ? '#10b981' : '#ef4444'};
            `;
            statusSpan.textContent = isRunning ? t('docker.running', 'EN EJECUCIÓN') : t('docker.stopped', 'DETENIDO');

            header.appendChild(info);
            header.appendChild(statusSpan);

            // Stats row (always show for running containers)
            card.appendChild(header);
            if (isRunning) {
                const cpuVal = container.cpu || '0%';
                const ramVal = container.ram && container.ram !== '---' ? container.ram : '< 1MB';
                const cpuNum = parseFloat(cpuVal) || 0;
                
                const statsRow = document.createElement('div');
                statsRow.style.cssText = 'display: flex; gap: 20px; margin-bottom: 15px; padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px;';
                statsRow.innerHTML = `
                    <div style="flex: 1; text-align: center;">
                        <div style="font-size: 0.7rem; color: var(--text-dim);">CPU</div>
                        <div style="font-size: 1rem; font-weight: 600; color: ${cpuNum > 50 ? '#f59e0b' : '#10b981'}">${escapeHtml(cpuVal)}</div>
                    </div>
                    <div style="flex: 1; text-align: center;">
                        <div style="font-size: 0.7rem; color: var(--text-dim);">RAM</div>
                        <div style="font-size: 1rem; font-weight: 600; color: #6366f1;">${escapeHtml(ramVal)}</div>
                    </div>
                `;
                card.appendChild(statsRow);
            }

            // Ports section
            if (container.ports && container.ports.length > 0) {
                const portsDiv = document.createElement('div');
                portsDiv.className = 'docker-ports';
                portsDiv.style.marginBottom = '12px'; // Add spacing before buttons
                container.ports.forEach(port => {
                    if (port.public) {
                        const badge = document.createElement('span');
                        badge.className = 'docker-port-badge';
                        badge.innerHTML = `<span class="port-public">${port.public}</span><span class="port-arrow">→</span><span class="port-private">${port.private}</span>`;
                        portsDiv.appendChild(badge);
                    }
                });
                if (portsDiv.children.length > 0) {
                    card.appendChild(portsDiv);
                }
            }

            // Controls row
            const controls = document.createElement('div');
            controls.style.cssText = 'display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px;';

            const actionBtn = document.createElement('button');
            actionBtn.className = 'btn-sm';
            actionBtn.style.cssText = `flex: 1; padding: 8px; background: ${isRunning ? '#ef4444' : '#10b981'}; color: white; border: none; border-radius: 6px; cursor: pointer;`;
            actionBtn.textContent = isRunning ? t('docker.stop', 'Detener') : t('docker.start', 'Iniciar');
            actionBtn.addEventListener('click', () => handleDockerAction(container.id, isRunning ? 'stop' : 'start', actionBtn));

            const restartBtn = document.createElement('button');
            restartBtn.className = 'btn-sm';
            restartBtn.style.cssText = 'flex: 1; padding: 8px; background: #f59e0b; color: white; border: none; border-radius: 6px; cursor: pointer;';
            restartBtn.textContent = t('docker.restart', 'Reiniciar');
            restartBtn.addEventListener('click', () => handleDockerAction(container.id, 'restart', restartBtn));

            controls.appendChild(actionBtn);
            controls.appendChild(restartBtn);

            if (hasUpdate) {
                const updateBtn = document.createElement('button');
                updateBtn.className = 'btn-sm';
                updateBtn.style.cssText = 'width: 100%; margin-top: 8px; padding: 10px; background: linear-gradient(135deg, #10b981, #059669); color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;';
                updateBtn.innerHTML = '⬆️ ' + t('docker.updateContainer', 'Actualizar');
                updateBtn.addEventListener('click', () => updateContainer(container.id, container.name, updateBtn));
                controls.appendChild(updateBtn);
            }

            card.appendChild(controls);

            // Action buttons row (logs, web, edit)
            const actionsRow = document.createElement('div');
            actionsRow.className = 'docker-actions-row';

            // Logs button (always show, works for running and stopped)
            const logsBtn = document.createElement('button');
            logsBtn.className = 'docker-action-btn logs';
            logsBtn.innerHTML = '📜 ' + t('docker.viewLogs', 'Logs');
            logsBtn.addEventListener('click', () => openContainerLogs(container.id, container.name));
            actionsRow.appendChild(logsBtn);

            if (isRunning) {
                // Open Web button (if has public ports)
                const webPort = container.ports?.find(p => p.public);
                if (webPort) {
                    const webBtn = document.createElement('button');
                    webBtn.className = 'docker-action-btn web';
                    webBtn.innerHTML = '🌐 ' + t('docker.openWebUI', 'Web');
                    webBtn.addEventListener('click', () => {
                        window.open(`http://${window.location.hostname}:${webPort.public}`, '_blank');
                    });
                    actionsRow.appendChild(webBtn);
                }
            }

            // Edit compose button (always show if container has compose file)
            if (container.compose) {
                const editBtn = document.createElement('button');
                editBtn.className = 'docker-action-btn edit';
                editBtn.innerHTML = '✏️ ' + t('docker.editCompose', 'Editar');
                editBtn.addEventListener('click', () => openEditComposeModal(container.compose.name));
                actionsRow.appendChild(editBtn);
            }

            if (actionsRow.children.length > 0) {
                card.appendChild(actionsRow);
            }

            // Notes section
            const notesDiv = document.createElement('div');
            notesDiv.className = 'docker-notes';
            
            const notesHeader = document.createElement('div');
            notesHeader.className = 'docker-notes-header';
            
            const notesLabel = document.createElement('span');
            notesLabel.textContent = `📝 ${t('docker.notes', 'Notas')}`;
            
            const saveNoteBtn = document.createElement('button');
            saveNoteBtn.className = 'btn-sm';
            saveNoteBtn.style.cssText = 'padding: 4px 8px; font-size: 0.7rem;';
            saveNoteBtn.textContent = t('docker.saveNote', 'Guardar');
            
            notesHeader.appendChild(notesLabel);
            notesHeader.appendChild(saveNoteBtn);
            
            const notesTextarea = document.createElement('textarea');
            notesTextarea.className = 'docker-notes-input';
            notesTextarea.placeholder = t('docker.addNote', 'Añadir notas, contraseñas, etc...');
            notesTextarea.value = container.notes || '';
            
            // Save button click handler
            saveNoteBtn.addEventListener('click', async () => {
                const ok = await saveContainerNotes(container.id, notesTextarea.value);
                if (ok) {
                    saveNoteBtn.textContent = '✓ ' + t('common.saved', 'Guardado');
                    setTimeout(() => {
                        saveNoteBtn.textContent = t('docker.saveNote', 'Guardar');
                    }, 2000);
                } else {
                    alert(t('common.error', 'Error al guardar'));
                }
            });
            
            notesDiv.appendChild(notesHeader);
            notesDiv.appendChild(notesTextarea);
            card.appendChild(notesDiv);

            containerGrid.appendChild(card);
        });

        dashboardContent.appendChild(containerGrid);
    }

    // Compose Files Section
    if (composeFiles.length > 0) {
        const composeSectionTitle = document.createElement('h3');
        composeSectionTitle.style.cssText = 'grid-column: 1 / -1; margin-top: 30px; margin-bottom: 10px;';
        composeSectionTitle.textContent = 'Docker Compose Files';
        dashboardContent.appendChild(composeSectionTitle);

        const composeGrid = document.createElement('div');
        composeGrid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 15px; grid-column: 1 / -1;';

        composeFiles.forEach(compose => {
            const card = document.createElement('div');
            card.className = 'glass-card';
            card.style.padding = '15px';

            const header = document.createElement('div');
            header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;';

            const name = document.createElement('h4');
            name.style.margin = '0';
            name.textContent = compose.name;

            const modified = document.createElement('span');
            modified.style.cssText = 'font-size: 0.75rem; color: var(--text-dim);';
            modified.textContent = new Date(compose.modified).toLocaleDateString();

            header.appendChild(name);
            header.appendChild(modified);

            const controls = document.createElement('div');
            controls.style.cssText = 'display: flex; gap: 8px;';

            const runBtn = document.createElement('button');
            runBtn.style.cssText = 'flex: 1; padding: 8px; background: #10b981; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 0.85rem;';
            runBtn.textContent = 'Run';
            runBtn.addEventListener('click', () => runCompose(compose.name, runBtn));

            const stopBtn = document.createElement('button');
            stopBtn.style.cssText = 'flex: 1; padding: 8px; background: #f59e0b; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 0.85rem;';
            stopBtn.textContent = 'Stop';
            stopBtn.addEventListener('click', () => stopCompose(compose.name, stopBtn));

            const deleteBtn = document.createElement('button');
            deleteBtn.style.cssText = 'padding: 8px 12px; background: #ef4444; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 0.85rem;';
            deleteBtn.textContent = '🗑️';
            deleteBtn.addEventListener('click', () => deleteCompose(compose.name));

            controls.appendChild(runBtn);
            controls.appendChild(stopBtn);
            controls.appendChild(deleteBtn);

            card.appendChild(header);
            card.appendChild(controls);
            composeGrid.appendChild(card);
        });

        dashboardContent.appendChild(composeGrid);
    }
}

// Docker Update Functions
async function checkDockerUpdates(event) {
    const btn = event.target;
    btn.disabled = true;
    btn.innerHTML = '🔄 Checking...';

    try {
        const res = await authFetch(`${API_BASE}/docker/check-updates`, { method: 'POST' });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Check failed');

        alert(`Update check complete!\n\nImages checked: ${data.totalImages}\nUpdates available: ${data.updatesAvailable}`);
        renderContent('docker');
    } catch (e) {
        console.error('Docker update check error:', e);
        alert('Error: ' + e.message);
        btn.disabled = false;
        btn.innerHTML = '🔄 ' + t('docker.checkUpdates', 'Buscar Actualizaciones');
    }
}

async function updateContainer(containerId, containerName, btn) {
    const confirmed = await showConfirmModal(
        `¿Actualizar "${containerName}"?`,
        'Esto parará el container, descargará la última imagen y lo recreará. Los volúmenes y datos se conservan.'
    );
    if (!confirmed) return;

    btn.disabled = true;
    btn.innerHTML = '⏳ Updating...';

    try {
        const res = await authFetch(`${API_BASE}/docker/update`, {
            method: 'POST',
            body: JSON.stringify({ containerId })
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Update failed');

        alert(`Container "${containerName}" updated successfully!`);
        renderContent('docker');
    } catch (e) {
        console.error('Container update error:', e);
        alert('Update failed: ' + e.message);
        btn.disabled = false;
        btn.innerHTML = '⬆️ Update Container';
    }
}

// Compose Functions
function openComposeModal() {
    const modal = document.createElement('div');
    modal.id = 'compose-modal';
    modal.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.8); display: flex; align-items: center;
        justify-content: center; z-index: 1000;
    `;

    modal.innerHTML = `
        <div style="background: var(--card-bg); padding: 30px; border-radius: 16px; width: 90%; max-width: 600px; max-height: 80vh; overflow-y: auto;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h3 style="margin: 0;">${t('docker.importCompose', 'Importar Docker Compose')}</h3>
                <button id="close-compose-modal" style="background: none; border: none; color: white; font-size: 1.5rem; cursor: pointer;">&times;</button>
            </div>
            <div class="input-group" style="margin-bottom: 15px;">
                <input type="text" id="compose-name" placeholder=" " required>
                <label>${t('docker.stackName', 'Nombre del Stack')}</label>
            </div>
            <div style="margin-bottom: 15px;">
                <label style="display: block; margin-bottom: 8px; color: var(--text-dim);">docker-compose.yml content:</label>
                <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                    <label style="
                        flex: 1; padding: 12px; background: rgba(99, 102, 241, 0.2);
                        border: 2px dashed rgba(99, 102, 241, 0.5); border-radius: 8px;
                        color: #6366f1; text-align: center; cursor: pointer;
                        transition: all 0.2s ease;
                    ">
                        📁 ${t('docker.uploadYml', 'Subir archivo .yml')}
                        <input type="file" id="compose-file-input" accept=".yml,.yaml" style="display: none;">
                    </label>
                </div>
                <textarea id="compose-content" style="
                    width: 100%; height: 300px; background: rgba(0,0,0,0.3);
                    border: 1px solid rgba(255,255,255,0.1); border-radius: 8px;
                    color: white; font-family: monospace; padding: 15px; resize: vertical;
                " placeholder="version: '3'
services:
  myapp:
    image: nginx:latest
    ports:
      - '8080:80'"></textarea>
            </div>
            <div style="display: flex; gap: 10px;">
                <button id="save-compose-btn" class="btn-primary" style="flex: 1; padding: 12px;">${t('docker.saveCompose', 'Guardar Compose')}</button>
                <button id="save-run-compose-btn" class="btn-primary" style="flex: 1; padding: 12px; background: #10b981;">${t('docker.saveAndRun', 'Guardar y Ejecutar')}</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('close-compose-modal').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    // File upload handler
    document.getElementById("compose-file-input").addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                document.getElementById("compose-content").value = event.target.result;
                // Auto-fill stack name from filename if empty
                const nameInput = document.getElementById("compose-name");
                if (!nameInput.value.trim()) {
                    nameInput.value = file.name.replace(/.(yml|yaml)$/i, "").replace(/docker-compose[-_]?/i, "") || "stack";
                }
            };
            reader.readAsText(file);
        }
    });


    document.getElementById('save-compose-btn').addEventListener('click', () => saveCompose(false));
    document.getElementById('save-run-compose-btn').addEventListener('click', () => saveCompose(true));
}

async function saveCompose(andRun) {
    const name = document.getElementById("compose-name").value.trim();
    const content = document.getElementById("compose-content").value;

    if (!name) {
        alert("Please enter a stack name");
        return;
    }
    if (!content) {
        alert("Please enter compose content");
        return;
    }

    // Replace modal content with progress view
    const modal = document.getElementById("compose-modal");
    const modalContent = modal.querySelector("div");
    modalContent.innerHTML = `
        <h3 style="margin: 0 0 20px 0;">Desplegando Stack: ${escapeHtml(name)}</h3>
        <div id="deploy-steps">
            <div class="deploy-step" id="step-save">
                <span class="step-icon">⏳</span>
                <span class="step-text">Guardando archivo compose...</span>
            </div>
            ${andRun ? `<div class="deploy-step" id="step-pull">
                <span class="step-icon">⏳</span>
                <span class="step-text">Descargando imágenes...</span>
            </div>
            <div class="deploy-step" id="step-start">
                <span class="step-icon">⏳</span>
                <span class="step-text">Iniciando contenedores...</span>
            </div>` : ""}
        </div>
        <div style="margin: 20px 0;">
            <div style="background: rgba(255,255,255,0.1); border-radius: 8px; height: 8px; overflow: hidden;">
                <div id="deploy-progress" style="height: 100%; background: linear-gradient(90deg, #6366f1, #10b981); width: 0%; transition: width 0.3s ease;"></div>
            </div>
            <div id="deploy-status" style="margin-top: 10px; font-size: 0.9rem; color: var(--text-dim); text-align: center;">Inicializando...</div>
        </div>
        <div id="deploy-log" style="display: none; margin: 15px 0; padding: 15px; background: rgba(0,0,0,0.3); border-radius: 8px; font-family: monospace; font-size: 0.8rem; max-height: 200px; overflow-y: auto; white-space: pre-wrap;"></div>
        <div id="deploy-actions" style="display: none; text-align: center;">
            <button id="deploy-close-btn" class="btn-primary" style="padding: 12px 30px;">Accept</button>
        </div>
    `;

    const updateStep = (stepId, status) => {
        const step = document.getElementById(stepId);
        if (!step) return;
        step.className = "deploy-step";
        if (status) step.classList.add(status);
    };

    const updateProgress = (percent, text) => {
        const bar = document.getElementById("deploy-progress");
        const status = document.getElementById("deploy-status");
        if (bar) bar.style.width = percent + "%";
        if (status) status.textContent = text;
    };

    const showResult = (success, message, log = "") => {
        const actions = document.getElementById("deploy-actions");
        const logDiv = document.getElementById("deploy-log");
        const btn = document.getElementById("deploy-close-btn");
        
        if (actions) actions.style.display = "block";
        if (!success && log && logDiv) {
            logDiv.style.display = "block";
            logDiv.textContent = log;
            logDiv.style.color = "#ef4444";
        }
        if (btn) {
            btn.textContent = success ? "Accept" : "Close";
            btn.style.background = success ? "#10b981" : "#ef4444";
            btn.onclick = () => {
                modal.remove();
                if (success) renderContent("docker");
            };
        }
        updateProgress(100, message);
    };

    try {
        // Step 1: Save compose file
        updateStep("step-save", "active");
        updateProgress(10, "Guardando archivo compose...");

        const res = await authFetch(`${API_BASE}/docker/compose/import`, {
            method: "POST",
            body: JSON.stringify({ name, content })
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || "Error al importar");

        updateStep("step-save", "done");
        updateProgress(andRun ? 33 : 100, andRun ? "Compose guardado, iniciando despliegue..." : "¡Compose guardado exitosamente!");

        if (andRun) {
            // Step 2: Pull & Start
            updateStep("step-pull", "active");
            updateProgress(50, "Descargando imágenes e iniciando contenedores...");

            const runRes = await authFetch(`${API_BASE}/docker/compose/up`, {
                method: "POST",
                body: JSON.stringify({ name })
            });
            const runData = await runRes.json();

            if (!runRes.ok) {
                updateStep("step-pull", "error");
                updateStep("step-start", "error");
                throw new Error(runData.error || runData.output || "Error al ejecutar");
            }

            updateStep("step-pull", "done");
            updateStep("step-start", "done");
            showResult(true, "¡Stack desplegado exitosamente! ✅");
        } else {
            showResult(true, "¡Archivo Compose guardado! ✅");
        }

    } catch (e) {
        console.error("Compose deploy error:", e);
        const currentStep = document.querySelector(".deploy-step.active");
        if (currentStep) currentStep.classList.replace("active", "error");
        showResult(false, "Despliegue fallido ❌", e.message);
    }
}

async function runCompose(name, btn) {
    btn.disabled = true;
    btn.textContent = t('docker.starting', 'Iniciando...');

    try {
        const res = await authFetch(`${API_BASE}/docker/compose/up`, {
            method: 'POST',
            body: JSON.stringify({ name })
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || t('common.error', 'Error al iniciar'));

        alert(`Compose "${name}" ${t('docker.started', 'iniciado')}!`);
        renderContent('docker');
    } catch (e) {
        console.error('Compose run error:', e);
        alert('Error: ' + e.message);
        btn.disabled = false;
        btn.textContent = t('docker.run', 'Ejecutar');
    }
}

async function stopCompose(name, btn) {
    btn.disabled = true;
    btn.textContent = t('docker.stopping', 'Deteniendo...');

    try {
        const res = await authFetch(`${API_BASE}/docker/compose/down`, {
            method: 'POST',
            body: JSON.stringify({ name })
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || t('common.error', 'Error al detener'));

        alert(`Compose "${name}" ${t('docker.stopped', 'detenido')}!`);
        renderContent('docker');
    } catch (e) {
        console.error('Compose stop error:', e);
        alert('Error: ' + e.message);
        btn.disabled = false;
        btn.textContent = t('docker.stop', 'Detener');
    }
}

async function deleteCompose(name) {
    const confirmed = await showConfirmModal(
        `¿Eliminar "${name}"?`,
        'Esto parará todos los containers y eliminará el archivo compose.'
    );
    if (!confirmed) return;

    try {
        const res = await authFetch(`${API_BASE}/docker/compose/${encodeURIComponent(name)}`, {
            method: 'DELETE'
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Delete failed');

        alert(`Compose "${name}" deleted!`);
        renderContent('docker');
    } catch (e) {
        console.error('Compose delete error:', e);
        alert('Error: ' + e.message);
    }
}

// Edit compose modal
async function openEditComposeModal(composeName) {
    // Fetch current compose content
    let content = '';
    try {
        const res = await authFetch(`${API_BASE}/docker/compose/${encodeURIComponent(composeName)}`);
        if (res.ok) {
            const data = await res.json();
            content = data.content || '';
        }
    } catch (e) {
        console.error('Error fetching compose:', e);
    }

    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="glass-card modal-content" style="max-width: 700px; max-height: 80vh; overflow-y: auto;">
            <header class="modal-header">
                <h3>✏️ ${t('docker.editCompose', 'Editar Compose')}: ${escapeHtml(composeName)}</h3>
                <button id="close-edit-compose" class="btn-close">&times;</button>
            </header>
            <div style="padding: 20px;">
                <textarea id="edit-compose-content" style="
                    width: 100%; height: 400px; background: rgba(0,0,0,0.3);
                    border: 1px solid rgba(255,255,255,0.1); border-radius: 8px;
                    color: white; font-family: monospace; padding: 15px; resize: vertical;
                ">${escapeHtml(content)}</textarea>
            </div>
            <div class="modal-footer" style="display: flex; gap: 10px; padding: 15px;">
                <button id="cancel-edit-compose" class="btn-primary" style="background: var(--text-dim);">
                    ${t('common.cancel', 'Cancelar')}
                </button>
                <button id="save-edit-compose" class="btn-primary">
                    ${t('common.save', 'Guardar')}
                </button>
                <button id="save-run-edit-compose" class="btn-primary" style="background: #10b981;">
                    ${t('docker.saveAndRun', 'Guardar y Ejecutar')}
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Close handlers
    const closeModal = () => modal.remove();
    document.getElementById('close-edit-compose').addEventListener('click', closeModal);
    document.getElementById('cancel-edit-compose').addEventListener('click', closeModal);

    // Click outside to close
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    const saveHandler = async (andRun) => {
        const newContent = document.getElementById('edit-compose-content').value;
        try {
            // Save compose
            const saveRes = await authFetch(`${API_BASE}/docker/compose/${encodeURIComponent(composeName)}`, {
                method: 'PUT',
                body: JSON.stringify({ content: newContent })
            });
            if (!saveRes.ok) {
                const data = await saveRes.json();
                throw new Error(data.error || 'Failed to save');
            }

            if (andRun) {
                // Run compose
                const runRes = await authFetch(`${API_BASE}/docker/compose/up`, {
                    method: 'POST',
                    body: JSON.stringify({ name: composeName })
                });
                if (!runRes.ok) {
                    const data = await runRes.json();
                    throw new Error(data.error || 'Failed to run');
                }
            }

            modal.remove();
            renderContent('docker');
        } catch (e) {
            alert('Error: ' + e.message);
        }
    };

    document.getElementById('save-edit-compose').addEventListener('click', () => saveHandler(false));
    document.getElementById('save-run-edit-compose').addEventListener('click', () => saveHandler(true));
}

window.checkDockerUpdates = checkDockerUpdates;
window.updateContainer = updateContainer;
window.openComposeModal = openComposeModal;
window.openEditComposeModal = openEditComposeModal;

async function handleDockerAction(id, action, btn) {
    if (!btn) return;

    btn.disabled = true;
    btn.textContent = t('common.processing', 'Procesando...');

    try {
        const res = await authFetch(`${API_BASE}/docker/action`, {
            method: 'POST',
            body: JSON.stringify({ id, action })
        });

        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Docker action failed');
        }

        renderContent('docker');
    } catch (e) {
        console.error('Docker action error:', e);
        alert(e.message || 'Docker Logic Fail');
        btn.disabled = false;
        btn.textContent = action === 'stop' ? 'Stop' : 'Start';
    }
}

// Keep window reference for backward compatibility
window.handleDockerAction = handleDockerAction;

// Network Manager (Refined)
async function renderNetworkManager() {
    try {
        const res = await fetch(`${API_BASE}/network/interfaces`);
        if (!res.ok) throw new Error('Failed to fetch interfaces');
        state.network.interfaces = await res.json();
    } catch (e) {
        console.error('Network fetch error:', e);
        dashboardContent.innerHTML = `<div class="glass-card"><h3>${t('common.error', 'Error al cargar datos de red')}</h3></div>`;
        return;
    }

    // Remove any existing network-grid to prevent duplicates
    const existingGrid = dashboardContent.querySelector('.network-grid');
    if (existingGrid) existingGrid.remove();

    const container = document.createElement('div');
    container.className = 'network-grid';

    // 1. Interfaces Section
    const ifaceSection = document.createElement('div');
    const ifaceTitle = document.createElement('h3');
    ifaceTitle.textContent = 'CM5 ' + t('network.adapters', 'Adaptadores de Red');
    ifaceTitle.style.marginBottom = '20px';
    ifaceSection.appendChild(ifaceTitle);

    // Grid container for interface cards
    const interfacesGrid = document.createElement('div');
    interfacesGrid.className = 'interfaces-grid';

    state.network.interfaces.forEach(iface => {
        const card = document.createElement('div');
        card.className = 'glass-card interface-card';
        card.dataset.interfaceId = iface.id;

        const isConnected = iface.status === 'connected';
        // Use local state if available, otherwise use server state
        const isDhcp = localDhcpState[iface.id] !== undefined ? localDhcpState[iface.id] : iface.dhcp;

        // Create header
        const header = document.createElement('div');
        header.className = 'interface-header';

        const headerInfo = document.createElement('div');
        const h4 = document.createElement('h4');
        h4.textContent = `${iface.name || t('common.unknown', 'Desconocido')} (${iface.id || 'N/A'})`;
        const statusSpan = document.createElement('span');
        statusSpan.style.cssText = `font-size: 0.8rem; color: ${isConnected ? '#10b981' : '#94a3b8'}`;
        const statusMap = { connected: t('terminal.connected', 'CONECTADO'), disconnected: t('terminal.disconnected', 'DESCONECTADO') };
        statusSpan.textContent = statusMap[iface.status] || (iface.status || t('common.unknown', 'desconocido')).toUpperCase();
        headerInfo.appendChild(h4);
        headerInfo.appendChild(statusSpan);

        const checkboxItem = document.createElement('div');
        checkboxItem.className = 'checkbox-item';

        const dhcpCheckbox = document.createElement('input');
        dhcpCheckbox.type = 'checkbox';
        dhcpCheckbox.id = `dhcp-${iface.id}`;
        dhcpCheckbox.checked = isDhcp;
        dhcpCheckbox.addEventListener('change', (e) => toggleDHCP(iface.id, e.target.checked, iface));

        const dhcpLabel = document.createElement('label');
        dhcpLabel.htmlFor = `dhcp-${iface.id}`;
        dhcpLabel.textContent = 'DHCP';

        checkboxItem.appendChild(dhcpCheckbox);
        checkboxItem.appendChild(dhcpLabel);

        header.appendChild(headerInfo);
        header.appendChild(checkboxItem);

        // Create form
        const netForm = document.createElement('div');
        netForm.className = 'net-form';
        netForm.id = `netform-${iface.id}`;

        if (isDhcp) {
            const inputGroup = document.createElement('div');
            inputGroup.className = 'input-group';
            inputGroup.style.gridColumn = '1 / -1';

            const ipInput = document.createElement('input');
            ipInput.type = 'text';
            ipInput.value = iface.ip || '';
            ipInput.disabled = true;
            ipInput.placeholder = ' ';

            const label = document.createElement('label');
            label.textContent = t('network.hardwareAssignedIP', 'IP Asignada por Hardware');

            inputGroup.appendChild(ipInput);
            inputGroup.appendChild(label);
            netForm.appendChild(inputGroup);
        } else {
            // IP Input
            const ipGroup = document.createElement('div');
            ipGroup.className = 'input-group';
            const ipInput = document.createElement('input');
            ipInput.type = 'text';
            ipInput.id = `ip-${iface.id}`;
            ipInput.value = iface.ip || '';
            ipInput.placeholder = ' ';
            const ipLabel = document.createElement('label');
            ipLabel.textContent = t('network.ipAddress', 'Dirección IP');
            ipGroup.appendChild(ipInput);
            ipGroup.appendChild(ipLabel);

            // Subnet Input
            const subnetGroup = document.createElement('div');
            subnetGroup.className = 'input-group';
            const subnetInput = document.createElement('input');
            subnetInput.type = 'text';
            subnetInput.id = `subnet-${iface.id}`;
            subnetInput.value = iface.subnet || '';
            subnetInput.placeholder = ' ';
            const subnetLabel = document.createElement('label');
            subnetLabel.textContent = t('network.subnetMask', 'Máscara de Subred');
            subnetGroup.appendChild(subnetInput);
            subnetGroup.appendChild(subnetLabel);

            netForm.appendChild(ipGroup);
            netForm.appendChild(subnetGroup);
        }

        // Save button
        const btnContainer = document.createElement('div');
        btnContainer.style.cssText = 'display: flex; align-items: flex-end; padding-bottom: 25px; grid-column: 1 / -1;';

        const saveBtn = document.createElement('button');
        saveBtn.className = 'btn-primary';
        saveBtn.style.cssText = 'padding: 10px; max-width: 200px;';
        saveBtn.textContent = t('network.saveToNode', 'Guardar en Nodo');
        saveBtn.addEventListener('click', () => applyNetwork(iface.id));

        btnContainer.appendChild(saveBtn);
        netForm.appendChild(btnContainer);

        card.appendChild(header);
        card.appendChild(netForm);
        interfacesGrid.appendChild(card);
    });

    ifaceSection.appendChild(interfacesGrid);

    // DDNS section is now rendered by renderDDNSSection() after this function
    container.appendChild(ifaceSection);
    dashboardContent.appendChild(container);
}

// Network functions
function toggleDHCP(interfaceId, isChecked, iface) {
    // Update local state
    localDhcpState[interfaceId] = isChecked;

    // Re-render only the form for this interface
    const netForm = document.getElementById(`netform-${interfaceId}`);
    if (netForm) {
        renderNetForm(netForm, iface, isChecked);
    }
}

// Helper function to render the network form
function renderNetForm(netForm, iface, isDhcp) {
    netForm.innerHTML = '';

    if (isDhcp) {
        const inputGroup = document.createElement('div');
        inputGroup.className = 'input-group';
        inputGroup.style.gridColumn = '1 / -1';

        const ipInput = document.createElement('input');
        ipInput.type = 'text';
        ipInput.value = iface.ip || '';
        ipInput.disabled = true;
        ipInput.placeholder = ' ';

        const label = document.createElement('label');
        label.textContent = t('network.hardwareAssignedIP', 'Hardware Assigned IP');

        inputGroup.appendChild(ipInput);
        inputGroup.appendChild(label);
        netForm.appendChild(inputGroup);
    } else {
        // IP Input
        const ipGroup = document.createElement('div');
        ipGroup.className = 'input-group';
        const ipInput = document.createElement('input');
        ipInput.type = 'text';
        ipInput.id = `ip-${iface.id}`;
        ipInput.value = iface.ip || '';
        ipInput.placeholder = ' ';
        const ipLabel = document.createElement('label');
        ipLabel.textContent = t('network.ipAddress', 'Dirección IP');
        ipGroup.appendChild(ipInput);
        ipGroup.appendChild(ipLabel);

        // Subnet Input
        const subnetGroup = document.createElement('div');
        subnetGroup.className = 'input-group';
        const subnetInput = document.createElement('input');
        subnetInput.type = 'text';
        subnetInput.id = `subnet-${iface.id}`;
        subnetInput.value = iface.subnet || '';
        subnetInput.placeholder = ' ';
        const subnetLabel = document.createElement('label');
        subnetLabel.textContent = t('network.subnetMask', 'Máscara de Subred');
        subnetGroup.appendChild(subnetInput);
        subnetGroup.appendChild(subnetLabel);

        // Gateway Input
        const gatewayGroup = document.createElement('div');
        gatewayGroup.className = 'input-group';
        const gatewayInput = document.createElement('input');
        gatewayInput.type = 'text';
        gatewayInput.id = `gateway-${iface.id}`;
        gatewayInput.value = iface.gateway || '';
        gatewayInput.placeholder = ' ';
        const gatewayLabel = document.createElement('label');
        gatewayLabel.textContent = t('network.gateway', 'Puerta de Enlace');
        gatewayGroup.appendChild(gatewayInput);
        gatewayGroup.appendChild(gatewayLabel);

        // DNS Input
        const dnsGroup = document.createElement('div');
        dnsGroup.className = 'input-group';
        const dnsInput = document.createElement('input');
        dnsInput.type = 'text';
        dnsInput.id = `dns-${iface.id}`;
        dnsInput.value = '';
        dnsInput.placeholder = ' ';
        const dnsLabel = document.createElement('label');
        dnsLabel.textContent = t('network.dns', 'DNS') + ' (ej: 8.8.8.8)';
        dnsGroup.appendChild(dnsInput);
        dnsGroup.appendChild(dnsLabel);

        netForm.appendChild(ipGroup);
        netForm.appendChild(subnetGroup);
        netForm.appendChild(gatewayGroup);
        netForm.appendChild(dnsGroup);
    }

    // Save button
    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = 'display: flex; align-items: flex-end; padding-top: 10px; grid-column: 1 / -1;';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn-primary';
    saveBtn.style.cssText = 'padding: 10px; width: 100%;';
    saveBtn.textContent = t('network.saveToNode', 'Guardar en Nodo');
    saveBtn.addEventListener('click', () => applyNetwork(iface.id));

    btnContainer.appendChild(saveBtn);
    netForm.appendChild(btnContainer);
}

async function applyNetwork(interfaceId) {
    const dhcpCheckbox = document.getElementById(`dhcp-${interfaceId}`);
    const isDhcp = dhcpCheckbox ? dhcpCheckbox.checked : false;

    let config = { dhcp: isDhcp };

    if (!isDhcp) {
        const ipInput = document.getElementById(`ip-${interfaceId}`);
        const subnetInput = document.getElementById(`subnet-${interfaceId}`);
        const gatewayInput = document.getElementById(`gateway-${interfaceId}`);
        const dnsInput = document.getElementById(`dns-${interfaceId}`);

        if (ipInput) config.ip = ipInput.value.trim();
        if (subnetInput) config.subnet = subnetInput.value.trim();
        if (gatewayInput) config.gateway = gatewayInput.value.trim();
        if (dnsInput) config.dns = dnsInput.value.trim();

        // Basic validation
        const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

        if (config.ip && !ipRegex.test(config.ip)) {
            alert('Formato de IP inválido');
            return;
        }

        if (config.subnet && !ipRegex.test(config.subnet)) {
            alert('Formato de máscara de subred inválido');
            return;
        }

        if (config.gateway && !ipRegex.test(config.gateway)) {
            alert('Formato de puerta de enlace inválido');
            return;
        }

        if (config.dns && !ipRegex.test(config.dns)) {
            alert('Formato de DNS inválido');
            return;
        }
    }

    try {
        const res = await authFetch(`${API_BASE}/network/configure`, {
            method: 'POST',
            body: JSON.stringify({ id: interfaceId, config })
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || 'Network configuration failed');
        }

        alert(data.message || t('common.saved', 'Configuración guardada'));
    } catch (e) {
        console.error('Network config error:', e);
        alert(e.message || t('common.error', 'Error al aplicar configuración de red'));
    }
}

// DDNS modal is now handled by showDDNSForm() in renderDDNSSection

// Terms and Conditions Modal
const termsModal = document.getElementById('terms-modal');
const termsLink = document.getElementById('terms-link');
const closeTermsBtn = document.getElementById('close-terms-modal');
const acceptTermsBtn = document.getElementById('accept-terms-btn');

if (termsLink) {
    termsLink.addEventListener('click', (e) => {
        e.preventDefault();
        if (termsModal) termsModal.style.display = 'flex';
    });
}

if (closeTermsBtn) {
    closeTermsBtn.addEventListener('click', () => {
        if (termsModal) termsModal.style.display = 'none';
    });
}

if (acceptTermsBtn) {
    acceptTermsBtn.addEventListener('click', () => {
        if (termsModal) termsModal.style.display = 'none';
    });
}

if (termsModal) {
    termsModal.addEventListener('click', (e) => {
        if (e.target === termsModal) {
            termsModal.style.display = 'none';
        }
    });
}

// System View (Real Actions)
function renderSystemView() {
    // Format uptime intelligently
    const uptimeSeconds = Number(state.globalStats.uptime) || 0;
    const days = Math.floor(uptimeSeconds / 86400);
    const hours = Math.floor((uptimeSeconds % 86400) / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    let uptimeStr;
    if (days > 0) {
        uptimeStr = `${days} día${days > 1 ? 's' : ''} ${hours}h`;
    } else if (hours > 0) {
        uptimeStr = `${hours} hora${hours > 1 ? 's' : ''} ${minutes}m`;
    } else {
        uptimeStr = `${minutes} minuto${minutes !== 1 ? 's' : ''}`;
    }
    const hostname = escapeHtml(state.globalStats.hostname || 'raspberrypi');

    const container = document.createElement('div');
    container.style.cssText = 'display: contents;';

    // Management card
    const mgmtCard = document.createElement('div');
    mgmtCard.className = 'glass-card';
    mgmtCard.style.gridColumn = '1 / -1';

    const mgmtTitle = document.createElement('h3');
    mgmtTitle.textContent = 'CM5 ' + t('system.nodeManagement', 'Gestión del Nodo');

    const mgmtDesc = document.createElement('p');
    mgmtDesc.style.cssText = 'color: var(--text-dim); margin-top: 10px;';
    mgmtDesc.textContent = t('system.executeActions', 'Ejecutar acciones físicas en el hardware del NAS.');

    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = 'display: flex; gap: 20px; margin-top: 30px;';

    const rebootBtn = document.createElement('button');
    rebootBtn.className = 'btn-primary';
    rebootBtn.style.cssText = 'background: #f59e0b; box-shadow: 0 4px 15px rgba(245, 158, 11, 0.4);';
    rebootBtn.textContent = t('system.restartNode', 'Reiniciar Nodo');
    rebootBtn.addEventListener('click', () => systemAction('reboot'));

    const shutdownBtn = document.createElement('button');
    shutdownBtn.className = 'btn-primary';
    shutdownBtn.style.cssText = 'background: #ef4444; box-shadow: 0 4px 15px rgba(239, 68, 68, 0.4);';
    shutdownBtn.textContent = t('system.powerOff', 'Apagar');
    shutdownBtn.addEventListener('click', () => systemAction('shutdown'));

    btnContainer.appendChild(rebootBtn);
    btnContainer.appendChild(shutdownBtn);

    mgmtCard.appendChild(mgmtTitle);
    mgmtCard.appendChild(mgmtDesc);
    mgmtCard.appendChild(btnContainer);

    // Info card
    const infoCard = document.createElement('div');
    infoCard.className = 'glass-card';

    const infoTitle = document.createElement('h3');
    infoTitle.textContent = t('system.systemInfo', 'Información del Sistema');

    const uptimeRow = document.createElement('div');
    uptimeRow.className = 'stat-row';
    uptimeRow.innerHTML = `<span>${t('system.logicUptime', 'Tiempo Activo Lógico')}</span> <span>${uptimeStr}</span>`;

    const hostnameRow = document.createElement('div');
    hostnameRow.className = 'stat-row';
    hostnameRow.innerHTML = `<span>${t('system.nodeName', 'Nombre del Nodo')}</span> <span>${hostname}</span>`;

    infoCard.appendChild(infoTitle);
    infoCard.appendChild(uptimeRow);
    infoCard.appendChild(hostnameRow);

    // Update card
    const updateCard = document.createElement('div');
    updateCard.className = 'glass-card';

    const updateTitle = document.createElement('h3');
    updateTitle.textContent = t('system.softwareUpdates', 'Actualizaciones de Software');

    const updateDesc = document.createElement('p');
    updateDesc.style.cssText = 'color: var(--text-dim); margin-top: 10px;';
    updateDesc.textContent = t('system.checkUpdatesDesc', 'Buscar e instalar actualizaciones de HomePiNAS desde GitHub.');

    const updateStatus = document.createElement('div');
    updateStatus.id = 'update-status';
    updateStatus.style.cssText = 'margin-top: 15px; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 8px;';
    updateStatus.innerHTML = `<span style="color: var(--text-dim);">${t('system.clickToCheck', 'Haz clic en "Buscar Actualizaciones" para verificar...')}</span>`;

    const updateBtnContainer = document.createElement('div');
    updateBtnContainer.style.cssText = 'display: flex; gap: 15px; margin-top: 20px;';

    const checkUpdateBtn = document.createElement('button');
    checkUpdateBtn.className = 'btn-primary';
    checkUpdateBtn.style.cssText = 'background: #6366f1; box-shadow: 0 4px 15px rgba(99, 102, 241, 0.4);';
    checkUpdateBtn.textContent = t('system.checkUpdates', 'Buscar Actualizaciones');
    checkUpdateBtn.addEventListener('click', checkForUpdates);

    const applyUpdateBtn = document.createElement('button');
    applyUpdateBtn.className = 'btn-primary';
    applyUpdateBtn.id = 'apply-update-btn';
    applyUpdateBtn.style.cssText = 'background: #10b981; box-shadow: 0 4px 15px rgba(16, 185, 129, 0.4); display: none;';
    applyUpdateBtn.textContent = t('system.installUpdate', 'Instalar Actualización');
    applyUpdateBtn.addEventListener('click', applyUpdate);

    updateBtnContainer.appendChild(checkUpdateBtn);
    updateBtnContainer.appendChild(applyUpdateBtn);

    updateCard.appendChild(updateTitle);
    updateCard.appendChild(updateDesc);
    updateCard.appendChild(updateStatus);
    updateCard.appendChild(updateBtnContainer);

    dashboardContent.appendChild(mgmtCard);
    dashboardContent.appendChild(infoCard);
    dashboardContent.appendChild(updateCard);
}

async function systemAction(action) {
    const actionLabel = action === 'reboot' ? 'reiniciar' : 'apagar';
    const confirmed = await showConfirmModal('Acción del sistema', `¿Seguro que quieres ${actionLabel} el NAS?`);
    if (!confirmed) return;

    try {
        const res = await authFetch(`${API_BASE}/system/${action}`, { method: 'POST' });

        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'System action failed');
        }

        alert(`${action.toUpperCase()} command sent to Hardware.`);
    } catch (e) {
        console.error('System action error:', e);
        alert(e.message || 'System Logic Fail');
    }
}

window.systemAction = systemAction;

// Update Functions
async function checkForUpdates() {
    const statusEl = document.getElementById('update-status');
    const applyBtn = document.getElementById('apply-update-btn');

    if (!statusEl) return;

    statusEl.innerHTML = `<span style="color: #f59e0b;">${t('system.checkingUpdates', 'Buscando actualizaciones...')}</span>`;
    if (applyBtn) applyBtn.style.display = 'none';

    try {
        const res = await authFetch(`${API_BASE}/update/check`);
        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || t('common.error', 'Error al buscar actualizaciones'));
        }

        // Warning for local changes
        const localChangesWarning = data.localChanges ? `
            <div style="margin-top: 12px; padding: 10px; background: rgba(245, 158, 11, 0.15); border: 1px solid #f59e0b; border-radius: 8px;">
                <div style="color: #f59e0b; font-weight: 600;">⚠️ Cambios locales detectados</div>
                <div style="margin-top: 4px; font-size: 0.85rem; color: var(--text-dim);">
                    Hay archivos modificados localmente. La actualización hará <code>git reset --hard</code> y perderás estos cambios:
                </div>
                <code style="display: block; margin-top: 5px; padding: 6px; background: rgba(0,0,0,0.2); border-radius: 4px; font-size: 0.8rem;">${escapeHtml((data.localChangesFiles || []).join('\n'))}</code>
            </div>
        ` : '';

        if (data.updateAvailable) {
            statusEl.innerHTML = `
                <div style="color: #10b981; font-weight: 600;">${t('system.updateAvailable', '¡Actualización Disponible!')}</div>
                <div style="margin-top: 8px; color: var(--text-dim);">
                    ${t('system.current', 'Actual')}: <strong>v${escapeHtml(data.currentVersion)}</strong> →
                    ${t('system.latest', 'Última')}: <strong style="color: #10b981;">v${escapeHtml(data.latestVersion)}</strong>
                </div>
                <div style="margin-top: 10px; font-size: 0.85rem; color: var(--text-dim);">
                    <strong>${t('system.changes', 'Cambios')}:</strong><br>
                    <code style="display: block; margin-top: 5px; padding: 8px; background: rgba(0,0,0,0.2); border-radius: 4px; white-space: pre-wrap;">${escapeHtml(data.changelog || t('common.info', 'Ver GitHub para detalles'))}</code>
                </div>
                ${localChangesWarning}
            `;
            if (applyBtn) applyBtn.style.display = 'inline-block';
        } else {
            statusEl.innerHTML = `
                <div style="color: #6366f1;">${t('system.upToDate', '¡Estás al día!')}</div>
                <div style="margin-top: 8px; color: var(--text-dim);">
                    ${t('system.version', 'Versión')}: <strong>v${escapeHtml(data.currentVersion)}</strong>
                </div>
                ${localChangesWarning}
            `;
        }
    } catch (e) {
        console.error('Update check error:', e);
        statusEl.innerHTML = `<span style="color: #ef4444;">Error: ${escapeHtml(e.message)}</span>`;
    }
}

async function applyUpdate() {
    const confirmed = await showConfirmModal('Instalar actualización', '¿Instalar la actualización ahora? El servicio se reiniciará y puede perder conexión ~30 segundos.');
    if (!confirmed) return;

    const statusEl = document.getElementById('update-status');
    const applyBtn = document.getElementById('apply-update-btn');

    if (statusEl) {
        statusEl.innerHTML = `<span style="color: #f59e0b;">${t('system.installingUpdate', 'Instalando actualización... Por favor espera.')}</span>`;
    }
    if (applyBtn) {
        applyBtn.disabled = true;
        applyBtn.textContent = t('system.installing', 'Instalando...');
    }

    try {
        const res = await authFetch(`${API_BASE}/update/apply`, { method: 'POST' });
        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || 'Update failed');
        }

        if (statusEl) {
            statusEl.innerHTML = `
                <div style="color: #10b981; font-weight: 600;">Update started!</div>
                <div style="margin-top: 8px; color: var(--text-dim);">
                    The service is restarting. This page will refresh automatically in 30 seconds...
                </div>
                <div style="margin-top: 10px;">
                    <div class="progress-bar" style="height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden;">
                        <div id="update-progress" style="height: 100%; background: #10b981; width: 0%; transition: width 0.5s;"></div>
                    </div>
                </div>
            `;
        }

        // Progress animation and auto-refresh
        let progress = 0;
        const progressEl = document.getElementById('update-progress');
        const interval = setInterval(() => {
            progress += 3.33;
            if (progressEl) progressEl.style.width = `${Math.min(progress, 100)}%`;
            if (progress >= 100) {
                clearInterval(interval);
                window.location.reload();
            }
        }, 1000);

    } catch (e) {
        console.error('Update apply error:', e);
        if (statusEl) {
            statusEl.innerHTML = `<span style="color: #ef4444;">${t('system.updateFailed', 'Actualización fallida')}: ${escapeHtml(e.message)}</span>`;
        }
        if (applyBtn) {
            applyBtn.disabled = false;
            applyBtn.textContent = t('system.retryUpdate', 'Reintentar Actualización');
            applyBtn.style.display = 'inline-block';
        }
    }
}

window.checkForUpdates = checkForUpdates;
window.applyUpdate = applyUpdate;

// Helper Colors
function getRoleColor(role) {
    switch (role) {
        case 'data': return '#6366f1';
        case 'parity': return '#f59e0b';
        case 'cache': return '#10b981';
        case 'independent': return '#14b8a6';
        default: return '#475569';
    }
}

if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
        const confirmed = await showConfirmModal('RESETEAR NAS', '¿Seguro que quieres RESETEAR todo el NAS? Se borrará toda la configuración y será necesario configurarlo de nuevo.');
        if (!confirmed) return;

        resetBtn.textContent = t('system.resettingNode', 'Reseteando Nodo...');
        resetBtn.disabled = true;

        try {
            // Use public factory-reset endpoint (no auth required - for login page)
            const res = await fetch(`${API_BASE}/system/factory-reset`, { method: 'POST' });
            const data = await res.json();

            if (res.ok && data.success) {
                // Clear local session
                clearSession();
                window.location.reload();
            } else {
                alert(t('system.resetFailed', 'Reseteo Fallido') + ': ' + (data.error || t('common.unknown', 'Error desconocido')));
                resetBtn.textContent = t('system.resetSetupData', 'Resetear Configuración');
                resetBtn.disabled = false;
            }
        } catch (e) {
            console.error('Reset error:', e);
            alert(e.message || t('system.resetError', 'Error de Reseteo: Comunicación interrumpida'));
            resetBtn.textContent = t('system.resetSetupData', 'Resetear Configuración');
            resetBtn.disabled = false;
        }
    });
}


// Power menu handler (logout, reboot, shutdown)
const powerBtn = document.getElementById("power-btn");
const powerDropdown = document.getElementById("power-dropdown");
if (powerBtn && powerDropdown) {
    // Toggle dropdown
    powerBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = powerDropdown.style.display !== 'none';
        powerDropdown.style.display = isOpen ? 'none' : 'block';
    });

    // Close dropdown when clicking outside
    document.addEventListener("click", () => {
        powerDropdown.style.display = 'none';
    });
    powerDropdown.addEventListener("click", (e) => e.stopPropagation());

    // Logout
    document.getElementById("power-logout").addEventListener("click", async () => {
        powerDropdown.style.display = 'none';
        const confirmed = await showConfirmModal('Cerrar sesión', '¿Seguro que quieres cerrar sesión?');
        if (confirmed) {
            clearSession();
            state.isAuthenticated = false;
            state.user = null;
            window.location.reload();
        }
    });

    // Reboot
    document.getElementById("power-reboot").addEventListener("click", async () => {
        powerDropdown.style.display = 'none';
        const confirmed = await showConfirmModal('Reiniciar sistema', '¿Seguro que quieres reiniciar el sistema? Se perderán todas las conexiones activas.');
        if (confirmed) {
            try {
                const res = await authFetch(`${API_BASE}/power/reboot`, { method: 'POST' });
                if (res.ok) {
                    showNotification('Sistema reiniciando... La página se recargará en 60 segundos.', 'success', 10000);
                    setTimeout(() => window.location.reload(), 60000);
                } else {
                    const data = await res.json();
                    showNotification(data.error || 'Error al reiniciar', 'error');
                }
            } catch (e) {
                showNotification('Error al reiniciar: ' + e.message, 'error');
            }
        }
    });

    // Shutdown
    document.getElementById("power-shutdown").addEventListener("click", async () => {
        powerDropdown.style.display = 'none';
        const confirmed = await showConfirmModal('Apagar sistema', '⚠️ ¿Seguro que quieres APAGAR el sistema? Necesitarás acceso físico para volver a encenderlo.');
        if (confirmed) {
            try {
                const res = await authFetch(`${API_BASE}/power/shutdown`, { method: 'POST' });
                if (res.ok) {
                    showNotification('Sistema apagándose...', 'warning', 10000);
                } else {
                    const data = await res.json();
                    showNotification(data.error || 'Error al apagar', 'error');
                }
            } catch (e) {
                showNotification('Error al apagar: ' + e.message, 'error');
            }
        }
    });
}


    // Expose to window
    window.AppStorageWizard = {
        render: renderStorageWizard,
        state: wizardState
    };
    
})(window);
