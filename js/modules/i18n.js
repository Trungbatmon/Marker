/**
 * Marker — Internationalization Module (i18n)
 * Supports: Vietnamese (vi), English (en)
 * Rule R3.5: ALL display strings MUST go through this module.
 */

const I18n = (() => {
    // ── Translation dictionaries ──
    const translations = {
        vi: {
            // App
            'app.name': 'Marker',
            'app.tagline': 'Chấm Thi Trắc Nghiệm',
            'app.loading': 'Đang tải...',
            'app.loading_opencv': 'Đang tải bộ xử lý ảnh...',
            'app.ready': 'Sẵn sàng',

            // Navigation
            'nav.dashboard': 'Trang chủ',
            'nav.scan': 'Quét',
            'nav.designer': 'Phiếu',
            'nav.results': 'Kết quả',
            'nav.settings': 'Cài đặt',

            // Dashboard
            'dashboard.welcome': 'Xin chào!',
            'dashboard.welcome_sub': 'Chấm bài nhanh chóng, chính xác',
            'dashboard.stats': 'Tổng quan',
            'dashboard.total_projects': 'Dự án',
            'dashboard.total_scanned': 'Đã chấm',
            'dashboard.today_scanned': 'Hôm nay',
            'dashboard.avg_score': 'Điểm TB',
            'dashboard.projects': 'Dự án chấm',
            'dashboard.no_projects': 'Chưa có dự án nào',
            'dashboard.no_projects_desc': 'Tạo dự án đầu tiên để bắt đầu chấm bài',
            'dashboard.create_first': 'Tạo dự án',

            // Project
            'project.new': 'Tạo dự án mới',
            'project.edit': 'Sửa dự án',
            'project.delete': 'Xóa dự án',
            'project.delete_confirm': 'Bạn có chắc muốn xóa dự án này? Toàn bộ đáp án và kết quả sẽ bị xóa vĩnh viễn.',
            'project.name': 'Tên dự án',
            'project.name_placeholder': 'VD: Thi HK1 Toán 10',
            'project.subject': 'Môn học',
            'project.subject_placeholder': 'VD: Toán',
            'project.total_questions': 'Số câu hỏi',
            'project.option_count': 'Số đáp án/câu',
            'project.point_per_question': 'Điểm mỗi câu',
            'project.total_points': 'Tổng điểm',
            'project.template': 'Mẫu phiếu',
            'project.status_active': 'Đang hoạt động',
            'project.status_archived': 'Đã lưu trữ',
            'project.scanned_count': '{count} bài đã chấm',
            'project.scan_now': 'Quét ngay',
            'project.view_results': 'Xem kết quả',

            // Sheet Designer
            'designer.title': 'Thiết kế phiếu trả lời',
            'designer.template_name': 'Tên mẫu',
            'designer.template_name_placeholder': 'VD: Mẫu 40 câu - 4 đáp án',
            'designer.question_count': 'Số câu hỏi',
            'designer.option_count': 'Số đáp án',
            'designer.student_id_digits': 'Số chữ số SBD',
            'designer.exam_code_digits': 'Số chữ số mã đề',
            'designer.has_exam_code': 'Có mã đề',
            'designer.columns': 'Số cột',
            'designer.header_text': 'Tiêu đề phiếu',
            'designer.header_placeholder': 'VD: Trường THPT ABC\nKỳ thi HK1 2025-2026',
            'designer.preview': 'Xem trước',
            'designer.download_pdf': 'Tải PDF',
            'designer.print': 'In phiếu',
            'designer.save_template': 'Lưu mẫu',
            'designer.templates': 'Mẫu đã lưu',
            'designer.no_templates': 'Chưa có mẫu nào',

            // Answer Key
            'answer_key.title': 'Đáp án',
            'answer_key.add': 'Thêm mã đề',
            'answer_key.exam_code': 'Mã đề',
            'answer_key.exam_code_placeholder': 'VD: 001',
            'answer_key.input_method': 'Phương thức nhập',
            'answer_key.manual': 'Nhập tay',
            'answer_key.paste': 'Dán nhanh',
            'answer_key.import_text': 'Import từ text',
            'answer_key.import_excel': 'Import từ Excel',
            'answer_key.paste_hint': 'Dán chuỗi đáp án liên tục VD: ABCDABCD...',
            'answer_key.filled': '{count}/{total} câu đã nhập',
            'answer_key.save': 'Lưu đáp án',
            'answer_key.clear': 'Xóa tất cả',
            'answer_key.delete_confirm': 'Xóa mã đề này?',

            // Scanner
            'scanner.title': 'Quét bài thi',
            'scanner.select_project': 'Chọn dự án',
            'scanner.select_exam_code': 'Chọn mã đề',
            'scanner.guide': 'Đặt phiếu trong khung',
            'scanner.processing': 'Đang xử lý...',
            'scanner.success': 'Chấm thành công!',
            'scanner.error_no_markers': 'Không tìm thấy marker. Vui lòng chụp lại.',
            'scanner.error_blurry': 'Ảnh mờ. Vui lòng giữ yên và chụp lại.',
            'scanner.error_generic': 'Lỗi xử lý. Vui lòng thử lại.',
            'scanner.retake': 'Chụp lại',
            'scanner.save_result': 'Lưu kết quả',
            'scanner.flip_camera': 'Đổi camera',
            'scanner.flash': 'Đèn flash',
            'scanner.no_camera': 'Không thể truy cập camera',
            'scanner.camera_permission': 'Vui lòng cho phép truy cập camera để sử dụng tính năng quét.',

            // Results
            'results.title': 'Kết quả chấm',
            'results.student_id': 'SBD',
            'results.exam_code': 'Mã đề',
            'results.correct': 'Đúng',
            'results.wrong': 'Sai',
            'results.blank': 'Bỏ trống',
            'results.multi': 'Đa đáp án',
            'results.score': 'Điểm',
            'results.time': 'Thời gian',
            'results.detail': 'Chi tiết',
            'results.regrade': 'Chấm lại',
            'results.manual_edit': 'Sửa thủ công',
            'results.export_excel': 'Xuất Excel',
            'results.export_json': 'Xuất JSON',
            'results.no_results': 'Chưa có kết quả',
            'results.no_results_desc': 'Quét bài thi để xem kết quả tại đây',
            'results.filter_all': 'Tất cả',
            'results.verified': 'Đã xác nhận',
            'results.unverified': 'Chưa xác nhận',
            'results.stats': 'Thống kê',
            'results.avg_score': 'Điểm trung bình',
            'results.highest': 'Cao nhất',
            'results.lowest': 'Thấp nhất',
            'results.distribution': 'Phân phối điểm',
            'results.question_analysis': 'Phân tích câu hỏi',
            'results.correct_rate': 'Tỷ lệ đúng',

            // Settings
            'settings.title': 'Cài đặt',
            'settings.general': 'Chung',
            'settings.language': 'Ngôn ngữ',
            'settings.theme': 'Giao diện',
            'settings.theme_dark': 'Tối',
            'settings.theme_light': 'Sáng',
            'settings.scan_settings': 'Cài đặt quét',
            'settings.fill_threshold': 'Ngưỡng tô đáp án',
            'settings.fill_threshold_desc': 'Tỷ lệ % pixel đen để coi là đã tô',
            'settings.sound': 'Âm thanh',
            'settings.vibration': 'Rung phản hồi',
            'settings.data': 'Dữ liệu',
            'settings.backup': 'Sao lưu dữ liệu',
            'settings.backup_desc': 'Xuất toàn bộ dữ liệu ra file JSON',
            'settings.restore': 'Khôi phục dữ liệu',
            'settings.restore_desc': 'Nhập dữ liệu từ file backup',
            'settings.clear_data': 'Xóa toàn bộ dữ liệu',
            'settings.clear_data_confirm': 'Hành động này không thể hoàn tác. Bạn có chắc chắn?',
            'settings.about': 'Thông tin',
            'settings.version': 'Phiên bản',
            'settings.install_app': 'Cài đặt ứng dụng',
            'settings.install_app_desc': 'Thêm vào màn hình chính',

            // Common actions
            'action.save': 'Lưu',
            'action.cancel': 'Hủy',
            'action.delete': 'Xóa',
            'action.edit': 'Sửa',
            'action.close': 'Đóng',
            'action.confirm': 'Xác nhận',
            'action.back': 'Quay lại',
            'action.create': 'Tạo mới',
            'action.search': 'Tìm kiếm',
            'action.export': 'Xuất',
            'action.import': 'Nhập',
            'action.select': 'Chọn',
            'action.done': 'Xong',
            'action.retry': 'Thử lại',
            'action.yes': 'Có',
            'action.no': 'Không',

            // Misc
            'misc.or': 'hoặc',
            'misc.items': 'mục',
            'misc.loading': 'Đang tải...',
            'misc.no_data': 'Không có dữ liệu',
            'misc.error': 'Đã xảy ra lỗi',
            'misc.success': 'Thành công',
            'misc.updated': 'Đã cập nhật',
            'misc.deleted': 'Đã xóa',
            'misc.saved': 'Đã lưu',
            'misc.copied': 'Đã sao chép',
        },

        en: {
            // App
            'app.name': 'Marker',
            'app.tagline': 'Answer Sheet Grader',
            'app.loading': 'Loading...',
            'app.loading_opencv': 'Loading image processor...',
            'app.ready': 'Ready',

            // Navigation
            'nav.dashboard': 'Home',
            'nav.scan': 'Scan',
            'nav.designer': 'Sheets',
            'nav.results': 'Results',
            'nav.settings': 'Settings',

            // Dashboard
            'dashboard.welcome': 'Welcome!',
            'dashboard.welcome_sub': 'Fast and accurate grading',
            'dashboard.stats': 'Overview',
            'dashboard.total_projects': 'Projects',
            'dashboard.total_scanned': 'Graded',
            'dashboard.today_scanned': 'Today',
            'dashboard.avg_score': 'Avg Score',
            'dashboard.projects': 'Projects',
            'dashboard.no_projects': 'No projects yet',
            'dashboard.no_projects_desc': 'Create your first project to start grading',
            'dashboard.create_first': 'Create project',

            // Project
            'project.new': 'New Project',
            'project.edit': 'Edit Project',
            'project.delete': 'Delete Project',
            'project.delete_confirm': 'Are you sure you want to delete this project? All answer keys and results will be permanently deleted.',
            'project.name': 'Project name',
            'project.name_placeholder': 'e.g., Mid-term Math Grade 10',
            'project.subject': 'Subject',
            'project.subject_placeholder': 'e.g., Mathematics',
            'project.total_questions': 'Number of questions',
            'project.option_count': 'Options per question',
            'project.point_per_question': 'Points per question',
            'project.total_points': 'Total points',
            'project.template': 'Answer sheet template',
            'project.status_active': 'Active',
            'project.status_archived': 'Archived',
            'project.scanned_count': '{count} graded',
            'project.scan_now': 'Scan now',
            'project.view_results': 'View results',

            // Sheet Designer
            'designer.title': 'Answer Sheet Designer',
            'designer.template_name': 'Template name',
            'designer.template_name_placeholder': 'e.g., 40 Questions - 4 Options',
            'designer.question_count': 'Number of questions',
            'designer.option_count': 'Number of options',
            'designer.student_id_digits': 'Student ID digits',
            'designer.exam_code_digits': 'Exam code digits',
            'designer.has_exam_code': 'Has exam code',
            'designer.columns': 'Columns',
            'designer.header_text': 'Sheet header',
            'designer.header_placeholder': 'e.g., ABC High School\nMid-term Exam 2025-2026',
            'designer.preview': 'Preview',
            'designer.download_pdf': 'Download PDF',
            'designer.print': 'Print',
            'designer.save_template': 'Save template',
            'designer.templates': 'Saved templates',
            'designer.no_templates': 'No templates yet',

            // Answer Key
            'answer_key.title': 'Answer Key',
            'answer_key.add': 'Add exam code',
            'answer_key.exam_code': 'Exam code',
            'answer_key.exam_code_placeholder': 'e.g., 001',
            'answer_key.input_method': 'Input method',
            'answer_key.manual': 'Manual input',
            'answer_key.paste': 'Quick paste',
            'answer_key.import_text': 'Import from text',
            'answer_key.import_excel': 'Import from Excel',
            'answer_key.paste_hint': 'Paste answer string e.g., ABCDABCD...',
            'answer_key.filled': '{count}/{total} filled',
            'answer_key.save': 'Save answer key',
            'answer_key.clear': 'Clear all',
            'answer_key.delete_confirm': 'Delete this exam code?',

            // Scanner
            'scanner.title': 'Scan Answer Sheet',
            'scanner.select_project': 'Select project',
            'scanner.select_exam_code': 'Select exam code',
            'scanner.guide': 'Place sheet inside frame',
            'scanner.processing': 'Processing...',
            'scanner.success': 'Grading successful!',
            'scanner.error_no_markers': 'Markers not found. Please retake.',
            'scanner.error_blurry': 'Image is blurry. Please hold steady and retake.',
            'scanner.error_generic': 'Processing error. Please try again.',
            'scanner.retake': 'Retake',
            'scanner.save_result': 'Save result',
            'scanner.flip_camera': 'Flip camera',
            'scanner.flash': 'Flash',
            'scanner.no_camera': 'Cannot access camera',
            'scanner.camera_permission': 'Please allow camera access to use the scan feature.',

            // Results
            'results.title': 'Grading Results',
            'results.student_id': 'ID',
            'results.exam_code': 'Code',
            'results.correct': 'Correct',
            'results.wrong': 'Wrong',
            'results.blank': 'Blank',
            'results.multi': 'Multiple',
            'results.score': 'Score',
            'results.time': 'Time',
            'results.detail': 'Detail',
            'results.regrade': 'Re-grade',
            'results.manual_edit': 'Manual edit',
            'results.export_excel': 'Export Excel',
            'results.export_json': 'Export JSON',
            'results.no_results': 'No results yet',
            'results.no_results_desc': 'Scan answer sheets to see results here',
            'results.filter_all': 'All',
            'results.verified': 'Verified',
            'results.unverified': 'Unverified',
            'results.stats': 'Statistics',
            'results.avg_score': 'Average score',
            'results.highest': 'Highest',
            'results.lowest': 'Lowest',
            'results.distribution': 'Score distribution',
            'results.question_analysis': 'Question analysis',
            'results.correct_rate': 'Correct rate',

            // Settings
            'settings.title': 'Settings',
            'settings.general': 'General',
            'settings.language': 'Language',
            'settings.theme': 'Theme',
            'settings.theme_dark': 'Dark',
            'settings.theme_light': 'Light',
            'settings.scan_settings': 'Scan settings',
            'settings.fill_threshold': 'Fill threshold',
            'settings.fill_threshold_desc': '% of dark pixels to consider marked',
            'settings.sound': 'Sound',
            'settings.vibration': 'Vibration feedback',
            'settings.data': 'Data',
            'settings.backup': 'Backup data',
            'settings.backup_desc': 'Export all data to JSON file',
            'settings.restore': 'Restore data',
            'settings.restore_desc': 'Import data from backup file',
            'settings.clear_data': 'Clear all data',
            'settings.clear_data_confirm': 'This action cannot be undone. Are you sure?',
            'settings.about': 'About',
            'settings.version': 'Version',
            'settings.install_app': 'Install app',
            'settings.install_app_desc': 'Add to home screen',

            // Common actions
            'action.save': 'Save',
            'action.cancel': 'Cancel',
            'action.delete': 'Delete',
            'action.edit': 'Edit',
            'action.close': 'Close',
            'action.confirm': 'Confirm',
            'action.back': 'Back',
            'action.create': 'Create',
            'action.search': 'Search',
            'action.export': 'Export',
            'action.import': 'Import',
            'action.select': 'Select',
            'action.done': 'Done',
            'action.retry': 'Retry',
            'action.yes': 'Yes',
            'action.no': 'No',

            // Misc
            'misc.or': 'or',
            'misc.items': 'items',
            'misc.loading': 'Loading...',
            'misc.no_data': 'No data',
            'misc.error': 'An error occurred',
            'misc.success': 'Success',
            'misc.updated': 'Updated',
            'misc.deleted': 'Deleted',
            'misc.saved': 'Saved',
            'misc.copied': 'Copied',
        }
    };

    // ── State ──
    let currentLang = 'vi';

    // ── Public API ──

    /**
     * Initialize i18n with saved language preference
     */
    function init(savedLang) {
        currentLang = savedLang || localStorage.getItem('marker_lang') || 'vi';
        document.documentElement.lang = currentLang;
    }

    /**
     * Get translated string by key
     * @param {string} key - Translation key (e.g., 'nav.dashboard')
     * @param {Object} params - Optional interpolation params (e.g., {count: 5})
     * @returns {string} Translated string or key if not found
     */
    function t(key, params = {}) {
        const dict = translations[currentLang] || translations['vi'];
        let text = dict[key];

        if (text === undefined) {
            console.warn(`[i18n] Missing translation: "${key}" for lang "${currentLang}"`);
            return key;
        }

        // Interpolation: replace {param} with value
        if (params && typeof params === 'object') {
            Object.keys(params).forEach(param => {
                text = text.replace(new RegExp(`\\{${param}\\}`, 'g'), params[param]);
            });
        }

        return text;
    }

    /**
     * Switch language
     * @param {string} lang - 'vi' or 'en'
     */
    function setLang(lang) {
        if (!translations[lang]) {
            console.warn(`[i18n] Unknown language: "${lang}"`);
            return;
        }
        currentLang = lang;
        localStorage.setItem('marker_lang', lang);
        document.documentElement.lang = lang;

        // Update all elements with data-i18n attribute
        updateDOM();
    }

    /**
     * Get current language
     */
    function getLang() {
        return currentLang;
    }

    /**
     * Get all supported languages
     */
    function getSupportedLangs() {
        return [
            { code: 'vi', name: 'Tiếng Việt', flag: '🇻🇳' },
            { code: 'en', name: 'English', flag: '🇬🇧' }
        ];
    }

    /**
     * Update all DOM elements with data-i18n attribute
     */
    function updateDOM() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            const params = el.getAttribute('data-i18n-params');
            const parsedParams = params ? JSON.parse(params) : {};
            el.textContent = t(key, parsedParams);
        });

        // Update placeholders
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            el.placeholder = t(key);
        });

        // Update aria-labels
        document.querySelectorAll('[data-i18n-aria]').forEach(el => {
            const key = el.getAttribute('data-i18n-aria');
            el.setAttribute('aria-label', t(key));
        });

        // Update titles
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            el.title = t(key);
        });
    }

    return { init, t, setLang, getLang, getSupportedLangs, updateDOM };
})();

// Export for modules
if (typeof window !== 'undefined') {
    window.I18n = I18n;
}
