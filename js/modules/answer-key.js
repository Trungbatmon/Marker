/**
 * Marker — Answer Key Manager Module
 * Import, manage, and edit answer keys for each project
 */

const AnswerKeyManager = (() => {

    let _currentProjectId = null;

    /**
     * Show answer key management for a project
     */
    async function showForProject(projectId) {
        _currentProjectId = projectId;
        const project = await MarkerDB.get(MarkerDB.STORES.PROJECTS, projectId);
        if (!project) return;

        const answerKeys = await MarkerDB.getByIndex(MarkerDB.STORES.ANSWER_KEYS, 'projectId', projectId);

        const content = `
            <div style="margin-bottom:var(--space-4)">
                <p style="color:var(--color-text-secondary);font-size:var(--font-size-sm)">
                    ${UIHelpers.escapeHTML(project.name)} · ${project.totalQuestions} ${I18n.t('project.total_questions').toLowerCase()}
                </p>
            </div>

            <!-- Existing answer keys -->
            <div id="answer-keys-tabs" style="display:flex;gap:var(--space-2);overflow-x:auto;margin-bottom:var(--space-4);padding-bottom:var(--space-2)">
                ${answerKeys.map(ak => `
                    <button class="chip ak-tab ${answerKeys[0]?.id === ak.id ? 'active' : ''}" data-ak-id="${ak.id}">
                        ${I18n.t('answer_key.exam_code')}: ${UIHelpers.escapeHTML(ak.examCode)}
                    </button>
                `).join('')}
                <button class="chip" id="btn-add-answer-key" style="border-style:dashed">
                    + ${I18n.t('answer_key.add')}
                </button>
            </div>

            <!-- Answer key editor -->
            <div id="answer-key-editor">
                ${answerKeys.length > 0 ? renderAnswerKeyEditor(answerKeys[0], project) : renderNewAnswerKeyForm(project)}
            </div>
        `;

        // Bind tab events after modal renders (must be before await)
        setTimeout(() => bindAnswerKeyEvents(project), 100);

        await UIHelpers.showModal({
            title: I18n.t('answer_key.title'),
            content,
            actions: [
                { label: I18n.t('action.close'), className: 'btn-secondary', value: 'close' },
            ]
        });
    }

    function renderNewAnswerKeyForm(project) {
        return `
            <div class="form-group" style="margin-bottom:var(--space-4)">
                <label class="form-label">${I18n.t('answer_key.exam_code')}</label>
                <input type="text" class="form-input" id="input-exam-code" 
                    placeholder="${I18n.t('answer_key.exam_code_placeholder')}" maxlength="5">
            </div>

            <!-- Input method tabs -->
            <div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-4)">
                <button class="chip active" data-method="manual">${I18n.t('answer_key.manual')}</button>
                <button class="chip" data-method="paste">${I18n.t('answer_key.paste')}</button>
            </div>

            <!-- Manual input grid -->
            <div id="ak-manual-input">
                ${renderAnswerGrid(project.totalQuestions, project.optionCount, {})}
            </div>

            <!-- Paste input -->
            <div id="ak-paste-input" style="display:none">
                <div class="form-group">
                    <textarea class="form-textarea" id="input-paste-answers" 
                        placeholder="${I18n.t('answer_key.paste_hint')}"
                        style="font-family:var(--font-mono);font-size:var(--font-size-md);letter-spacing:2px"></textarea>
                </div>
                <button class="btn btn-sm btn-primary" id="btn-parse-paste" style="margin-top:var(--space-2)">
                    ${I18n.t('action.confirm')}
                </button>
            </div>

            <!-- Status -->
            <div id="ak-status" class="form-hint" style="margin-top:var(--space-3)">
                ${I18n.t('answer_key.filled', { count: 0, total: project.totalQuestions })}
            </div>

            <!-- Save button -->
            <button class="btn btn-primary btn-block" id="btn-save-answer-key" style="margin-top:var(--space-4)">
                ${I18n.t('answer_key.save')}
            </button>
        `;
    }

    function renderAnswerKeyEditor(answerKey, project) {
        return `
            <div class="form-group" style="margin-bottom:var(--space-4)">
                <label class="form-label">${I18n.t('answer_key.exam_code')}</label>
                <input type="text" class="form-input" id="input-exam-code" 
                    value="${UIHelpers.escapeHTML(answerKey.examCode)}" maxlength="5">
            </div>

            <div id="ak-manual-input">
                ${renderAnswerGrid(project.totalQuestions, project.optionCount, answerKey.answers || {})}
            </div>

            <div id="ak-status" class="form-hint" style="margin-top:var(--space-3)">
                ${I18n.t('answer_key.filled', { 
                    count: Object.values(answerKey.answers || {}).filter(v => v).length, 
                    total: project.totalQuestions 
                })}
            </div>

            <div style="display:flex;gap:var(--space-3);margin-top:var(--space-4)">
                <button class="btn btn-primary" id="btn-save-answer-key" style="flex:1" data-ak-id="${answerKey.id}">
                    ${I18n.t('answer_key.save')}
                </button>
                <button class="btn btn-danger btn-sm" id="btn-delete-answer-key" data-ak-id="${answerKey.id}">
                    ${I18n.t('action.delete')}
                </button>
            </div>
        `;
    }

    function renderAnswerGrid(totalQuestions, optionCount, answers) {
        let html = '<div class="answer-key-grid" style="display:flex;flex-direction:column;gap:var(--space-2)">';
        for (let i = 1; i <= totalQuestions; i++) {
            const value = answers[i] || '';
            html += `
                <div class="answer-key-cell" style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-2) 0;border-bottom:1px solid var(--color-bg-secondary)">
                    <span class="cell-number" style="font-weight:600;min-width:30px;color:var(--color-text-secondary)">${i}.</span>
                    <div style="display:flex;gap:var(--space-2);flex-wrap:wrap">
                        ${['A','B','C','D','E'].slice(0, optionCount).map(opt => `
                            <button class="chip ${value === opt ? 'active' : ''}" 
                                style="width:36px;height:36px;padding:0;border-radius:50%;display:flex;align-items:center;justify-content:center"
                                data-q="${i}" data-v="${opt}">
                                ${opt}
                            </button>
                        `).join('')}
                    </div>
                </div>
            `;
        }
        html += '</div>';
        return html;
    }

    function bindAnswerKeyEvents(project) {
        // Bubble group auto-advance
        document.querySelectorAll('.chip[data-q]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const q = btn.dataset.q;
                const val = btn.dataset.v;
                const isActive = btn.classList.contains('active');

                // Clear other bubbles in same question
                document.querySelectorAll(`.chip[data-q="${q}"]`).forEach(b => b.classList.remove('active'));
                
                if (!isActive) {
                    btn.classList.add('active');
                }

                updateStatus(project.totalQuestions);
            });
        });

        // Input method tabs
        document.querySelectorAll('[data-method]').forEach(chip => {
            chip.addEventListener('click', () => {
                document.querySelectorAll('[data-method]').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                const method = chip.dataset.method;
                const manual = document.getElementById('ak-manual-input');
                const paste = document.getElementById('ak-paste-input');
                if (manual) manual.style.display = method === 'manual' ? '' : 'none';
                if (paste) paste.style.display = method === 'paste' ? '' : 'none';
            });
        });

        // Parse paste
        document.getElementById('btn-parse-paste')?.addEventListener('click', () => {
            const text = document.getElementById('input-paste-answers')?.value?.trim().toUpperCase() || '';
            const validOptions = CONSTANTS.OPTION_LABELS.slice(0, project.optionCount);
            const answers = text.split('').filter(c => validOptions.includes(c));

            document.querySelectorAll('.chip[data-q]').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.chip[data-q]').forEach(btn => {
                const q = parseInt(btn.dataset.q);
                if (q <= answers.length && btn.dataset.v === answers[q - 1]) {
                    btn.classList.add('active');
                }
            });

            updateStatus(project.totalQuestions);
            // Switch to manual view to show results
            document.querySelectorAll('[data-method]').forEach(c => c.classList.remove('active'));
            document.querySelector('[data-method="manual"]')?.classList.add('active');
            const manual = document.getElementById('ak-manual-input');
            const paste = document.getElementById('ak-paste-input');
            if (manual) manual.style.display = '';
            if (paste) paste.style.display = 'none';

            UIHelpers.showToast(I18n.t('answer_key.filled', { count: answers.length, total: project.totalQuestions }), 'success');
        });

        // Save
        document.getElementById('btn-save-answer-key')?.addEventListener('click', async () => {
            await saveAnswerKey(project);
        });

        // Delete
        document.getElementById('btn-delete-answer-key')?.addEventListener('click', async (e) => {
            const akId = e.target.dataset.akId;
            const confirmed = await UIHelpers.confirm(I18n.t('answer_key.delete_confirm'), { danger: true });
            if (confirmed && akId) {
                await MarkerDB.remove(MarkerDB.STORES.ANSWER_KEYS, akId);
                UIHelpers.showToast(I18n.t('misc.deleted'), 'success');
                UIHelpers.closeModal();
            }
        });

        // Add new answer key
        document.getElementById('btn-add-answer-key')?.addEventListener('click', () => {
            const editor = document.getElementById('answer-key-editor');
            if (editor) editor.innerHTML = renderNewAnswerKeyForm(project);
            // Re-bind
            setTimeout(() => bindAnswerKeyEvents(project), 50);
        });

        // Tab switching
        document.querySelectorAll('.ak-tab').forEach(tab => {
            tab.addEventListener('click', async () => {
                document.querySelectorAll('.ak-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const ak = await MarkerDB.get(MarkerDB.STORES.ANSWER_KEYS, tab.dataset.akId);
                if (ak) {
                    const editor = document.getElementById('answer-key-editor');
                    if (editor) editor.innerHTML = renderAnswerKeyEditor(ak, project);
                    setTimeout(() => bindAnswerKeyEvents(project), 50);
                }
            });
        });
    }

    function updateStatus(total) {
        const filled = document.querySelectorAll('.cell-input.filled').length;
        const status = document.getElementById('ak-status');
        if (status) {
            status.textContent = I18n.t('answer_key.filled', { count: filled, total });
        }
    }

    async function saveAnswerKey(project) {
        const examCode = document.getElementById('input-exam-code')?.value?.trim();
        if (!examCode) {
            UIHelpers.showToast(I18n.t('answer_key.exam_code') + '!', 'warning');
            return;
        }

        function getAnswers() {
            const answers = {};
            document.querySelectorAll('.chip.active[data-q]').forEach(btn => {
                answers[btn.dataset.q] = btn.dataset.v;
            });
            return answers;
        }

        const answers = getAnswers();
        const existingId = document.getElementById('btn-save-answer-key')?.dataset?.akId;

        const answerKey = {
            id: existingId || UIHelpers.uuid(),
            projectId: _currentProjectId,
            name: `${I18n.t('answer_key.exam_code')} ${examCode}`,
            examCode,
            answers,
            createdAt: existingId ? undefined : new Date().toISOString(),
        };

        if (existingId) {
            const existing = await MarkerDB.get(MarkerDB.STORES.ANSWER_KEYS, existingId);
            if (existing) answerKey.createdAt = existing.createdAt;
        }

        await MarkerDB.put(MarkerDB.STORES.ANSWER_KEYS, answerKey);
        UIHelpers.showToast(I18n.t('misc.saved'), 'success');
        UIHelpers.vibrate(50);
    }

    return {
        showForProject,
    };
})();

if (typeof window !== 'undefined') {
    window.AnswerKeyManager = AnswerKeyManager;
}
