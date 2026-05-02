(function () {
    'use strict';

    // ═══════════════════════════════════════════════════════════════
    //  IKARUS CHECKPOINT — index.js
    //  Floating checkpoint/branch navigator for SillyTavern
    // ═══════════════════════════════════════════════════════════════

    const EXT_NAME = 'ikarus_checkpoint';
    const EXT_DISPLAY = 'Ikarus Checkpoint';
    const WIN_ID = 'ikcp-window';
    const DOCK_ID = 'ikcp-dock-icon';

    // ── Extension path detection (ST-Copilot pattern) ───────────
    let __extPath = 'third-party/IkarusCheckpoint';
    if (document.currentScript && document.currentScript.src) {
        const match = new URL(document.currentScript.src).pathname
            .match(/\/scripts\/extensions\/(.+)\/[^\/]+\.js$/);
        if (match) __extPath = match[1];
    }

    // ── State ────────────────────────────────────────────────────
    let _windowEl = null;
    let _dockEl = null;
    let _isOpen = false;
    let _scanCache = null;       // { checkpoints: [], branches: [] }
    let _currentFilter = '';
    let _detailsCache = {};      // fileName -> { messageCount, contextSize }

    // ── Settings ─────────────────────────────────────────────────

    function getSettings() {
        const { extensionSettings } = SillyTavern.getContext();
        if (!extensionSettings[EXT_NAME]) extensionSettings[EXT_NAME] = {};
        const s = extensionSettings[EXT_NAME];
        const defaults = {
            enabled: true,
            showDock: true,
            hotkeyEnabled: false,
            hotkey: 'Alt+K',
            windowX: null,
            windowY: null,
            windowW: 380,
            windowH: 520,
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

    // ── Helpers ──────────────────────────────────────────────────

    function escHtml(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    function formatContextSize(charCount) {
        if (charCount < 1000) return `~${charCount}`;
        return `~${Math.round(charCount / 1000)}K`;
    }

    function getCharacterName() {
        const ctx = SillyTavern.getContext();
        if (ctx.characterId !== undefined && ctx.characters && ctx.characters[ctx.characterId]) {
            return ctx.characters[ctx.characterId].name || '';
        }
        return '';
    }

    function isInCheckpoint() {
        const ctx = SillyTavern.getContext();
        return !!(ctx.chatMetadata && ctx.chatMetadata.main_chat);
    }

    // ── Init ─────────────────────────────────────────────────────

    async function init() {
        const ctx = SillyTavern.getContext();
        const s = getSettings();

        // Load settings panel
        try {
            const container = document.getElementById('extensions_settings2');
            if (container) {
                const html = await ctx.renderExtensionTemplateAsync(__extPath, 'settings');
                container.insertAdjacentHTML('beforeend', html);
                loadSettingsUI();
            }
        } catch (e) {
            console.error(`[${EXT_DISPLAY}] Failed to load settings panel:`, e);
        }

        // Build the floating window + dock icon
        injectUI();

        // Wand menu button
        addWandButton();

        // Hotkey listener
        setupHotkey();

        // Listen for chat changes
        const es = ctx.eventSource;
        const et = ctx.event_types;
        if (es && et) {
            es.on(et.CHAT_CHANGED, onChatChanged);
        }

        // Show/hide dock based on setting
        updateDockVisibility();

        console.log(`[${EXT_DISPLAY}] Initialized.`);
    }

    // ── Settings UI wiring ───────────────────────────────────────

    function loadSettingsUI() {
        const s = getSettings();

        const elEnabled = document.getElementById('ikcp-enabled');
        const elDock = document.getElementById('ikcp-show-dock');
        const elHotkeyEnabled = document.getElementById('ikcp-hotkey-enabled');
        const elHotkey = document.getElementById('ikcp-hotkey');
        const elOpenBtn = document.getElementById('ikcp-open-window');

        if (elEnabled) {
            elEnabled.checked = s.enabled;
            elEnabled.addEventListener('change', () => {
                s.enabled = elEnabled.checked;
                saveSettings();
                updateDockVisibility();
            });
        }
        if (elDock) {
            elDock.checked = s.showDock;
            elDock.addEventListener('change', () => {
                s.showDock = elDock.checked;
                saveSettings();
                updateDockVisibility();
            });
        }
        if (elHotkeyEnabled) {
            elHotkeyEnabled.checked = s.hotkeyEnabled;
            elHotkeyEnabled.addEventListener('change', () => {
                s.hotkeyEnabled = elHotkeyEnabled.checked;
                saveSettings();
            });
        }
        if (elHotkey) {
            elHotkey.value = s.hotkey;
            elHotkey.addEventListener('change', () => {
                s.hotkey = elHotkey.value.trim() || 'Alt+K';
                saveSettings();
            });
        }
        if (elOpenBtn) {
            elOpenBtn.addEventListener('click', () => showWindow());
        }
    }

    function updateDockVisibility() {
        const s = getSettings();
        if (_dockEl) {
            _dockEl.style.display = (s.enabled && s.showDock) ? 'flex' : 'none';
        }
    }

    // ── Event handler ────────────────────────────────────────────

    function onChatChanged() {
        _scanCache = null;
        _detailsCache = {};
        _currentFilter = '';
        if (_isOpen) {
            refreshContent();
        }
        // Update character badge
        if (_windowEl) {
            const badge = _windowEl.querySelector('.ikcp-char-badge');
            if (badge) badge.textContent = getCharacterName() || '—';
        }
    }

    // (All functions implemented inline below)

    // ═══════════════════════════════════════════════════════════════
    //  PART 2 — UI INJECTION
    // ═══════════════════════════════════════════════════════════════

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
                <span class="ikcp-title">IKARUS CHECKPOINT</span>
                <span class="ikcp-char-badge">${escHtml(charName)}</span>
            </div>
            <div class="ikcp-header-right">
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
                    <span class="ikcp-section-title">CHECKPOINTS</span>
                    <span class="ikcp-section-count">(0)</span>
                    <button class="ikcp-section-action" data-action="new-checkpoint">+ New</button>
                </div>
                <div class="ikcp-section-body">
                    <div class="ikcp-search-bar">
                        <input class="ikcp-search-input" type="text" placeholder="Search checkpoints…" data-target="checkpoints" />
                        <button class="ikcp-sort-btn" data-target="checkpoints" title="Toggle sort">${s.sortMode === 'name' ? '↓ A-Z' : '↓ Date'}</button>
                    </div>
                    <div class="ikcp-card-list" data-list="checkpoints">
                        <div class="ikcp-loading"><div class="ikcp-spinner"></div>Scanning…</div>
                    </div>
                </div>
            </div>

            <div class="ikcp-section" data-section="branches">
                <div class="ikcp-section-header${brCollapsed}">
                    <span class="ikcp-section-chevron"><i class="fa-solid fa-chevron-down"></i></span>
                    <span class="ikcp-section-title">BRANCHES</span>
                    <span class="ikcp-section-count">(0)</span>
                </div>
                <div class="ikcp-section-body">
                    <div class="ikcp-search-bar">
                        <input class="ikcp-search-input" type="text" placeholder="Search branches…" data-target="branches" />
                    </div>
                    <div class="ikcp-card-list" data-list="branches">
                        <div class="ikcp-loading"><div class="ikcp-spinner"></div>Scanning…</div>
                    </div>
                </div>
            </div>
        </div>

        <div class="ikcp-footer" style="display:none;">
            <button class="ikcp-footer-btn" data-action="back-to-main">
                <i class="fa-solid fa-arrow-left"></i> Back to Main Chat
            </button>
        </div>`;
    }

    function injectUI() {
        // Remove any existing instances
        document.getElementById(WIN_ID)?.remove();
        document.getElementById(DOCK_ID)?.remove();

        const s = getSettings();

        // ── Build main window ──
        const win = document.createElement('div');
        win.id = WIN_ID;
        win.classList.add('ikcp-window');
        win.style.display = 'none'; // hidden by default
        win.innerHTML = buildWindowHTML();

        // Apply saved position/size
        if (s.windowX !== null) win.style.left = s.windowX + 'px';
        if (s.windowY !== null) win.style.top = s.windowY + 'px';
        if (s.windowW) win.style.width = s.windowW + 'px';
        if (s.windowH) win.style.height = s.windowH + 'px';
        if (s.windowX !== null) win.style.right = 'auto';

        document.body.appendChild(win);
        _windowEl = win;

        // ── Wire window event listeners ──

        // Close button
        win.querySelector('.ikcp-hbtn-close').addEventListener('click', (e) => {
            e.stopPropagation();
            hideWindow();
        });

        // Minimize button
        win.querySelector('.ikcp-btn-minimize').addEventListener('click', (e) => {
            e.stopPropagation();
            hideWindow();
        });

        // Section collapse toggles
        win.querySelectorAll('.ikcp-section-header').forEach(header => {
            header.addEventListener('click', (e) => {
                // Don't collapse if clicking the action button or search
                if (e.target.closest('.ikcp-section-action')) return;
                header.classList.toggle('collapsed');
                const section = header.closest('.ikcp-section').dataset.section;
                if (section === 'checkpoints') {
                    s.checkpointsCollapsed = header.classList.contains('collapsed');
                } else if (section === 'branches') {
                    s.branchesCollapsed = header.classList.contains('collapsed');
                }
                saveSettings();
            });
        });

        // New checkpoint button
        win.querySelector('[data-action="new-checkpoint"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            createQuickCheckpoint();
        });

        // Back to main chat button
        win.querySelector('[data-action="back-to-main"]')?.addEventListener('click', () => {
            backToMain();
        });

        // Search inputs
        win.querySelectorAll('.ikcp-search-input').forEach(input => {
            input.addEventListener('input', (e) => {
                _currentFilter = e.target.value.trim().toLowerCase();
                // Sync both search bars
                win.querySelectorAll('.ikcp-search-input').forEach(si => {
                    if (si !== e.target) si.value = e.target.value;
                });
                renderFromCache();
            });
        });

        // Sort button
        win.querySelectorAll('.ikcp-sort-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                s.sortMode = s.sortMode === 'date' ? 'name' : 'date';
                saveSettings();
                win.querySelectorAll('.ikcp-sort-btn').forEach(b => {
                    b.textContent = s.sortMode === 'name' ? '↓ A-Z' : '↓ Date';
                });
                renderFromCache();
            });
        });

        // Drag & resize
        setupDrag(win);
        setupResize(win);

        // ── Build dock icon ──
        const dock = document.createElement('div');
        dock.id = DOCK_ID;
        dock.classList.add('ikcp-dock-icon');
        dock.innerHTML = '<i class="fa-solid fa-bookmark"></i>';
        dock.title = 'Ikarus Checkpoint';
        dock.addEventListener('click', () => toggleWindow());
        document.body.appendChild(dock);
        _dockEl = dock;
    }

    // ── Show / Hide / Toggle ─────────────────────────────────────

    function showWindow() {
        const s = getSettings();
        if (!s.enabled || !_windowEl) return;
        _windowEl.style.display = 'flex';
        _isOpen = true;
        // Update footer visibility based on checkpoint state
        const footer = _windowEl.querySelector('.ikcp-footer');
        if (footer) footer.style.display = isInCheckpoint() ? 'flex' : 'none';
        // Update char badge
        const badge = _windowEl.querySelector('.ikcp-char-badge');
        if (badge) badge.textContent = getCharacterName() || '—';
        // Trigger scan
        refreshContent();
    }

    function hideWindow() {
        if (_windowEl) {
            _windowEl.style.display = 'none';
        }
        _isOpen = false;
    }

    function toggleWindow() {
        if (_isOpen) {
            hideWindow();
        } else {
            showWindow();
        }
    }

    // ── Navigation ───────────────────────────────────────────────

    async function navigateTo(fileName) {
        try {
            const ctx = SillyTavern.getContext();
            await ctx.openCharacterChat(fileName);
        } catch (e) {
            console.error(`[${EXT_DISPLAY}] Navigate failed:`, e);
            if (typeof toastr !== 'undefined') {
                toastr.error(`Failed to open checkpoint: ${e.message}`, EXT_DISPLAY);
            }
        }
    }

    async function backToMain() {
        const ctx = SillyTavern.getContext();
        const mainChat = ctx.chatMetadata?.main_chat;
        if (mainChat) {
            await navigateTo(mainChat);
        } else {
            if (typeof toastr !== 'undefined') {
                toastr.warning('No main chat found — you may already be on it.', EXT_DISPLAY);
            }
        }
    }

    function createQuickCheckpoint() {
        // Trigger ST's native bookmark creation button
        const bookmarkBtn = document.getElementById('option_new_bookmark');
        if (bookmarkBtn) {
            $(bookmarkBtn).trigger('click');
        } else {
            if (typeof toastr !== 'undefined') {
                toastr.warning('Bookmark button not found in SillyTavern UI.', EXT_DISPLAY);
            }
        }
    }

    // ── Notes ────────────────────────────────────────────────────

    function saveNote(fileName, text) {
        const s = getSettings();
        if (text.trim()) {
            s.notes[fileName] = text.trim();
        } else {
            delete s.notes[fileName];
        }
        saveSettings();
    }

    function getNote(fileName) {
        return getSettings().notes[fileName] || '';
    }

    // ── Render from cache (used by filter/sort) ──────────────────

    function renderFromCache() {
        if (!_scanCache) return;
        renderCheckpointList(_scanCache.checkpoints);
        renderBranchList(_scanCache.branches);
    }


    // ═══════════════════════════════════════════════════════════════
    //  PART 3 — SCANNING & RENDERING
    // ═══════════════════════════════════════════════════════════════

    function scanCheckpoints() {
        const ctx = SillyTavern.getContext();
        const chat = ctx.chat;
        if (!chat || !chat.length) return { checkpoints: [], branches: [] };

        const checkpoints = [];
        const branches = [];
        const seenBranches = new Set();

        for (let i = 0; i < chat.length; i++) {
            const msg = chat[i];
            if (!msg || !msg.extra) continue;

            // Checkpoint detection
            if (msg.extra.bookmark_link) {
                checkpoints.push({
                    fileName: msg.extra.bookmark_link,
                    messageIndex: i,
                    name: msg.extra.bookmark_link,
                    isUser: !!msg.is_user,
                    sendDate: msg.send_date || '',
                });
            }

            // Branch detection
            if (msg.extra.branches && Array.isArray(msg.extra.branches)) {
                for (const branchFile of msg.extra.branches) {
                    if (!seenBranches.has(branchFile)) {
                        seenBranches.add(branchFile);
                        branches.push({
                            fileName: branchFile,
                            messageIndex: i,
                            name: branchFile,
                            sendDate: msg.send_date || '',
                        });
                    }
                }
            }
        }

        return { checkpoints, branches };
    }

    function estimateContextSize(chat) {
        if (!chat || !chat.length) return 0;
        let total = 0;
        for (const msg of chat) {
            if (msg && msg.mes && !msg.is_system) {
                total += msg.mes.length;
            }
        }
        return total;
    }

    async function fetchCheckpointDetails(fileName) {
        if (_detailsCache[fileName]) return _detailsCache[fileName];

        try {
            const ctx = SillyTavern.getContext();
            if (!ctx.characters || ctx.characterId === undefined) return null;

            const response = await fetch('/api/chats/get', {
                method: 'POST',
                headers: ctx.getRequestHeaders(),
                body: JSON.stringify({
                    ch_name: ctx.characters[ctx.characterId].name,
                    file_name: fileName,
                    avatar_url: ctx.characters[ctx.characterId].avatar,
                }),
                cache: 'no-cache',
            });

            if (!response.ok) return null;

            const chatData = await response.json();
            if (!Array.isArray(chatData)) return null;

            // First element is metadata
            chatData.shift();
            const messageCount = chatData.length;
            const contextSize = estimateContextSize(chatData);

            const details = { messageCount, contextSize };
            _detailsCache[fileName] = details;
            return details;
        } catch (e) {
            console.warn(`[${EXT_DISPLAY}] fetchCheckpointDetails failed for ${fileName}:`, e);
            return null;
        }
    }

    async function refreshContent() {
        if (!_windowEl) return;

        // Show loading spinners
        const cpList = _windowEl.querySelector('[data-list="checkpoints"]');
        const brList = _windowEl.querySelector('[data-list="branches"]');
        if (cpList) cpList.innerHTML = '<div class="ikcp-loading"><div class="ikcp-spinner"></div>Scanning…</div>';
        if (brList) brList.innerHTML = '<div class="ikcp-loading"><div class="ikcp-spinner"></div>Scanning…</div>';

        // Update footer
        const footer = _windowEl.querySelector('.ikcp-footer');
        if (footer) footer.style.display = isInCheckpoint() ? 'flex' : 'none';

        // Scan
        _scanCache = scanCheckpoints();

        // Update section counts
        const cpCount = _windowEl.querySelector('[data-section="checkpoints"] .ikcp-section-count');
        const brCount = _windowEl.querySelector('[data-section="branches"] .ikcp-section-count');
        if (cpCount) cpCount.textContent = `(${_scanCache.checkpoints.length})`;
        if (brCount) brCount.textContent = `(${_scanCache.branches.length})`;

        // Render lists
        renderCheckpointList(_scanCache.checkpoints);
        renderBranchList(_scanCache.branches);

        // Fetch details in background (message counts)
        const allItems = [..._scanCache.checkpoints, ..._scanCache.branches];
        for (const item of allItems) {
            fetchCheckpointDetails(item.fileName).then(details => {
                if (!details || !_windowEl) return;
                // Update the card if it exists
                const card = _windowEl.querySelector(`[data-file="${CSS.escape(item.fileName)}"]`);
                if (card) {
                    const metaEl = card.querySelector('.ikcp-card-meta');
                    if (metaEl) {
                        const msgBadge = metaEl.querySelector('.ikcp-badge-msg-count');
                        if (msgBadge) msgBadge.textContent = `${details.messageCount} msgs`;
                        const ctxBadge = metaEl.querySelector('.ikcp-badge-accent');
                        if (ctxBadge) ctxBadge.textContent = formatContextSize(details.contextSize);
                    }
                }
            });
        }
    }

    function filterAndSort(items) {
        const s = getSettings();
        let filtered = items;

        // Filter by search
        if (_currentFilter) {
            filtered = filtered.filter(item => {
                const note = getNote(item.fileName).toLowerCase();
                return item.name.toLowerCase().includes(_currentFilter) ||
                       note.includes(_currentFilter);
            });
        }

        // Sort
        if (s.sortMode === 'name') {
            filtered.sort((a, b) => a.name.localeCompare(b.name));
        } else {
            // Date sort — by message index descending (newest first)
            filtered.sort((a, b) => b.messageIndex - a.messageIndex);
        }

        return filtered;
    }

    function buildCardHTML(item, iconClass) {
        const note = getNote(item.fileName);
        const noteHasContent = note ? ' has-content' : '';
        const cachedDetails = _detailsCache[item.fileName];
        const msgCountText = cachedDetails ? `${cachedDetails.messageCount} msgs` : '…';
        const ctxText = cachedDetails ? formatContextSize(cachedDetails.contextSize) : '…';

        return `
        <div class="ikcp-card" data-file="${escHtml(item.fileName)}" title="Click to navigate">
            <div class="ikcp-card-top">
                <span class="ikcp-card-icon"><i class="fa-solid ${iconClass}"></i></span>
                <span class="ikcp-card-name">${escHtml(item.name)}</span>
            </div>
            <div class="ikcp-card-meta">
                <span class="ikcp-badge">Msg #${item.messageIndex}</span>
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
        } catch {
            return '';
        }
    }

    function renderCheckpointList(checkpoints) {
        if (!_windowEl) return;
        const listEl = _windowEl.querySelector('[data-list="checkpoints"]');
        if (!listEl) return;

        const sorted = filterAndSort(checkpoints);

        if (sorted.length === 0) {
            listEl.innerHTML = _currentFilter
                ? '<div class="ikcp-empty">No checkpoints match your search.</div>'
                : '<div class="ikcp-empty">No checkpoints found in this chat.</div>';
            return;
        }

        listEl.innerHTML = sorted.map(cp => buildCardHTML(cp, 'fa-file-lines')).join('');
        wireCardEvents(listEl);
    }

    function renderBranchList(branches) {
        if (!_windowEl) return;
        const listEl = _windowEl.querySelector('[data-list="branches"]');
        if (!listEl) return;

        const sorted = filterAndSort(branches);

        if (sorted.length === 0) {
            listEl.innerHTML = _currentFilter
                ? '<div class="ikcp-empty">No branches match your search.</div>'
                : '<div class="ikcp-empty">No branches found in this chat.</div>';
            return;
        }

        listEl.innerHTML = sorted.map(br => buildCardHTML(br, 'fa-code-branch')).join('');
        wireCardEvents(listEl);
    }

    function wireCardEvents(listEl) {
        // Card click → navigate
        listEl.querySelectorAll('.ikcp-card').forEach(card => {
            card.addEventListener('click', (e) => {
                // Don't navigate if clicking the note input
                if (e.target.closest('.ikcp-note-input')) return;
                const fileName = card.dataset.file;
                if (fileName) navigateTo(fileName);
            });
        });

        // Note input — save on blur and enter
        listEl.querySelectorAll('.ikcp-note-input').forEach(input => {
            input.addEventListener('click', (e) => e.stopPropagation());
            input.addEventListener('blur', () => {
                const fileName = input.dataset.noteFile;
                saveNote(fileName, input.value);
                input.classList.toggle('has-content', !!input.value.trim());
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    input.blur();
                }
                // Stop propagation so hotkeys don't fire
                e.stopPropagation();
            });
        });
    }


    // ═══════════════════════════════════════════════════════════════
    //  PART 4 — DRAG, RESIZE, HOTKEY, WAND
    // ═══════════════════════════════════════════════════════════════

    function setupDrag(win) {
        const header = win.querySelector('.ikcp-header');
        if (!header) return;

        let isDragging = false;
        let startX, startY, startLeft, startTop;

        header.addEventListener('mousedown', (e) => {
            // Don't drag from buttons
            if (e.target.closest('.ikcp-hbtn')) return;
            isDragging = true;
            win.classList.add('ikcp-dragging');

            const rect = win.getBoundingClientRect();
            startX = e.clientX;
            startY = e.clientY;
            startLeft = rect.left;
            startTop = rect.top;

            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            let newLeft = startLeft + dx;
            let newTop = startTop + dy;

            // Keep within viewport bounds
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

            // Save position
            const s = getSettings();
            s.windowX = parseInt(win.style.left, 10);
            s.windowY = parseInt(win.style.top, 10);
            saveSettings();
        });
    }

    function setupResize(win) {
        const handles = win.querySelectorAll('.ikcp-rh');
        if (!handles.length) return;

        let isResizing = false;
        let resizeDir = '';
        let startX, startY, startW, startH, startLeft, startTop;

        handles.forEach(handle => {
            handle.addEventListener('mousedown', (e) => {
                isResizing = true;
                resizeDir = handle.dataset.dir;
                win.classList.add('ikcp-resizing');

                const rect = win.getBoundingClientRect();
                startX = e.clientX;
                startY = e.clientY;
                startW = rect.width;
                startH = rect.height;
                startLeft = rect.left;
                startTop = rect.top;

                e.preventDefault();
                e.stopPropagation();
            });
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            const dir = resizeDir;
            const minW = 320;
            const minH = 280;

            let newW = startW;
            let newH = startH;
            let newLeft = startLeft;
            let newTop = startTop;

            // East
            if (dir.includes('e')) newW = Math.max(minW, startW + dx);
            // West
            if (dir.includes('w')) {
                newW = Math.max(minW, startW - dx);
                if (newW > minW) newLeft = startLeft + dx;
            }
            // South
            if (dir.includes('s')) newH = Math.max(minH, startH + dy);
            // North
            if (dir.includes('n') && dir !== 'ne' || dir === 'n' || dir === 'nw') {
                newH = Math.max(minH, startH - dy);
                if (newH > minH) newTop = startTop + dy;
            }
            if (dir === 'ne') {
                newH = Math.max(minH, startH - dy);
                if (newH > minH) newTop = startTop + dy;
            }

            win.style.width = newW + 'px';
            win.style.height = newH + 'px';
            win.style.left = newLeft + 'px';
            win.style.top = newTop + 'px';
            win.style.right = 'auto';
        });

        document.addEventListener('mouseup', () => {
            if (!isResizing) return;
            isResizing = false;
            win.classList.remove('ikcp-resizing');

            // Save size + position
            const s = getSettings();
            s.windowW = parseInt(win.style.width, 10);
            s.windowH = parseInt(win.style.height, 10);
            s.windowX = parseInt(win.style.left, 10);
            s.windowY = parseInt(win.style.top, 10);
            saveSettings();
        });
    }

    function setupHotkey() {
        document.addEventListener('keydown', (e) => {
            const s = getSettings();
            if (!s.enabled || !s.hotkeyEnabled || !s.hotkey) return;

            // Don't trigger if typing in an input
            const tag = (e.target.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;

            // Parse hotkey string like "Alt+K", "Ctrl+Shift+B"
            const parts = s.hotkey.split('+').map(p => p.trim().toLowerCase());
            const key = parts.pop(); // last part is the actual key
            const needCtrl = parts.includes('ctrl') || parts.includes('control');
            const needAlt = parts.includes('alt');
            const needShift = parts.includes('shift');
            const needMeta = parts.includes('meta') || parts.includes('cmd');

            if (e.ctrlKey !== needCtrl) return;
            if (e.altKey !== needAlt) return;
            if (e.shiftKey !== needShift) return;
            if (e.metaKey !== needMeta) return;
            if (e.key.toLowerCase() !== key) return;

            e.preventDefault();
            e.stopPropagation();
            toggleWindow();
        });
    }

    function addWandButton() {
        const menu = document.getElementById('extensionsMenu');
        if (!menu || document.getElementById('ikcp-wand-btn')) return;

        const btn = document.createElement('div');
        btn.id = 'ikcp-wand-btn';
        btn.classList.add('list-group-item', 'flex-container', 'flexGap5');
        btn.innerHTML = '<div class="fa-solid fa-bookmark extensionsMenuExtensionButton"></div><span>Ikarus Checkpoint</span>';
        btn.addEventListener('click', () => {
            toggleWindow();
        });
        menu.appendChild(btn);
    }


    // ── Bootstrap ────────────────────────────────────────────────
    jQuery(async () => {
        try {
            await init();
        } catch (e) {
            console.error(`[${EXT_DISPLAY}] Init failed:`, e);
        }
    });

})();
