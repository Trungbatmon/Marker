/**
 * Marker — Results Manager Module
 * View, filter, and manage scan results
 */

const ResultsManager = (() => {

    let _currentProjectId = null;
    let _currentFilter = 'all';

    /**
     * Initialize results view
     */
    async function init(projectId = null) {
        _currentProjectId = projectId;
        await render();
    }

    async function render() {
        const container = document.getElementById('results-content');
        if (!container) return;

        // Get all projects for project selector
        const projects = await MarkerDB.getAll(MarkerDB.STORES.PROJECTS);
        
        // Get results
        let results;
        if (_currentProjectId) {
            results = await MarkerDB.getByIndex(MarkerDB.STORES.SCAN_RESULTS, 'projectId', _currentProjectId);
        } else {
            results = await MarkerDB.getAll(MarkerDB.STORES.SCAN_RESULTS);
        }

        // Sort by scannedAt descending
        results.sort((a, b) => new Date(b.scannedAt) - new Date(a.scannedAt));

        if (results.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="80" height="80">
                            <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
                        </svg>
                    </div>
                    <div class="empty-state-title">${I18n.t('results.no_results')}</div>
                    <div class="empty-state-desc">${I18n.t('results.no_results_desc')}</div>
                </div>
            `;
            return;
        }

        // Calculate stats
        const totalScore = results.reduce((s, r) => s + (r.score || 0), 0);
        const avgScore = (totalScore / results.length).toFixed(2);
        const highScore = Math.max(...results.map(r => r.score || 0)).toFixed(2);
        const lowScore = Math.min(...results.map(r => r.score || 0)).toFixed(2);

        // Determine project for max score reference
        const currentProject = _currentProjectId 
            ? await MarkerDB.get(MarkerDB.STORES.PROJECTS, _currentProjectId)
            : null;

        container.innerHTML = `
            <!-- Project Filter -->
            ${projects.length > 1 ? `
                <div class="form-group" style="margin-bottom:var(--space-4)">
                    <select class="form-select" id="results-project-filter">
                        <option value="">${I18n.t('results.filter_all')} (${results.length})</option>
                        ${projects.map(p => `
                            <option value="${p.id}" ${_currentProjectId === p.id ? 'selected' : ''}>
                                ${UIHelpers.escapeHTML(p.name)}
                            </option>
                        `).join('')}
                    </select>
                </div>
            ` : ''}

            <!-- Stats Summary -->
            <div class="stat-grid stagger-children" style="margin-bottom:var(--space-4)">
                <div class="stat-card stat-primary">
                    <div class="stat-value count-anim">${avgScore}</div>
                    <div class="stat-label">${I18n.t('results.avg_score')}</div>
                </div>
                <div class="stat-card stat-success">
                    <div class="stat-value count-anim">${highScore}</div>
                    <div class="stat-label">${I18n.t('results.highest')}</div>
                </div>
                <div class="stat-card stat-error">
                    <div class="stat-value count-anim">${lowScore}</div>
                    <div class="stat-label">${I18n.t('results.lowest')}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value count-anim">${results.length}</div>
                    <div class="stat-label">${I18n.t('dashboard.total_scanned')}</div>
                </div>
            </div>

            <!-- Results Table -->
            <div style="overflow-x:auto;border:1px solid var(--color-border);border-radius:var(--radius-lg)">
                <table class="results-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>${I18n.t('results.student_id')}</th>
                            <th>${I18n.t('results.exam_code')}</th>
                            <th>${I18n.t('results.correct')}</th>
                            <th>${I18n.t('results.score')}</th>
                            <th>${I18n.t('results.time')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${results.map((r, i) => {
                            const maxPoints = currentProject?.totalPoints || 10;
                            const pct = (r.score / maxPoints) * 100;
                            const scoreClass = pct >= 70 ? 'high' : pct >= 50 ? 'medium' : 'low';
                            return `
                                <tr data-result-id="${r.id}">
                                    <td>${i + 1}</td>
                                    <td><strong>${UIHelpers.escapeHTML(r.studentId || '--')}</strong></td>
                                    <td>${UIHelpers.escapeHTML(r.examCode || '--')}</td>
                                    <td>${r.correctCount || 0}/${(r.correctCount || 0) + (r.wrongCount || 0) + (r.blankCount || 0)}</td>
                                    <td><span class="results-score ${scoreClass}">${r.score?.toFixed(2) || '0'}</span></td>
                                    <td style="font-size:var(--font-size-xs);color:var(--color-text-tertiary)">${UIHelpers.formatDate(r.scannedAt, 'relative')}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;

        // Bind events
        document.getElementById('results-project-filter')?.addEventListener('change', (e) => {
            _currentProjectId = e.target.value || null;
            render();
        });

        // Row click → detail
        container.querySelectorAll('tr[data-result-id]').forEach(row => {
            row.addEventListener('click', () => {
                showResultDetail(row.dataset.resultId);
            });
        });
    }

    async function showResultDetail(resultId) {
        const result = await MarkerDB.get(MarkerDB.STORES.SCAN_RESULTS, resultId);
        if (!result) return;

        const project = result.projectId 
            ? await MarkerDB.get(MarkerDB.STORES.PROJECTS, result.projectId) 
            : null;

        // Get answer key for correct answers
        let answerKey = null;
        if (result.answerKeyId) {
            try { answerKey = await MarkerDB.get(MarkerDB.STORES.ANSWER_KEYS, result.answerKeyId); } catch(e) {}
        }
        if (!answerKey && result.projectId) {
            try {
                const keys = await MarkerDB.getByIndex(MarkerDB.STORES.ANSWER_KEYS, 'projectId', result.projectId);
                if (keys.length > 0) answerKey = keys[0];
            } catch(e) {}
        }

        const totalQ = project?.totalQuestions || Object.keys(result.answers || {}).length;

        // Build detailed question-by-question table
        let tableRows = '';
        for (let q = 1; q <= totalQ; q++) {
            const selected = result.answers?.[q] || CONSTANTS.ANSWER_STATUS.BLANK;
            const correct = answerKey?.answers?.[q] || '?';
            const detail = Array.isArray(result.details)
                ? result.details.find(d => d.question === q)
                : null;

            let statusLabel, statusStyle;
            if (selected === CONSTANTS.ANSWER_STATUS.BLANK || selected === 'BLANK') {
                statusLabel = '—'; statusStyle = 'color:var(--color-warning)';
            } else if (selected === CONSTANTS.ANSWER_STATUS.MULTI || selected === 'MULTI') {
                statusLabel = '⚠'; statusStyle = 'color:var(--color-error)';
            } else if (correct !== '?' && selected === correct) {
                statusLabel = '✓'; statusStyle = 'color:var(--color-success);font-weight:700';
            } else if (correct !== '?') {
                statusLabel = '✗'; statusStyle = 'color:var(--color-error);font-weight:700';
            } else {
                statusLabel = '--'; statusStyle = 'color:var(--color-text-tertiary)';
            }

            const confidence = detail?.confidence
                ? Math.round(detail.confidence * 100) + '%'
                : '--';

            const displaySelected = (selected === 'BLANK' || selected === CONSTANTS.ANSWER_STATUS.BLANK)
                ? '-'
                : (selected === 'MULTI' || selected === CONSTANTS.ANSWER_STATUS.MULTI)
                    ? '⚠'
                    : selected;

            const rowBg = statusLabel === '✓' ? 'background:rgba(16,185,129,0.06)' :
                          statusLabel === '✗' ? 'background:rgba(239,68,68,0.06)' : '';

            tableRows += `
                <tr style="${rowBg}">
                    <td style="font-weight:600;text-align:center">${q}</td>
                    <td style="text-align:center;font-weight:700;font-size:var(--font-size-md)">${displaySelected}</td>
                    <td style="text-align:center;color:var(--color-text-tertiary)">${correct}</td>
                    <td style="text-align:center;${statusStyle}">${statusLabel}</td>
                    <td style="text-align:center;font-size:var(--font-size-xs);color:var(--color-text-tertiary)">${confidence}</td>
                </tr>`;
        }

        const content = `
            <div class="stat-grid" style="margin-bottom:var(--space-4)">
                <div class="stat-card stat-primary">
                    <div class="stat-value">${result.studentId || '--'}</div>
                    <div class="stat-label">${I18n.t('results.student_id')}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${result.score?.toFixed(2) || '0'}</div>
                    <div class="stat-label">${I18n.t('results.score')}</div>
                </div>
                <div class="stat-card stat-success">
                    <div class="stat-value">${result.correctCount || 0}</div>
                    <div class="stat-label">${I18n.t('results.correct')}</div>
                </div>
                <div class="stat-card stat-error">
                    <div class="stat-value">${result.wrongCount || 0}</div>
                    <div class="stat-label">${I18n.t('results.wrong')}</div>
                </div>
            </div>

            <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;margin-bottom:var(--space-4)">
                <span class="badge badge-warning">${I18n.t('results.blank')}: ${result.blankCount || 0}</span>
                <span class="badge badge-error">${I18n.t('results.multi')}: ${result.multiCount || 0}</span>
                <span class="badge badge-info">${I18n.t('results.exam_code')}: ${result.examCode || '--'}</span>
            </div>

            <div class="divider-label" style="margin-bottom:var(--space-3)">Chi tiết bài làm</div>
            <div style="overflow-x:auto;max-height:50vh;border:1px solid var(--color-border);border-radius:var(--radius-lg)">
                <table class="results-table" style="font-size:var(--font-size-sm)">
                    <thead>
                        <tr>
                            <th style="text-align:center;width:3em">Câu</th>
                            <th style="text-align:center;width:3em">Chọn</th>
                            <th style="text-align:center;width:3em">ĐA</th>
                            <th style="text-align:center;width:3em">KQ</th>
                            <th style="text-align:center;width:4em">%</th>
                        </tr>
                    </thead>
                    <tbody>${tableRows}</tbody>
                </table>
            </div>
        `;

        await UIHelpers.showModal({
            title: `Chi tiết — ${result.studentId || 'SBD: --'}`,
            content,
            actions: [
                { label: I18n.t('action.close'), className: 'btn-secondary', value: 'close' },
                { label: I18n.t('action.delete'), className: 'btn-danger', value: 'delete' },
            ]
        }).then(async (action) => {
            if (action === 'delete') {
                const confirmed = await UIHelpers.confirm(I18n.t('project.delete_confirm'), { danger: true });
                if (confirmed) {
                    await MarkerDB.remove(MarkerDB.STORES.SCAN_RESULTS, resultId);
                    UIHelpers.showToast(I18n.t('misc.deleted'), 'success');
                    render();
                }
            }
        });
    }

    // Listen for view changes
    if (typeof EventBus !== 'undefined') {
        EventBus.on('view:changed', ({ to }) => {
            if (to === 'results') init(_currentProjectId);
        });
    }

    return {
        init,
        render,
        showResultDetail,
        setProject: (id) => { _currentProjectId = id; },
        getProjectId: () => _currentProjectId,
    };
})();

if (typeof window !== 'undefined') {
    window.ResultsManager = ResultsManager;
}
