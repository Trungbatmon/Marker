/**
 * Marker — Global Constants
 * Rule: All magic numbers and config values MUST be defined here.
 */

const CONSTANTS = (() => {
    return Object.freeze({
        // ── App Info ──
        APP_NAME: 'Marker',
        APP_VERSION: '1.0.0',
        DB_NAME: 'MarkerDB',
        DB_VERSION: 1,

        // ── Answer Sheet Physical Dimensions (mm) ──
        A4_WIDTH_MM: 210,
        A4_HEIGHT_MM: 297,
        MARKER_SIZE_MM: 12,          // Corner marker square size (large for reliable detection)
        BUBBLE_DIAMETER_MM: 5,       // Bubble circle diameter
        BUBBLE_SPACING_X_MM: 8,     // Horizontal center-to-center spacing
        BUBBLE_SPACING_Y_MM: 8,     // Vertical center-to-center spacing
        SAFE_MARGIN_MM: 10,         // Safe zone from paper edge
        MARKER_TO_CONTENT_MM: 5,    // Min distance from marker to nearest bubble
        TIMING_MARK_W_MM: 3,       // Timing mark width
        TIMING_MARK_H_MM: 1,       // Timing mark height
        STUDENT_ID_DIGITS: 8,       // Default SBD digit count
        EXAM_CODE_DIGITS: 3,       // Default exam code digit count

        // ── OMR Processing ──
        DEFAULT_FILL_THRESHOLD: 0.40,  // 40% fill ratio = marked
        MIN_FILL_THRESHOLD: 0.20,
        MAX_FILL_THRESHOLD: 0.70,
        FILL_THRESHOLD_STEP: 0.05,
        MIN_MARKER_AREA_RATIO: 0.0002,  // Min marker area relative to image (very permissive)
        MAX_MARKER_AREA_RATIO: 0.08,   // Max marker area relative to image
        MARKER_ASPECT_RATIO_TOL: 0.5,  // Tolerance for square detection (1.0 ± 0.5)
        GAUSSIAN_BLUR_SIZE: 5,
        ADAPTIVE_THRESH_BLOCK: 11,
        ADAPTIVE_THRESH_C: 2,

        // ── Scan Status ──
        SCAN_STATUS: Object.freeze({
            SUCCESS: 'success',
            MULTI: 'multi',        // Multiple answers marked
            BLANK: 'blank',        // No answer marked
            NO_MARKERS: 'no_markers',
            BLURRY: 'blurry',
            ERROR: 'error',
        }),

        // ── Answer Status ──
        ANSWER_STATUS: Object.freeze({
            CORRECT: 'correct',
            WRONG: 'wrong',
            BLANK: 'BLANK',
            MULTI: 'MULTI',
        }),

        // ── Project Status ──
        PROJECT_STATUS: Object.freeze({
            ACTIVE: 'active',
            ARCHIVED: 'archived',
        }),

        // ── Template Types (Extensibility R5.2) ──
        TEMPLATE_TYPES: Object.freeze({
            MULTIPLE_CHOICE: 'multiple-choice',
            ESSAY: 'essay',         // Future
            MIXED: 'mixed',         // Future
        }),

        // ── Grading Modes (Extensibility R5.3) ──
        GRADING_MODES: Object.freeze({
            OMR: 'omr',
            MANUAL: 'manual',       // Future
            AI: 'ai',               // Future
            MIXED: 'mixed',         // Future
        }),

        // ── Option Labels ──
        OPTION_LABELS: ['A', 'B', 'C', 'D', 'E'],
        MAX_OPTIONS: 5,
        MIN_OPTIONS: 4,

        // ── Question Limits ──
        MIN_QUESTIONS: 10,
        MAX_QUESTIONS: 120,
        DEFAULT_QUESTIONS: 50,
        DEFAULT_OPTIONS: 4,

        // ── Column Options ──
        COLUMN_OPTIONS: [1, 2, 3, 4],
        DEFAULT_COLUMNS: 3,

        // ── PDF Generation ──
        PDF_DPI: 72,               // jsPDF default DPI
        PDF_POINTS_PER_MM: 72 / 25.4,  // ≈ 2.835

        // ── UI ──
        TOAST_DURATION: 3000,       // 3 seconds
        TOAST_DURATION_LONG: 5000,  // 5 seconds
        DEBOUNCE_DELAY: 300,
        MIN_TOUCH_TARGET: 44,      // Minimum touch target size in px

        // ── Camera ──
        CAMERA_FACING: Object.freeze({
            BACK: 'environment',
            FRONT: 'user',
        }),
        PREFERRED_CAMERA_WIDTH: 3840,
        PREFERRED_CAMERA_HEIGHT: 2160,
        MIN_CAMERA_WIDTH: 1920,
        MIN_CAMERA_HEIGHT: 1080,
        CAPTURE_MAX_WIDTH: 3840,

        // ── Export ──
        EXCEL_FILENAME_PREFIX: 'Marker_Results_',

        // ── Local Storage Keys ──
        LS_KEYS: Object.freeze({
            THEME: 'marker_theme',
            LANG: 'marker_lang',
            FILL_THRESHOLD: 'marker_fill_threshold',
            SOUND_ENABLED: 'marker_sound',
            VIBRATION_ENABLED: 'marker_vibration',
            INSTALL_DISMISSED: 'marker_install_dismissed',
        }),
    });
})();

if (typeof window !== 'undefined') {
    window.CONSTANTS = CONSTANTS;
}
