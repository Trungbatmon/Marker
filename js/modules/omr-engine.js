/**
 * Marker — OMR Engine
 * Optical Mark Recognition processing pipeline
 * Rules: R2.1 - R2.7 strictly enforced
 * 
 * NOTE: In production, this should run in a Web Worker (R2.6).
 * For simplicity of initial implementation, it runs on the main thread
 * with plans to migrate to a Worker.
 */

const OMREngine = (() => {

    /**
     * Process an image and extract answers
     * Pipeline: R2.1 — Grayscale → Blur → Threshold → Find Markers → 
     *           Perspective Transform → Extract Regions → Analyze Bubbles
     * 
     * @param {ImageData} imageData - Raw image from camera
     * @param {Object} config - Template configuration
     * @param {Object} answerKey - Correct answers { 1: 'A', 2: 'C', ... }
     * @param {number} fillThreshold - Fill ratio threshold (R2.2)
     * @returns {Object} Processing result
     */
    function process(imageData, config, answerKey, fillThreshold) {
        if (typeof cv === 'undefined') {
            return { success: false, error: 'opencv_not_loaded' };
        }

        // Track all Mat objects for cleanup (R2.7)
        const mats = [];
        const track = (mat) => { mats.push(mat); return mat; };

        try {
            const src = track(cv.matFromImageData(imageData));
            
            // Step 1: Grayscale
            const gray = track(new cv.Mat());
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

            // Step 2: Gaussian Blur
            const blurred = track(new cv.Mat());
            cv.GaussianBlur(gray, blurred, new cv.Size(
                CONSTANTS.GAUSSIAN_BLUR_SIZE, 
                CONSTANTS.GAUSSIAN_BLUR_SIZE
            ), 0);

            // Step 3: Adaptive Threshold
            const thresh = track(new cv.Mat());
            cv.adaptiveThreshold(
                blurred, thresh, 255,
                cv.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv.THRESH_BINARY_INV,
                CONSTANTS.ADAPTIVE_THRESH_BLOCK,
                CONSTANTS.ADAPTIVE_THRESH_C
            );

            // Step 4: Find Corner Markers (R2.5)
            const markers = findCornerMarkers(thresh, src.cols, src.rows);
            
            if (markers.length < 4) {
                // R2.5: REJECT if < 4 markers found
                return { 
                    success: false, 
                    error: 'no_markers',
                    markersFound: markers.length 
                };
            }

            // Step 5: Perspective Transform
            const ordered = MathUtils.orderPoints(markers);
            const warped = track(perspectiveTransform(gray, ordered));
            
            // Re-threshold the warped image
            const warpedThresh = track(new cv.Mat());
            cv.adaptiveThreshold(
                warped, warpedThresh, 255,
                cv.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv.THRESH_BINARY_INV,
                CONSTANTS.ADAPTIVE_THRESH_BLOCK,
                CONSTANTS.ADAPTIVE_THRESH_C
            );

            // Use the config to determine where bubbles are
            if (!config) {
                return { success: false, error: 'no_config' };
            }

            // Step 6-7: Extract Student ID and Exam Code
            const studentId = extractBubbleRegion(warpedThresh, 
                getStudentIdRegion(config, warped.cols, warped.rows), 
                config.studentIdDigits || CONSTANTS.STUDENT_ID_DIGITS, 10, fillThreshold);
            
            const examCode = config.examCodeDigits 
                ? extractBubbleRegion(warpedThresh, 
                    getExamCodeRegion(config, warped.cols, warped.rows), 
                    config.examCodeDigits || CONSTANTS.EXAM_CODE_DIGITS, 10, fillThreshold)
                : '';

            // Step 8: Analyze Answer Bubbles
            const { answers, details } = analyzeAnswers(
                warpedThresh, config, warped.cols, warped.rows, fillThreshold
            );

            // Step 9: Grade
            let correctCount = 0, wrongCount = 0, blankCount = 0, multiCount = 0;
            const gradedDetails = [];

            for (let q = 1; q <= config.questionCount; q++) {
                const selected = answers[q] || CONSTANTS.ANSWER_STATUS.BLANK;
                const correct = answerKey ? answerKey[q] : null;
                let status = 'unknown';

                if (selected === CONSTANTS.ANSWER_STATUS.BLANK) {
                    blankCount++;
                    status = 'blank';
                } else if (selected === CONSTANTS.ANSWER_STATUS.MULTI) {
                    multiCount++;
                    status = 'wrong'; // R2.3: Multi = wrong
                } else if (correct && selected === correct) {
                    correctCount++;
                    status = 'correct';
                } else {
                    wrongCount++;
                    status = 'wrong';
                }

                gradedDetails.push({
                    question: q,
                    selected,
                    correct: correct || '?',
                    status,
                    confidence: details[q]?.confidence || 0,
                });
            }

            const avgConfidence = gradedDetails.length > 0
                ? gradedDetails.reduce((s, d) => s + d.confidence, 0) / gradedDetails.length
                : 0;

            return {
                success: true,
                studentId: studentId || '',
                examCode: examCode || '',
                answers,
                details: gradedDetails,
                correctCount,
                wrongCount,
                blankCount,
                multiCount,
                avgConfidence: Math.round(avgConfidence * 100) / 100,
            };

        } catch (error) {
            console.error('[OMR] Processing error:', error);
            return { success: false, error: 'processing_error', message: error.message };
        } finally {
            // Step 11: Cleanup ALL Mat objects (R2.7)
            mats.forEach(mat => {
                try { mat.delete(); } catch (e) { /* already deleted */ }
            });
        }
    }

    /**
     * Find 4 corner markers in the thresholded image
     */
    function findCornerMarkers(thresh, imgWidth, imgHeight) {
        const contours = new cv.MatVector();
        const hierarchy = new cv.Mat();

        try {
            cv.findContours(thresh, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

            const imgArea = imgWidth * imgHeight;
            const minArea = imgArea * CONSTANTS.MIN_MARKER_AREA_RATIO;
            const maxArea = imgArea * CONSTANTS.MAX_MARKER_AREA_RATIO;

            const candidates = [];

            for (let i = 0; i < contours.size(); i++) {
                const contour = contours.get(i);
                const area = cv.contourArea(contour);
                
                if (area < minArea || area > maxArea) continue;

                const rect = cv.boundingRect(contour);
                const aspect = MathUtils.aspectRatio(rect.width, rect.height);

                // Markers should be roughly square (aspect ratio close to 1)
                if (aspect > (1 - CONSTANTS.MARKER_ASPECT_RATIO_TOL)) {
                    candidates.push({
                        x: rect.x + rect.width / 2,
                        y: rect.y + rect.height / 2,
                        area,
                        aspect,
                    });
                }
            }

            // Sort by area descending, pick top 4
            candidates.sort((a, b) => b.area - a.area);

            // Should find exactly 4 large square-ish contours
            return candidates.slice(0, 4);

        } finally {
            contours.delete();
            hierarchy.delete();
        }
    }

    /**
     * Apply perspective transform to get a top-down view
     */
    function perspectiveTransform(srcGray, orderedPoints) {
        const [tl, tr, br, bl] = orderedPoints;

        // Calculate output dimensions
        const widthTop = MathUtils.distance(tl, tr);
        const widthBottom = MathUtils.distance(bl, br);
        const maxWidth = Math.round(Math.max(widthTop, widthBottom));

        const heightLeft = MathUtils.distance(tl, bl);
        const heightRight = MathUtils.distance(tr, br);
        const maxHeight = Math.round(Math.max(heightLeft, heightRight));

        // Source points
        const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
            tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y
        ]);

        // Destination points
        const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
            0, 0, maxWidth, 0, maxWidth, maxHeight, 0, maxHeight
        ]);

        const M = cv.getPerspectiveTransform(srcPts, dstPts);
        const warped = new cv.Mat();
        cv.warpPerspective(srcGray, warped, M, new cv.Size(maxWidth, maxHeight));

        srcPts.delete();
        dstPts.delete();
        M.delete();

        return warped;
    }

    /**
     * Calculate Student ID region in normalized coordinates
     */
    function getStudentIdRegion(config, imgW, imgH) {
        const marginRatio = CONSTANTS.SAFE_MARGIN_MM / CONSTANTS.A4_WIDTH_MM;
        const markerRatio = CONSTANTS.MARKER_SIZE_MM / CONSTANTS.A4_WIDTH_MM;
        const gapRatio = CONSTANTS.MARKER_TO_CONTENT_MM / CONSTANTS.A4_WIDTH_MM;

        return {
            x: (marginRatio + markerRatio + gapRatio) * imgW,
            y: 0.15 * imgH, // Approximate 15% from top (after header)
            width: ((config.studentIdDigits || 6) * CONSTANTS.BUBBLE_SPACING_X_MM / CONSTANTS.A4_WIDTH_MM) * imgW,
            height: (10 * CONSTANTS.BUBBLE_SPACING_Y_MM / CONSTANTS.A4_HEIGHT_MM) * imgH,
        };
    }

    function getExamCodeRegion(config, imgW, imgH) {
        const sidRegion = getStudentIdRegion(config, imgW, imgH);
        return {
            x: sidRegion.x + sidRegion.width + 0.05 * imgW,
            y: sidRegion.y,
            width: ((config.examCodeDigits || 3) * CONSTANTS.BUBBLE_SPACING_X_MM / CONSTANTS.A4_WIDTH_MM) * imgW,
            height: sidRegion.height,
        };
    }

    /**
     * Extract digits from a bubble region (for SBD or exam code)
     */
    function extractBubbleRegion(warpedThresh, region, digitCount, valuesPerDigit, threshold) {
        const { x, y, width, height } = region;
        
        // Clamp to image bounds
        const rx = MathUtils.clamp(Math.round(x), 0, warpedThresh.cols - 1);
        const ry = MathUtils.clamp(Math.round(y), 0, warpedThresh.rows - 1);
        const rw = MathUtils.clamp(Math.round(width), 1, warpedThresh.cols - rx);
        const rh = MathUtils.clamp(Math.round(height), 1, warpedThresh.rows - ry);

        let digits = '';
        const colWidth = rw / digitCount;
        const rowHeight = rh / valuesPerDigit;

        for (let d = 0; d < digitCount; d++) {
            let maxFill = 0;
            let maxVal = 0;

            for (let v = 0; v < valuesPerDigit; v++) {
                const bx = MathUtils.clamp(Math.round(rx + d * colWidth + colWidth * 0.2), 0, warpedThresh.cols - 1);
                const by = MathUtils.clamp(Math.round(ry + v * rowHeight + rowHeight * 0.2), 0, warpedThresh.rows - 1);
                const bw = MathUtils.clamp(Math.round(colWidth * 0.6), 1, warpedThresh.cols - bx);
                const bh = MathUtils.clamp(Math.round(rowHeight * 0.6), 1, warpedThresh.rows - by);

                try {
                    const roi = warpedThresh.roi(new cv.Rect(bx, by, bw, bh));
                    const nonZero = cv.countNonZero(roi);
                    const fill = nonZero / (bw * bh);
                    roi.delete();

                    if (fill > maxFill) {
                        maxFill = fill;
                        maxVal = v;
                    }
                } catch (e) {
                    // ROI out of bounds, skip
                }
            }

            digits += (maxFill >= threshold) ? String(maxVal) : '?';
        }

        return digits.replace(/\?/g, '');
    }

    /**
     * Analyze answer bubbles
     */
    function analyzeAnswers(warpedThresh, config, imgW, imgH, fillThreshold) {
        const answers = {};
        const details = {};
        
        const questionsPerCol = Math.ceil(config.questionCount / (config.columns || 2));
        
        // Approximate question area (after SBD section)
        const qStartY = 0.45 * imgH; // Questions start roughly 45% down
        const qEndY = imgH * 0.92;   // End at 92%
        const qMarginX = 0.08 * imgW;
        const qUsableW = imgW - 2 * qMarginX;
        const colW = qUsableW / (config.columns || 2);
        const rowH = (qEndY - qStartY) / questionsPerCol;

        for (let q = 1; q <= config.questionCount; q++) {
            const col = Math.floor((q - 1) / questionsPerCol);
            const row = (q - 1) % questionsPerCol;

            const baseX = qMarginX + col * colW + colW * 0.25; // Skip question number area
            const baseY = qStartY + row * rowH;
            const bubbleW = colW * 0.6 / config.optionCount;
            const bubbleH = rowH * 0.7;

            const fills = [];
            for (let opt = 0; opt < config.optionCount; opt++) {
                const bx = MathUtils.clamp(Math.round(baseX + opt * bubbleW), 0, imgW - 1);
                const by = MathUtils.clamp(Math.round(baseY + rowH * 0.15), 0, imgH - 1);
                const bw = MathUtils.clamp(Math.round(bubbleW * 0.7), 1, imgW - bx);
                const bh = MathUtils.clamp(Math.round(bubbleH * 0.7), 1, imgH - by);

                try {
                    const roi = warpedThresh.roi(new cv.Rect(bx, by, bw, bh));
                    const nonZero = cv.countNonZero(roi);
                    const fill = nonZero / (bw * bh);
                    roi.delete();
                    fills.push({ option: CONSTANTS.OPTION_LABELS[opt], fill });
                } catch (e) {
                    fills.push({ option: CONSTANTS.OPTION_LABELS[opt], fill: 0 });
                }
            }

            // Determine which bubble(s) are marked (R2.2, R2.3, R2.4)
            const marked = fills.filter(f => f.fill >= fillThreshold);
            const maxFill = Math.max(...fills.map(f => f.fill));

            if (marked.length === 0) {
                // R2.4: No bubble marked → BLANK
                answers[q] = CONSTANTS.ANSWER_STATUS.BLANK;
            } else if (marked.length === 1) {
                answers[q] = marked[0].option;
            } else {
                // R2.3: Multiple bubbles marked → MULTI
                answers[q] = CONSTANTS.ANSWER_STATUS.MULTI;
            }

            details[q] = {
                fills,
                markedCount: marked.length,
                confidence: maxFill,
            };
        }

        return { answers, details };
    }

    // Register as grading strategy (R5.3)
    if (typeof Extensibility !== 'undefined') {
        Extensibility.registerGradingStrategy(CONSTANTS.GRADING_MODES.OMR, {
            name: 'OMR (Optical Mark Recognition)',
            process,
        });
    }

    return {
        process,
    };
})();

if (typeof window !== 'undefined') {
    window.OMREngine = OMREngine;
}
