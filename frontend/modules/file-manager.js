/**
 * File Manager Module
 * File Station - file browser and management
 * 
 * NOTE: This file exceeds 300 lines due to complex file operations
 * and UI interactions. Keeping cohesive for now.
 */
(function(window) {
    'use strict';
    
    const state = window.AppState;
    const API_BASE = window.API_BASE;
    const escapeHtml = window.AppUtils.escapeHtml;

// =============================================================================

let currentFilePath = '/';
let fmViewMode = localStorage.getItem('fm-view-mode') || 'list'; // 'list' | 'grid'
let fmSelectedFiles = new Set(); // Set of full file paths for multi-select
let fmCurrentFiles = []; // current loaded file list for reference
let fmClipboard = { action: null, files: [] }; // { action: 'copy'|'cut', files: [{path, name}] }

// Thumbnail loading queue — limits concurrent downloads to avoid overwhelming the Pi
const _thumbBlobUrls = []; // Track blob URLs for cleanup
let _thumbQueueActive = 0;
const _thumbQueuePending = [];
const THUMB_MAX_CONCURRENT = 3;

function _cleanupThumbBlobs() {
    while (_thumbBlobUrls.length > 0) {
        URL.revokeObjectURL(_thumbBlobUrls.pop());
    }
    _thumbQueuePending.length = 0;
    _thumbQueueActive = 0;
}

function _enqueueThumbLoad(thumb, url) {
    _thumbQueuePending.push({ thumb, url });
    _processThumbQueue();
}

function _processThumbQueue() {
    while (_thumbQueueActive < THUMB_MAX_CONCURRENT && _thumbQueuePending.length > 0) {
        const { thumb, url } = _thumbQueuePending.shift();
        _thumbQueueActive++;
        authFetch(url)
            .then(r => r.ok ? r.blob() : null)
            .then(blob => {
                if (blob && thumb.isConnected) {
                    const blobUrl = URL.createObjectURL(blob);
                    _thumbBlobUrls.push(blobUrl);
                    thumb.src = blobUrl;
                }
            })
            .catch(() => {})
            .finally(() => {
                _thumbQueueActive--;
                _processThumbQueue();
            });
    }
}

async function renderFilesView() {
    // ══════════════════════════════════════════════════════════════════════════
    // FILE MANAGER - SYNOLOGY STYLE LAYOUT
    // ══════════════════════════════════════════════════════════════════════════
    
    // Revoke previous thumbnail blob URLs to prevent memory leaks
    _cleanupThumbBlobs();

    // Clear previous content to avoid duplicates
    dashboardContent.innerHTML = '';
    
    // Main layout container
    const layout = document.createElement('div');
    layout.className = 'fm-layout';
    
    // ── LEFT SIDEBAR: Folder Tree ──
    const sidebar = document.createElement('div');
    sidebar.className = 'fm-sidebar';
    sidebar.innerHTML = `
        <div class="fm-sidebar-header">📂 Carpetas</div>
        <div class="fm-tree" id="fm-tree"></div>
    `;
    layout.appendChild(sidebar);
    
    // ── RIGHT PANEL: Main Content ──
    const main = document.createElement('div');
    main.className = 'fm-main';
    
    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'fm-main-toolbar';
    
    // Row 1: breadcrumb + actions
    const toolbarRow1 = document.createElement('div');
    toolbarRow1.className = 'fm-toolbar-row';

    // Breadcrumb
    const breadcrumb = document.createElement('div');
    breadcrumb.className = 'fm-breadcrumb';
    breadcrumb.id = 'fm-breadcrumb';
    updateBreadcrumb(breadcrumb, currentFilePath);

    // Actions right
    const actions = document.createElement('div');
    actions.className = 'fm-actions';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = '🔍 Buscar...';
    searchInput.className = 'fm-search-input';
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') searchFiles(searchInput.value); // Deep search on Enter
    });
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim().toLowerCase();
        if (!query) {
            // Empty search: show all files
            renderFilteredFiles(fmCurrentFiles);
        } else {
            // Local filter: instant results
            const filtered = fmCurrentFiles.filter(f => 
                f.name.toLowerCase().includes(query)
            );
            renderFilteredFiles(filtered, query);
        }
    });

    const uploadBtn = document.createElement('button');
    uploadBtn.className = 'btn-primary btn-sm';
    uploadBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Subir';
    uploadBtn.addEventListener('click', () => triggerFileUpload());

    const newFolderBtn = document.createElement('button');
    newFolderBtn.className = 'btn-primary btn-sm';
    newFolderBtn.style.background = '#6366f1';
    newFolderBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg> Carpeta';
    newFolderBtn.addEventListener('click', () => createNewFolder());

    // View mode toggle
    const viewToggle = document.createElement('div');
    viewToggle.className = 'fm-view-toggle';
    const listBtn = document.createElement('button');
    listBtn.className = 'fm-view-btn' + (fmViewMode === 'list' ? ' active' : '');
    listBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>';
    listBtn.title = 'Vista lista';
    listBtn.addEventListener('click', () => { fmViewMode = 'list'; localStorage.setItem('fm-view-mode', 'list'); renderFilesView(); });
    const gridBtn = document.createElement('button');
    gridBtn.className = 'fm-view-btn' + (fmViewMode === 'grid' ? ' active' : '');
    gridBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>';
    gridBtn.title = 'Vista cuadrícula';
    gridBtn.addEventListener('click', () => { fmViewMode = 'grid'; localStorage.setItem('fm-view-mode', 'grid'); renderFilesView(); });
    viewToggle.appendChild(listBtn);
    viewToggle.appendChild(gridBtn);

    actions.appendChild(searchInput);
    actions.appendChild(uploadBtn);
    actions.appendChild(newFolderBtn);
    actions.appendChild(viewToggle);

    toolbarRow1.appendChild(breadcrumb);
    toolbarRow1.appendChild(actions);
    toolbar.appendChild(toolbarRow1);

    // Row 2: Bulk actions bar (hidden by default)
    const bulkBar = document.createElement('div');
    bulkBar.className = 'fm-bulk-bar';
    bulkBar.id = 'fm-bulk-bar';
    bulkBar.style.display = 'none';
    bulkBar.innerHTML = `
        <span class="fm-bulk-count" id="fm-bulk-count">0 seleccionados</span>
        <button class="fm-bulk-btn" data-action="bulk-download" title="Descargar seleccionados"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Descargar</button>
        <button class="fm-bulk-btn" data-action="bulk-copy" title="Copiar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Copiar</button>
        <button class="fm-bulk-btn" data-action="bulk-cut" title="Mover"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg> Mover</button>
        <button class="fm-bulk-btn fm-bulk-btn-danger" data-action="bulk-delete" title="Eliminar seleccionados"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg> Eliminar</button>
        <button class="fm-bulk-btn" data-action="bulk-clear" title="Deseleccionar">✕ Limpiar</button>
    `;
    bulkBar.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        switch (btn.dataset.action) {
            case 'bulk-download': fmBulkDownload(); break;
            case 'bulk-copy': fmBulkCopy(); break;
            case 'bulk-cut': fmBulkCut(); break;
            case 'bulk-delete': fmBulkDelete(); break;
            case 'bulk-clear': fmClearSelection(); break;
        }
    });
    toolbar.appendChild(bulkBar);

    // Paste bar (when clipboard has items)
    if (fmClipboard.action && fmClipboard.files.length > 0) {
        const pasteBar = document.createElement('div');
        pasteBar.className = 'fm-paste-bar';
        pasteBar.innerHTML = `
            <span>📋 ${fmClipboard.files.length} archivo(s) en portapapeles (${fmClipboard.action === 'copy' ? 'copiar' : 'mover'})</span>
            <button class="btn-primary btn-sm" data-action="paste">📋 Pegar aquí</button>
            <button class="fm-bulk-btn" data-action="clear-clipboard">✕ Cancelar</button>
        `;
        pasteBar.querySelector('[data-action="paste"]').addEventListener('click', () => fmPaste());
        pasteBar.querySelector('[data-action="clear-clipboard"]').addEventListener('click', () => { fmClipboard = {action: null, files: []}; renderFilesView(); });
        toolbar.appendChild(pasteBar);
    }

    main.appendChild(toolbar);
    
    // Upload progress bar
    const uploadProgress = document.createElement('div');
    uploadProgress.className = 'fm-upload-progress';
    uploadProgress.id = 'fm-upload-progress';
    uploadProgress.style.display = 'none';
    uploadProgress.innerHTML = `
        <div class="fm-upload-info">
            <span id="fm-upload-filename">Subiendo...</span>
            <span id="fm-upload-percent">0%</span>
        </div>
        <div class="fm-progress-track">
            <div class="fm-progress-fill" id="fm-progress-fill" style="width: 0%"></div>
        </div>
    `;
    main.appendChild(uploadProgress);

    // Main content area (files list)
    const content = document.createElement('div');
    content.className = 'fm-main-content';
    content.id = 'fm-main-content';
    
    // Drag & drop overlay
    const dropZone = document.createElement('div');
    dropZone.className = 'fm-drop-zone';
    dropZone.id = 'fm-drop-zone';
    dropZone.innerHTML = `
        <div class="fm-drop-inner">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--primary, #84cc16)" stroke-width="1.5">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <p style="margin-top: 12px; font-size: 1.1rem; font-weight: 600;">Suelta los archivos aquí</p>
            <p style="font-size: 0.85rem; color: var(--text-dim);">Se subirán a <strong>${escapeHtml(currentFilePath)}</strong></p>
        </div>
    `;
    content.appendChild(dropZone);

    // Table header (only for list view)
    if (fmViewMode === 'list') {
        const tableHeader = document.createElement('div');
        tableHeader.className = 'fm-table-header';
        tableHeader.innerHTML = `
            <label class="fm-checkbox-wrap"><input type="checkbox" id="fm-select-all"><span class="fm-checkbox-custom"></span></label>
            <span></span>
            <span>Nombre</span>
            <span>Tamaño</span>
            <span class="fm-hide-mobile">Modificado</span>
            <span class="fm-hide-mobile">Permisos</span>
            <span></span>
        `;
        tableHeader.querySelector('#fm-select-all').addEventListener('change', function() { fmToggleSelectAll(this.checked); });
        content.appendChild(tableHeader);
    }

    const filesList = document.createElement('div');
    filesList.id = 'files-list';
    filesList.className = fmViewMode === 'grid' ? 'fm-grid' : 'fm-list';
    content.appendChild(filesList);

    main.appendChild(content);
    layout.appendChild(main);
    dashboardContent.appendChild(layout);

    // ── Setup drag & drop ──
    fmSetupDragDrop(layout);

    // Hidden file input
    let fileInput = document.getElementById('file-upload-input');
    if (!fileInput) {
        fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.id = 'file-upload-input';
        fileInput.multiple = true;
        fileInput.style.display = 'none';
        fileInput.addEventListener('change', handleFileUpload);
        document.body.appendChild(fileInput);
    }

    fmSelectedFiles.clear();
    
    // Load folder tree and files in parallel
    await Promise.all([
        loadFolderTree(),
        loadFiles(currentFilePath)
    ]);
}

// ══════════════════════════════════════════════════════════════════════════════
// FOLDER TREE (Synology-style sidebar)
// ══════════════════════════════════════════════════════════════════════════════
let fmExpandedFolders = new Set(['/']);

async function loadFolderTree() {
    const treeContainer = document.getElementById('fm-tree');
    if (!treeContainer) return;
    
    treeContainer.innerHTML = '<div style="padding: 12px; color: var(--text-dim);">Cargando...</div>';
    
    try {
        // Build tree starting from root
        const tree = await buildFolderTree('/');
        treeContainer.innerHTML = '';
        renderFolderTree(treeContainer, tree, 0);
    } catch (e) {
        console.error('loadFolderTree error:', e);
        treeContainer.innerHTML = '<div style="padding: 12px; color: #ef4444;">Error al cargar</div>';
    }
}

async function buildFolderTree(path) {
    try {
        const res = await authFetch(`${API_BASE}/files/list?path=${encodeURIComponent(path)}`);
        if (!res.ok) return { name: path.split('/').pop() || 'Storage', path, children: [] };
        const data = await res.json();
        
        const items = data.items || data.files || [];
        const folders = items
            .filter(f => f.type === 'directory' || f.isDirectory)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(f => ({
                name: f.name,
                path: path === '/' ? '/' + f.name : path + '/' + f.name,
                children: null // Lazy load
            }));
        
        return {
            name: path === '/' ? 'Storage' : path.split('/').pop(),
            path,
            children: folders
        };
    } catch (e) {
        return { name: path.split('/').pop() || 'Storage', path, children: [] };
    }
}

function renderFolderTree(container, node, level) {
    const item = document.createElement('div');
    item.className = 'fm-tree-item' + (currentFilePath === node.path ? ' active' : '');
    item.style.paddingLeft = (12 + level * 16) + 'px';
    
    // hasChildren: true if has loaded children OR children is null (not yet loaded)
    const hasChildren = node.children === null || (node.children && node.children.length > 0);
    const isExpanded = fmExpandedFolders.has(node.path);
    
    // Expand/collapse arrow
    const expandBtn = document.createElement('span');
    expandBtn.className = 'fm-tree-expand' + (isExpanded ? ' expanded' : '');
    expandBtn.innerHTML = hasChildren ? '▶' : '';
    expandBtn.style.visibility = hasChildren ? 'visible' : 'hidden';
    
    // Folder icon
    const icon = document.createElement('span');
    icon.className = 'fm-tree-icon';
    icon.textContent = isExpanded && hasChildren ? '📂' : '📁';
    
    // Folder name
    const name = document.createElement('span');
    name.textContent = node.name;
    name.style.overflow = 'hidden';
    name.style.textOverflow = 'ellipsis';
    
    item.appendChild(expandBtn);
    item.appendChild(icon);
    item.appendChild(name);
    
    // Click to navigate
    item.addEventListener('click', async (e) => {
        if (e.target === expandBtn || e.target.closest('.fm-tree-expand')) {
            // Toggle expand/collapse
            e.stopPropagation();
            if (isExpanded) {
                fmExpandedFolders.delete(node.path);
            } else {
                fmExpandedFolders.add(node.path);
                // Load children if not yet loaded
                if (node.children === null) {
                    const childData = await buildFolderTree(node.path);
                    node.children = childData.children || [];
                }
            }
            await loadFolderTree();
        } else {
            // Navigate to folder
            currentFilePath = node.path;
            fmExpandedFolders.add(node.path);
            // Load children if not yet loaded
            if (node.children === null) {
                const childData = await buildFolderTree(node.path);
                node.children = childData.children || [];
            }
            await renderFilesView();
        }
    });
    
    // ── Drop target for drag & drop ──
    item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        item.classList.add('drop-target');
    });
    item.addEventListener('dragleave', () => {
        item.classList.remove('drop-target');
    });
    item.addEventListener('drop', async (e) => {
        e.preventDefault();
        item.classList.remove('drop-target');
        
        try {
            const data = JSON.parse(e.dataTransfer.getData('text/plain'));
            if (data.path && data.name) {
                // Don't move to same folder
                const srcFolder = data.path.substring(0, data.path.lastIndexOf('/')) || '/';
                if (srcFolder === node.path) return;
                
                // Move file
                const destPath = node.path === '/' ? '/' + data.name : node.path + '/' + data.name;
                const res = await authFetch(`${API_BASE}/files/move`, {
                    method: 'POST',
                    body: JSON.stringify({ source: data.path, destination: destPath })
                });
                
                if (res.ok) {
                    showNotification(`"${data.name}" movido a ${node.path}`, 'success');
                    await renderFilesView();
                } else {
                    const err = await res.json().catch(() => ({}));
                    showNotification('Error: ' + (err.error || 'No se pudo mover'), 'error');
                }
            }
        } catch (e) {
            console.error('Drop error:', e);
        }
    });
    
    container.appendChild(item);
    
    // Render children if expanded AND loaded
    if (hasChildren && isExpanded && Array.isArray(node.children) && node.children.length > 0) {
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'fm-tree-children';
        node.children.forEach(child => {
            renderFolderTree(childrenContainer, child, level + 1);
        });
        container.appendChild(childrenContainer);
    }
}

// ── Breadcrumb ──
function updateBreadcrumb(breadcrumb, filePath) {
    breadcrumb.innerHTML = '';
    const parts = filePath.split('/').filter(Boolean);

    const homeBtn = document.createElement('button');
    homeBtn.className = 'fm-breadcrumb-btn';
    homeBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>';
    homeBtn.title = 'Storage';
    homeBtn.addEventListener('click', () => { currentFilePath = '/'; renderFilesView(); });
    breadcrumb.appendChild(homeBtn);

    let accPath = '';
    parts.forEach((part, i) => {
        accPath += '/' + part;
        const sep = document.createElement('span');
        sep.className = 'fm-breadcrumb-sep';
        sep.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>';
        breadcrumb.appendChild(sep);

        const btn = document.createElement('button');
        btn.textContent = part;
        btn.className = 'fm-breadcrumb-btn' + (i === parts.length - 1 ? ' active' : '');
        const targetPath = accPath;
        btn.addEventListener('click', () => { currentFilePath = targetPath; renderFilesView(); });
        breadcrumb.appendChild(btn);
    });
}

// ── Load files ──
async function loadFiles(filePath) {
    const filesList = document.getElementById('files-list');
    if (!filesList) return;
    filesList.innerHTML = '<div class="fm-empty-state"><div class="fm-spinner"></div><p>Cargando archivos...</p></div>';

    try {
        const res = await authFetch(`${API_BASE}/files/list?path=${encodeURIComponent(filePath)}`);
        if (!res.ok) throw new Error('Failed to load files');
        const data = await res.json();
        const files = data.items || data || [];

        fmCurrentFiles = files;

        if (files.length === 0) {
            filesList.innerHTML = `<div class="fm-empty-state">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="1" opacity="0.4">
                    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                </svg>
                <p style="margin-top:12px">Carpeta vacía</p>
                <p style="font-size:0.8rem;color:var(--text-dim)">Arrastra archivos aquí o usa el botón Subir</p>
            </div>`;
            return;
        }

        // Sort: folders first, then alphabetical
        files.sort((a, b) => {
            if (a.type === 'directory' && b.type !== 'directory') return -1;
            if (a.type !== 'directory' && b.type === 'directory') return 1;
            return a.name.localeCompare(b.name);
        });

        filesList.innerHTML = '';

        if (fmViewMode === 'grid') {
            renderFilesGrid(filesList, files, filePath);
        } else {
            renderFilesList(filesList, files, filePath);
        }
    } catch (e) {
        console.error('Load files error:', e);
        filesList.innerHTML = '<div class="fm-empty-state" style="color:#ef4444"><p>❌ Error al cargar archivos</p></div>';
    }
}

// ── Render filtered files (for local search) ──
function renderFilteredFiles(files, highlightQuery = '') {
    const filesList = document.getElementById('files-list');
    if (!filesList) return;

    if (files.length === 0) {
        filesList.innerHTML = `<div class="fm-empty-state">
            <p>🔍 Sin resultados${highlightQuery ? ' para "' + highlightQuery + '"' : ''}</p>
            <p style="font-size:0.8rem;color:var(--text-dim)">Presiona Enter para buscar en subcarpetas</p>
        </div>`;
        return;
    }

    // Sort: folders first, then alphabetical
    const sorted = [...files].sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1;
        if (a.type !== 'directory' && b.type === 'directory') return 1;
        return a.name.localeCompare(b.name);
    });

    filesList.innerHTML = '';
    if (fmViewMode === 'grid') {
        renderFilesGrid(filesList, sorted, currentFilePath);
    } else {
        renderFilesList(filesList, sorted, currentFilePath);
    }
}

// ── Render list view ──
function renderFilesList(container, files, filePath) {
    files.forEach(file => {
        const fullPath = filePath + '/' + file.name;
        const isSelected = fmSelectedFiles.has(fullPath);
        const row = document.createElement('div');
        row.className = 'fm-row' + (isSelected ? ' selected' : '');
        row.dataset.path = fullPath;

        const checkbox = document.createElement('label');
        checkbox.className = 'fm-checkbox-wrap';
        checkbox.innerHTML = `<input type="checkbox" ${isSelected ? 'checked' : ''} data-path="${fullPath.replace(/"/g, '&quot;')}"><span class="fm-checkbox-custom"></span>`;
        checkbox.querySelector('input').addEventListener('change', function() { fmToggleSelect(this.dataset.path, this.checked); });
        checkbox.addEventListener('click', (e) => e.stopPropagation());

        const iconWrap = document.createElement('span');
        iconWrap.className = 'fm-file-icon';
        iconWrap.innerHTML = file.type === 'directory' ? getFolderSVG() : getFileIconSVG(file.name);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'fm-file-name';
        nameSpan.textContent = file.name;

        const sizeSpan = document.createElement('span');
        sizeSpan.className = 'fm-file-meta';
        sizeSpan.textContent = file.type === 'directory' ? '—' : formatFileSize(file.size);

        const dateSpan = document.createElement('span');
        dateSpan.className = 'fm-file-meta fm-hide-mobile';
        dateSpan.textContent = file.modified ? new Date(file.modified).toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

        const permSpan = document.createElement('span');
        permSpan.className = 'fm-file-meta fm-hide-mobile fm-file-perm';
        permSpan.textContent = file.permissions || file.mode || '—';

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'fm-row-actions';

        if (file.type !== 'directory') {
            const dlBtn = document.createElement('button');
            dlBtn.className = 'fm-action-btn';
            dlBtn.title = 'Descargar';
            dlBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
            dlBtn.addEventListener('click', (e) => { e.stopPropagation(); downloadFile(fullPath); });
            actionsDiv.appendChild(dlBtn);
        }

        const menuBtn = document.createElement('button');
        menuBtn.className = 'fm-action-btn';
        menuBtn.title = 'Más opciones';
        menuBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>';
        menuBtn.addEventListener('click', (e) => { e.stopPropagation(); showFileContextMenu(e, fullPath, file); });
        actionsDiv.appendChild(menuBtn);

        row.appendChild(checkbox);
        row.appendChild(iconWrap);
        row.appendChild(nameSpan);
        row.appendChild(sizeSpan);
        row.appendChild(dateSpan);
        row.appendChild(permSpan);
        row.appendChild(actionsDiv);

        row.addEventListener('click', (e) => {
            if (file.type === 'directory') {
                currentFilePath = fullPath;
                renderFilesView();
            } else {
                fmPreviewFile(file, filePath);
            }
        });

        row.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showFileContextMenu(e, fullPath, file);
        });

        // ── Drag & Drop ──
        row.draggable = true;
        row.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', JSON.stringify({ path: fullPath, name: file.name }));
            e.dataTransfer.effectAllowed = 'move';
            row.classList.add('dragging');
            document.body.classList.add('fm-dragging');
        });
        row.addEventListener('dragend', () => {
            row.classList.remove('dragging');
            document.body.classList.remove('fm-dragging');
        });

        container.appendChild(row);
    });
}

// ── Render grid view ──
function renderFilesGrid(container, files, filePath) {
    files.forEach(file => {
        const fullPath = filePath + '/' + file.name;
        const isSelected = fmSelectedFiles.has(fullPath);
        const card = document.createElement('div');
        card.className = 'fm-grid-item' + (isSelected ? ' selected' : '');
        card.dataset.path = fullPath;

        const checkbox = document.createElement('label');
        checkbox.className = 'fm-checkbox-wrap fm-grid-checkbox';
        checkbox.innerHTML = `<input type="checkbox" ${isSelected ? 'checked' : ''} data-path="${fullPath.replace(/"/g, '&quot;')}"><span class="fm-checkbox-custom"></span>`;
        checkbox.querySelector('input').addEventListener('change', function() { fmToggleSelect(this.dataset.path, this.checked); });
        checkbox.addEventListener('click', (e) => e.stopPropagation());

        const iconArea = document.createElement('div');
        iconArea.className = 'fm-grid-icon';

        // For images, show thumbnail (fetch via headers to avoid sessionId in URL)
        const ext = file.name.split('.').pop().toLowerCase();
        const imgExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'];
        if (file.type !== 'directory' && imgExts.includes(ext)) {
            const thumb = document.createElement('img');
            thumb.className = 'fm-grid-thumb';
            thumb.alt = file.name;
            thumb.loading = 'lazy';
            iconArea.appendChild(thumb);
            // Enqueue thumbnail load (throttled to THUMB_MAX_CONCURRENT)
            _enqueueThumbLoad(thumb, `${API_BASE}/files/download?path=${encodeURIComponent(fullPath)}`);
        } else {
            iconArea.innerHTML = file.type === 'directory' ? getFolderSVG(48) : getFileIconSVG(file.name, 48);
        }

        const nameLabel = document.createElement('div');
        nameLabel.className = 'fm-grid-name';
        nameLabel.textContent = file.name;
        nameLabel.title = file.name;

        const metaLabel = document.createElement('div');
        metaLabel.className = 'fm-grid-meta';
        metaLabel.textContent = file.type === 'directory' ? 'Carpeta' : formatFileSize(file.size);

        card.appendChild(checkbox);
        card.appendChild(iconArea);
        card.appendChild(nameLabel);
        card.appendChild(metaLabel);

        card.addEventListener('click', (e) => {
            if (file.type === 'directory') {
                currentFilePath = fullPath;
                renderFilesView();
            } else {
                fmPreviewFile(file, filePath);
            }
        });

        card.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showFileContextMenu(e, fullPath, file);
        });

        // ── Drag & Drop ──
        card.draggable = true;
        card.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', JSON.stringify({ path: fullPath, name: file.name }));
            e.dataTransfer.effectAllowed = 'move';
            card.classList.add('dragging');
            document.body.classList.add('fm-dragging');
        });
        card.addEventListener('dragend', () => {
            card.classList.remove('dragging');
            document.body.classList.remove('fm-dragging');
        });

        container.appendChild(card);
    });
}

// ── File Icons (SVG) ──
function getFileIconSVG(name, size) {
    const s = size || 24;
    const ext = name.split('.').pop().toLowerCase();
    const colorMap = {
        // Images
        jpg: '#e879f9', jpeg: '#e879f9', png: '#e879f9', gif: '#e879f9', svg: '#e879f9', webp: '#e879f9', bmp: '#e879f9', ico: '#e879f9',
        // Video
        mp4: '#f97316', mkv: '#f97316', avi: '#f97316', mov: '#f97316', wmv: '#f97316', flv: '#f97316', webm: '#f97316',
        // Audio
        mp3: '#06b6d4', flac: '#06b6d4', wav: '#06b6d4', ogg: '#06b6d4', aac: '#06b6d4', wma: '#06b6d4', m4a: '#06b6d4',
        // Documents
        pdf: '#ef4444', doc: '#3b82f6', docx: '#3b82f6', xls: '#22c55e', xlsx: '#22c55e', ppt: '#f97316', pptx: '#f97316',
        txt: '#94a3b8', md: '#94a3b8', csv: '#22c55e', rtf: '#3b82f6',
        // Archives
        zip: '#eab308', tar: '#eab308', gz: '#eab308', rar: '#eab308', '7z': '#eab308', bz2: '#eab308', xz: '#eab308',
        // Code
        js: '#eab308', ts: '#3b82f6', py: '#22c55e', sh: '#22c55e', json: '#eab308', yml: '#ef4444', yaml: '#ef4444',
        html: '#f97316', css: '#3b82f6', php: '#8b5cf6', rb: '#ef4444', go: '#06b6d4', rs: '#f97316', java: '#ef4444',
        c: '#3b82f6', cpp: '#3b82f6', h: '#3b82f6', xml: '#f97316', sql: '#3b82f6',
        // Disk images
        iso: '#8b5cf6', img: '#8b5cf6', dmg: '#8b5cf6',
        // Config
        conf: '#94a3b8', cfg: '#94a3b8', ini: '#94a3b8', env: '#94a3b8', log: '#94a3b8', toml: '#94a3b8',
        // Fonts
        ttf: '#e879f9', otf: '#e879f9', woff: '#e879f9', woff2: '#e879f9',
    };
    const labelMap = {
        pdf: 'PDF', doc: 'DOC', docx: 'DOC', xls: 'XLS', xlsx: 'XLS', ppt: 'PPT', pptx: 'PPT',
        zip: 'ZIP', tar: 'TAR', gz: 'GZ', rar: 'RAR', '7z': '7Z',
        js: 'JS', ts: 'TS', py: 'PY', sh: 'SH', json: '{ }', yml: 'YML', yaml: 'YML',
        html: 'HTML', css: 'CSS', php: 'PHP', sql: 'SQL',
        mp3: '♪', flac: '♪', wav: '♪', ogg: '♪', aac: '♪', m4a: '♪',
        mp4: '▶', mkv: '▶', avi: '▶', mov: '▶', webm: '▶',
        jpg: '🖼', jpeg: '🖼', png: '🖼', gif: '🖼', svg: '🖼', webp: '🖼',
        iso: 'ISO', img: 'IMG',
    };
    const color = colorMap[ext] || '#94a3b8';
    const label = labelMap[ext] || ext.toUpperCase().slice(0, 4);
    const labelFontSize = label.length > 3 ? (s * 0.2) : (s * 0.28);
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" fill="${color}20" stroke="${color}" stroke-width="1.5"/>
        <polyline points="14 2 14 8 20 8" stroke="${color}" stroke-width="1.5"/>
        <text x="12" y="17" text-anchor="middle" fill="${color}" font-size="${labelFontSize}" font-weight="700" font-family="system-ui">${label}</text>
    </svg>`;
}

function getFolderSVG(size) {
    const s = size || 24;
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none">
        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" fill="#eab30830" stroke="#eab308" stroke-width="1.5"/>
    </svg>`;
}

function getFileIcon(name) {
    // Legacy compat — returns emoji
    const ext = name.split('.').pop().toLowerCase();
    const iconMap = {
        jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', svg: '🖼️', webp: '🖼️', bmp: '🖼️',
        mp4: '🎬', mkv: '🎬', avi: '🎬', mov: '🎬', webm: '🎬',
        mp3: '🎵', flac: '🎵', wav: '🎵', ogg: '🎵', aac: '🎵', m4a: '🎵',
        pdf: '📕', doc: '📄', docx: '📄', xls: '📊', xlsx: '📊', ppt: '📊', pptx: '📊',
        txt: '📝', md: '📝', csv: '📊', rtf: '📄',
        zip: '📦', tar: '📦', gz: '📦', rar: '📦', '7z': '📦',
        js: '⚙️', ts: '⚙️', py: '🐍', sh: '🔧', json: '{ }', yml: '⚙️', yaml: '⚙️',
        html: '🌐', css: '🎨', php: '🐘', sql: '🗃️',
        iso: '💿', img: '💿', dmg: '💿',
        conf: '⚙️', cfg: '⚙️', ini: '⚙️', log: '📋', env: '🔒',
        ttf: '🔤', otf: '🔤', woff: '🔤',
    };
    return iconMap[ext] || '📄';
}

function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function triggerFileUpload() {
    const input = document.getElementById('file-upload-input');
    if (input) input.click();
}

// ── Upload with progress ──
async function handleFileUpload(e) {
    const files = e.target ? e.target.files : e;
    if (!files || files.length === 0) return;

    const progressEl = document.getElementById('fm-upload-progress');
    const filenameEl = document.getElementById('fm-upload-filename');
    const percentEl = document.getElementById('fm-upload-percent');
    const fillEl = document.getElementById('fm-progress-fill');
    if (progressEl) progressEl.style.display = 'block';

    const fileArray = Array.from(files);
    for (let idx = 0; idx < fileArray.length; idx++) {
        const file = fileArray[idx];
        if (filenameEl) filenameEl.textContent = `(${idx + 1}/${fileArray.length}) ${file.name}`;
        if (percentEl) percentEl.textContent = '0%';
        if (fillEl) fillEl.style.width = '0%';

        const formData = new FormData();
        formData.append('files', file);
        formData.append('path', currentFilePath);

        // Speed calculation
        let uploadStartTime = Date.now();
        let lastLoaded = 0;
        let lastTime = uploadStartTime;

        try {
            // Helper to perform upload with current CSRF token
            const doUpload = () => new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open('POST', `${API_BASE}/files/upload`);
                xhr.setRequestHeader('X-Session-Id', state.sessionId);
                if (state.csrfToken) xhr.setRequestHeader('X-CSRF-Token', state.csrfToken);
                uploadStartTime = Date.now();
                lastTime = uploadStartTime;
                lastLoaded = 0;

                xhr.upload.addEventListener('progress', (ev) => {
                    if (ev.lengthComputable) {
                        const pct = Math.round((ev.loaded / ev.total) * 100);
                        const now = Date.now();
                        const elapsed = (now - lastTime) / 1000; // seconds
                        
                        // Calculate speed (use instant speed with smoothing)
                        let speed = 0;
                        if (elapsed > 0.1) { // Update every 100ms minimum
                            const bytesDelta = ev.loaded - lastLoaded;
                            speed = bytesDelta / elapsed; // bytes per second
                            lastLoaded = ev.loaded;
                            lastTime = now;
                        }
                        
                        // Also calculate average speed for ETA
                        const totalElapsed = (now - uploadStartTime) / 1000;
                        const avgSpeed = totalElapsed > 0 ? ev.loaded / totalElapsed : 0;
                        const remaining = ev.total - ev.loaded;
                        const eta = avgSpeed > 0 ? remaining / avgSpeed : 0;
                        
                        // Format speed
                        let speedStr = '';
                        if (speed > 0 || avgSpeed > 0) {
                            const displaySpeed = speed > 0 ? speed : avgSpeed;
                            if (displaySpeed >= 1024 * 1024 * 1024) {
                                speedStr = (displaySpeed / (1024 * 1024 * 1024)).toFixed(1) + ' GB/s';
                            } else if (displaySpeed >= 1024 * 1024) {
                                speedStr = (displaySpeed / (1024 * 1024)).toFixed(1) + ' MB/s';
                            } else if (displaySpeed >= 1024) {
                                speedStr = (displaySpeed / 1024).toFixed(0) + ' KB/s';
                            } else {
                                speedStr = displaySpeed.toFixed(0) + ' B/s';
                            }
                        }
                        
                        // Format ETA
                        let etaStr = '';
                        if (eta > 0 && eta < 86400) { // Less than 24h
                            if (eta >= 3600) {
                                etaStr = Math.floor(eta / 3600) + 'h ' + Math.floor((eta % 3600) / 60) + 'm';
                            } else if (eta >= 60) {
                                etaStr = Math.floor(eta / 60) + 'm ' + Math.floor(eta % 60) + 's';
                            } else {
                                etaStr = Math.floor(eta) + 's';
                            }
                        }
                        
                        if (percentEl) {
                            percentEl.textContent = `${pct}%${speedStr ? ' • ' + speedStr : ''}${etaStr ? ' • ' + etaStr : ''}`;
                        }
                        if (fillEl) fillEl.style.width = pct + '%';
                    }
                });

                xhr.addEventListener('load', () => {
                    if (xhr.status >= 200 && xhr.status < 300) resolve();
                    else reject({ status: xhr.status, response: xhr.responseText });
                });
                xhr.addEventListener('error', () => reject({ status: 0, response: 'Network error' }));
                xhr.send(formData);
            });

            try {
                await doUpload();
            } catch (uploadErr) {
                // If 403, try refreshing CSRF token and retry once
                if (uploadErr.status === 403) {
                    console.log('CSRF token expired, refreshing...');
                    try {
                        const refreshRes = await fetch(`${API_BASE}/verify-session`, {
                            method: 'POST',
                            headers: { 'X-Session-Id': state.sessionId }
                        });
                        if (refreshRes.ok) {
                            const data = await refreshRes.json();
                            if (data.csrfToken) {
                                state.csrfToken = data.csrfToken;
                                sessionStorage.setItem('csrfToken', data.csrfToken);
                                console.log('CSRF token refreshed, retrying upload...');
                                await doUpload();
                            } else {
                                throw new Error('No CSRF token in response');
                            }
                        } else {
                            // Session invalid, force re-login
                            clearSession();
                            switchView('login');
                            throw new Error('Session expired');
                        }
                    } catch (refreshErr) {
                        throw new Error('Upload failed: ' + uploadErr.status);
                    }
                } else {
                    throw new Error('Upload failed: ' + uploadErr.status);
                }
            }
        } catch (err) {
            console.error('Upload error:', err);
            alert(`Error al subir ${file.name}`);
        }
    }

    if (progressEl) {
        if (fillEl) fillEl.style.width = '100%';
        if (filenameEl) filenameEl.textContent = '✅ Subida completada';
        setTimeout(() => { progressEl.style.display = 'none'; }, 2000);
    }

    if (e.target) e.target.value = '';
    await loadFiles(currentFilePath);
}

// ── Drag & Drop ──
function fmSetupDragDrop(container) {
    let dragCounter = 0;
    const dropZone = document.getElementById('fm-drop-zone');
    if (!dropZone) return;

    const showDrop = () => dropZone.classList.add('active');
    const hideDrop = () => { dropZone.classList.remove('active'); dragCounter = 0; };

    container.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        if (e.dataTransfer.types.includes('Files')) showDrop();
    });
    container.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) hideDrop();
    });
    container.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    });
    container.addEventListener('drop', (e) => {
        e.preventDefault();
        hideDrop();
        if (e.dataTransfer.files.length > 0) {
            handleFileUpload(e.dataTransfer.files);
        }
    });
}

// ── File preview ──
function fmPreviewFile(file, basePath) {
    const fullPath = basePath + '/' + file.name;
    const ext = file.name.split('.').pop().toLowerCase();
    const imgExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'];
    const textExts = ['txt', 'md', 'log', 'json', 'yml', 'yaml', 'xml', 'csv', 'sh', 'bash', 'py', 'js', 'ts', 'html', 'css', 'php', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'sql', 'conf', 'cfg', 'ini', 'env', 'toml', 'service', 'properties', 'gitignore', 'dockerfile'];
    const videoExts = ['mp4', 'webm', 'ogg'];
    const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'];

    // Remove existing preview
    document.querySelectorAll('.fm-preview-overlay').forEach(m => m.remove());

    const overlay = document.createElement('div');
    overlay.className = 'fm-preview-overlay';

    const modal = document.createElement('div');
    modal.className = 'fm-preview-modal';

    // Header
    const header = document.createElement('div');
    header.className = 'fm-preview-header';
    
    const titleSpan = document.createElement('span');
    titleSpan.className = 'fm-preview-title';
    titleSpan.textContent = file.name;
    
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'fm-preview-actions';
    
    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'fm-action-btn';
    downloadBtn.title = 'Descargar';
    downloadBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
    downloadBtn.addEventListener('click', () => downloadFile(fullPath));
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'fm-action-btn';
    closeBtn.title = 'Cerrar';
    closeBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    // closeBtn click handler set after closePreview is defined (below)

    actionsDiv.appendChild(downloadBtn);
    actionsDiv.appendChild(closeBtn);
    header.appendChild(titleSpan);
    header.appendChild(actionsDiv);
    modal.appendChild(header);

    const body = document.createElement('div');
    body.className = 'fm-preview-body';

    const fileEndpoint = `${API_BASE}/files/download?path=${encodeURIComponent(fullPath)}`;
    let _previewBlobUrl = null; // Track for cleanup on close

    // Helper: fetch file via authFetch (headers) and create blob URL — avoids leaking sessionId in URL
    function loadPreviewBlob(callback) {
        body.innerHTML = '<div class="fm-preview-loading"><div class="fm-spinner"></div></div>';
        authFetch(fileEndpoint)
            .then(r => r.ok ? r.blob() : Promise.reject('Download failed'))
            .then(blob => {
                _previewBlobUrl = URL.createObjectURL(blob);
                callback(_previewBlobUrl);
            })
            .catch(() => {
                body.innerHTML = '<p style="color:#ef4444;text-align:center">Error al cargar el archivo</p>';
            });
    }

    function closePreview() {
        if (_previewBlobUrl) { URL.revokeObjectURL(_previewBlobUrl); _previewBlobUrl = null; }
        overlay.remove();
    }

    if (imgExts.includes(ext)) {
        loadPreviewBlob(url => {
            body.innerHTML = `<img src="${url}" alt="${escapeHtml(file.name)}" class="fm-preview-image" />`;
        });
    } else if (videoExts.includes(ext)) {
        loadPreviewBlob(url => {
            body.innerHTML = `<video controls autoplay class="fm-preview-video"><source src="${url}"></video>`;
        });
    } else if (audioExts.includes(ext)) {
        loadPreviewBlob(url => {
            body.innerHTML = `<div class="fm-preview-audio-wrap">${getFileIconSVG(file.name, 80)}<audio controls autoplay style="width:100%;margin-top:20px"><source src="${url}"></audio></div>`;
        });
    } else if (ext === 'pdf') {
        loadPreviewBlob(url => {
            body.innerHTML = `<iframe src="${url}" class="fm-preview-pdf"></iframe>`;
        });
    } else if (textExts.includes(ext)) {
        body.innerHTML = '<div class="fm-preview-loading"><div class="fm-spinner"></div></div>';
        authFetch(fileEndpoint).then(r => r.text()).then(text => {
            const pre = document.createElement('pre');
            pre.className = 'fm-preview-code';
            pre.textContent = text.slice(0, 100000); // Limit to 100KB
            body.innerHTML = '';
            body.appendChild(pre);
        }).catch(() => {
            body.innerHTML = '<p style="color:#ef4444;text-align:center">Error al cargar el archivo</p>';
        });
    } else {
        body.innerHTML = `
            <div class="fm-preview-nopreview">
                ${getFileIconSVG(file.name, 80)}
                <p style="margin-top:16px;font-size:1rem">${escapeHtml(file.name)}</p>
                <p style="color:var(--text-dim);font-size:0.85rem">${formatFileSize(file.size)} · ${ext.toUpperCase()}</p>
                <button class="btn-primary btn-sm fm-nopreview-download" style="margin-top:16px">Descargar archivo</button>
            </div>
        `;
        body.querySelector('.fm-nopreview-download').addEventListener('click', () => downloadFile(fullPath));
    }

    modal.appendChild(body);

    // File info footer
    const footer = document.createElement('div');
    footer.className = 'fm-preview-footer';
    footer.innerHTML = `
        <span>📐 ${formatFileSize(file.size)}</span>
        <span>📅 ${file.modified ? new Date(file.modified).toLocaleString('es-ES') : '—'}</span>
        ${file.permissions ? `<span>🔒 ${file.permissions}</span>` : ''}
    `;
    modal.appendChild(footer);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Wire up close handlers (closePreview revokes blob URLs)
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closePreview(); });
    closeBtn.addEventListener('click', () => closePreview());
    const escHandler = (e) => { if (e.key === 'Escape') { closePreview(); document.removeEventListener('keydown', escHandler); } };
    document.addEventListener('keydown', escHandler);
}

// ── Multi-select ──
function fmToggleSelect(path, checked) {
    if (checked) {
        fmSelectedFiles.add(path);
    } else {
        fmSelectedFiles.delete(path);
    }
    fmUpdateBulkBar();
    // Update visual
    const row = document.querySelector(`[data-path="${CSS.escape(path)}"]`);
    if (row) row.classList.toggle('selected', checked);
}
window.fmToggleSelect = fmToggleSelect;

function fmToggleSelectAll(checked) {
    const filesList = document.getElementById('files-list');
    if (!filesList) return;
    filesList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.checked = checked;
    });
    if (checked) {
        fmCurrentFiles.forEach(f => fmSelectedFiles.add(currentFilePath + '/' + f.name));
        filesList.querySelectorAll('[data-path]').forEach(r => r.classList.add('selected'));
    } else {
        fmSelectedFiles.clear();
        filesList.querySelectorAll('[data-path]').forEach(r => r.classList.remove('selected'));
    }
    fmUpdateBulkBar();
}
window.fmToggleSelectAll = fmToggleSelectAll;

function fmUpdateBulkBar() {
    const bar = document.getElementById('fm-bulk-bar');
    const count = document.getElementById('fm-bulk-count');
    if (!bar) return;
    if (fmSelectedFiles.size > 0) {
        bar.style.display = 'flex';
        if (count) count.textContent = `${fmSelectedFiles.size} seleccionado${fmSelectedFiles.size > 1 ? 's' : ''}`;
    } else {
        bar.style.display = 'none';
    }
}

function fmClearSelection() {
    fmSelectedFiles.clear();
    const filesList = document.getElementById('files-list');
    if (filesList) {
        filesList.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
        filesList.querySelectorAll('[data-path]').forEach(r => r.classList.remove('selected'));
    }
    const selectAll = document.getElementById('fm-select-all');
    if (selectAll) selectAll.checked = false;
    fmUpdateBulkBar();
}
window.fmClearSelection = fmClearSelection;

// ── Bulk actions ──
async function fmBulkDelete() {
    if (fmSelectedFiles.size === 0) return;
    const confirmed = await showConfirmModal('Eliminar archivos', `¿Eliminar ${fmSelectedFiles.size} elemento(s)?`);
    if (!confirmed) return;
    for (const fp of fmSelectedFiles) {
        try {
            await authFetch(`${API_BASE}/files/delete`, { method: 'POST', body: JSON.stringify({ path: fp }) });
        } catch (e) { console.error('Delete error:', e); }
    }
    fmSelectedFiles.clear();
    await loadFiles(currentFilePath);
}
window.fmBulkDelete = fmBulkDelete;

function fmBulkDownload() {
    for (const fp of fmSelectedFiles) {
        downloadFile(fp);
    }
}
window.fmBulkDownload = fmBulkDownload;

function fmBulkCopy() {
    fmClipboard = { action: 'copy', files: Array.from(fmSelectedFiles).map(p => ({ path: p, name: p.split('/').pop() })) };
    fmClearSelection();
    renderFilesView();
}
window.fmBulkCopy = fmBulkCopy;

function fmBulkCut() {
    fmClipboard = { action: 'cut', files: Array.from(fmSelectedFiles).map(p => ({ path: p, name: p.split('/').pop() })) };
    fmClearSelection();
    renderFilesView();
}
window.fmBulkCut = fmBulkCut;

async function fmPaste() {
    if (!fmClipboard.action || fmClipboard.files.length === 0) return;
    for (const f of fmClipboard.files) {
        const newPath = currentFilePath + '/' + f.name;
        try {
            if (fmClipboard.action === 'copy') {
                await authFetch(`${API_BASE}/files/copy`, { method: 'POST', body: JSON.stringify({ srcPath: f.path, destPath: newPath }) });
            } else {
                await authFetch(`${API_BASE}/files/rename`, { method: 'POST', body: JSON.stringify({ oldPath: f.path, newPath: newPath }) });
            }
        } catch (e) { console.error('Paste error:', e); }
    }
    fmClipboard = { action: null, files: [] };
    await loadFiles(currentFilePath);
    renderFilesView();
}
window.fmPaste = fmPaste;

// ── CRUD operations ──
async function createNewFolder() {
    const name = prompt('Nombre de la carpeta:');
    if (!name) return;
    // Validate folder name: no path traversal or special chars
    const trimmed = name.trim();
    if (!trimmed || trimmed.includes('/') || trimmed.includes('\\') || trimmed === '.' || trimmed === '..' || trimmed.includes('\0')) {
        alert('Nombre de carpeta no válido. No puede contener / \\ ni ser . o ..');
        return;
    }
    try {
        const res = await authFetch(`${API_BASE}/files/mkdir`, {
            method: 'POST',
            body: JSON.stringify({ path: currentFilePath + '/' + trimmed })
        });
        if (!res.ok) throw new Error('Failed');
        await loadFiles(currentFilePath);
    } catch (e) {
        alert('Error al crear carpeta');
    }
}

async function downloadFile(filePath) {
    // Don't expose sessionId in URL - use header-based auth via fetch + blob
    try {
        const res = await authFetch(`${API_BASE}/files/download?path=${encodeURIComponent(filePath)}`);
        if (!res.ok) throw new Error('Download failed');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filePath.split('/').pop() || 'download';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (e) {
        alert('Error al descargar archivo');
    }
}

async function deleteFile(filePath, name) {
    const confirmed = await showConfirmModal('Eliminar archivo', `¿Eliminar "${name}"?`);
    if (!confirmed) return;
    try {
        const res = await authFetch(`${API_BASE}/files/delete`, {
            method: 'POST',
            body: JSON.stringify({ path: filePath })
        });
        if (!res.ok) throw new Error('Failed');
        await loadFiles(currentFilePath);
    } catch (e) {
        alert('Error al eliminar');
    }
}

async function renameFile(filePath, oldName) {
    const newName = prompt('Nuevo nombre:', oldName);
    if (!newName || newName === oldName) return;
    // Validate new name: no path traversal or special chars
    const trimmed = newName.trim();
    if (!trimmed || trimmed.includes('/') || trimmed.includes('\\') || trimmed === '.' || trimmed === '..' || trimmed.includes('\0')) {
        alert('Nombre no válido. No puede contener / \\ ni ser . o ..');
        return;
    }
    const dir = filePath.substring(0, filePath.lastIndexOf('/'));
    try {
        const res = await authFetch(`${API_BASE}/files/rename`, {
            method: 'POST',
            body: JSON.stringify({ oldPath: filePath, newPath: dir + '/' + trimmed })
        });
        if (!res.ok) throw new Error('Failed');
        await loadFiles(currentFilePath);
    } catch (e) {
        alert('Error al renombrar');
    }
}

// ── Search ──
async function searchFiles(query) {
    if (!query.trim()) { await loadFiles(currentFilePath); return; }
    const filesList = document.getElementById('files-list');
    if (!filesList) return;
    filesList.innerHTML = '<div class="fm-empty-state"><div class="fm-spinner"></div><p>🔍 Buscando...</p></div>';
    try {
        const res = await authFetch(`${API_BASE}/files/search?path=${encodeURIComponent(currentFilePath)}&query=${encodeURIComponent(query)}`);
        if (!res.ok) throw new Error('Search failed');
        const searchData = await res.json();
        const results = searchData.results || searchData || [];
        if (results.length === 0) {
            filesList.innerHTML = '<div class="fm-empty-state"><p>Sin resultados para "' + escapeHtml(query) + '"</p></div>';
            return;
        }
        filesList.innerHTML = '';
        filesList.className = 'fm-list';
        results.forEach(file => {
            const row = document.createElement('div');
            row.className = 'fm-row';
            row.innerHTML = `
                <span></span>
                <span class="fm-file-icon">${file.type === 'directory' ? getFolderSVG() : getFileIconSVG(file.name || file.path.split('/').pop())}</span>
                <span class="fm-file-name" style="grid-column: span 2">${file.path || file.name}</span>
                <span class="fm-file-meta">${file.type === 'directory' ? '—' : formatFileSize(file.size)}</span>
                <span></span><span></span>
            `;
            row.style.cursor = 'pointer';
            row.addEventListener('click', () => {
                if (file.type === 'directory') {
                    currentFilePath = file.path || ('/' + file.name);
                    renderFilesView();
                }
            });
            filesList.appendChild(row);
        });
    } catch (e) {
        filesList.innerHTML = '<div class="fm-empty-state" style="color:#ef4444">Error en la búsqueda</div>';
    }
}

// ── Enhanced Context Menu ──
function showFileContextMenu(e, filePath, file) {
    document.querySelectorAll('.fm-context-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'fm-context-menu';

    // Position: ensure menu stays within viewport
    const menuWidth = 200;
    const menuHeight = 280;
    let top = e.clientY;
    let left = e.clientX;
    if (left + menuWidth > window.innerWidth) left = window.innerWidth - menuWidth - 8;
    if (top + menuHeight > window.innerHeight) top = window.innerHeight - menuHeight - 8;
    menu.style.top = top + 'px';
    menu.style.left = left + 'px';

    const ext = file.name.split('.').pop().toLowerCase();
    const imgExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'];
    const previewable = file.type !== 'directory';

    const items = [
        ...(file.type === 'directory' ? [
            { icon: '📂', label: 'Abrir carpeta', action: () => { currentFilePath = filePath; renderFilesView(); } },
        ] : [
            { icon: '👁️', label: 'Vista previa', action: () => fmPreviewFile(file, filePath.substring(0, filePath.lastIndexOf('/'))) },
        ]),
        { icon: '✏️', label: 'Renombrar', action: () => renameFile(filePath, file.name) },
        ...(file.type !== 'directory' ? [
            { icon: '⬇️', label: 'Descargar', action: () => downloadFile(filePath) },
        ] : []),
        { divider: true },
        { icon: '📋', label: 'Copiar', action: () => { fmClipboard = { action: 'copy', files: [{ path: filePath, name: file.name }] }; renderFilesView(); } },
        { icon: '✂️', label: 'Mover', action: () => { fmClipboard = { action: 'cut', files: [{ path: filePath, name: file.name }] }; renderFilesView(); } },
        { divider: true },
        { icon: '🗑️', label: 'Eliminar', action: () => deleteFile(filePath, file.name), danger: true },
    ];

    items.forEach(item => {
        if (item.divider) {
            const hr = document.createElement('div');
            hr.className = 'fm-context-divider';
            menu.appendChild(hr);
            return;
        }
        const btn = document.createElement('button');
        btn.className = 'fm-context-item' + (item.danger ? ' danger' : '');
        btn.innerHTML = `<span>${item.icon}</span><span>${item.label}</span>`;
        btn.addEventListener('click', () => { menu.remove(); item.action(); });
        menu.appendChild(btn);
    });

    document.body.appendChild(menu);
    // Animate in
    requestAnimationFrame(() => menu.classList.add('visible'));
    setTimeout(() => {
        document.addEventListener('click', () => menu.remove(), { once: true });
    }, 10);
}


    // Expose to window
    window.AppFileManager = {
        render: renderFileManagerView
    };
    
})(window);
