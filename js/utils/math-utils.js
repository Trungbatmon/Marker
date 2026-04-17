/**
 * Marker — Math Utilities
 * Geometry calculations for OMR processing
 */

const MathUtils = (() => {

    /**
     * Calculate distance between two points
     */
    function distance(p1, p2) {
        return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
    }

    /**
     * Order 4 points: [top-left, top-right, bottom-right, bottom-left]
     * @param {Array<{x,y}>} pts - Array of 4 points
     * @returns {Array<{x,y}>} Ordered points
     */
    function orderPoints(pts) {
        if (pts.length !== 4) throw new Error('Expected exactly 4 points');

        // Sort by sum (x+y): smallest = top-left, largest = bottom-right
        const sorted = [...pts].sort((a, b) => (a.x + a.y) - (b.x + b.y));
        const tl = sorted[0];
        const br = sorted[3];

        // Sort by difference (y-x): smallest = top-right, largest = bottom-left
        const remaining = sorted.slice(1, 3);
        remaining.sort((a, b) => (a.y - a.x) - (b.y - b.x));
        const tr = remaining[0];
        const bl = remaining[1];

        return [tl, tr, br, bl];
    }

    /**
     * Convert millimeters to pixels at given DPI
     */
    function mmToPx(mm, dpi = 96) {
        return mm * dpi / 25.4;
    }

    /**
     * Convert pixels to millimeters at given DPI
     */
    function pxToMm(px, dpi = 96) {
        return px * 25.4 / dpi;
    }

    /**
     * Convert mm to PDF points (jsPDF uses 72dpi points)
     */
    function mmToPoints(mm) {
        return mm * CONSTANTS.PDF_POINTS_PER_MM;
    }

    /**
     * Calculate center point between two points
     */
    function midpoint(p1, p2) {
        return {
            x: (p1.x + p2.x) / 2,
            y: (p1.y + p2.y) / 2
        };
    }

    /**
     * Calculate angle between two points in degrees
     */
    function angleDeg(p1, p2) {
        return Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;
    }

    /**
     * Check if a number is approximately equal to another
     */
    function approxEqual(a, b, tolerance = 0.01) {
        return Math.abs(a - b) <= tolerance;
    }

    /**
     * Calculate aspect ratio of a bounding rect
     */
    function aspectRatio(width, height) {
        return Math.min(width, height) / Math.max(width, height);
    }

    /**
     * Clamp a value between min and max
     */
    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    /**
     * Linear interpolation
     */
    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    /**
     * Map a value from one range to another
     */
    function mapRange(value, inMin, inMax, outMin, outMax) {
        return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
    }

    /**
     * Calculate the bounding rectangle of a set of points
     */
    function boundingRect(points) {
        const xs = points.map(p => p.x);
        const ys = points.map(p => p.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        return {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY
        };
    }

    /**
     * Calculate grid positions for answer bubbles on the sheet
     * @param {Object} template - Template configuration
     * @returns {Array<{question, options: Array<{x,y}>}>} Grid positions in mm
     */
    function calculateBubbleGrid(template) {
        const {
            questionCount,
            optionCount,
            columns,
            studentIdDigits,
            hasExamCodeSection = true,
            examCodeDigits = 3,
        } = template;

        const C = CONSTANTS;
        const startX = C.SAFE_MARGIN_MM + C.MARKER_SIZE_MM + C.MARKER_TO_CONTENT_MM;
        const startY = C.SAFE_MARGIN_MM + C.MARKER_SIZE_MM + C.MARKER_TO_CONTENT_MM;

        // Calculate available width for questions area
        const usableWidth = C.A4_WIDTH_MM - (2 * startX);
        const columnWidth = usableWidth / columns;

        // Y offset after header + student ID section
        // Header: ~20mm, Student ID: ~(10 rows * spacing + labels) ≈ 35mm, separator: 5mm
        const headerHeight = 20;
        const sidSectionHeight = 10 * C.BUBBLE_SPACING_Y_MM + 10;
        const questionsStartY = startY + headerHeight + sidSectionHeight + 5;

        const questionsPerColumn = Math.ceil(questionCount / columns);
        const grid = [];

        for (let q = 0; q < questionCount; q++) {
            const col = Math.floor(q / questionsPerColumn);
            const row = q % questionsPerColumn;

            const baseX = startX + (col * columnWidth) + 12; // 12mm for question number
            const baseY = questionsStartY + (row * C.BUBBLE_SPACING_Y_MM);

            const options = [];
            for (let o = 0; o < optionCount; o++) {
                options.push({
                    x: baseX + (o * C.BUBBLE_SPACING_X_MM),
                    y: baseY,
                });
            }

            grid.push({
                question: q + 1,
                x: startX + (col * columnWidth),
                y: baseY,
                options,
            });
        }

        return grid;
    }

    /**
     * Calculate Student ID bubble positions
     */
    function calculateStudentIdGrid(digits = 6) {
        const C = CONSTANTS;
        const startX = C.SAFE_MARGIN_MM + C.MARKER_SIZE_MM + C.MARKER_TO_CONTENT_MM + 5;
        const startY = C.SAFE_MARGIN_MM + C.MARKER_SIZE_MM + C.MARKER_TO_CONTENT_MM + 25; // After header

        const grid = [];
        for (let d = 0; d < digits; d++) {
            const column = [];
            for (let n = 0; n < 10; n++) {
                column.push({
                    x: startX + (d * C.BUBBLE_SPACING_X_MM),
                    y: startY + (n * C.BUBBLE_SPACING_Y_MM),
                    value: n,
                });
            }
            grid.push(column);
        }

        return grid;
    }

    return {
        distance,
        orderPoints,
        mmToPx,
        pxToMm,
        mmToPoints,
        midpoint,
        angleDeg,
        approxEqual,
        aspectRatio,
        clamp,
        lerp,
        mapRange,
        boundingRect,
        calculateBubbleGrid,
        calculateStudentIdGrid,
    };
})();

if (typeof window !== 'undefined') {
    window.MathUtils = MathUtils;
}
