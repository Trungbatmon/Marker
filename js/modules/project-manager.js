/**
 * Marker — Project Manager Module
 * CRUD operations for grading projects
 */

const ProjectManager = (() => {

    /**
     * Show create/edit project dialog
     * @param {Object|null} existingProject - If editing, pass the project object
     */
    async function showCreateDialog(existingProject = null) {
        const isEdit = !!existingProject;
        const templates = await MarkerDB.getAll(MarkerDB.STORES.TEMPLATES);

        const content = `
            <div style="display:flex;flex-direction:column;gap:var(--space-4)">
                <div class="form-group">
                    <label class="form-label" data-i18n="project.name">${I18n.t('project.name')}</label>
                    <input type="text" class="form-input" id="input-project-name" 
                        placeholder="${I18n.t('project.name_placeholder')}"
                        value="${isEdit ? UIHelpers.escapeHTML(existingProject.name) : ''}" required>
                </div>
                <div class="form-group">
                    <label class="form-label" data-i18n="project.subject">${I18n.t('project.subject')}</label>
                    <input type="text" class="form-input" id="input-project-subject" 
                        placeholder="${I18n.t('project.subject_placeholder')}"
                        value="${isEdit ? UIHelpers.escapeHTML(existingProject.subject || '') : ''}">
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
                    <div class="form-group">
                        <label class="form-label" data-i18n="project.total_questions">${I18n.t('project.total_questions')}</label>
                        <input type="number" class="form-input" id="input-project-questions" 
                            min="${CONSTANTS.MIN_QUESTIONS}" max="${CONSTANTS.MAX_QUESTIONS}" 
                            value="${isEdit ? existingProject.totalQuestions : CONSTANTS.DEFAULT_QUESTIONS}">
                    </div>
                    <div class="form-group">
                        <label class="form-label" data-i18n="project.option_count">${I18n.t('project.option_count')}</label>
                        <select class="form-select" id="select-project-options">
                            <option value="4" ${(isEdit ? existingProject.optionCount : CONSTANTS.DEFAULT_OPTIONS) === 4 ? 'selected' : ''}>4 (A-D)</option>
                            <option value="5" ${(isEdit ? existingProject.optionCount : CONSTANTS.DEFAULT_OPTIONS) === 5 ? 'selected' : ''}>5 (A-E)</option>
                        </select>
                    </div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
                    <div class="form-group">
                        <label class="form-label" data-i18n="project.point_per_question">${I18n.t('project.point_per_question')}</label>
                        <input type="number" class="form-input" id="input-project-ppq" 
                            min="0.01" max="10" step="0.01"
                            value="${isEdit ? existingProject.pointPerQuestion : 0.25}">
                    </div>
                    <div class="form-group">
                        <label class="form-label" data-i18n="project.total_points">${I18n.t('project.total_points')}</label>
                        <input type="number" class="form-input" id="input-project-total-points" 
                            value="${isEdit ? existingProject.totalPoints : 10}" readonly
                            style="opacity:0.7">
                    </div>
                </div>
            </div>
        `;

        // Wire up auto-calculate total points (must be before await)
        setTimeout(() => {
            const qInput = document.getElementById('input-project-questions');
            const ppqInput = document.getElementById('input-project-ppq');
            const totalInput = document.getElementById('input-project-total-points');

            function recalc() {
                if (qInput && ppqInput && totalInput) {
                    const q = parseInt(qInput.value) || 0;
                    const ppq = parseFloat(ppqInput.value) || 0;
                    totalInput.value = (q * ppq).toFixed(2);
                }
            }

            if (qInput) qInput.addEventListener('input', recalc);
            if (ppqInput) ppqInput.addEventListener('input', recalc);
        }, 100);

        const result = await UIHelpers.showModal({
            title: isEdit ? I18n.t('project.edit') : I18n.t('project.new'),
            content,
            actions: [
                { label: I18n.t('action.cancel'), className: 'btn-secondary', value: 'cancel' },
                { label: I18n.t('action.save'), className: 'btn-primary', value: 'save' },
            ]
        });

        if (result === 'save') {
            await saveProject(isEdit ? existingProject.id : null);
        }
    }

    async function saveProject(existingId = null) {
        const name = document.getElementById('input-project-name')?.value?.trim();
        const subject = document.getElementById('input-project-subject')?.value?.trim();
        const totalQuestions = parseInt(document.getElementById('input-project-questions')?.value) || CONSTANTS.DEFAULT_QUESTIONS;
        const optionCount = parseInt(document.getElementById('select-project-options')?.value) || CONSTANTS.DEFAULT_OPTIONS;
        const pointPerQuestion = parseFloat(document.getElementById('input-project-ppq')?.value) || 0.25;

        if (!name) {
            UIHelpers.showToast(I18n.t('project.name') + '!', 'warning');
            return;
        }

        const now = new Date().toISOString();
        const project = {
            id: existingId || UIHelpers.uuid(),
            name,
            subject: subject || '',
            totalQuestions: MathUtils.clamp(totalQuestions, CONSTANTS.MIN_QUESTIONS, CONSTANTS.MAX_QUESTIONS),
            optionCount: MathUtils.clamp(optionCount, CONSTANTS.MIN_OPTIONS, CONSTANTS.MAX_OPTIONS),
            pointPerQuestion,
            totalPoints: parseFloat((totalQuestions * pointPerQuestion).toFixed(2)),
            templateId: null,
            status: CONSTANTS.PROJECT_STATUS.ACTIVE,
            // Extensibility fields (R5.4)
            schoolId: null,
            classId: null,
            examSessionId: null,
            gradingMode: CONSTANTS.GRADING_MODES.OMR,
            createdAt: existingId ? undefined : now, // Don't overwrite on edit
            updatedAt: now,
        };

        // Preserve createdAt on edit
        if (existingId) {
            const existing = await MarkerDB.get(MarkerDB.STORES.PROJECTS, existingId);
            if (existing) project.createdAt = existing.createdAt;
        }

        await MarkerDB.put(MarkerDB.STORES.PROJECTS, project);

        UIHelpers.showToast(I18n.t('misc.saved'), 'success');
        UIHelpers.vibrate(50);

        EventBus.emit(existingId ? 'project:updated' : 'project:created', { project });
        App.loadDashboard();
    }

    /**
     * Get a project by ID
     */
    async function getProject(id) {
        return MarkerDB.get(MarkerDB.STORES.PROJECTS, id);
    }

    /**
     * Get all projects
     */
    async function getAllProjects() {
        return MarkerDB.getAll(MarkerDB.STORES.PROJECTS);
    }

    return {
        showCreateDialog,
        getProject,
        getAllProjects,
    };
})();

if (typeof window !== 'undefined') {
    window.ProjectManager = ProjectManager;
}
