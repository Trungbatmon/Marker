/**
 * Marker — Sheet Designer Module
 * UI for customizing answer sheet templates
 */

const SheetDesigner = (() => {
    let _previewCanvas = null;
    let _currentConfig = null;
    let _logoBase64 = null;

    /**
     * Initialize the designer view
     */
    function init() {
        renderDesignerUI();
    }

    function renderDesignerUI() {
        const container = document.getElementById('designer-content');
        if (!container) return;

        const savedTemplates = []; // Will be loaded from DB

        container.innerHTML = `
            <div class="designer-controls">
                <!-- Template Name -->
                <div class="form-group">
                    <label class="form-label">${I18n.t('designer.template_name')}</label>
                    <input type="text" class="form-input" id="input-template-name" 
                        placeholder="${I18n.t('designer.template_name_placeholder')}" value="">
                </div>

                <!-- Include Info Fields -->
                <div class="form-group" style="flex-direction:row;align-items:center;gap:var(--space-3);margin-top:var(--space-2)">
                    <label class="toggle">
                        <input type="checkbox" id="toggle-info-fields" checked>
                        <span class="toggle-track"></span>
                    </label>
                    <div style="flex:1">
                        <span class="form-label" style="margin:0">${I18n.getLang() === 'vi' ? 'Phần điền thông tin' : 'Info Fields'}</span>
                        <div style="font-size:var(--font-size-xs);color:var(--color-text-tertiary)">${I18n.getLang() === 'vi' ? 'Hiện Họ tên, Lớp, Ngày sinh' : 'Show Name, Class, DOB'}</div>
                    </div>
                </div>

                <!-- Logo Upload -->
                <div class="form-group">
                    <label class="form-label">${I18n.getLang() === 'vi' ? 'Logo (Dưới 1MB)' : 'Logo (Max 1MB)'}</label>
                    <div style="display:flex;gap:var(--space-2);align-items:center">
                        <button class="btn btn-sm btn-secondary" id="btn-upload-logo" style="flex:1" onclick="document.getElementById('input-logo-file').click()">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                            <span>${I18n.getLang() === 'vi' ? 'Tải lên hình ảnh' : 'Upload Image'}</span>
                        </button>
                        <button class="btn-icon btn-ghost btn-sm" id="btn-remove-logo" style="display:none;color:var(--color-error)">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                    </div>
                    <input type="file" id="input-logo-file" accept="image/png, image/jpeg" style="display:none">
                    <div id="logo-preview-container" style="display:none;margin-top:var(--space-2);text-align:center;padding:var(--space-2);background:var(--color-bg-tertiary);border-radius:var(--radius-md)">
                        <img id="logo-img-preview" src="" style="max-height:50px;max-width:100%;object-fit:contain">
                    </div>
                </div>

                <!-- Header Text -->
                <div class="form-group">
                    <label class="form-label">${I18n.t('designer.header_text')}</label>
                    <textarea class="form-textarea" id="input-header-text" 
                        placeholder="${I18n.t('designer.header_placeholder')}" 
                        rows="2" style="min-height:60px"></textarea>
                </div>

                <!-- Grid: Question Count + Options -->
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
                    <div class="form-group">
                        <label class="form-label">${I18n.t('designer.question_count')}</label>
                        <input type="number" class="form-input" id="input-question-count" 
                            min="${CONSTANTS.MIN_QUESTIONS}" max="${CONSTANTS.MAX_QUESTIONS}" 
                            value="${CONSTANTS.DEFAULT_QUESTIONS}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">${I18n.t('designer.option_count')}</label>
                        <select class="form-select" id="select-option-count">
                            <option value="4" selected>4 (A-D)</option>
                            <option value="5">5 (A-E)</option>
                        </select>
                    </div>
                </div>

                <!-- Grid: SBD Digits + Columns -->
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
                    <div class="form-group">
                        <label class="form-label">${I18n.t('designer.student_id_digits')}</label>
                        <input type="number" class="form-input" id="input-sid-digits" 
                            min="4" max="10" value="${CONSTANTS.STUDENT_ID_DIGITS}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">${I18n.t('designer.columns')}</label>
                        <select class="form-select" id="select-columns">
                            ${CONSTANTS.COLUMN_OPTIONS.map(c => 
                                `<option value="${c}" ${c === CONSTANTS.DEFAULT_COLUMNS ? 'selected' : ''}>${c}</option>`
                            ).join('')}
                        </select>
                    </div>
                </div>

                <!-- Exam Code -->
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3);align-items:end">
                    <div class="form-group" style="flex-direction:row;align-items:center;gap:var(--space-3)">
                        <label class="toggle">
                            <input type="checkbox" id="toggle-exam-code" checked>
                            <span class="toggle-track"></span>
                        </label>
                        <span class="form-label" style="margin:0">${I18n.t('designer.has_exam_code')}</span>
                    </div>
                    <div class="form-group" id="exam-code-digits-group">
                        <label class="form-label">${I18n.t('designer.exam_code_digits')}</label>
                        <input type="number" class="form-input" id="input-exam-code-digits" 
                            min="1" max="5" value="${CONSTANTS.EXAM_CODE_DIGITS}">
                    </div>
                </div>
            </div>

            <!-- Preview -->
            <div style="margin-bottom:var(--space-3)">
                <div class="form-label" style="margin-bottom:var(--space-2)">${I18n.t('designer.preview')}</div>
                <div class="preview-container" id="sheet-preview-container">
                    <canvas id="sheet-preview-canvas" class="preview-canvas"></canvas>
                </div>
            </div>

            <!-- Actions -->
            <div class="designer-actions">
                <button class="btn btn-primary btn-block" id="btn-download-pdf">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    <span>${I18n.t('designer.download_pdf')}</span>
                </button>
                <button class="btn btn-secondary" id="btn-save-template">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                    <span>${I18n.t('designer.save_template')}</span>
                </button>
            </div>

            <!-- Saved Templates -->
            <div style="margin-top:var(--space-6)">
                <div class="form-label" style="margin-bottom:var(--space-2)">${I18n.t('designer.templates')}</div>
                <div id="saved-templates-list"></div>
            </div>
        `;

        // Bind events
        bindDesignerEvents();
        loadSavedTemplates();

        // Initial preview
        setTimeout(() => updatePreview(), 200);
    }

    function bindDesignerEvents() {
        const debounced = UIHelpers.debounce(updatePreview, 300);

        // All inputs trigger preview update
        ['input-question-count', 'select-option-count', 'input-sid-digits', 'select-columns',
         'input-header-text', 'toggle-exam-code', 'input-exam-code-digits', 'toggle-info-fields'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', debounced);
                el.addEventListener('change', debounced);
            }
        });

        // Logo Upload
        const logoInput = document.getElementById('input-logo-file');
        const logoPreview = document.getElementById('logo-preview-container');
        const logoImg = document.getElementById('logo-img-preview');
        const btnRemoveLogo = document.getElementById('btn-remove-logo');

        if (logoInput) {
            logoInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;
                
                if (file.size > 1024 * 1024 * 2) {
                    UIHelpers.showToast(I18n.getLang() === 'vi' ? 'Ảnh quá lớn. Chọn ảnh < 2MB' : 'Image too large. Max 2MB', 'error');
                    return;
                }

                const reader = new FileReader();
                reader.onload = (event) => {
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        const MAX = 200;
                        let w = img.width, h = img.height;
                        if (w > h) { if (w > MAX) { h *= MAX / w; w = MAX; } } 
                        else { if (h > MAX) { w *= MAX / h; h = MAX; } }

                        canvas.width = w; canvas.height = h;
                        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                        _logoBase64 = canvas.toDataURL('image/png');
                        logoImg.src = _logoBase64;
                        logoPreview.style.display = 'block';
                        btnRemoveLogo.style.display = 'block';
                        debounced();
                    };
                    img.src = event.target.result;
                };
                reader.readAsDataURL(file);
            });
        }

        if (btnRemoveLogo) {
            btnRemoveLogo.addEventListener('click', () => {
                _logoBase64 = null;
                logoImg.src = '';
                logoPreview.style.display = 'none';
                logoInput.value = '';
                btnRemoveLogo.style.display = 'none';
                debounced();
            });
        }

        // Toggle exam code digits visibility
        document.getElementById('toggle-exam-code')?.addEventListener('change', (e) => {
            const group = document.getElementById('exam-code-digits-group');
            if (group) group.style.opacity = e.target.checked ? '1' : '0.4';
        });

        // Download PDF
        document.getElementById('btn-download-pdf')?.addEventListener('click', handleDownloadPDF);

        // Save template
        document.getElementById('btn-save-template')?.addEventListener('click', handleSaveTemplate);
    }

    function getConfig() {
        return {
            questionCount: parseInt(document.getElementById('input-question-count')?.value) || CONSTANTS.DEFAULT_QUESTIONS,
            optionCount: parseInt(document.getElementById('select-option-count')?.value) || CONSTANTS.DEFAULT_OPTIONS,
            studentIdDigits: parseInt(document.getElementById('input-sid-digits')?.value) || CONSTANTS.STUDENT_ID_DIGITS,
            columns: parseInt(document.getElementById('select-columns')?.value) || CONSTANTS.DEFAULT_COLUMNS,
            headerText: document.getElementById('input-header-text')?.value || '',
            hasExamCodeSection: document.getElementById('toggle-exam-code')?.checked ?? true,
            examCodeDigits: parseInt(document.getElementById('input-exam-code-digits')?.value) || CONSTANTS.EXAM_CODE_DIGITS,
            hasInfoFields: document.getElementById('toggle-info-fields')?.checked ?? true,
            logoBase64: _logoBase64,
            paperSize: 'A4',
            orientation: 'portrait',
            type: CONSTANTS.TEMPLATE_TYPES.MULTIPLE_CHOICE,
            detachableId: false,
        };
    }

    function updatePreview() {
        const config = getConfig();
        _currentConfig = config;

        const canvas = document.getElementById('sheet-preview-canvas');
        if (!canvas) return;

        // Set canvas to A4 proportions at reasonable preview resolution
        const previewWidth = canvas.parentElement.clientWidth * (window.devicePixelRatio || 1);
        const scale = previewWidth / CONSTANTS.A4_WIDTH_MM;
        canvas.width = Math.round(CONSTANTS.A4_WIDTH_MM * scale);
        canvas.height = Math.round(CONSTANTS.A4_HEIGHT_MM * scale);
        canvas.style.width = '100%';
        canvas.style.height = 'auto';

        // Render using SheetRenderer
        if (typeof SheetRenderer !== 'undefined') {
            try {
                SheetRenderer.renderToCanvas(canvas, config, scale);
            } catch (e) {
                console.error("Canvas Render Error:", e);
                document.getElementById('app').innerHTML = `<div style="padding: 20px; color: red;"><h1>CÓ LỖI XẢY RA KHI VẼ</h1><pre>${e.stack || e.message}</pre></div>`;
            }
        } else {
            document.getElementById('app').innerHTML = `<div style="padding: 20px; color: red;"><h1>LỖI MÃ NGUỒN NGHIÊM TRỌNG</h1><p>Module SheetRenderer không tồn tại, có thể do lỗi cú pháp (Syntax Error) trong file sheet-renderer.js.</p></div>`;
        }
    }

    async function handleDownloadPDF() {
        const config = getConfig();
        const canvas = document.getElementById('sheet-preview-canvas');
        if (!canvas) return;

        const imgData = canvas.toDataURL('image/jpeg', 0.9);
        const isVi = I18n.getLang() === 'vi';
        
        const content = `
            <div style="text-align:center;max-height:55vh;overflow-y:auto;border:1px solid var(--color-border);border-radius:var(--radius-md)">
                <img src="${imgData}" style="width:100%;height:auto;display:block">
            </div>
            <div style="margin-top:var(--space-3);font-size:var(--font-size-sm);color:var(--color-text-secondary);text-align:center">
                ${isVi ? 'Vui lòng kiểm tra lại bố cục. Hệ thống đã tự động co giãn để phiếu nằm gọn trong 1 trang A4.' : 'Please double check the layout.'}
            </div>
        `;

        const action = await UIHelpers.showModal({
            title: isVi ? 'Xem trước Phiếu trả lời' : 'Preview Answer Sheet',
            content,
            actions: [
                { label: I18n.t('action.cancel') || 'Huỷ', className: 'btn-secondary', value: 'cancel' },
                { label: I18n.t('designer.download_pdf') || 'Tải xuống PDF', className: 'btn-primary', value: 'download' }
            ]
        });

        if (action !== 'download') return;

        try {
            UIHelpers.showLoading((I18n.t('designer.download_pdf') || 'Downloading') + '...');

            // Dynamically load jsPDF if not loaded
            if (typeof jspdf === 'undefined' && typeof jsPDF === 'undefined') {
                await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
            }

            if (typeof SheetRenderer !== 'undefined') {
                SheetRenderer.generatePDF(config);
            }

            UIHelpers.hideLoading();
            UIHelpers.showToast(I18n.t('misc.success') || 'Thành công', 'success');
        } catch (error) {
            UIHelpers.hideLoading();
            UIHelpers.showToast(I18n.t('misc.error') + ': ' + error.message, 'error');
            console.error('[Designer] PDF error:', error);
        }
    }

    async function handleSaveTemplate() {
        const name = document.getElementById('input-template-name')?.value?.trim();
        if (!name) {
            UIHelpers.showToast(I18n.t('designer.template_name') + '!', 'warning');
            return;
        }

        const config = getConfig();
        const template = {
            id: UIHelpers.uuid(),
            name,
            ...config,
            createdAt: new Date().toISOString(),
        };

        await MarkerDB.put(MarkerDB.STORES.TEMPLATES, template);
        UIHelpers.showToast(I18n.t('misc.saved'), 'success');
        UIHelpers.vibrate(50);
        loadSavedTemplates();
    }

    async function loadSavedTemplates() {
        const templates = await MarkerDB.getAll(MarkerDB.STORES.TEMPLATES);
        const container = document.getElementById('saved-templates-list');
        if (!container) return;

        if (templates.length === 0) {
            container.innerHTML = `
                <div class="empty-state" style="padding:var(--space-6)">
                    <div class="empty-state-desc">${I18n.t('designer.no_templates')}</div>
                </div>
            `;
            return;
        }

        container.innerHTML = templates.map(t => `
            <div class="list-item" data-template-id="${t.id}">
                <div class="list-item-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                    </svg>
                </div>
                <div class="list-item-content">
                    <div class="list-item-title">${UIHelpers.escapeHTML(t.name)}</div>
                    <div class="list-item-subtitle">${t.questionCount} câu · ${t.optionCount} đáp án · ${t.columns} cột</div>
                </div>
                <button class="btn-icon btn-ghost btn-sm template-load-btn" data-template-id="${t.id}" title="Load">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
            </div>
        `).join('');

        // Bind load buttons
        container.querySelectorAll('.template-load-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const template = await MarkerDB.get(MarkerDB.STORES.TEMPLATES, btn.dataset.templateId);
                if (template) loadTemplate(template);
            });
        });
    }

    function loadTemplate(template) {
        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val;
        };
        const setChecked = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.checked = val;
        };

        setVal('input-template-name', template.name || '');
        setVal('input-question-count', template.questionCount);
        setVal('select-option-count', template.optionCount);
        setVal('input-sid-digits', template.studentIdDigits);
        setVal('select-columns', template.columns);
        setVal('input-header-text', template.headerText || '');
        setChecked('toggle-exam-code', template.hasExamCodeSection !== false);
        setVal('input-exam-code-digits', template.examCodeDigits || 3);
        setChecked('toggle-info-fields', template.hasInfoFields !== false);

        _logoBase64 = template.logoBase64 || null;
        if (_logoBase64) {
            document.getElementById('logo-img-preview').src = _logoBase64;
            document.getElementById('logo-preview-container').style.display = 'block';
            document.getElementById('btn-remove-logo').style.display = 'block';
        } else {
            document.getElementById('logo-img-preview').src = '';
            document.getElementById('logo-preview-container').style.display = 'none';
            document.getElementById('btn-remove-logo').style.display = 'none';
            document.getElementById('input-logo-file').value = '';
        }

        updatePreview();
        UIHelpers.showToast(I18n.t('misc.success'), 'success');
    }

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            if (document.querySelector(`script[src="${src}"]`)) {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    // Listen for view changes to initialize
    if (typeof EventBus !== 'undefined') {
        EventBus.on('view:changed', ({ to }) => {
            if (to === 'designer') {
                init();
            }
        });
    }

    return {
        init,
        getConfig,
        updatePreview,
    };
})();

if (typeof window !== 'undefined') {
    window.SheetDesigner = SheetDesigner;
}
