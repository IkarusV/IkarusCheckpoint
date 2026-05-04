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
    let _activeCheckpointRoot = null;
    let _activeBranchSource = null;
    let _activeSwipeSource = null;
    
    // Cache per character: characterId -> { checkpoints: [], branches: [] }
    let _characterHubCache = {};

    function getSettings() {
        const { extensionSettings } = SillyTavern.getContext();
        if (!extensionSettings[EXT_NAME]) extensionSettings[EXT_NAME] = {};
        const s = extensionSettings[EXT_NAME];
        const defaults = {
            enabled: true,
            showDock: true,
            showNotifications: true,
            autoScanOnCharacterChange: true,
            windowX: null, windowY: null,
            windowW: 380, windowH: 520,
            notes: {},
            checkpointsCollapsed: false,
            branchesCollapsed: true,
            detectCheckpoints: true,
            detectBranches: true,
            detectSwipes: true,
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

    function escAttr(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function stripJsonl(fileName) {
        return String(fileName ?? '').replace(/\.jsonl$/i, '');
    }

    function withJsonl(fileName) {
        const clean = stripJsonl(fileName);
        return clean ? `${clean}.jsonl` : '';
    }

    function getCheckpointRootName(fileName) {
        let root = stripJsonl(fileName).trim();
        const original = root;
        while (/\(\d+\)$/.test(root)) {
            root = root.replace(/\(\d+\)$/, '').trim();
        }
        return root || original;
    }

    function getCheckpointCopyNumber(fileName) {
        const name = stripJsonl(fileName).trim();
        const match = name.match(/\((\d+)\)$/);
        return match ? Number(match[1]) : 0;
    }

    function getItemDateValue(item) {
        return new Date(item?.sendDate || item?.lastDate || '').getTime() || 0;
    }

    function formatDate(dateStr) {
        if (!dateStr) return '';
        try {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return String(dateStr).substring(0, 10);
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const hours = String(d.getHours()).padStart(2, '0');
            const mins = String(d.getMinutes()).padStart(2, '0');
            return `${month}/${day} ${hours}:${mins}`;
        } catch { return ''; }
    }

    function previewText(text, maxLength = 64) {
        const clean = String(text || '').replace(/\s+/g, ' ').trim();
        if (!clean) return '(empty swipe)';
        return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}…` : clean;
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
            if (getSettings().autoScanOnCharacterChange && charId !== undefined && !_characterHubCache[charId]) {
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
        bindCheck('ikcp-show-notifs', 'showNotifications');
        bindCheck('ikcp-auto-scan-character', 'autoScanOnCharacterChange');
        const resyncDetection = () => {
            const charId = getCharacterId();
            if (charId !== undefined) delete _characterHubCache[charId];
            _activeCheckpointRoot = null;
            _activeBranchSource = null;
            _activeSwipeSource = null;
            syncAllCharacterChats();
        };
        bindCheck('ikcp-detect-checkpoints', 'detectCheckpoints', resyncDetection);
        bindCheck('ikcp-detect-branches', 'detectBranches', resyncDetection);
        bindCheck('ikcp-detect-swipes', 'detectSwipes', resyncDetection);

        document.getElementById('ikcp-open-window')?.addEventListener('click', () => showWindow());
    }

    function updateDockVisibility() {
        const s = getSettings();
        if (!_dockEl) return;
        if (s.enabled && s.showDock) _dockEl.style.setProperty('display', 'flex', 'important');
        else _dockEl.style.setProperty('display', 'none', 'important');
    }

    function onChatChanged() {
        if (_windowEl) {
            const badge = _windowEl.querySelector('.ikcp-char-badge');
            if (badge) badge.textContent = getCharacterName() || '—';
        }
        
        const charId = getCharacterId();
        if (charId !== undefined && !_characterHubCache[charId]) {
            // Auto-sync only when enabled. Otherwise just show cached state/manual sync prompt.
            if (getSettings().autoScanOnCharacterChange) syncAllCharacterChats();
            else if (_isOpen) renderFromCache();
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
                <button class="ikcp-hbtn ikcp-btn-deep-scan" title="Deep Branch Scan" data-action="deep-scan">
                    <i class="fa-solid fa-magnifying-glass"></i>
                </button>
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
                    <span class="ikcp-section-title">BRANCHES & SWIPES</span>
                    <span class="ikcp-section-count">(0)</span>
                </div>
                <div class="ikcp-section-body">
                    <div class="ikcp-search-bar">
                        <input class="ikcp-search-input" type="text" placeholder="Search branches & swipes…" data-target="branches" />
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
        win.querySelector('.ikcp-btn-deep-scan').addEventListener('click', (e) => { e.stopPropagation(); deepScanBranches(); });

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

        // On mobile, force window above all ST panels and into visible area
        if (isMobile()) {
            _windowEl.style.zIndex = '10001';
            _windowEl.style.left = '3vw';
            _windowEl.style.top = '8vh';
            _windowEl.style.right = 'auto';
        }

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

    async function navigateToMessageInChat(fileName, messageIndex) {
        await navigateTo(fileName);
        const targetIndex = Number(messageIndex);
        if (!Number.isFinite(targetIndex)) return;

        setTimeout(() => {
            const chat = $('#chat');
            let message = chat.find(`.mes[mesid="${targetIndex}"]`);

            for (let tries = 0; tries < 10 && (!message.length || !message.is(':visible')); tries++) {
                const showMoreBtn = $('#show_more_messages');
                if (!showMoreBtn.length) break;
                showMoreBtn.trigger('mouseup');
                message = chat.find(`.mes[mesid="${targetIndex}"]`);
            }

            if (message.length) {
                const scrollPosition = chat.scrollTop() + message.position().top;
                chat.animate({ scrollTop: scrollPosition }, 350);
            }
        }, 250);
    }

    async function duplicateAndOpenChat(baseFileName) {
        const ctx = SillyTavern.getContext();
        const charName = getCharacterName();
        const charAvatar = getCharacterAvatar();
        const baseName = stripJsonl(baseFileName);
        const rootName = getCheckpointRootName(baseName);
        
        try {
            // 1. Fetch original chat
            const getRes = await fetch('/api/chats/get', {
                method: 'POST',
                headers: ctx.getRequestHeaders(),
                body: JSON.stringify({
                    ch_name: charName,
                    file_name: baseName,
                    avatar_url: charAvatar,
                }),
                cache: 'no-cache',
            });
            if (!getRes.ok) throw new Error('Failed to fetch checkpoint chat.');
            const chatData = await getRes.json();

            if (Array.isArray(chatData) && chatData[0] && typeof chatData[0] === 'object') {
                chatData[0].ikarus_checkpoint = {
                    root: rootName,
                    createdFrom: baseName,
                    createdAt: new Date().toISOString(),
                };
            }
            
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
            
            let cleanBase = rootName || baseName;
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
                    avatar_url: charAvatar,
                    chat: chatData,
                    force: true,
                })
            });
            if (!saveRes.ok) throw new Error('Failed to create new checkpoint copy.');
            
            // 4. Navigate to new chat
            await ctx.openCharacterChat(newName);
            toastr?.success(`Created checkpoint copy: ${newName}`, EXT_DISPLAY);
            
            // 5. Sync hub to show new branch
            syncAllCharacterChats();
            
        } catch (e) {
            console.error(`[${EXT_DISPLAY}] Restore failed:`, e);
            if (typeof toastr !== 'undefined') toastr.error(`Failed to create checkpoint copy: ${e.message}`, EXT_DISPLAY);
        }
    }

    // ── Data Syncing ────────────────────────────────────────────

    function getChatMeta(chatFileMetadata, fileName) {
        return chatFileMetadata[withJsonl(fileName)] || chatFileMetadata[stripJsonl(fileName)] || {};
    }

    function applyMetadata(item, chatFileMetadata) {
        const meta = getChatMeta(chatFileMetadata, item.fileName);
        if (meta.messageCount !== undefined) item.messageCount = meta.messageCount;
        if (meta.contextSize !== undefined) item.contextSize = meta.contextSize;
        if (!item.sendDate && meta.lastDate) item.sendDate = meta.lastDate;
        item.lastDate = meta.lastDate || item.sendDate || '';
        return item;
    }

    function makeChatItem(fileName, chatFileMetadata, extra = {}) {
        const cleanName = stripJsonl(fileName);
        const item = {
            fileName: cleanName,
            name: cleanName,
            sendDate: '',
            ...extra,
        };
        if (!item.name) item.name = cleanName;
        return applyMetadata(item, chatFileMetadata);
    }

    function buildCheckpointFamilies(checkpoints, chatFiles, chatFileMetadata) {
        const rootMap = new Map();

        for (const checkpoint of checkpoints) {
            checkpoint.fileName = stripJsonl(checkpoint.fileName);
            checkpoint.name = stripJsonl(checkpoint.name || checkpoint.fileName);
            checkpoint.rootName = getCheckpointRootName(checkpoint.fileName);
            applyMetadata(checkpoint, chatFileMetadata);
            if (!rootMap.has(checkpoint.rootName)) {
                rootMap.set(checkpoint.rootName, checkpoint);
            }
        }

        const childrenByRoot = new Map();
        const seenChildren = new Set();
        for (const fileName of chatFiles) {
            const cleanName = stripJsonl(fileName);
            const rootName = getCheckpointRootName(cleanName);
            if (!rootMap.has(rootName)) continue;

            const key = `${rootName}::${cleanName}`;
            if (seenChildren.has(key)) continue;
            seenChildren.add(key);

            const child = makeChatItem(cleanName, chatFileMetadata, {
                rootName,
                copyNumber: getCheckpointCopyNumber(cleanName),
                isOriginal: cleanName === rootName,
            });

            if (!childrenByRoot.has(rootName)) childrenByRoot.set(rootName, []);
            childrenByRoot.get(rootName).push(child);
        }

        for (const checkpoint of rootMap.values()) {
            const children = childrenByRoot.get(checkpoint.rootName) || [];
            if (!children.some(child => child.fileName === checkpoint.fileName)) {
                children.push({
                    ...checkpoint,
                    copyNumber: getCheckpointCopyNumber(checkpoint.fileName),
                    isOriginal: checkpoint.fileName === checkpoint.rootName,
                });
            }

            children.sort((a, b) => {
                if (a.copyNumber !== b.copyNumber) return a.copyNumber - b.copyNumber;
                const dateDiff = getItemDateValue(b) - getItemDateValue(a);
                if (dateDiff) return dateDiff;
                return a.name.localeCompare(b.name);
            });

            checkpoint.children = children;
            checkpoint.childCount = children.length;
        }

        return Array.from(rootMap.values());
    }

    function buildBranchParents(branchLinks, swipeLinks, chatFileMetadata) {
        const parentMap = new Map();
        const ensureParent = (sourceChat, messageIndex = 0) => {
            const cleanSource = stripJsonl(sourceChat);
            if (!parentMap.has(cleanSource)) {
                parentMap.set(cleanSource, makeChatItem(cleanSource, chatFileMetadata, {
                    sourceChat: cleanSource,
                    branchChildren: [],
                    swipeChildren: [],
                    children: [],
                    childCount: 0,
                    messageIndex,
                    _seenBranchChildren: new Set(),
                }));
            }
            return parentMap.get(cleanSource);
        };

        for (const link of branchLinks) {
            const sourceChat = stripJsonl(link.sourceChat);
            const branchFile = stripJsonl(link.fileName);
            if (!sourceChat || !branchFile) continue;

            const parent = ensureParent(sourceChat, link.messageIndex);
            if (parent._seenBranchChildren.has(branchFile)) continue;
            parent._seenBranchChildren.add(branchFile);
            parent.messageIndex = Math.min(parent.messageIndex ?? link.messageIndex, link.messageIndex);

            parent.branchChildren.push(makeChatItem(branchFile, chatFileMetadata, {
                kind: 'branch',
                sourceChat,
                messageIndex: link.messageIndex,
                sendDate: link.sendDate,
                inferred: !!link.inferred,
                matchCount: link.matchCount,
                swipeChildren: swipeLinks[branchFile] || [],
                swipeCount: (swipeLinks[branchFile] || []).length,
            }));
        }

        for (const [sourceChat, swipes] of Object.entries(swipeLinks || {})) {
            const cleanSource = stripJsonl(sourceChat);
            const parent = parentMap.get(cleanSource);
            if (!parent) continue;
            parent.swipeChildren = swipes;
            parent.swipeCount = swipes.length;
        }

        for (const parent of parentMap.values()) {
            const byDateThenMessage = (a, b) => {
                const dateDiff = getItemDateValue(b) - getItemDateValue(a);
                if (dateDiff) return dateDiff;
                if (a.messageIndex !== b.messageIndex) return a.messageIndex - b.messageIndex;
                return a.name.localeCompare(b.name);
            };
            parent.branchChildren.sort(byDateThenMessage);
            parent.swipeChildren = parent.swipeChildren || [];
            parent.swipeChildren.sort(byDateThenMessage);
            parent.children = [...parent.branchChildren];
            parent.childCount = parent.branchChildren.length;
            delete parent._seenBranchChildren;
        }

        return Array.from(parentMap.values());
    }

    function buildSwipesBySource(swipeLinks) {
        const swipesBySource = {};
        const seen = new Set();

        for (const link of swipeLinks || []) {
            const sourceChat = stripJsonl(link.sourceChat);
            if (!sourceChat) continue;
            const swipeKey = `${sourceChat}::${link.messageIndex}::${link.swipeIndex}`;
            if (seen.has(swipeKey)) continue;
            seen.add(swipeKey);

            if (!swipesBySource[sourceChat]) swipesBySource[sourceChat] = [];
            swipesBySource[sourceChat].push({
                fileName: sourceChat,
                name: link.name,
                kind: 'swipe',
                sourceChat,
                messageIndex: link.messageIndex,
                swipeIndex: link.swipeIndex,
                sendDate: link.sendDate,
                metaText: `msg ${link.messageIndex + 1}`,
                contextSize: link.contextSize,
                searchText: link.searchText,
            });
        }

        for (const swipes of Object.values(swipesBySource)) {
            swipes.sort((a, b) => {
                const dateDiff = getItemDateValue(b) - getItemDateValue(a);
                if (dateDiff) return dateDiff;
                if (a.messageIndex !== b.messageIndex) return a.messageIndex - b.messageIndex;
                return (a.swipeIndex ?? 0) - (b.swipeIndex ?? 0);
            });
        }

        return swipesBySource;
    }

    function mergeBranchLinks(...linkLists) {
        const merged = [];
        const seen = new Set();
        for (const list of linkLists) {
            for (const link of list || []) {
                const sourceChat = stripJsonl(link.sourceChat);
                const fileName = stripJsonl(link.fileName);
                if (!sourceChat || !fileName || sourceChat === fileName) continue;
                const key = `${sourceChat}::${fileName}`;
                if (seen.has(key)) continue;
                seen.add(key);
                merged.push({ ...link, sourceChat, fileName, name: link.name || fileName });
            }
        }
        return merged;
    }

    function getMessageSignature(msg) {
        const role = msg?.is_system ? 'system' : msg?.is_user ? 'user' : 'char';
        const name = msg?.name || '';
        const text = String(msg?.mes || '').replace(/\r\n/g, '\n').trim();
        return `${role}\u0001${name}\u0001${text}`;
    }

    function getCommonPrefixLength(a, b) {
        const limit = Math.min(a.length, b.length);
        let i = 0;
        while (i < limit && a[i] === b[i]) i++;
        return i;
    }

    function isBranchLikeName(fileName) {
        return /(?:^|[\s._-])branch(?:[\s._#-]|\d|$)/i.test(stripJsonl(fileName));
    }

    function getCheckpointFileExclusions(cache) {
        const files = new Set();
        for (const checkpoint of cache?.checkpoints || []) {
            files.add(stripJsonl(checkpoint.fileName));
            for (const child of checkpoint.children || []) {
                files.add(stripJsonl(child.fileName));
            }
        }
        return files;
    }

    function inferDeepBranchLinks(chatRecords, existingCache) {
        const checkpointFiles = getCheckpointFileExclusions(existingCache);
        const records = chatRecords.filter(record => record.signatures.length > 1 && !checkpointFiles.has(record.fileName));
        const inferred = [];

        for (const child of records) {
            let best = null;
            const childBranchLike = isBranchLikeName(child.fileName);

            for (const parent of records) {
                if (parent.fileName === child.fileName) continue;

                const lcp = getCommonPrefixLength(child.signatures, parent.signatures);
                if (lcp < 2) continue;
                if (lcp === child.signatures.length && lcp === parent.signatures.length) continue;

                const parentBranchLike = isBranchLikeName(parent.fileName);
                const shorter = Math.min(child.signatures.length, parent.signatures.length);
                const sharedRatio = lcp / Math.max(1, shorter);
                const qualifies = childBranchLike
                    ? lcp >= 2
                    : lcp >= 6 && (sharedRatio >= 0.5 || lcp >= 12);

                if (!qualifies) continue;

                let score = lcp * 10 + Math.round(sharedRatio * 20);
                if (childBranchLike && !parentBranchLike) score += 1000;
                if (parentBranchLike) score -= 50;
                if (lcp < child.signatures.length && lcp < parent.signatures.length) score += 25;

                if (!best || score > best.score) {
                    best = { parent, lcp, score };
                }
            }

            if (!best) continue;

            inferred.push({
                fileName: child.fileName,
                sourceChat: best.parent.fileName,
                messageIndex: Math.max(0, best.lcp - 1),
                name: child.fileName,
                sendDate: child.lastDate || '',
                inferred: true,
                matchCount: best.lcp,
            });
        }

        return inferred;
    }

    async function fetchCharacterChatRecords() {
        const ctx = SillyTavern.getContext();
        const charAvatar = getCharacterAvatar();
        const charName = getCharacterName();
        const listRes = await fetch('/api/characters/chats', {
            method: 'POST',
            body: JSON.stringify({ avatar_url: charAvatar }),
            headers: ctx.getRequestHeaders(),
        });
        if (!listRes.ok) throw new Error('Failed to get chat list');

        const chatDict = await listRes.json();
        const chatFiles = Object.values(chatDict).map(c => c.file_name);
        const chatFileMetadata = {};
        const records = [];

        for (const fileName of chatFiles) {
            const getRes = await fetch('/api/chats/get', {
                method: 'POST',
                headers: ctx.getRequestHeaders(),
                body: JSON.stringify({
                    ch_name: charName,
                    file_name: stripJsonl(fileName),
                    avatar_url: charAvatar,
                }),
                cache: 'no-cache',
            });
            if (!getRes.ok) continue;

            const chatData = await getRes.json();
            if (!Array.isArray(chatData)) continue;
            chatData.shift();

            let contextSize = 0;
            for (const msg of chatData) {
                if (msg?.mes && !msg.is_system) contextSize += msg.mes.length;
            }

            const lastDate = chatData[chatData.length - 1]?.send_date || '';
            chatFileMetadata[fileName] = {
                messageCount: chatData.length,
                contextSize,
                lastDate,
            };

            records.push({
                fileName: stripJsonl(fileName),
                messages: chatData,
                signatures: chatData.map(getMessageSignature),
                lastDate,
            });
        }

        return { records, chatFileMetadata, chatFiles };
    }

    async function deepScanBranches() {
        const charId = getCharacterId();
        const charAvatar = getCharacterAvatar();
        if (charId === undefined || !charAvatar) {
            toastr?.warning('No active character selected.', EXT_DISPLAY);
            return;
        }

        if (!_characterHubCache[charId]) {
            await syncAllCharacterChats();
        }

        const brList = _windowEl?.querySelector('[data-list="branches"]');
        if (brList) brList.innerHTML = '<div class="ikcp-loading"><div class="ikcp-spinner"></div>Deep scanning branches...</div>';
        if (getSettings().showNotifications) toastr?.info('Deep scanning branch parents...', EXT_DISPLAY);

        try {
            const { records, chatFileMetadata } = await fetchCharacterChatRecords();
            const existing = _characterHubCache[charId] || {};
            const deepBranchLinks = inferDeepBranchLinks(records, existing);
            const quickBranchLinks = existing.quickBranchLinks || [];
            const swipeLinks = existing.swipeLinks || [];
            const swipesBySource = existing.swipesBySource || buildSwipesBySource(swipeLinks);
            const allBranches = buildBranchParents(mergeBranchLinks(quickBranchLinks, deepBranchLinks), swipesBySource, chatFileMetadata);
            const branchCount = allBranches.reduce((sum, item) => sum + (item.children?.length || 0), 0);

            _characterHubCache[charId] = {
                ...existing,
                branches: allBranches,
                branchCount,
                quickBranchLinks,
                swipeLinks,
                swipesBySource,
                deepBranchLinks,
                chatFileMetadata,
            };

            renderFromCache();
            toastr?.success(`Deep scan found ${deepBranchLinks.length} inferred branch${deepBranchLinks.length !== 1 ? 'es' : ''}.`, EXT_DISPLAY);
        } catch (e) {
            console.error(`[${EXT_DISPLAY}] Deep branch scan failed:`, e);
            toastr?.error(`Deep branch scan failed: ${e.message}`, EXT_DISPLAY);
            renderFromCache();
        }
    }

    async function syncAllCharacterChats() {
        const charId = getCharacterId();
        const charAvatar = getCharacterAvatar();
        const charName = getCharacterName();
        if (charId === undefined || !charAvatar) {
            toastr?.warning('No active character selected.', EXT_DISPLAY);
            return;
        }

        if (getSettings().showNotifications) toastr?.info(`Scanning chats for ${charName}...`, EXT_DISPLAY);

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
            const chatFileSet = new Set(chatFiles.map(stripJsonl));
            const settings = getSettings();
            const existingCache = _characterHubCache[charId] || {};

            let allCheckpoints = [];
            let allBranchLinks = [];
            let allSwipeLinks = [];
            let seenBranchLinks = new Set();
            let seenSwipeLinks = new Set();
            let seenCheckpoints = new Set();
            let chatFileMetadata = {};

            // 2. Fetch each chat and scan
            for (const file_name of chatFiles) {
                const getRes = await fetch('/api/chats/get', {
                    method: 'POST',
                    headers: ctx.getRequestHeaders(),
                    body: JSON.stringify({
                        ch_name: charName,
                        file_name: stripJsonl(file_name),
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

                    const extra = msg.extra || {};
                    
                    if (settings.detectCheckpoints && extra.bookmark_link) {
                        const link = stripJsonl(extra.bookmark_link);
                        if (chatFileSet.has(link) && !seenCheckpoints.has(link)) {
                            seenCheckpoints.add(link);
                            allCheckpoints.push({
                                fileName: link,
                                sourceChat: file_name,
                                messageIndex: i,
                                name: link,
                                sendDate: msg.send_date || '',
                            });
                        }
                    }

                    if (settings.detectBranches && extra.branches && Array.isArray(extra.branches)) {
                        for (const branchFile of extra.branches) {
                            const cleanBranchFile = stripJsonl(branchFile);
                            const branchKey = `${stripJsonl(file_name)}::${cleanBranchFile}`;
                            if (chatFileSet.has(cleanBranchFile) && !seenBranchLinks.has(branchKey)) {
                                seenBranchLinks.add(branchKey);
                                allBranchLinks.push({
                                    fileName: cleanBranchFile,
                                    sourceChat: file_name,
                                    messageIndex: i,
                                    name: cleanBranchFile,
                                    sendDate: msg.send_date || '',
                                });
                            }
                        }
                    }

                    if (settings.detectSwipes && Array.isArray(msg.swipes) && msg.swipes.length > 1) {
                        for (let swipeIndex = 0; swipeIndex < msg.swipes.length; swipeIndex++) {
                            const swipeText = msg.swipes[swipeIndex];
                            if (!swipeText || swipeText === msg.mes) continue;

                            const swipeKey = `${stripJsonl(file_name)}::${i}::${swipeIndex}`;
                            if (seenSwipeLinks.has(swipeKey)) continue;
                            seenSwipeLinks.add(swipeKey);

                            const swipeInfo = Array.isArray(msg.swipe_info) ? msg.swipe_info[swipeIndex] : null;
                            allSwipeLinks.push({
                                sourceChat: file_name,
                                messageIndex: i,
                                swipeIndex,
                                name: `Swipe ${i + 1}.${swipeIndex + 1}: ${previewText(swipeText)}`,
                                sendDate: swipeInfo?.send_date || msg.send_date || '',
                                contextSize: swipeText.length,
                                searchText: swipeText,
                            });
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

            allCheckpoints = buildCheckpointFamilies(allCheckpoints, chatFiles, chatFileMetadata);
            const preservedDeepBranchLinks = (existingCache.deepBranchLinks || [])
                .filter(link => chatFileSet.has(stripJsonl(link.sourceChat)) && chatFileSet.has(stripJsonl(link.fileName)));
            const swipesBySource = buildSwipesBySource(allSwipeLinks);
            const allBranches = buildBranchParents(mergeBranchLinks(allBranchLinks, preservedDeepBranchLinks), swipesBySource, chatFileMetadata);
            const branchCount = allBranches.reduce((sum, item) => sum + (item.children?.length || 0), 0);

            // Save to cache
            _characterHubCache[charId] = {
                checkpoints: allCheckpoints,
                branches: allBranches,
                branchCount,
                quickBranchLinks: allBranchLinks,
                swipeLinks: allSwipeLinks,
                swipesBySource,
                deepBranchLinks: preservedDeepBranchLinks,
                chatFileMetadata,
            };

            const totalChats = chatFiles.length;
            if (getSettings().showNotifications) {
                toastr?.success(
                    `${charName} scan complete! ${totalChats} chat${totalChats !== 1 ? 's' : ''} · ${allCheckpoints.length} checkpoint folder${allCheckpoints.length !== 1 ? 's' : ''} · ${branchCount} branch/swipe item${branchCount !== 1 ? 's' : ''}`,
                    EXT_DISPLAY,
                    { timeOut: 6000 }
                );
            }

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
        
        const allItems = [];
        const seenItems = new Set();
        const addItem = (item) => {
            if (!item?.fileName) return;
            const cleanName = stripJsonl(item.fileName);
            if (seenItems.has(cleanName)) return;
            seenItems.add(cleanName);
            allItems.push(item);
        };
        for (const checkpoint of checkpoints) {
            addItem(checkpoint);
            (checkpoint.children || []).forEach(addItem);
        }
        for (const branch of branches) {
            addItem(branch);
            (branch.children || []).forEach(addItem);
        }

        for (const item of allItems) {
            try {
                const getRes = await fetch('/api/chats/get', {
                    method: 'POST',
                    headers: ctx.getRequestHeaders(),
                    body: JSON.stringify({
                        ch_name: charName,
                        file_name: stripJsonl(item.fileName),
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
                            const cards = _windowEl.querySelectorAll(`[data-file="${CSS.escape(stripJsonl(item.fileName))}"]:not([data-type="swipe-child"])`);
                            cards.forEach(card => {
                                const msgBadge = card.querySelector('.ikcp-badge-msg-count');
                                if (msgBadge) msgBadge.textContent = `${item.messageCount} msgs`;
                                const ctxBadge = card.querySelector('.ikcp-badge-accent');
                                if (ctxBadge) ctxBadge.textContent = formatContextSize(item.contextSize);
                            });
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
        if (brCount) brCount.textContent = `(${data.branchCount ?? data.branches.length})`;

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

    function itemMatchesFilter(item) {
        if (!_currentFilter) return true;
        const note = getSettings().notes[item.fileName] || '';
        const ownHaystack = `${item.name} ${item.searchText || ''}`.toLowerCase();
        const ownMatch = ownHaystack.includes(_currentFilter) || note.toLowerCase().includes(_currentFilter);
        const childMatch = (item.children || []).some(child => {
            const childNote = getSettings().notes[child.fileName] || '';
            const childHaystack = `${child.name} ${child.searchText || ''}`.toLowerCase();
            const childOwnMatch = childHaystack.includes(_currentFilter) || childNote.toLowerCase().includes(_currentFilter);
            const childSwipeMatch = (child.swipeChildren || []).some(swipe => {
                const swipeHaystack = `${swipe.name} ${swipe.searchText || ''}`.toLowerCase();
                return swipeHaystack.includes(_currentFilter);
            });
            return childOwnMatch || childSwipeMatch;
        });
        const swipeMatch = (item.swipeChildren || []).some(swipe => {
            const swipeHaystack = `${swipe.name} ${swipe.searchText || ''}`.toLowerCase();
            return swipeHaystack.includes(_currentFilter);
        });
        return ownMatch || childMatch || swipeMatch;
    }

    function sortHubItems(items) {
        const sorted = items.slice();
        const s = getSettings();
        if (s.sortMode === 'name') {
            sorted.sort((a, b) => a.name.localeCompare(b.name));
        } else {
            sorted.sort((a, b) => {
                const dateDiff = getItemDateValue(b) - getItemDateValue(a);
                if (dateDiff) return dateDiff;
                return (b.messageIndex ?? 0) - (a.messageIndex ?? 0);
            });
        }
        return sorted;
    }

    function openCheckpointFolder(rootName) {
        _activeCheckpointRoot = rootName;
        renderFromCache();
    }

    function openBranchFolder(sourceChat) {
        _activeBranchSource = stripJsonl(sourceChat);
        _activeSwipeSource = null;
        renderFromCache();
    }

    function openSwipeFolder(sourceChat) {
        _activeSwipeSource = stripJsonl(sourceChat);
        renderFromCache();
    }

    function closeFolder(type) {
        if (type === 'checkpoints') _activeCheckpointRoot = null;
        if (type === 'branches') {
            _activeBranchSource = null;
            _activeSwipeSource = null;
        }
        if (type === 'swipes') _activeSwipeSource = null;
        renderFromCache();
    }

    function findBranchItemByFile(items, fileName) {
        const cleanFile = stripJsonl(fileName);
        for (const item of items || []) {
            if (stripJsonl(item.fileName) === cleanFile) return item;
            for (const child of item.branchChildren || []) {
                if (stripJsonl(child.fileName) === cleanFile) return child;
            }
        }
        return null;
    }

    function renderList(type, items, iconClass, itemType) {
        const listEl = _windowEl.querySelector(`[data-list="${type}"]`);
        if (!listEl) return;

        const sourceItems = Array.isArray(items) ? items : [];

        if (type === 'checkpoints' && _activeCheckpointRoot) {
            const folder = sourceItems.find(item => item.rootName === _activeCheckpointRoot);
            if (folder) {
                renderFolderList(listEl, 'checkpoints', folder, folder.children || [], 'fa-file-lines', 'checkpoint-child');
                return;
            }
            _activeCheckpointRoot = null;
        }

        if (type === 'branches' && _activeSwipeSource) {
            const swipeSource = findBranchItemByFile(sourceItems, _activeSwipeSource);
            if (swipeSource) {
                renderSwipeFolderList(listEl, swipeSource);
                return;
            }
            _activeSwipeSource = null;
        }

        if (type === 'branches' && _activeBranchSource) {
            const folder = sourceItems.find(item => stripJsonl(item.fileName) === _activeBranchSource);
            if (folder) {
                renderBranchSwipeFolderList(listEl, folder);
                return;
            }
            _activeBranchSource = null;
        }

        const filtered = sortHubItems(sourceItems.filter(itemMatchesFilter));
        if (filtered.length === 0) {
            listEl.innerHTML = _currentFilter
                ? `<div class="ikcp-empty">No ${type} match your search.</div>`
                : `<div class="ikcp-empty">No ${type} found.</div>`;
            return;
        }

        listEl.innerHTML = filtered.map(item => buildCardHTML(item, iconClass, itemType)).join('');
        wireCardEvents(listEl);
    }

    function renderFolderList(listEl, type, parent, children, iconClass, childType) {
        const filtered = sortHubItems(children.filter(itemMatchesFilter));
        const emptyText = type === 'checkpoints' ? 'No checkpoint copies found.' : 'No branches found.';
        const childCards = filtered.length
            ? filtered.map(item => buildCardHTML(item, iconClass, childType)).join('')
            : `<div class="ikcp-empty">${emptyText}</div>`;
        listEl.innerHTML = buildFolderHeaderHTML(type, parent, children.length) + childCards;
        wireCardEvents(listEl);
    }

    function renderBranchSwipeFolderList(listEl, parent) {
        const settings = getSettings();
        const branchItems = sortHubItems((parent.branchChildren || []).filter(itemMatchesFilter));
        const branchCards = branchItems.length
            ? branchItems.map(item => buildCardHTML(item, 'fa-code-branch', 'branch-child')).join('')
            : `<div class="ikcp-empty ikcp-empty-compact">No branches found.</div>`;

        const branchSection = settings.detectBranches ? `
            <div class="ikcp-folder-category">
                <div class="ikcp-folder-category-title">
                    <i class="fa-solid fa-code-branch"></i>
                    <span>Branches</span>
                    <span class="ikcp-folder-count">${branchItems.length}</span>
                </div>
                ${branchCards}
            </div>` : '';

        listEl.innerHTML = buildFolderHeaderHTML('branches', parent, parent.childCount || 0) + branchSection;
        wireCardEvents(listEl);
    }

    function renderSwipeFolderList(listEl, parent) {
        const swipeItems = sortHubItems((parent.swipeChildren || []).filter(itemMatchesFilter));
        const swipeCards = swipeItems.length
            ? swipeItems.map(item => buildCardHTML(item, 'fa-clone', 'swipe-child')).join('')
            : `<div class="ikcp-empty ikcp-empty-compact">No swipes found.</div>`;

        listEl.innerHTML = buildFolderHeaderHTML('swipes', parent, parent.swipeChildren?.length || 0) + swipeCards;
        wireCardEvents(listEl);
    }

    function buildFolderHeaderHTML(type, parent, count) {
        const isCheckpoint = type === 'checkpoints';
        const isSwipe = type === 'swipes';
        const title = isCheckpoint ? (parent.rootName || parent.name) : parent.name;
        const icon = isCheckpoint ? 'fa-folder-open' : isSwipe ? 'fa-clone' : 'fa-code-branch';
        const createButton = isCheckpoint ? `
            <button type="button" class="ikcp-card-action ikcp-card-action-create"
                data-action="create-checkpoint" data-file="${escAttr(parent.fileName)}"
                title="Create a new checkpoint copy">
                <i class="fa-solid fa-plus"></i>
            </button>` : '';
        const swipeButton = !isCheckpoint && !isSwipe && parent.swipeChildren?.length ? `
            <button type="button" class="ikcp-card-action ikcp-card-action-swipe"
                data-action="open-swipe-folder" data-source="${escAttr(parent.fileName)}"
                title="Show swipes in this chat">
                <span>S</span>
                <span>${parent.swipeChildren.length}</span>
            </button>` : '';

        return `
        <div class="ikcp-folder-bar" data-folder-type="${escAttr(type)}">
            <button type="button" class="ikcp-folder-back" data-action="folder-back" data-folder-type="${escAttr(type)}" title="Back">
                <i class="fa-solid fa-arrow-left"></i>
            </button>
            <div class="ikcp-folder-title">
                <i class="fa-solid ${icon}"></i>
                <span>${escHtml(title)}</span>
                <span class="ikcp-folder-count">${count}</span>
            </div>
            ${createButton}
            ${swipeButton}
        </div>`;
    }

    function buildCardHTML(item, iconClass, itemType) {
        const note = getSettings().notes[item.fileName] || '';
        const noteHasContent = note ? ' has-content' : '';
        const isCheckpointParent = itemType === 'checkpoints';
        const isBranchParent = itemType === 'branches';
        const isChild = itemType === 'checkpoint-child' || itemType === 'branch-child' || itemType === 'swipe-child';
        const swipeCount = item.swipeChildren?.length || 0;
        const rootName = item.rootName || getCheckpointRootName(item.fileName);
        const copyBadge = itemType === 'checkpoint-child'
            ? `<span class="ikcp-badge ikcp-badge-subtle">${item.isOriginal ? 'Original' : `#${item.copyNumber}`}</span>`
            : '';
        const inferredBadge = item.inferred ? '<span class="ikcp-badge ikcp-badge-subtle">Inferred</span>' : '';
        const cardTitle = isCheckpointParent
            ? `Open checkpoint folder for ${item.name}`
            : isBranchParent
                ? `Open branch and swipe folder for ${item.name}`
            : itemType === 'swipe-child'
                ? `Open ${item.fileName} at message ${item.messageIndex + 1}`
                : `Click to open ${item.fileName}`;
        const swipeAction = swipeCount && itemType !== 'swipe-child' ? `
                    <button type="button" class="ikcp-card-action ikcp-card-action-swipe"
                        data-action="open-swipe-folder" data-source="${escAttr(item.fileName)}"
                        title="Show swipes in this chat">
                        <span>S</span>
                        <span>${swipeCount}</span>
                    </button>` : '';
        const cardActions = isCheckpointParent ? `
                <div class="ikcp-card-actions">
                    <button type="button" class="ikcp-card-action ikcp-card-action-create"
                        data-action="create-checkpoint" data-file="${escAttr(item.fileName)}"
                        title="Create a new checkpoint copy">
                        <i class="fa-solid fa-plus"></i>
                    </button>
                    <button type="button" class="ikcp-card-action"
                        data-action="open-checkpoint-folder" data-root="${escAttr(rootName)}"
                        title="Show existing checkpoint copies">
                        <i class="fa-solid fa-folder-open"></i>
                        <span>${item.childCount || 0}</span>
                    </button>
                    ${swipeAction}
                </div>` : isBranchParent ? `
                <div class="ikcp-card-actions">
                    <button type="button" class="ikcp-card-action"
                        data-action="open-branch-folder" data-source="${escAttr(item.fileName)}"
                        title="Show branches and swipes in this chat">
                        <i class="fa-solid fa-folder-open"></i>
                        <span>${item.childCount || 0}</span>
                    </button>
                    ${swipeAction}
                </div>` : swipeAction ? `
                <div class="ikcp-card-actions">
                    ${swipeAction}
                </div>` : '';
        const msgCountText = item.metaText || (item.messageCount !== undefined ? `${item.messageCount} msgs` : '…');
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
        <div class="ikcp-card${isChild ? ' ikcp-card-child' : ''}" data-file="${escAttr(item.fileName)}" data-root="${escAttr(rootName)}" data-type="${escAttr(itemType)}" data-message-index="${escAttr(item.messageIndex ?? '')}" data-swipe-index="${escAttr(item.swipeIndex ?? '')}" title="${escAttr(cardTitle)}">
            <div class="ikcp-card-top">
                <span class="ikcp-card-icon"><i class="fa-solid ${iconClass}"></i></span>
                <span class="ikcp-card-name">${escHtml(item.name)}</span>
                ${cardActions}
            </div>
            <div class="ikcp-card-meta">
                <span class="ikcp-badge ikcp-badge-msg-count">${msgCountText}</span>
                <span class="ikcp-badge ikcp-badge-accent">${ctxText}</span>
                ${copyBadge}
                ${inferredBadge}
                ${item.sendDate ? `<span class="ikcp-card-date">${escHtml(formatDate(item.sendDate))}</span>` : ''}
            </div>
            <div class="ikcp-note-row">
                <span class="ikcp-note-icon"><i class="fa-solid fa-pen"></i></span>
                <input class="ikcp-note-input${noteHasContent}" type="text"
                    placeholder="Add a note…" value="${escAttr(note)}"
                    data-note-file="${escAttr(item.fileName)}" />
            </div>
        </div>`;
    }

    function wireCardEvents(listEl) {
        listEl.querySelectorAll('[data-action="folder-back"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                closeFolder(btn.dataset.folderType);
            });
        });

        listEl.querySelectorAll('[data-action="create-checkpoint"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const fileName = btn.dataset.file;
                if (fileName) duplicateAndOpenChat(fileName);
            });
        });

        listEl.querySelectorAll('[data-action="open-checkpoint-folder"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                openCheckpointFolder(btn.dataset.root);
            });
        });

        listEl.querySelectorAll('[data-action="open-branch-folder"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                openBranchFolder(btn.dataset.source);
            });
        });

        listEl.querySelectorAll('[data-action="open-swipe-folder"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                openSwipeFolder(btn.dataset.source);
            });
        });

        listEl.querySelectorAll('.ikcp-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('.ikcp-note-input, .ikcp-card-action')) return;
                const fileName = card.dataset.file;
                const itemType = card.dataset.type;
                if (fileName) {
                    if (itemType === 'checkpoints') {
                        openCheckpointFolder(card.dataset.root);
                    } else if (itemType === 'branches') {
                        openBranchFolder(fileName);
                    } else if (itemType === 'swipe-child') {
                        navigateToMessageInChat(fileName, card.dataset.messageIndex);
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
