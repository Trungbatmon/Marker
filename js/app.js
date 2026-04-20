/**
 * Marker — Main App Controller
 * Router, view management, PWA install, OpenCV loading
 */

const App = (() => {
    // ── State ──
    let _currentView = 'dashboard';
    let _deferredPrompt = null; // PWA install prompt
    let _opencvLoaded = false;

    // ══════════════════════════════════════════
    // INITIALIZATION
    // ══════════════════════════════════════════

    async function init() {
        try {
            // 1. Init i18n
            I18n.init();

            // 2. Update splash progress
            updateSplash(10, I18n.t('app.loading'));

            // 3. Init database
            await MarkerDB.open();
            updateSplash(30, I18n.t('app.loading'));

            // 4. Apply saved theme
            applyTheme(localStorage.getItem(CONSTANTS.LS_KEYS.THEME) || 'dark');

            // 5. Setup navigation
            setupNavigation();
            updateSplash(50, I18n.t('app.loading'));

            // 6. Setup PWA install
            setupPWAInstall();

            // 7. Register Service Worker
            registerServiceWorker();

            // 8. Render settings
            renderSettings();
            updateSplash(70, I18n.t('app.loading'));

            // 9. Load initial view data
            await loadDashboard();
            updateSplash(90, I18n.t('app.ready'));

            // 10. Handle hash routing
            handleRoute();
            window.addEventListener('hashchange', handleRoute);

            // 11. Update i18n DOM
            I18n.updateDOM();

            // 12. Hide splash
            setTimeout(() => {
                updateSplash(100, I18n.t('app.ready'));
                setTimeout(() => {
                    document.getElementById('splash-screen').classList.add('hidden');
                }, 300);
            }, 400);

            // 13. Load OpenCV in background (non-blocking)
            loadOpenCV();

        } catch (error) {
            console.error('[App] Init error:', error);
            updateSplash(100, 'Error: ' + error.message);
        }
    }

    // ══════════════════════════════════════════
    // SPLASH SCREEN
    // ══════════════════════════════════════════

    function updateSplash(percent, message) {
        const bar = document.getElementById('splash-progress-bar');
        const status = document.getElementById('splash-status');
        if (bar) bar.style.width = percent + '%';
        if (status) status.textContent = message;
    }

    // ══════════════════════════════════════════
    // NAVIGATION & ROUTING
    // ══════════════════════════════════════════

    function setupNavigation() {
        // Bottom nav buttons
        document.querySelectorAll('.bottom-nav-item').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const view = btn.getAttribute('data-view');
                if (view) {
                    if (view === 'scanner' && typeof Scanner !== 'undefined') {
                        Scanner.setProject(null);
                        Scanner.setExamCode(null);
                    }
                    navigateTo(view);
                    UIHelpers.playSound('click');
                }
            });
        });

        // Header back button
        document.getElementById('header-back-btn').addEventListener('click', () => {
            navigateTo('dashboard');
        });
    }

    function handleRoute() {
        const hash = window.location.hash.replace('#/', '') || 'dashboard';
        const validViews = ['dashboard', 'scanner', 'designer', 'results', 'settings'];
        const view = validViews.includes(hash) ? hash : 'dashboard';
        navigateTo(view, false);
    }

    function navigateTo(viewName, updateHash = true) {
        const oldView = _currentView;
        _currentView = viewName;

        // Update hash
        if (updateHash) {
            window.location.hash = '#/' + viewName;
        }

        // Update views
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        const targetView = document.getElementById('view-' + viewName);
        if (targetView) targetView.classList.add('active');

        // Update nav
        document.querySelectorAll('.bottom-nav-item').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-view') === viewName);
        });

        // Update header
        updateHeader(viewName);

        // Emit event
        EventBus.emit('view:changed', { from: oldView, to: viewName });

        // View-specific actions
        if (viewName === 'dashboard') {
            loadDashboard();
        }
    }

    function updateHeader(viewName) {
        const backBtn = document.getElementById('header-back-btn');
        const title = document.getElementById('header-title');
        const actionBtn = document.getElementById('header-action-btn');

        // Show back button for sub-views
        const mainViews = ['dashboard'];
        backBtn.style.display = mainViews.includes(viewName) ? 'none' : '';

        // Update title
        const titleMap = {
            dashboard: I18n.t('app.name'),
            scanner: I18n.t('scanner.title'),
            designer: I18n.t('designer.title'),
            results: I18n.t('results.title'),
            settings: I18n.t('settings.title'),
        };

        const titleContent = titleMap[viewName] || I18n.t('app.name');
        if (viewName === 'dashboard') {
            title.innerHTML = `<span style="background:linear-gradient(135deg,var(--color-primary),var(--color-accent));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">${titleContent}</span>`;
        } else {
            title.textContent = titleContent;
            title.style.background = 'none';
            title.style.webkitTextFillColor = 'var(--color-text-primary)';
        }
    }

    // ══════════════════════════════════════════
    // DASHBOARD
    // ══════════════════════════════════════════

    async function loadDashboard() {
        try {
            const projects = await MarkerDB.getAll(MarkerDB.STORES.PROJECTS);
            const allResults = await MarkerDB.getAll(MarkerDB.STORES.SCAN_RESULTS);
            const todayCount = await MarkerDB.getTodayScanCount();

            // Update stats
            document.getElementById('stat-total-projects').textContent = projects.length;
            document.getElementById('stat-total-scanned').textContent = allResults.length;
            document.getElementById('stat-today-scanned').textContent = todayCount;

            // Average score
            if (allResults.length > 0) {
                const avg = allResults.reduce((s, r) => s + (r.score || 0), 0) / allResults.length;
                document.getElementById('stat-avg-score').textContent = avg.toFixed(1);
            } else {
                document.getElementById('stat-avg-score').textContent = '--';
            }

            // Render project list
            const listEl = document.getElementById('project-list');
            const emptyEl = document.getElementById('dashboard-empty');

            if (projects.length === 0) {
                listEl.innerHTML = '';
                emptyEl.style.display = '';
                // Bind create first project button
                const createBtn = document.getElementById('btn-create-first-project');
                createBtn.onclick = () => ProjectManager.showCreateDialog();
            } else {
                emptyEl.style.display = 'none';
                await renderProjectList(projects, allResults);
            }
        } catch (error) {
            console.error('[Dashboard] Load error:', error);
        }
    }

    async function renderProjectList(projects, allResults) {
        const listEl = document.getElementById('project-list');

        // Sort by updatedAt descending
        projects.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));

        const html = projects.map(project => {
            const projectResults = allResults.filter(r => r.projectId === project.id);
            const scanCount = projectResults.length;
            const avgScore = scanCount > 0
                ? (projectResults.reduce((s, r) => s + (r.score || 0), 0) / scanCount).toFixed(1)
                : '--';

            return `
                <div class="project-card" data-project-id="${project.id}">
                    <div class="project-card-header">
                        <div>
                            <div class="project-card-name">${UIHelpers.escapeHTML(project.name)}</div>
                            <div class="project-card-meta">
                                <span>📚 ${UIHelpers.escapeHTML(project.subject || '')}</span>
                                <span>📝 ${project.totalQuestions} ${I18n.t('project.total_questions').toLowerCase()}</span>
                            </div>
                        </div>
                        <span class="badge ${project.status === 'active' ? 'badge-success' : 'badge-info'}">
                            ${project.status === 'active' ? I18n.t('project.status_active') : I18n.t('project.status_archived')}
                        </span>
                    </div>
                    <div class="project-card-progress">
                        <div class="progress"><div class="progress-bar" style="width:${scanCount > 0 ? Math.min(scanCount / 40 * 100, 100) : 0}%"></div></div>
                        <span class="project-card-progress-text">${I18n.t('project.scanned_count', { count: scanCount })}</span>
                    </div>
                    <div class="project-card-meta" style="margin-top:var(--space-2);margin-bottom:0">
                        <span>⏱ ${UIHelpers.formatDate(project.updatedAt || project.createdAt, 'relative')}</span>
                        <span>📊 ${I18n.t('results.avg_score')}: ${avgScore}</span>
                    </div>
                    <div class="project-card-actions">
                        <button class="btn btn-sm btn-primary project-scan-btn" data-project-id="${project.id}">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                            <span>${I18n.t('project.scan_now')}</span>
                        </button>
                        <button class="btn btn-sm btn-secondary project-results-btn" data-project-id="${project.id}">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                            <span>${I18n.t('project.view_results')}</span>
                        </button>
                        <button class="btn btn-sm btn-secondary project-ak-btn" data-project-id="${project.id}">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
                            <span>Đáp án</span>
                        </button>
                        <button class="btn btn-sm btn-ghost project-delete-btn" data-project-id="${project.id}" style="flex:0;min-width:36px;color:var(--color-error)">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        listEl.innerHTML = html;

        // Bind action buttons
        listEl.querySelectorAll('.project-scan-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                Scanner.setProject(btn.dataset.projectId);
                navigateTo('scanner');
            });
        });

        listEl.querySelectorAll('.project-results-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                ResultsManager.setProject(btn.dataset.projectId);
                navigateTo('results');
            });
        });

        listEl.querySelectorAll('.project-ak-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                AnswerKeyManager.showForProject(btn.dataset.projectId);
            });
        });

        listEl.querySelectorAll('.project-delete-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const confirmed = await UIHelpers.confirm(
                    I18n.t('project.delete_confirm'),
                    { title: I18n.t('project.delete'), danger: true, confirmLabel: I18n.t('action.delete') }
                );
                if (confirmed) {
                    await MarkerDB.deleteProjectCascade(btn.dataset.projectId);
                    UIHelpers.showToast(I18n.t('misc.deleted'), 'success');
                    UIHelpers.vibrate(50);
                    EventBus.emit('project:deleted', { projectId: btn.dataset.projectId });
                    loadDashboard();
                }
            });
        });

        // FAB for creating project
        let fab = document.querySelector('.fab');
        if (!fab) {
            fab = document.createElement('button');
            fab.className = 'fab';
            fab.id = 'fab-create-project';
            fab.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
            fab.setAttribute('aria-label', I18n.t('project.new'));
            document.getElementById('app').appendChild(fab);
        }
        fab.onclick = () => ProjectManager.showCreateDialog();
    }

    // ══════════════════════════════════════════
    // SETTINGS
    // ══════════════════════════════════════════

    function renderSettings() {
        const container = document.getElementById('settings-content');
        const currentTheme = localStorage.getItem(CONSTANTS.LS_KEYS.THEME) || 'dark';
        const currentLang = I18n.getLang();
        const soundEnabled = localStorage.getItem(CONSTANTS.LS_KEYS.SOUND_ENABLED) !== 'false';
        const vibrationEnabled = localStorage.getItem(CONSTANTS.LS_KEYS.VIBRATION_ENABLED) !== 'false';

        container.innerHTML = `
            <!-- General -->
            <div class="settings-section">
                <div class="settings-section-title" data-i18n="settings.general">${I18n.t('settings.general')}</div>
                <div class="settings-group">
                    <div class="settings-item" id="setting-language">
                        <div class="settings-item-left">
                            <div class="settings-item-icon" style="background:var(--color-info-soft);color:var(--color-info)">🌐</div>
                            <div>
                                <div class="settings-item-label" data-i18n="settings.language">${I18n.t('settings.language')}</div>
                            </div>
                        </div>
                        <select class="form-select" id="select-language" style="width:auto;min-height:36px;padding:var(--space-2) var(--space-8) var(--space-2) var(--space-3)">
                            <option value="vi" ${currentLang === 'vi' ? 'selected' : ''}>🇻🇳 Tiếng Việt</option>
                            <option value="en" ${currentLang === 'en' ? 'selected' : ''}>🇬🇧 English</option>
                        </select>
                    </div>
                    <div class="settings-item" id="setting-theme">
                        <div class="settings-item-left">
                            <div class="settings-item-icon" style="background:var(--color-accent-glow);color:var(--color-accent)">🎨</div>
                            <div>
                                <div class="settings-item-label" data-i18n="settings.theme">${I18n.t('settings.theme')}</div>
                            </div>
                        </div>
                        <select class="form-select" id="select-theme" style="width:auto;min-height:36px;padding:var(--space-2) var(--space-8) var(--space-2) var(--space-3)">
                            <option value="dark" ${currentTheme === 'dark' ? 'selected' : ''}>🌙 ${I18n.t('settings.theme_dark')}</option>
                            <option value="light" ${currentTheme === 'light' ? 'selected' : ''}>☀️ ${I18n.t('settings.theme_light')}</option>
                        </select>
                    </div>
                    <div class="settings-item">
                        <div class="settings-item-left">
                            <div class="settings-item-icon" style="background:var(--color-success-soft);color:var(--color-success)">🔔</div>
                            <div>
                                <div class="settings-item-label" data-i18n="settings.sound">${I18n.t('settings.sound')}</div>
                            </div>
                        </div>
                        <label class="toggle">
                            <input type="checkbox" id="toggle-sound" ${soundEnabled ? 'checked' : ''}>
                            <span class="toggle-track"></span>
                        </label>
                    </div>
                    <div class="settings-item">
                        <div class="settings-item-left">
                            <div class="settings-item-icon" style="background:var(--color-warning-soft);color:var(--color-warning)">📳</div>
                            <div>
                                <div class="settings-item-label" data-i18n="settings.vibration">${I18n.t('settings.vibration')}</div>
                            </div>
                        </div>
                        <label class="toggle">
                            <input type="checkbox" id="toggle-vibration" ${vibrationEnabled ? 'checked' : ''}>
                            <span class="toggle-track"></span>
                        </label>
                    </div>
                </div>
            </div>

            <!-- Scan Settings -->
            <div class="settings-section">
                <div class="settings-section-title" data-i18n="settings.scan_settings">${I18n.t('settings.scan_settings')}</div>
                <div class="settings-group">
                    <div class="settings-item" style="flex-direction:column;align-items:stretch;gap:var(--space-3)">
                        <div class="flex-between">
                            <div class="settings-item-label" data-i18n="settings.fill_threshold">${I18n.t('settings.fill_threshold')}</div>
                            <span id="threshold-value" style="font-weight:600;color:var(--color-primary)">${Math.round((parseFloat(localStorage.getItem(CONSTANTS.LS_KEYS.FILL_THRESHOLD)) || CONSTANTS.DEFAULT_FILL_THRESHOLD) * 100)}%</span>
                        </div>
                        <input type="range" id="range-threshold" 
                            min="${CONSTANTS.MIN_FILL_THRESHOLD * 100}" 
                            max="${CONSTANTS.MAX_FILL_THRESHOLD * 100}" 
                            step="${CONSTANTS.FILL_THRESHOLD_STEP * 100}"
                            value="${Math.round((parseFloat(localStorage.getItem(CONSTANTS.LS_KEYS.FILL_THRESHOLD)) || CONSTANTS.DEFAULT_FILL_THRESHOLD) * 100)}"
                            style="width:100%;accent-color:var(--color-primary)">
                        <div class="form-hint" data-i18n="settings.fill_threshold_desc">${I18n.t('settings.fill_threshold_desc')}</div>
                    </div>
                </div>
            </div>

            <!-- AI Vision -->
            <div class="settings-section">
                <div class="settings-section-title">🤖 AI Vision (GPT-4o)</div>
                <div class="settings-group">
                    <div class="settings-item" id="setting-scan-mode">
                        <div class="settings-item-left">
                            <div class="settings-item-icon" style="background:linear-gradient(135deg,rgba(139,92,246,0.15),rgba(59,130,246,0.15));color:var(--color-primary)">🔍</div>
                            <div>
                                <div class="settings-item-label">Chế độ quét</div>
                                <div class="settings-item-desc" style="font-size:var(--font-size-xs)">Chọn engine xử lý phiếu</div>
                            </div>
                        </div>
                        <select class="form-select" id="select-scan-mode" style="width:auto;min-height:36px;padding:var(--space-2) var(--space-8) var(--space-2) var(--space-3)">
                            <option value="auto" ${VisionScanner.getScanMode() === 'auto' ? 'selected' : ''}>🔄 Auto (OMR → AI)</option>
                            <option value="vision" ${VisionScanner.getScanMode() === 'vision' ? 'selected' : ''}>🤖 AI Vision</option>
                            <option value="omr" ${VisionScanner.getScanMode() === 'omr' ? 'selected' : ''}>📐 OMR (Offline)</option>
                        </select>
                    </div>
                    <div class="settings-item" style="flex-direction:column;align-items:stretch;gap:var(--space-2)">
                        <div class="settings-item-left" style="margin-bottom:var(--space-1)">
                            <div class="settings-item-icon" style="background:rgba(16,185,129,0.12);color:var(--color-success)">🔑</div>
                            <div>
                                <div class="settings-item-label">OpenAI API Key</div>
                                <div class="settings-item-desc" style="font-size:var(--font-size-xs)">Cần để dùng chế độ AI Vision (~$0.005/phiếu)</div>
                            </div>
                        </div>
                        <div style="display:flex;gap:var(--space-2)">
                            <input type="password" id="input-api-key" class="form-input" 
                                placeholder="sk-..." 
                                value="${VisionScanner.getAPIKey()}"
                                style="flex:1;font-family:monospace;font-size:var(--font-size-sm)">
                            <button class="btn btn-sm btn-secondary" id="btn-toggle-key" style="min-width:40px" title="Hiện/ẩn">👁</button>
                            <button class="btn btn-sm btn-primary" id="btn-test-key" style="min-width:60px">Test</button>
                        </div>
                        <div id="api-key-status" style="font-size:var(--font-size-xs);min-height:1.2em"></div>
                    </div>
                    <div class="settings-item" id="setting-verify-mode">
                        <div class="settings-item-left">
                            <div class="settings-item-icon" style="background:rgba(245,158,11,0.12);color:var(--color-warning)">🛡️</div>
                            <div>
                                <div class="settings-item-label">Xác minh kết quả</div>
                                <div class="settings-item-desc" style="font-size:var(--font-size-xs)">Kiểm tra chéo để tăng độ chính xác</div>
                            </div>
                        </div>
                        <select class="form-select" id="select-verify-mode" style="width:auto;min-height:36px;padding:var(--space-2) var(--space-8) var(--space-2) var(--space-3)">
                            <option value="validate" ${VisionScanner.getVerifyMode() === 'validate' ? 'selected' : ''}>✅ Validate (khuyến nghị)</option>
                            <option value="double" ${VisionScanner.getVerifyMode() === 'double' ? 'selected' : ''}>🔄 Double-read (2x cost)</option>
                            <option value="none" ${VisionScanner.getVerifyMode() === 'none' ? 'selected' : ''}>⚡ Không (nhanh nhất)</option>
                        </select>
                    </div>
                </div>
            </div>

            <!-- Data -->
            <div class="settings-section">
                <div class="settings-section-title" data-i18n="settings.data">${I18n.t('settings.data')}</div>
                <div class="settings-group">
                    <div class="settings-item" id="setting-backup" style="cursor:pointer">
                        <div class="settings-item-left">
                            <div class="settings-item-icon" style="background:var(--color-primary-soft);color:var(--color-primary)">💾</div>
                            <div>
                                <div class="settings-item-label" data-i18n="settings.backup">${I18n.t('settings.backup')}</div>
                                <div class="settings-item-desc" data-i18n="settings.backup_desc">${I18n.t('settings.backup_desc')}</div>
                            </div>
                        </div>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                    </div>
                    <div class="settings-item" id="setting-restore" style="cursor:pointer">
                        <div class="settings-item-left">
                            <div class="settings-item-icon" style="background:var(--color-success-soft);color:var(--color-success)">📂</div>
                            <div>
                                <div class="settings-item-label" data-i18n="settings.restore">${I18n.t('settings.restore')}</div>
                                <div class="settings-item-desc" data-i18n="settings.restore_desc">${I18n.t('settings.restore_desc')}</div>
                            </div>
                        </div>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                    </div>
                    <div class="settings-item" id="setting-clear" style="cursor:pointer">
                        <div class="settings-item-left">
                            <div class="settings-item-icon" style="background:var(--color-error-soft);color:var(--color-error)">🗑️</div>
                            <div>
                                <div class="settings-item-label" style="color:var(--color-error)" data-i18n="settings.clear_data">${I18n.t('settings.clear_data')}</div>
                            </div>
                        </div>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                    </div>
                </div>
            </div>

            <!-- About -->
            <div class="settings-section">
                <div class="settings-section-title" data-i18n="settings.about">${I18n.t('settings.about')}</div>
                <div class="settings-group">
                    <div class="settings-item">
                        <div class="settings-item-left">
                            <div class="settings-item-icon" style="background:var(--color-primary-soft);color:var(--color-primary)">ℹ️</div>
                            <div>
                                <div class="settings-item-label" data-i18n="settings.version">${I18n.t('settings.version')}</div>
                            </div>
                        </div>
                        <span class="settings-item-value">v${CONSTANTS.APP_VERSION}</span>
                    </div>
                </div>
            </div>
        `;

        // Bind settings events
        document.getElementById('select-language').addEventListener('change', (e) => {
            I18n.setLang(e.target.value);
            renderSettings();
            updateHeader(_currentView);
            loadDashboard();
            EventBus.emit('lang:changed', { lang: e.target.value });
            UIHelpers.showToast(I18n.t('misc.updated'), 'success');
        });

        document.getElementById('select-theme').addEventListener('change', (e) => {
            applyTheme(e.target.value);
            UIHelpers.showToast(I18n.t('misc.updated'), 'success');
        });

        document.getElementById('toggle-sound').addEventListener('change', (e) => {
            localStorage.setItem(CONSTANTS.LS_KEYS.SOUND_ENABLED, e.target.checked);
            if (e.target.checked) UIHelpers.playSound('click');
        });

        document.getElementById('toggle-vibration').addEventListener('change', (e) => {
            localStorage.setItem(CONSTANTS.LS_KEYS.VIBRATION_ENABLED, e.target.checked);
            if (e.target.checked) UIHelpers.vibrate(50);
        });

        document.getElementById('range-threshold').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            document.getElementById('threshold-value').textContent = value + '%';
            localStorage.setItem(CONSTANTS.LS_KEYS.FILL_THRESHOLD, (value / 100).toString());
            EventBus.emit('settings:changed', { key: 'fillThreshold', value: value / 100 });
        });

        document.getElementById('setting-backup').addEventListener('click', handleBackup);
        document.getElementById('setting-restore').addEventListener('click', handleRestore);
        document.getElementById('setting-clear').addEventListener('click', handleClearData);

        // ── AI Vision settings ──
        document.getElementById('select-scan-mode')?.addEventListener('change', (e) => {
            VisionScanner.setScanMode(e.target.value);
            const labels = { auto: '🔄 Auto', vision: '🤖 AI Vision', omr: '📐 OMR' };
            UIHelpers.showToast(`Chế độ quét: ${labels[e.target.value]}`, 'success');
        });

        document.getElementById('input-api-key')?.addEventListener('change', (e) => {
            VisionScanner.setAPIKey(e.target.value);
            const statusEl = document.getElementById('api-key-status');
            if (statusEl) {
                statusEl.innerHTML = e.target.value.trim()
                    ? '<span style="color:var(--color-success)">✓ Đã lưu</span>'
                    : '<span style="color:var(--color-text-tertiary)">Chưa có key</span>';
            }
        });

        document.getElementById('btn-toggle-key')?.addEventListener('click', () => {
            const input = document.getElementById('input-api-key');
            if (input) {
                input.type = input.type === 'password' ? 'text' : 'password';
            }
        });

        document.getElementById('btn-test-key')?.addEventListener('click', async () => {
            const input = document.getElementById('input-api-key');
            const statusEl = document.getElementById('api-key-status');
            const key = input?.value?.trim();
            if (!key) {
                if (statusEl) statusEl.innerHTML = '<span style="color:var(--color-warning)">Nhập API key trước</span>';
                return;
            }
            VisionScanner.setAPIKey(key);
            if (statusEl) statusEl.innerHTML = '<span style="color:var(--color-info)">⏳ Đang kiểm tra...</span>';
            const result = await VisionScanner.testAPIKey(key);
            if (result.success) {
                if (statusEl) statusEl.innerHTML = '<span style="color:var(--color-success)">✅ Kết nối thành công!</span>';
                UIHelpers.showToast('API key hợp lệ!', 'success');
            } else {
                if (statusEl) statusEl.innerHTML = `<span style="color:var(--color-error)">❌ ${UIHelpers.escapeHTML(result.error)}</span>`;
                UIHelpers.showToast('API key không hợp lệ: ' + result.error, 'error', 5000);
            }
        });

        document.getElementById('select-verify-mode')?.addEventListener('change', (e) => {
            VisionScanner.setVerifyMode(e.target.value);
            const labels = { validate: '✅ Validate', double: '🔄 Double-read', none: '⚡ Không xác minh' };
            UIHelpers.showToast(`Xác minh: ${labels[e.target.value]}`, 'success');
        });
    }

    async function handleBackup() {
        try {
            UIHelpers.showLoading(I18n.t('settings.backup') + '...');
            const data = await MarkerDB.exportAll();
            const json = JSON.stringify(data, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Marker_Backup_${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            UIHelpers.hideLoading();
            UIHelpers.showToast(I18n.t('misc.success'), 'success');
        } catch (error) {
            UIHelpers.hideLoading();
            UIHelpers.showToast(I18n.t('misc.error'), 'error');
        }
    }

    async function handleRestore() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                UIHelpers.showLoading(I18n.t('settings.restore') + '...');
                const text = await file.text();
                const data = JSON.parse(text);
                await MarkerDB.importAll(data);
                UIHelpers.hideLoading();
                UIHelpers.showToast(I18n.t('misc.success'), 'success');
                loadDashboard();
            } catch (error) {
                UIHelpers.hideLoading();
                UIHelpers.showToast(I18n.t('misc.error') + ': ' + error.message, 'error');
            }
        });
        input.click();
    }

    async function handleClearData() {
        const confirmed = await UIHelpers.confirm(
            I18n.t('settings.clear_data_confirm'),
            { title: I18n.t('settings.clear_data'), danger: true, confirmLabel: I18n.t('action.delete') }
        );
        if (confirmed) {
            await MarkerDB.clearAll();
            UIHelpers.showToast(I18n.t('misc.deleted'), 'success');
            loadDashboard();
        }
    }

    // ══════════════════════════════════════════
    // THEME
    // ══════════════════════════════════════════

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem(CONSTANTS.LS_KEYS.THEME, theme);

        // Update meta theme-color
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) {
            meta.content = theme === 'dark' ? '#0a0e1a' : '#f8fafc';
        }

        EventBus.emit('theme:changed', { theme });
    }

    // ══════════════════════════════════════════
    // PWA INSTALL
    // ══════════════════════════════════════════

    function setupPWAInstall() {
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            _deferredPrompt = e;

            // Show install banner if not dismissed
            const dismissed = localStorage.getItem(CONSTANTS.LS_KEYS.INSTALL_DISMISSED);
            if (!dismissed) {
                setTimeout(() => {
                    document.getElementById('install-banner').classList.add('show');
                }, 3000);
            }
        });

        // Install button
        document.getElementById('btn-install')?.addEventListener('click', async () => {
            if (!_deferredPrompt) return;
            _deferredPrompt.prompt();
            const result = await _deferredPrompt.userChoice;
            if (result.outcome === 'accepted') {
                UIHelpers.showToast(I18n.t('misc.success'), 'success');
            }
            _deferredPrompt = null;
            document.getElementById('install-banner').classList.remove('show');
        });

        // Dismiss button
        document.getElementById('btn-install-dismiss')?.addEventListener('click', () => {
            document.getElementById('install-banner').classList.remove('show');
            localStorage.setItem(CONSTANTS.LS_KEYS.INSTALL_DISMISSED, 'true');
        });
    }

    // ══════════════════════════════════════════
    // SERVICE WORKER
    // ══════════════════════════════════════════

    function registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./sw.js')
                .then(reg => {
                    console.log('[SW] Registered:', reg.scope);
                    
                    reg.addEventListener('updatefound', () => {
                        const newWorker = reg.installing;
                        newWorker.addEventListener('statechange', () => {
                            // If a new SW is installed and there was already one controlling the page
                            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                console.log('[SW] New version found! Reloading...');
                                UIHelpers.showToast('Đang tải bản cập nhật mới...', 'info');
                                setTimeout(() => window.location.reload(), 1000);
                            }
                        });
                    });
                })
                .catch(err => {
                    console.warn('[SW] Registration failed:', err);
                });
        }
    }

    // ══════════════════════════════════════════
    // OPENCV.JS LOADING
    // ══════════════════════════════════════════

    function loadOpenCV() {
        // Load OpenCV.js asynchronously
        const script = document.createElement('script');
        script.src = 'https://docs.opencv.org/4.x/opencv.js';
        script.async = true;

        script.onload = () => {
            // OpenCV.js needs cv to be ready (onRuntimeInitialized)
            if (typeof cv !== 'undefined') {
                if (cv.getBuildInformation) {
                    _opencvLoaded = true;
                    EventBus.emit('opencv:loaded', {});
                    console.log('[OpenCV] Loaded successfully');
                } else {
                    // Wait for WASM to initialize
                    cv['onRuntimeInitialized'] = () => {
                        _opencvLoaded = true;
                        EventBus.emit('opencv:loaded', {});
                        console.log('[OpenCV] Runtime initialized');
                    };
                }
            }
        };

        script.onerror = (err) => {
            console.warn('[OpenCV] Failed to load, OMR scanning will not work offline until cached');
            EventBus.emit('opencv:error', { error: err });
        };

        document.head.appendChild(script);
    }

    function isOpenCVReady() {
        return _opencvLoaded;
    }

    // ══════════════════════════════════════════
    // PUBLIC API
    // ══════════════════════════════════════════

    return {
        init,
        navigateTo,
        loadDashboard,
        isOpenCVReady,
        get currentView() { return _currentView; },
    };
})();

// ── Bootstrap ──
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});

if (typeof window !== 'undefined') {
    window.App = App;
}
