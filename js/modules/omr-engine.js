/**
 * Marker — OMR Engine v2
 * Optical Mark Recognition processing pipeline
 * 
 * v2 Rewrite: Removed fragile sub-marker system.
 * Uses direct linear mapping from perspective-corrected image.
 * Uses relative fill detection for robust bubble recognition.
 */

const OMREngine = (() => {

    /**
     * Process an image and extract answers
     * Pipeline: Grayscale → Blur → Threshold → Find Markers → 
     *           Perspective Transform → Direct Coordinate Mapping → Analyze Bubbles
     */
    function process(imageData, config, answerKey, fillThreshold) {
        if (typeof cv === 'undefined') {
            return { success: false, error: 'opencv_not_loaded' };
        }

        const mats = [];
        const track = (mat) => { mats.push(mat); return mat; };

        try {
            const src = track(cv.matFromImageData(imageData));
            
            // Step 1: Min(R,G,B) Grayscale — Preserves colored pen marks
            const gray = track(new cv.Mat());
            const channels = new cv.MatVector();
            cv.split(src, channels);
            const R = channels.get(0);
            const G = channels.get(1);
            const B = channels.get(2);
            const minRG = track(new cv.Mat());
            cv.min(R, G, minRG);
            cv.min(minRG, B, gray);
            R.delete(); G.delete(); B.delete(); channels.delete();

            // Step 2: Gaussian Blur
            const blurred = track(new cv.Mat());
            cv.GaussianBlur(gray, blurred, new cv.Size(
                CONSTANTS.GAUSSIAN_BLUR_SIZE, 
                CONSTANTS.GAUSSIAN_BLUR_SIZE
            ), 0);

            // Step 3: Adaptive Threshold for marker detection
            const thresh = track(new cv.Mat());
            cv.adaptiveThreshold(
                blurred, thresh, 255,
                cv.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv.THRESH_BINARY_INV,
                CONSTANTS.ADAPTIVE_THRESH_BLOCK,
                CONSTANTS.ADAPTIVE_THRESH_C
            );

            // Step 4: Find Corner Markers
            const markers = findCornerMarkers(thresh, src.cols, src.rows);
            
            if (markers.length < 4) {
                return { 
                    success: false, 
                    error: 'no_markers',
                    markersFound: markers.length 
                };
            }

            // Step 5: Perspective Transform on GRAYSCALE image
            const ordered = MathUtils.orderPoints(markers);
            const warped = track(perspectiveTransform(gray, ordered));
            
            // Step 6: Re-threshold the warped image with tuned parameters
            // Use a larger block size for better handling of uneven lighting
            const warpedBlurred = track(new cv.Mat());
            cv.GaussianBlur(warped, warpedBlurred, new cv.Size(3, 3), 0);
            
            const warpedThresh = track(new cv.Mat());
            cv.adaptiveThreshold(
                warpedBlurred, warpedThresh, 255,
                cv.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv.THRESH_BINARY_INV,
                15, // Larger block for more stable threshold on warped image
                4   // Slightly higher C to reduce noise on printed circle outlines
            );

            if (!config) {
                return { success: false, error: 'no_config' };
            }

            // Step 7: Calculate layout (direct A4 mm → pixel mapping)
            const layout = calculateLayout(config, warped.cols, warped.rows);
            
            console.log(`[OMR] Warped: ${warped.cols}x${warped.rows}px, sX=${layout.sX.toFixed(2)} sY=${layout.sY.toFixed(2)} px/mm`);
            console.log(`[OMR] SID origin: (${layout.sidStartX.toFixed(1)}, ${layout.sidStartY.toFixed(1)})mm → pixel (${layout.toX(layout.sidStartX).toFixed(0)}, ${layout.toY(layout.sidStartY).toFixed(0)})`);
            console.log(`[OMR] Q1 origin: qStartY=${layout.qStartY.toFixed(1)}mm → pixel ${layout.toY(layout.qStartY).toFixed(0)}`);

            // Step 8: Extract Student ID and Exam Code using DIRECT mapping
            const studentId = extractBubbleGrid(warpedThresh, 
                layout.sidStartX, layout.sidStartY, 
                config.studentIdDigits || CONSTANTS.STUDENT_ID_DIGITS, 
                10, fillThreshold, layout);
            
            const hasEC = config.hasExamCodeSection !== false;
            const ecDigits = hasEC ? (config.examCodeDigits || CONSTANTS.EXAM_CODE_DIGITS) : 0;
            const examCode = ecDigits > 0
                ? extractBubbleGrid(warpedThresh, 
                    layout.sidStartX + (config.studentIdDigits || CONSTANTS.STUDENT_ID_DIGITS) * CONSTANTS.BUBBLE_SPACING_X_MM + 25, 
                    layout.sidStartY,
                    ecDigits, 10, fillThreshold, layout)
                : '';

            console.log(`[OMR] SBD="${studentId}" Code="${examCode}"`);

            // Step 9: Analyze Answer Bubbles with RELATIVE detection
            const { answers, details } = analyzeAnswers(
                warpedThresh, config, fillThreshold, layout
            );

            // Step 10: Grade
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
                    status = 'wrong';
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
            mats.forEach(mat => {
                try { mat.delete(); } catch (e) { /* already deleted */ }
            });
        }
    }

    /**
     * Calculate layout regions matching SheetRenderer.generatePDF() EXACTLY.
     * 
     * After perspective transform:
     *   warped(0,0) = A4 coordinate (margin+markerSize/2, margin+markerSize/2) = (16,16)mm
     *   warped(W,H) = A4 coordinate (pageW-16, pageH-16)mm
     * 
     * Direct linear mapping: px = (a4mm - origin) * imgSize / span
     */
    function calculateLayout(config, imgW, imgH) {
        const C = CONSTANTS;

        // Warped ↔ A4 coordinate mapping
        const m = C.SAFE_MARGIN_MM;           // 10mm
        const ms = C.MARKER_SIZE_MM;          // 12mm
        const originX = m + ms / 2;           // 16mm — TL marker center X on A4
        const originY = m + ms / 2;           // 16mm — TL marker center Y on A4
        const spanX = C.A4_WIDTH_MM - 2 * originX;   // 178mm
        const spanY = C.A4_HEIGHT_MM - 2 * originY;  // 265mm

        const sX = imgW / spanX;  // pixels per mm (horizontal)
        const sY = imgH / spanY;  // pixels per mm (vertical)

        // Convert A4 absolute position (mm from paper edge) → warped pixel
        const toX = (a4mm) => (a4mm - originX) * sX;
        const toY = (a4mm) => (a4mm - originY) * sY;

        // ═══════════════════════════════════════════════════════════════
        // Replicate SheetRenderer.generatePDF() layout EXACTLY.
        // ALL positions below are in A4 mm from paper top-left edge.
        // ═══════════════════════════════════════════════════════════════

        let currentY = m + ms + 5; // 27mm

        // Header text
        const headerLines = (config.headerText || '').split('\n').filter(l => l.trim());
        if (headerLines.length > 0) {
            currentY += headerLines.length * 6; // 6mm per header line
        }
        currentY += 3; // gap after header

        // Info fields (Name, Class, DOB)
        if (config.hasInfoFields !== false) {
            let infoY = currentY;
            if (config.logoBase64) {
                const logoBottom = m + ms + 18 + 5;
                if (infoY < logoBottom) infoY = logoBottom;
            }
            infoY += 8;
            currentY = infoY + 10;
        }

        // Student ID (SBD) Section
        const sidDigits = config.studentIdDigits || C.STUDENT_ID_DIGITS;
        const ecDigits = config.examCodeDigits || C.EXAM_CODE_DIGITS;
        const hasEC = config.hasExamCodeSection !== false;
        const safeEc = hasEC ? (isNaN(ecDigits) ? 0 : ecDigits) : 0;
        const safeSid = isNaN(config.studentIdDigits) ? C.STUDENT_ID_DIGITS : config.studentIdDigits;

        const usableW = C.A4_WIDTH_MM - 2 * m - 2 * ms; // 166mm
        const totalIdBlock = (safeSid * C.BUBBLE_SPACING_X_MM) +
            (safeEc > 0 ? 25 + safeEc * C.BUBBLE_SPACING_X_MM : 0);

        let startXOff = (usableW - totalIdBlock) / 2;
        if (isNaN(startXOff) || startXOff < 0) startXOff = 0;

        const sidStartX = m + ms + startXOff;
        const sidStartY = currentY + 10;

        // Separator
        const sepY = sidStartY + 10 * C.BUBBLE_SPACING_Y_MM + 8;

        // Questions Grid
        const qStartY = sepY + 10;
        const columns = config.columns || C.DEFAULT_COLUMNS;
        const questionsPerCol = Math.ceil(config.questionCount / columns);
        const colWidthMM = usableW / columns;

        // Adaptive bubble spacing X (same as SheetRenderer.calcBubbleSpacingX)
        const qNumArea = 12, rightPad = 3;
        const availBub = colWidthMM - qNumArea - rightPad;
        const idealSp = availBub / config.optionCount;
        const minSp = C.BUBBLE_DIAMETER_MM + 1;
        const bubbleSpX = Math.max(minSp, Math.min(idealSp, C.BUBBLE_SPACING_X_MM));

        // Vertical spacing (may compress if too many questions)
        const bottomLim = C.A4_HEIGHT_MM - m - ms - 5;
        const availH = bottomLim - qStartY;
        let spY = C.BUBBLE_SPACING_Y_MM;
        if (questionsPerCol * spY > availH) {
            spY = availH / questionsPerCol;
        }

        const bubbleXOff = 10; // colX + 10 in PDF

        return {
            qStartY, questionsPerCol, columns, colWidthMM,
            bubbleSpX, spY, bubbleXOff,
            m, ms, toX, toY, sX, sY,
            sidStartX, sidStartY,
            imgW, imgH,
        };
    }

    /**
     * Find 4 corner markers in the thresholded image.
     */
    function findCornerMarkers(thresh, imgWidth, imgHeight) {
        const contours = new cv.MatVector();
        const hierarchy = new cv.Mat();
        let morphed = null;

        try {
            morphed = new cv.Mat();
            const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
            cv.morphologyEx(thresh, morphed, cv.MORPH_CLOSE, kernel);
            kernel.delete();

            cv.findContours(morphed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

            const imgArea = imgWidth * imgHeight;
            const minArea = imgArea * CONSTANTS.MIN_MARKER_AREA_RATIO;
            const maxArea = imgArea * CONSTANTS.MAX_MARKER_AREA_RATIO;
            const aspectTol = CONSTANTS.MARKER_ASPECT_RATIO_TOL;

            const candidates = [];

            for (let i = 0; i < contours.size(); i++) {
                const contour = contours.get(i);
                const area = cv.contourArea(contour);
                if (area < minArea || area > maxArea) continue;

                const rect = cv.boundingRect(contour);
                const aspect = MathUtils.aspectRatio(rect.width, rect.height);
                if (aspect < (1 - aspectTol)) continue;

                const solidity = area / (rect.width * rect.height);
                if (solidity < 0.4) continue;

                const cx = rect.x + rect.width / 2;
                const cy = rect.y + rect.height / 2;

                candidates.push({ x: cx, y: cy, area, aspect, solidity, rect });
            }

            console.log(`[OMR] Found ${candidates.length} marker candidates (area ${minArea.toFixed(0)}-${maxArea.toFixed(0)}, img ${imgWidth}×${imgHeight})`);

            if (candidates.length < 4) {
                const fallbackMin = imgArea * 0.00005;
                const fallbackMax = imgArea * 0.15;
                
                const relaxedCandidates = [];
                for (let i = 0; i < contours.size(); i++) {
                    const contour = contours.get(i);
                    const area = cv.contourArea(contour);
                    if (area < fallbackMin || area > fallbackMax) continue;
                    
                    const rect = cv.boundingRect(contour);
                    const aspect = MathUtils.aspectRatio(rect.width, rect.height);
                    if (aspect < 0.35) continue;
                    
                    const solidity = area / (rect.width * rect.height);
                    if (solidity < 0.3) continue;
                    
                    relaxedCandidates.push({
                        x: rect.x + rect.width / 2,
                        y: rect.y + rect.height / 2,
                        area, aspect, solidity, rect,
                    });
                }
                
                console.log(`[OMR] Fallback: ${relaxedCandidates.length} relaxed candidates`);
                if (relaxedCandidates.length >= 4) {
                    return pickBestFourCorners(relaxedCandidates, imgWidth, imgHeight);
                }
                return relaxedCandidates.slice(0, 4);
            }

            return pickBestFourCorners(candidates, imgWidth, imgHeight);

        } finally {
            contours.delete();
            hierarchy.delete();
            if (morphed) morphed.delete();
        }
    }

    /**
     * From a list of candidates, pick the 4 that best match the 4 corners.
     */
    function pickBestFourCorners(candidates, imgWidth, imgHeight) {
        const corners = [
            { x: 0, y: 0, label: 'TL' },
            { x: imgWidth, y: 0, label: 'TR' },
            { x: 0, y: imgHeight, label: 'BL' },
            { x: imgWidth, y: imgHeight, label: 'BR' },
        ];

        const selected = [];
        const used = new Set();

        for (const corner of corners) {
            let bestIdx = -1;
            let bestDist = Infinity;

            for (let i = 0; i < candidates.length; i++) {
                if (used.has(i)) continue;
                const dx = (candidates[i].x - corner.x) / imgWidth;
                const dy = (candidates[i].y - corner.y) / imgHeight;
                const dist = Math.sqrt(dx * dx + dy * dy);
                
                if (dist < bestDist && dist < 0.4) {
                    bestDist = dist;
                    bestIdx = i;
                }
            }

            if (bestIdx >= 0) {
                selected.push(candidates[bestIdx]);
                used.add(bestIdx);
                console.log(`[OMR] ${corner.label} marker: (${candidates[bestIdx].x.toFixed(0)}, ${candidates[bestIdx].y.toFixed(0)}) area=${candidates[bestIdx].area.toFixed(0)} aspect=${candidates[bestIdx].aspect.toFixed(2)} dist=${bestDist.toFixed(3)}`);
            } else {
                console.warn(`[OMR] No candidate found near ${corner.label} corner`);
            }
        }

        return selected;
    }

    /**
     * Apply perspective transform to get a top-down view
     */
    function perspectiveTransform(srcGray, orderedPoints) {
        const [tl, tr, br, bl] = orderedPoints;

        const widthTop = MathUtils.distance(tl, tr);
        const widthBottom = MathUtils.distance(bl, br);
        const maxWidth = Math.round(Math.max(widthTop, widthBottom));

        // Force proper aspect ratio based on A4 template
        const m = CONSTANTS.SAFE_MARGIN_MM;
        const ms = CONSTANTS.MARKER_SIZE_MM;
        const originX = m + ms / 2;
        const originY = m + ms / 2;
        const spanX = CONSTANTS.A4_WIDTH_MM - 2 * originX;
        const spanY = CONSTANTS.A4_HEIGHT_MM - 2 * originY;
        const maxHeight = Math.round(maxWidth * spanY / spanX);

        const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
            tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y
        ]);
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
     * Sample a single bubble and return its fill ratio.
     * Uses a circular-ish sample centered on the expected bubble position.
     * 
     * @param {cv.Mat} warpedThresh - Binary threshold image
     * @param {number} cx_A4 - Bubble center X in A4 mm
     * @param {number} cy_A4 - Bubble center Y in A4 mm
     * @param {Object} layout - Layout with toX, toY, sX
     * @returns {number} Fill ratio 0-1
     */
    function sampleBubble(warpedThresh, cx_A4, cy_A4, layout) {
        const px = layout.toX(cx_A4);
        const py = layout.toY(cy_A4);
        
        // Sample size = 70% of bubble diameter (sample the INNER core, not the outline)
        // This is KEY: by sampling only the inner 70%, we avoid picking up the printed
        // circle outline, which would cause false positives.
        const bubbleRPx = (CONSTANTS.BUBBLE_DIAMETER_MM / 2) * layout.sX;
        const sampleSize = Math.max(3, Math.round(bubbleRPx * 1.2)); // Inner core sample
        
        const bx = MathUtils.clamp(Math.round(px - sampleSize / 2), 0, layout.imgW - sampleSize);
        const by = MathUtils.clamp(Math.round(py - sampleSize / 2), 0, layout.imgH - sampleSize);
        const bw = Math.min(sampleSize, layout.imgW - bx);
        const bh = Math.min(sampleSize, layout.imgH - by);
        
        if (bw < 2 || bh < 2) return 0;

        try {
            const roi = warpedThresh.roi(new cv.Rect(bx, by, bw, bh));
            const nonZero = cv.countNonZero(roi);
            const fill = nonZero / (bw * bh);
            roi.delete();
            return fill;
        } catch (e) {
            return 0;
        }
    }

    /**
     * Extract digits from a bubble grid (SBD or Exam Code) using DIRECT mapping.
     * For each digit column, finds the row with highest fill if above threshold.
     * Uses relative detection: the winning row must be clearly dominant.
     */
    function extractBubbleGrid(warpedThresh, startX_A4, startY_A4, digitCount, valuesPerDigit, threshold, layout) {
        let digits = '';
        const C = CONSTANTS;

        for (let d = 0; d < digitCount; d++) {
            const cx_A4 = startX_A4 + d * C.BUBBLE_SPACING_X_MM;
            const fills = [];

            for (let v = 0; v < valuesPerDigit; v++) {
                const cy_A4 = startY_A4 + v * C.BUBBLE_SPACING_Y_MM;
                const fill = sampleBubble(warpedThresh, cx_A4, cy_A4, layout);
                fills.push({ value: v, fill });
            }

            // Sort by fill descending
            const sorted = [...fills].sort((a, b) => b.fill - a.fill);
            const best = sorted[0];
            const second = sorted[1];

            // Debug: log digit fills for first 2 digits
            if (d < 2) {
                console.log(`[OMR] SID digit ${d}: best=${best.value}(${best.fill.toFixed(2)}) second=${second.value}(${second.fill.toFixed(2)}) threshold=${threshold}`);
            }

            // Relative detection: best must be above threshold AND clearly dominant
            if (best.fill >= threshold && best.fill > second.fill * 1.8) {
                digits += String(best.value);
            } else if (best.fill >= threshold * 0.8 && best.fill > second.fill * 2.5) {
                // Relaxed: if clearly dominant even at slightly below threshold
                digits += String(best.value);
            } else {
                digits += '?';
            }
        }

        return digits.replace(/\?/g, '');
    }

    /**
     * Analyze answer bubbles using DIRECT A4→pixel coordinate mapping.
     * Uses both absolute threshold AND relative comparison for robust detection.
     */
    function analyzeAnswers(warpedThresh, config, fillThreshold, layout) {
        const answers = {};
        const details = {};
        const C = CONSTANTS;

        for (let q = 1; q <= config.questionCount; q++) {
            const col = Math.floor((q - 1) / layout.questionsPerCol);
            const row = (q - 1) % layout.questionsPerCol;

            // A4 mm coordinates (matching SheetRenderer.generatePDF exactly)
            const colX_A4 = layout.m + layout.ms + C.MARKER_TO_CONTENT_MM + col * layout.colWidthMM;
            const bubStartX_A4 = colX_A4 + layout.bubbleXOff;
            const qY_A4 = layout.qStartY + row * layout.spY;

            const fills = [];
            for (let opt = 0; opt < config.optionCount; opt++) {
                const cx_A4 = bubStartX_A4 + opt * layout.bubbleSpX;
                const cy_A4 = qY_A4;
                const fill = sampleBubble(warpedThresh, cx_A4, cy_A4, layout);
                fills.push({ option: C.OPTION_LABELS[opt], fill });
            }

            // Debug: log first 5 questions and every 10th
            if (q <= 5 || q % 10 === 0) {
                console.log(`[OMR] Q${q}: ${fills.map(f => f.option + ':' + f.fill.toFixed(2)).join(' ')} (thr=${fillThreshold})`);
            }

            // ═══════════════════════════════════════════════════════════
            // ROBUST BUBBLE DETECTION using both absolute and relative checks
            // ═══════════════════════════════════════════════════════════
            
            // Sort fills descending
            const sorted = [...fills].sort((a, b) => b.fill - a.fill);
            const maxFill = sorted[0].fill;
            const secondFill = sorted[1].fill;
            
            // Calculate baseline: median of all fills (represents "unfilled" level)
            const allFills = fills.map(f => f.fill).sort((a, b) => a - b);
            const medianFill = allFills[Math.floor(allFills.length / 2)];
            
            // Method 1: Absolute threshold (traditional)
            const markedAbsolute = fills.filter(f => f.fill >= fillThreshold);
            
            // Method 2: Relative detection
            // A bubble is "marked" if it stands out significantly from the rest
            const dominanceRatio = secondFill > 0.001 ? maxFill / secondFill : 999;
            const liftAboveMedian = maxFill - medianFill;
            
            // Decision logic:
            if (markedAbsolute.length === 1) {
                // Clear single mark — trust it
                answers[q] = markedAbsolute[0].option;
            } else if (markedAbsolute.length === 0) {
                // Nothing above absolute threshold — try relative detection
                // If one bubble is clearly dominant (3x the second) and has significant lift
                if (dominanceRatio >= 3.0 && liftAboveMedian >= 0.10 && maxFill >= fillThreshold * 0.6) {
                    answers[q] = sorted[0].option;
                } else {
                    answers[q] = C.ANSWER_STATUS.BLANK;
                }
            } else if (markedAbsolute.length >= 2) {
                // Multiple above threshold — but check if one is clearly dominant
                if (dominanceRatio >= 2.0 && sorted[0].fill >= fillThreshold) {
                    // One is much higher than the rest — likely just noise on others
                    answers[q] = sorted[0].option;
                } else {
                    // Genuinely multiple marks
                    answers[q] = C.ANSWER_STATUS.MULTI;
                }
            }

            details[q] = {
                fills,
                markedCount: markedAbsolute.length,
                confidence: maxFill,
            };
        }

        return { answers, details };
    }

    // Register as grading strategy
    if (typeof Extensibility !== 'undefined') {
        Extensibility.registerGradingStrategy(CONSTANTS.GRADING_MODES.OMR, {
            name: 'OMR (Optical Mark Recognition)',
            process,
        });
    }

    /**
     * Fast marker detection for live preview.
     */
    function detectMarkersFast(imageData) {
        if (typeof cv === 'undefined') return 0;

        const mats = [];
        const track = (mat) => { mats.push(mat); return mat; };

        try {
            const src = track(cv.matFromImageData(imageData));
            const gray = track(new cv.Mat());
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

            const blurred = track(new cv.Mat());
            cv.GaussianBlur(gray, blurred, new cv.Size(
                CONSTANTS.GAUSSIAN_BLUR_SIZE, 
                CONSTANTS.GAUSSIAN_BLUR_SIZE
            ), 0);

            const thresh = track(new cv.Mat());
            cv.adaptiveThreshold(
                blurred, thresh, 255,
                cv.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv.THRESH_BINARY_INV,
                CONSTANTS.ADAPTIVE_THRESH_BLOCK,
                CONSTANTS.ADAPTIVE_THRESH_C
            );

            const origLog = console.log;
            console.log = () => {};
            const markers = findCornerMarkers(thresh, src.cols, src.rows);
            console.log = origLog;

            return markers ? markers.length : 0;
        } catch (e) {
            return 0;
        } finally {
            mats.forEach(m => m.delete());
        }
    }

    return {
        process,
        detectMarkersFast,
    };
})();

if (typeof window !== 'undefined') {
    window.OMREngine = OMREngine;
}
