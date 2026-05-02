(function () {
    'use strict';

    // ═══════════════════════════════════════════════════════════════
    //  IKARUS CHECKPOINT — index.js (Character-level Hub Redesign)
    // ═══════════════════════════════════════════════════════════════

    const EXT_NAME = 'ikarus_checkpoint';
    const EXT_DISPLAY = 'Ikarus Checkpoint';
    const WIN_ID = 'ikcp-window';
    const DOCK_ID = 'ikcp-dock-icon';

    let __extPath = 'third-party/IkarusCheckpoint';
    if (document.currentScript && document.currentScript.src) {
        const match = new URL(document.currentScript.src).pathname
            .match(/\/scripts\/extensions\/(.+)\/[^\/]+\.js$/);
        if (match) __extPath = match[1];
    }

    let _windowEl = null;
    let _dockEl = null;
    let _isOpen = false;
    let _currentFilter = '';
    
    // Cache per character: characterId -> { checkpoints: [], branches: [] }
    let _characterHubCache = {};

    function getSettings() {
        const { extensionSettings } = SillyTavern.getContext();
        if (!extensionSettings[EXT_NAME]) extensionSettings[EXT_NAME] = {};
        const s = extensionSettings[EXT_NAME];
        const defaults = {
            enabled: true,
            showDock: true,
            enabled: true,
            showDock: true,
            windowX: null, windowY: null,
            windowW: 380, windowH: 520,
            notes: {},
            checkpointsCollapsed: false,
            branchesCollapsed: true,
            sortMode: 'date',
        };
        for (const [k, v] of Object.entries(defaults)) {
            if (s[k] === undefined) s[k] = v;
        }
        return s;
    }

    function saveSettings() {
        SillyTavern.getContext().saveSettingsDebounced();
    }

    function escHtml(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    function formatContextSize(charCount) {
        if (charCount < 1000) return `~${charCount}`;
        return `~${Math.round(charCount / 1000)}K`;
    }

    function getCharacterId() { return SillyTavern.getContext().characterId; }
    function getCharacter() { 
        const ctx = SillyTavern.getContext();
        return (ctx.characterId !== undefined && ctx.characters) ? ctx.characters[ctx.characterId] : null;
    }
    function getCharacterName() { return getCharacter()?.name || ''; }
    function getCharacterAvatar() { return getCharacter()?.avatar || ''; }

    async function init() {
        const ctx = SillyTavern.getContext();
        try {
            const container = document.getElementById('extensions_settings2');
            if (container) {
                const html = await ctx.renderExtensionTemplateAsync(__extPath, 'settings');
                container.insertAdjacentHTML('beforeend', html);
                loadSettingsUI();
            }
        } catch (e) { console.error(`[${EXT_DISPLAY}] Settings load failed:`, e); }

        injectUI();
        addWandButton();
        updateDockVisibility();

        // When chat changes, we don't automatically rescan all chats (too slow).
        // We just re-render from cache if the window is open.
        const es = ctx.eventSource;
        const et = ctx.event_types;
        if (es && et) {
            es.on(et.CHAT_CHANGED, onChatChanged);
        }
        console.log(`[${EXT_DISPLAY}] Hub Initialized.`);

        // Initial check: if a character is already loaded when extension initializes
        // (important for mobile where CHAT_CHANGED may fire before extension loads)
        setTimeout(() => {
            const charId = getCharacterId();
            if (charId !== undefined && !_characterHubCache[charId]) {
                syncAllCharacterChats();
            }
        }, 800);
    }

    function loadSettingsUI() {
        const s = getSettings();
        const bindCheck = (id, key, callback) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.checked = s[key];
            el.addEventListener('change', () => { s[key] = el.checked; saveSettings(); if (callback) callback(); });
        };
        bindCheck('ikcp-enabled', 'enabled', updateDockVisibility);
        bindCheck('ikcp-show-dock', 'showDock', updateDockVisibility);

        document.getElementById('ikcp-open-window')?.addEventListener('click', () => showWindow());
    }

    function updateDockVisibility() {
        const s = getSettings();
        if (_dockEl) _dockEl.style.display = (s.enabled && s.showDock) ? 'flex' : 'none';
    }

    function onChatChanged() {
        if (_windowEl) {
            const badge = _windowEl.querySelector('.ikcp-char-badge');
            if (badge) badge.textContent = getCharacterName() || '—';
        }
        
        const charId = getCharacterId();
        if (charId !== undefined && !_characterHubCache[charId]) {
            // Auto-sync if cache is completely empty for this character (first load or switch)
            syncAllCharacterChats();
        } else if (_isOpen) {
            // Render from cache for this character
            renderFromCache();
        }
    }

    function buildWindowHTML() {
        const s = getSettings();
        const charName = getCharacterName() || '—';
        const cpCollapsed = s.checkpointsCollapsed ? ' collapsed' : '';
        const brCollapsed = s.branchesCollapsed ? ' collapsed' : '';

        return `
        <div class="ikcp-rh ikcp-rh-n" data-dir="n"></div>
        <div class="ikcp-rh ikcp-rh-s" data-dir="s"></div>
        <div class="ikcp-rh ikcp-rh-e" data-dir="e"></div>
        <div class="ikcp-rh ikcp-rh-w" data-dir="w"></div>
        <div class="ikcp-rh ikcp-rh-ne" data-dir="ne"></div>
        <div class="ikcp-rh ikcp-rh-se" data-dir="se"></div>
        <div class="ikcp-rh ikcp-rh-sw" data-dir="sw"></div>
        <div class="ikcp-rh ikcp-rh-nw" data-dir="nw"></div>

        <div class="ikcp-header">
            <div class="ikcp-header-left">
                <span class="ikcp-logo"><i class="fa-solid fa-bookmark"></i></span>
                <span class="ikcp-title">IKARUS HUB</span>
                <span class="ikcp-char-badge">${escHtml(charName)}</span>
            </div>
            <div class="ikcp-header-right">
                <button class="ikcp-hbtn ikcp-btn-sync" title="Sync All Character Chats" data-action="sync-all">
                    <i class="fa-solid fa-rotate"></i>
                </button>
                <button class="ikcp-hbtn ikcp-btn-minimize" title="Minimize">
                    <i class="fa-solid fa-minus"></i>
                </button>
                <button class="ikcp-hbtn ikcp-hbtn-close" title="Close">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        </div>

        <div class="ikcp-content">
            <div class="ikcp-section" data-section="checkpoints">
                <div class="ikcp-section-header${cpCollapsed}">
                    <span class="ikcp-section-chevron"><i class="fa-solid fa-chevron-down"></i></span>
                    <span class="ikcp-section-title">ALL CHECKPOINTS</span>
                    <span class="ikcp-section-count">(0)</span>
                </div>
                <div class="ikcp-section-body">
                    <div class="ikcp-search-bar">
                        <input class="ikcp-search-input" type="text" placeholder="Search checkpoints…" data-target="checkpoints" />
                        <button class="ikcp-sort-btn" data-target="checkpoints" title="Toggle sort">${s.sortMode === 'name' ? '↓ A-Z' : '↓ Date'}</button>
                    </div>
                    <div class="ikcp-card-list" data-list="checkpoints">
                        <div class="ikcp-empty">Click Sync (top right) to scan character chats.</div>
                    </div>
                </div>
            </div>

            <div class="ikcp-section" data-section="branches">
                <div class="ikcp-section-header${brCollapsed}">
                    <span class="ikcp-section-chevron"><i class="fa-solid fa-chevron-down"></i></span>
                    <span class="ikcp-section-title">ALL BRANCHES</span>
                    <span class="ikcp-section-count">(0)</span>
                </div>
                <div class="ikcp-section-body">
                    <div class="ikcp-search-bar">
                        <input class="ikcp-search-input" type="text" placeholder="Search branches…" data-target="branches" />
                    </div>
                    <div class="ikcp-card-list" data-list="branches">
                        <div class="ikcp-empty">Click Sync (top right) to scan character chats.</div>
                    </div>
                </div>
            </div>
        </div>
        `;
    }

    function injectUI() {
        document.getElementById(WIN_ID)?.remove();
        document.getElementById(DOCK_ID)?.remove();

        const s = getSettings();
        const win = document.createElement('div');
        win.id = WIN_ID;
        win.classList.add('ikcp-window');
        win.style.display = 'none';
        win.innerHTML = buildWindowHTML();

        if (s.windowX !== null) win.style.left = s.windowX + 'px';
        if (s.windowY !== null) win.style.top = s.windowY + 'px';
        if (s.windowW) win.style.width = s.windowW + 'px';
        if (s.windowH) win.style.height = s.windowH + 'px';
        if (s.windowX !== null) win.style.right = 'auto';

        document.body.appendChild(win);
        _windowEl = win;

        win.querySelector('.ikcp-hbtn-close').addEventListener('click', (e) => { e.stopPropagation(); hideWindow(); });
        win.querySelector('.ikcp-btn-minimize').addEventListener('click', (e) => { e.stopPropagation(); hideWindow(); });
        win.querySelector('.ikcp-btn-sync').addEventListener('click', (e) => { e.stopPropagation(); syncAllCharacterChats(); });

        win.querySelectorAll('.ikcp-section-header').forEach(header => {
            header.addEventListener('click', (e) => {
                if (e.target.closest('.ikcp-section-action')) return;
                header.classList.toggle('collapsed');
                const section = header.closest('.ikcp-section').dataset.section;
                if (section === 'checkpoints') s.checkpointsCollapsed = header.classList.contains('collapsed');
                else if (section === 'branches') s.branchesCollapsed = header.classList.contains('collapsed');
                saveSettings();
            });
        });

        win.querySelectorAll('.ikcp-search-input').forEach(input => {
            input.addEventListener('input', (e) => {
                _currentFilter = e.target.value.trim().toLowerCase();
                win.querySelectorAll('.ikcp-search-input').forEach(si => { if (si !== e.target) si.value = e.target.value; });
                renderFromCache();
            });
        });

        win.querySelectorAll('.ikcp-sort-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                s.sortMode = s.sortMode === 'date' ? 'name' : 'date';
                saveSettings();
                win.querySelectorAll('.ikcp-sort-btn').forEach(b => { b.textContent = s.sortMode === 'name' ? '↓ A-Z' : '↓ Date'; });
                renderFromCache();
            });
        });

        setupDrag(win);
        setupResize(win);

        const dock = document.createElement('div');
        dock.id = DOCK_ID;
        dock.classList.add('ikcp-dock-icon');
        dock.innerHTML = '<i class="fa-solid fa-bookmark"></i>';
        dock.title = 'Ikarus Checkpoint Hub';
        dock.addEventListener('click', () => toggleWindow());
        document.body.appendChild(dock);
        _dockEl = dock;
    }

    function showWindow() {
        const s = getSettings();
        if (!s.enabled || !_windowEl) return;
        _windowEl.style.display = 'flex';
        _isOpen = true;
        const badge = _windowEl.querySelector('.ikcp-char-badge');
        if (badge) badge.textContent = getCharacterName() || '—';
        renderFromCache();
    }

    function hideWindow() {
        if (_windowEl) _windowEl.style.display = 'none';
        _isOpen = false;
    }

    function toggleWindow() {
        if (_isOpen) hideWindow();
        else showWindow();
    }

    async function navigateTo(fileName) {
        try {
            await SillyTavern.getContext().openCharacterChat(fileName.replace('.jsonl', ''));
        } catch (e) {
            console.error(`[${EXT_DISPLAY}] Navigate failed:`, e);
            if (typeof toastr !== 'undefined') toastr.error(`Failed to open: ${e.message}`, EXT_DISPLAY);
        }
    }

    async function duplicateAndOpenChat(baseFileName) {
        const ctx = SillyTavern.getContext();
        const charName = getCharacterName();
        const charAvatar = getCharacterAvatar();
        
        try {
            // 1. Fetch original chat
            const getRes = await fetch('/api/chats/get', {
                method: 'POST',
                headers: ctx.getRequestHeaders(),
                body: JSON.stringify({
                    ch_name: charName,
                    file_name: baseFileName.replace('.jsonl', ''),
                    avatar_url: charAvatar,
                }),
                cache: 'no-cache',
            });
            if (!getRes.ok) throw new Error('Failed to fetch checkpoint chat.');
            const chatData = await getRes.json();
            
            // 2. Determine new unique name
            const listRes = await fetch('/api/characters/chats', {
                method: 'POST',
                body: JSON.stringify({ avatar_url: charAvatar }),
                headers: ctx.getRequestHeaders(),
            });
            let existingFiles = [];
            if (listRes.ok) {
                const chatDict = await listRes.json();
                existingFiles = Object.values(chatDict).map(c => c.file_name.replace('.jsonl', ''));
            }
            
            let cleanBase = baseFileName.replace('.jsonl', '');
            let newName = cleanBase;
            let counter = 1;
            while (existingFiles.includes(newName)) {
                newName = `${cleanBase}(${counter})`;
                counter++;
            }
            
            // 3. Save as new chat
            const saveRes = await fetch('/api/chats/save', {
                method: 'POST',
                headers: ctx.getRequestHeaders(),
                body: JSON.stringify({
                    ch_name: charName,
                    file_name: newName,
                    chat: chatData
                })
            });
            if (!saveRes.ok) throw new Error('Failed to create new branch.');
            
            // 4. Navigate to new chat
            await ctx.openCharacterChat(newName);
            toastr?.success(`Restored checkpoint to: ${newName}`, EXT_DISPLAY);
            
            // 5. Sync hub to show new branch
            syncAllCharacterChats();
            
        } catch (e) {
            console.error(`[${EXT_DISPLAY}] Restore failed:`, e);
            if (typeof toastr !== 'undefined') toastr.error(`Failed to restore checkpoint: ${e.message}`, EXT_DISPLAY);
        }
    }

    // ── Data Syncing ────────────────────────────────────────────

    async function syncAllCharacterChats() {
        const charId = getCharacterId();
        const charAvatar = getCharacterAvatar();
        const charName = getCharacterName();
        if (charId === undefined || !charAvatar) {
            toastr?.warning('No active character selected.', EXT_DISPLAY);
            return;
        }

        toastr?.info(`Scanning chats for ${charName}...`, EXT_DISPLAY);

        const cpList = _windowEl?.querySelector('[data-list="checkpoints"]');
        const brList = _windowEl?.querySelector('[data-list="branches"]');
        if (cpList) cpList.innerHTML = '<div class="ikcp-loading"><div class="ikcp-spinner"></div>Syncing all chats...</div>';
        if (brList) brList.innerHTML = '<div class="ikcp-loading"><div class="ikcp-spinner"></div>Syncing all chats...</div>';

        try {
            // 1. Get all chats for character
            const ctx = SillyTavern.getContext();
            const listRes = await fetch('/api/characters/chats', {
                method: 'POST',
                body: JSON.stringify({ avatar_url: charAvatar }),
                headers: ctx.getRequestHeaders(),
            });
            if (!listRes.ok) throw new Error('Failed to get chat list');
            const chatDict = await listRes.json();
            const chatFiles = Object.values(chatDict).map(c => c.file_name);

            let allCheckpoints = [];
            let allBranches = [];
            let seenBranches = new Set();
            let seenCheckpoints = new Set();
            let chatFileMetadata = {};

            // 2. Fetch each chat and scan
            for (const file_name of chatFiles) {
                const getRes = await fetch('/api/chats/get', {
                    method: 'POST',
                    headers: ctx.getRequestHeaders(),
                    body: JSON.stringify({
                        ch_name: charName,
                        file_name: file_name.replace('.jsonl', ''),
                        avatar_url: charAvatar,
                    }),
                    cache: 'no-cache',
                });
                if (!getRes.ok) continue;
                
                let chatData = await getRes.json();
                if (!Array.isArray(chatData)) continue;
                chatData.shift(); // remove metadata

                let totalContext = 0;
                for (let i = 0; i < chatData.length; i++) {
                    const msg = chatData[i];
                    if (!msg) continue;
                    if (msg.mes && !msg.is_system) totalContext += msg.mes.length;

                    if (!msg.extra) continue;
                    
                    if (msg.extra.bookmark_link) {
                        const link = msg.extra.bookmark_link;
                        if (!seenCheckpoints.has(link)) {
                            seenCheckpoints.add(link);
                            allCheckpoints.push({
                                fileName: link,
                                sourceChat: file_name,
                                messageIndex: i,
                                name: link,
                                sendDate: msg.send_date || '',
                                // Estimate details using the point of branch
                                // Real details would require fetching the checkpoint file itself, 
                                // which we'll do asynchronously later if needed, or just keep it simple.
                            });
                        }
                    }

                    if (msg.extra.branches && Array.isArray(msg.extra.branches)) {
                        for (const branchFile of msg.extra.branches) {
                            if (!seenBranches.has(branchFile)) {
                                seenBranches.add(branchFile);
                                allBranches.push({
                                    fileName: branchFile,
                                    sourceChat: file_name,
                                    messageIndex: i,
                                    name: branchFile,
                                    sendDate: msg.send_date || '',
                                });
                            }
                        }
                    }
                }

                // Collect metadata for this chat file
                const lastMsg = chatData[chatData.length - 1];
                chatFileMetadata[file_name] = {
                    messageCount: chatData.length,
                    contextSize: totalContext,
                    lastDate: lastMsg?.send_date || '',
                };
            }

            // 3. Chat files with "Branch" in the name are branches (active timelines)
            for (const file_name of chatFiles) {
                if (/branch/i.test(file_name) && !seenCheckpoints.has(file_name) && !seenBranches.has(file_name)) {
                    seenBranches.add(file_name);
                    const meta = chatFileMetadata[file_name] || {};
                    allBranches.push({
                        fileName: file_name,
                        sourceChat: file_name,
                        messageIndex: 0,
                        name: file_name,
                        sendDate: meta.lastDate || '',
                        messageCount: meta.messageCount,
                        contextSize: meta.contextSize,
                    });
                }
            }

            // Save to cache
            _characterHubCache[charId] = {
                checkpoints: allCheckpoints,
                branches: allBranches
            };

            const totalChats = chatFiles.length;
            toastr?.success(
                `${charName} scan complete! ${totalChats} chat${totalChats !== 1 ? 's' : ''} · ${allCheckpoints.length} checkpoint${allCheckpoints.length !== 1 ? 's' : ''} · ${allBranches.length} branch${allBranches.length !== 1 ? 'es' : ''}`,
                EXT_DISPLAY,
                { timeOut: 6000 }
            );

            // Re-render
            renderFromCache();

            // Fire off async tasks to get exact message counts for these files
            fetchDetailsBackground(charId, allCheckpoints, allBranches);

        } catch (e) {
            console.error(`[${EXT_DISPLAY}] Sync failed:`, e);
            toastr?.error('Failed to sync character chats', EXT_DISPLAY);
            if (cpList) cpList.innerHTML = '<div class="ikcp-empty">Sync failed.</div>';
            if (brList) brList.innerHTML = '<div class="ikcp-empty">Sync failed.</div>';
        }
    }

    async function fetchDetailsBackground(charId, checkpoints, branches) {
        const ctx = SillyTavern.getContext();
        const charName = getCharacterName();
        const charAvatar = getCharacterAvatar();
        
        const allItems = [...checkpoints, ...branches];
        for (const item of allItems) {
            try {
                const getRes = await fetch('/api/chats/get', {
                    method: 'POST',
                    headers: ctx.getRequestHeaders(),
                    body: JSON.stringify({
                        ch_name: charName,
                        file_name: item.fileName.replace('.jsonl', ''),
                        avatar_url: charAvatar,
                    }),
                    cache: 'no-cache',
                });
                if (getRes.ok) {
                    let chatData = await getRes.json();
                    if (Array.isArray(chatData)) {
                        chatData.shift();
                        item.messageCount = chatData.length;
                        let size = 0;
                        for(let m of chatData) { if(m && m.mes && !m.is_system) size += m.mes.length; }
                        item.contextSize = size;
                        
                        // Update UI if still on same character
                        if (getCharacterId() === charId && _windowEl) {
                            const card = _windowEl.querySelector(`[data-file="${CSS.escape(item.fileName)}"]`);
                            if (card) {
                                const msgBadge = card.querySelector('.ikcp-badge-msg-count');
                                if (msgBadge) msgBadge.textContent = `${item.messageCount} msgs`;
                                const ctxBadge = card.querySelector('.ikcp-badge-accent');
                                if (ctxBadge) ctxBadge.textContent = formatContextSize(item.contextSize);
                            }
                        }
                    }
                }
            } catch(e) {}
        }
    }

    // ── Rendering ───────────────────────────────────────────────

    function renderFromCache() {
        if (!_windowEl) return;
        const charId = getCharacterId();
        if (charId === undefined) {
            clearLists('No character selected.');
            return;
        }

        const data = _characterHubCache[charId];
        if (!data) {
            clearLists('Click Sync (top right) to scan character chats.');
            return;
        }

        // Update counts
        const cpCount = _windowEl.querySelector('[data-section="checkpoints"] .ikcp-section-count');
        const brCount = _windowEl.querySelector('[data-section="branches"] .ikcp-section-count');
        if (cpCount) cpCount.textContent = `(${data.checkpoints.length})`;
        if (brCount) brCount.textContent = `(${data.branches.length})`;

        renderList('checkpoints', data.checkpoints, 'fa-file-lines', 'checkpoints');
        renderList('branches', data.branches, 'fa-code-branch', 'branches');
    }

    function clearLists(msg) {
        const cpList = _windowEl.querySelector('[data-list="checkpoints"]');
        const brList = _windowEl.querySelector('[data-list="branches"]');
        if (cpList) cpList.innerHTML = `<div class="ikcp-empty">${msg}</div>`;
        if (brList) brList.innerHTML = `<div class="ikcp-empty">${msg}</div>`;
        
        const cpCount = _windowEl.querySelector('[data-section="checkpoints"] .ikcp-section-count');
        const brCount = _windowEl.querySelector('[data-section="branches"] .ikcp-section-count');
        if (cpCount) cpCount.textContent = `(0)`;
        if (brCount) brCount.textContent = `(0)`;
    }

    function renderList(type, items, iconClass, itemType) {
        const listEl = _windowEl.querySelector(`[data-list="${type}"]`);
        if (!listEl) return;

        let filtered = items;
        if (_currentFilter) {
            filtered = filtered.filter(item => {
                const note = getSettings().notes[item.fileName] || '';
                return item.name.toLowerCase().includes(_currentFilter) || note.toLowerCase().includes(_currentFilter);
            });
        }

        const s = getSettings();
        if (s.sortMode === 'name') {
            filtered.sort((a, b) => a.name.localeCompare(b.name));
        } else {
            // Sort by sendDate descending, or messageIndex if dates match
            filtered.sort((a, b) => {
                const da = new Date(a.sendDate).getTime() || 0;
                const db = new Date(b.sendDate).getTime() || 0;
                if (da !== db) return db - da;
                return b.messageIndex - a.messageIndex;
            });
        }

        if (filtered.length === 0) {
            listEl.innerHTML = _currentFilter
                ? `<div class="ikcp-empty">No ${type} match your search.</div>`
                : `<div class="ikcp-empty">No ${type} found.</div>`;
            return;
        }

        listEl.innerHTML = filtered.map(item => buildCardHTML(item, iconClass, itemType)).join('');
        wireCardEvents(listEl);
    }

    function buildCardHTML(item, iconClass, itemType) {
        const note = getSettings().notes[item.fileName] || '';
        const noteHasContent = note ? ' has-content' : '';
        const msgCountText = item.messageCount !== undefined ? `${item.messageCount} msgs` : '…';
        const ctxText = item.contextSize !== undefined ? formatContextSize(item.contextSize) : '…';

        function formatDate(dateStr) {
            if (!dateStr) return '';
            try {
                const d = new Date(dateStr);
                if (isNaN(d.getTime())) return dateStr.substring(0, 10);
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                const hours = String(d.getHours()).padStart(2, '0');
                const mins = String(d.getMinutes()).padStart(2, '0');
                return `${month}/${day} ${hours}:${mins}`;
            } catch { return ''; }
        }

        return `
        <div class="ikcp-card" data-file="${escHtml(item.fileName)}" data-type="${escHtml(itemType)}" title="Click to open ${escHtml(item.fileName)}">
            <div class="ikcp-card-top">
                <span class="ikcp-card-icon"><i class="fa-solid ${iconClass}"></i></span>
                <span class="ikcp-card-name">${escHtml(item.name)}</span>
            </div>
            <div class="ikcp-card-meta">
                <span class="ikcp-badge ikcp-badge-msg-count">${msgCountText}</span>
                <span class="ikcp-badge ikcp-badge-accent">${ctxText}</span>
                ${item.sendDate ? `<span class="ikcp-card-date">${escHtml(formatDate(item.sendDate))}</span>` : ''}
            </div>
            <div class="ikcp-note-row">
                <span class="ikcp-note-icon"><i class="fa-solid fa-pen"></i></span>
                <input class="ikcp-note-input${noteHasContent}" type="text"
                    placeholder="Add a note…" value="${escHtml(note)}"
                    data-note-file="${escHtml(item.fileName)}" />
            </div>
        </div>`;
    }

    function wireCardEvents(listEl) {
        listEl.querySelectorAll('.ikcp-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('.ikcp-note-input')) return;
                const fileName = card.dataset.file;
                const itemType = card.dataset.type;
                if (fileName) {
                    if (itemType === 'checkpoints') {
                        duplicateAndOpenChat(fileName);
                    } else {
                        navigateTo(fileName);
                    }
                }
            });
        });

        listEl.querySelectorAll('.ikcp-note-input').forEach(input => {
            input.addEventListener('click', (e) => e.stopPropagation());
            input.addEventListener('blur', () => {
                const fileName = input.dataset.noteFile;
                const val = input.value.trim();
                const s = getSettings();
                if (val) s.notes[fileName] = val;
                else delete s.notes[fileName];
                saveSettings();
                input.classList.toggle('has-content', !!val);
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
                e.stopPropagation();
            });
        });
    }

    // ── Window Mechanics ────────────────────────────────────────

    function isMobile() {
        return window.innerWidth <= 900 || ('ontouchstart' in window && window.innerWidth <= 1366);
    }

    function setupDrag(win) {
        const header = win.querySelector('.ikcp-header');
        if (!header) return;
        let isDragging = false;
        let startX, startY, startLeft, startTop;

        header.addEventListener('mousedown', (e) => {
            if (isMobile()) return;
            if (e.target.closest('.ikcp-hbtn')) return;
            isDragging = true;
            win.classList.add('ikcp-dragging');
            const rect = win.getBoundingClientRect();
            startX = e.clientX; startY = e.clientY;
            startLeft = rect.left; startTop = rect.top;
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            let newLeft = startLeft + (e.clientX - startX);
            let newTop = startTop + (e.clientY - startY);
            newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - 60));
            newTop = Math.max(0, Math.min(newTop, window.innerHeight - 40));
            win.style.left = newLeft + 'px';
            win.style.top = newTop + 'px';
            win.style.right = 'auto';
        });

        document.addEventListener('mouseup', () => {
            if (!isDragging) return;
            isDragging = false;
            win.classList.remove('ikcp-dragging');
            const s = getSettings();
            s.windowX = parseInt(win.style.left, 10);
            s.windowY = parseInt(win.style.top, 10);
            saveSettings();
        });
    }

    function setupResize(win) {
        const handles = win.querySelectorAll('.ikcp-rh');
        if (!handles.length) return;
        let isResizing = false, resizeDir = '', startX, startY, startW, startH, startLeft, startTop;

        handles.forEach(handle => {
            handle.addEventListener('mousedown', (e) => {
                if (isMobile()) return;
                isResizing = true;
                resizeDir = handle.dataset.dir;
                win.classList.add('ikcp-resizing');
                const rect = win.getBoundingClientRect();
                startX = e.clientX; startY = e.clientY;
                startW = rect.width; startH = rect.height;
                startLeft = rect.left; startTop = rect.top;
                e.preventDefault(); e.stopPropagation();
            });
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const dx = e.clientX - startX, dy = e.clientY - startY;
            const dir = resizeDir, minW = 320, minH = 280;
            let newW = startW, newH = startH, newLeft = startLeft, newTop = startTop;

            if (dir.includes('e')) newW = Math.max(minW, startW + dx);
            if (dir.includes('w')) { newW = Math.max(minW, startW - dx); if (newW > minW) newLeft = startLeft + dx; }
            if (dir.includes('s')) newH = Math.max(minH, startH + dy);
            if (dir.includes('n') && dir !== 'ne' || dir === 'n' || dir === 'nw') {
                newH = Math.max(minH, startH - dy); if (newH > minH) newTop = startTop + dy;
            }
            if (dir === 'ne') { newH = Math.max(minH, startH - dy); if (newH > minH) newTop = startTop + dy; }

            win.style.width = newW + 'px'; win.style.height = newH + 'px';
            win.style.left = newLeft + 'px'; win.style.top = newTop + 'px';
            win.style.right = 'auto';
        });

        document.addEventListener('mouseup', () => {
            if (!isResizing) return;
            isResizing = false;
            win.classList.remove('ikcp-resizing');
            const s = getSettings();
            s.windowW = parseInt(win.style.width, 10); s.windowH = parseInt(win.style.height, 10);
            s.windowX = parseInt(win.style.left, 10);  s.windowY = parseInt(win.style.top, 10);
            saveSettings();
        });
    }



    function addWandButton() {
        const menu = document.getElementById('extensionsMenu');
        if (!menu || document.getElementById('ikcp-wand-btn')) return;
        const btn = document.createElement('div');
        btn.id = 'ikcp-wand-btn';
        btn.classList.add('list-group-item', 'flex-container', 'flexGap5');
        btn.innerHTML = '<div class="fa-solid fa-bookmark extensionsMenuExtensionButton"></div><span>Ikarus Hub</span>';
        btn.addEventListener('click', toggleWindow);
        menu.appendChild(btn);
    }

    jQuery(async () => {
        try { await init(); } 
        catch (e) { console.error(`[${EXT_DISPLAY}] Init failed:`, e); }
    });

})();
