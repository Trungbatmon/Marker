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

            // Calculate layout parameters based on the same logic as SheetRenderer
            const layout = calculateLayout(config, warped.cols, warped.rows);

            // Step 6-7: Extract Student ID and Exam Code
            const studentId = extractBubbleRegion(warpedThresh, 
                layout.sidRegion, 
                config.studentIdDigits || CONSTANTS.STUDENT_ID_DIGITS, 10, fillThreshold);
            
            const examCode = (config.examCodeDigits) 
                ? extractBubbleRegion(warpedThresh, 
                    layout.ecRegion, 
                    config.examCodeDigits || CONSTANTS.EXAM_CODE_DIGITS, 10, fillThreshold)
                : '';

            // Step 8: Analyze Answer Bubbles
            const { answers, details } = analyzeAnswers(
                warpedThresh, config, warped.cols, warped.rows, fillThreshold, layout
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
     * Calculate layout regions matching SheetRenderer's exact output.
     * This ensures OMR reads from the same positions as rendered.
     */
    function calculateLayout(config, imgW, imgH) {
        const C = CONSTANTS;
        
        // The warped image represents the content between the 4 corner markers.
        // In SheetRenderer, markers are at: 
        //   margin + markerSize from edge
        // The warped image spans from marker center to marker center,
        // so we need to account for the content area between markers.

        // After perspective transform, the warped image IS the content between markers.
        // We need to map SheetRenderer's layout (in mm) to pixel coordinates in the warped image.
        
        // Content area in mm (the area between corner marker CENTERS)
        // After perspective transform, warped image spans from TL marker center to BR marker center
        // Marker centers are at (margin + markerSize/2) from paper edge
        // So the warped content is from center-to-center
        const contentW_MM = C.A4_WIDTH_MM - 2 * (C.SAFE_MARGIN_MM + C.MARKER_SIZE_MM / 2);
        const contentH_MM = C.A4_HEIGHT_MM - 2 * (C.SAFE_MARGIN_MM + C.MARKER_SIZE_MM / 2);
        
        const scaleX = imgW / contentW_MM;
        const scaleY = imgH / contentH_MM;
        const s = (mm) => mm * scaleX;
        const sy = (mm) => mm * scaleY;
        
        // Content start offset from warped image origin (i.e., from TL marker center)
        // In the warped image, (0,0) = TL marker center
        // Content starts at markerSize/2 (edge of marker) + gap
        const contentOffsetX = C.MARKER_SIZE_MM / 2 + C.MARKER_TO_CONTENT_MM;
        
        // === Header area ===
        // Header text starts at markerSize/2 + 5mm from top of warped image
        let currentY_MM = C.MARKER_SIZE_MM / 2 + 5;
        
        // Estimate header lines height
        const headerLines = 2; // Assume ~2 lines typical
        currentY_MM += headerLines * 7 + 3;
        
        // Info fields height
        if (config.hasInfoFields !== false) {
            currentY_MM += 8 + 10; // name line + class/DOB line + margin
        }

        // === SBD Section ===
        const sidDigits = config.studentIdDigits || C.STUDENT_ID_DIGITS;
        const ecDigits = config.examCodeDigits || C.EXAM_CODE_DIGITS;
        
        // Usable width between marker inner edges in the warped coordinate system
        // In warped space: total width = contentW_MM, markers extend markerSize/2 from each edge
        const usableW_MM = contentW_MM - 2 * (C.MARKER_SIZE_MM / 2);
        const totalIdBlockWidth_MM = (sidDigits * C.BUBBLE_SPACING_X_MM) + 
            (ecDigits > 0 ? 25 + ecDigits * C.BUBBLE_SPACING_X_MM : 0);
        
        let startXOffset = (usableW_MM - totalIdBlockWidth_MM) / 2;
        if (isNaN(startXOffset) || startXOffset < 0) startXOffset = 0;
        
        // Position relative to warped origin (TL marker center)
        const sidStartX_MM = C.MARKER_SIZE_MM / 2 + startXOffset;
        const sidStartY_MM = currentY_MM + 5;
        
        const sidRegion = {
            x: s(sidStartX_MM - C.BUBBLE_SPACING_X_MM / 2),
            y: sy(sidStartY_MM - C.BUBBLE_SPACING_Y_MM / 2),
            width: s(sidDigits * C.BUBBLE_SPACING_X_MM),
            height: sy(10 * C.BUBBLE_SPACING_Y_MM),
        };
        
        const ecRegion = {
            x: s(sidStartX_MM + sidDigits * C.BUBBLE_SPACING_X_MM + 25 - C.BUBBLE_SPACING_X_MM / 2),
            y: sy(sidStartY_MM - C.BUBBLE_SPACING_Y_MM / 2),
            width: s(ecDigits * C.BUBBLE_SPACING_X_MM),
            height: sy(10 * C.BUBBLE_SPACING_Y_MM),
        };
        
        // === Separator ===
        const separatorY_MM = sidStartY_MM + 10 * C.BUBBLE_SPACING_Y_MM + 8;
        
        // === Questions Grid ===
        const questionsStartY_MM = separatorY_MM + 12;
        const questionsPerCol = Math.ceil(config.questionCount / (config.columns || 3));
        const colWidth_MM = usableW_MM / (config.columns || 3);
        
        // Calculate adaptive bubble spacing (same as SheetRenderer)
        const questionNumArea = 12;
        const rightPadding = 3;
        const availableForBubbles = colWidth_MM - questionNumArea - rightPadding;
        const idealSpacing = availableForBubbles / config.optionCount;
        const minSpacing = C.BUBBLE_DIAMETER_MM + 1;
        const bubbleSpacingX_MM = Math.max(minSpacing, Math.min(idealSpacing, C.BUBBLE_SPACING_X_MM));
        
        // Available height for questions (in warped coordinate space)
        const bottomLimit_MM = contentH_MM - C.MARKER_SIZE_MM / 2 - 5;
        const availableH_MM = bottomLimit_MM - questionsStartY_MM;
        let spacingY_MM = C.BUBBLE_SPACING_Y_MM;
        if (questionsPerCol * spacingY_MM > availableH_MM) {
            spacingY_MM = availableH_MM / questionsPerCol;
        }
        
        return {
            sidRegion,
            ecRegion,
            questionsStartY_MM,
            questionsPerCol,
            colWidth_MM,
            bubbleSpacingX_MM,
            spacingY_MM,
            contentOffsetX,
            scaleX,
            scaleY,
            s,
            sy,
        };
    }

    /**
     * Find 4 corner markers in the thresholded image.
     * Uses morphological operations + multi-criteria filtering.
     */
    function findCornerMarkers(thresh, imgWidth, imgHeight) {
        const contours = new cv.MatVector();
        const hierarchy = new cv.Mat();
        let morphed = null;

        try {
            // Morphological close to fill gaps in markers (ink bleed, low res)
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

                // Must be roughly square-ish
                if (aspect < (1 - aspectTol)) continue;

                // Check solidity (contour area / bounding rect area)
                // Filled squares have high solidity (>0.5 after threshold noise)
                const solidity = area / (rect.width * rect.height);
                if (solidity < 0.4) continue;

                const cx = rect.x + rect.width / 2;
                const cy = rect.y + rect.height / 2;

                candidates.push({
                    x: cx,
                    y: cy,
                    area,
                    aspect,
                    solidity,
                    rect,
                });
            }

            console.log(`[OMR] Found ${candidates.length} marker candidates (area ${minArea.toFixed(0)}-${maxArea.toFixed(0)}, img ${imgWidth}×${imgHeight})`);

            if (candidates.length < 4) {
                // Fallback: try with even more relaxed area
                // Maybe markers are very small (far camera) or very large (close)
                const fallbackMin = imgArea * 0.00005;
                const fallbackMax = imgArea * 0.15;
                
                const relaxedCandidates = [];
                for (let i = 0; i < contours.size(); i++) {
                    const contour = contours.get(i);
                    const area = cv.contourArea(contour);
                    if (area < fallbackMin || area > fallbackMax) continue;
                    
                    const rect = cv.boundingRect(contour);
                    const aspect = MathUtils.aspectRatio(rect.width, rect.height);
                    if (aspect < 0.35) continue; // Very relaxed
                    
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

            // Pick the 4 candidates closest to the 4 corners of the image
            return pickBestFourCorners(candidates, imgWidth, imgHeight);

        } finally {
            contours.delete();
            hierarchy.delete();
            if (morphed) morphed.delete();
        }
    }

    /**
     * From a list of candidates, pick the 4 that best match the 4 corners.
     * Each corner gets the candidate closest to it (by normalized distance).
     */
    function pickBestFourCorners(candidates, imgWidth, imgHeight) {
        // Expected corner positions (with some margin inward)
        const corners = [
            { x: 0, y: 0, label: 'TL' },                       // Top-left
            { x: imgWidth, y: 0, label: 'TR' },                 // Top-right
            { x: 0, y: imgHeight, label: 'BL' },                // Bottom-left
            { x: imgWidth, y: imgHeight, label: 'BR' },         // Bottom-right
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
                
                // Must be within 40% of the corner (very generous)
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
     * Analyze answer bubbles using layout-matched coordinates
     */
    function analyzeAnswers(warpedThresh, config, imgW, imgH, fillThreshold, layout) {
        const answers = {};
        const details = {};
        
        const questionsPerCol = layout.questionsPerCol;
        const columns = config.columns || 2;
        
        for (let q = 1; q <= config.questionCount; q++) {
            const col = Math.floor((q - 1) / questionsPerCol);
            const row = (q - 1) % questionsPerCol;
            
            // colStartX_MM should use the layout's origin offset instead of hardcoded values
            // Question number area occupies first 11mm of each column
            const colStartX_MM = layout.contentOffsetX + col * layout.colWidth_MM;
            const bubbleStartX_MM = colStartX_MM + 11; // Same as SheetRenderer: s(11)
            const questionY_MM = layout.questionsStartY_MM + row * layout.spacingY_MM;
            
            const fills = [];
            for (let opt = 0; opt < config.optionCount; opt++) {
                const bubbleCenterX = layout.s(bubbleStartX_MM + opt * layout.bubbleSpacingX_MM);
                const bubbleCenterY = layout.sy(questionY_MM);
                const bubbleR = layout.s(CONSTANTS.BUBBLE_DIAMETER_MM / 2);
                
                // Sample a square region centered on the bubble
                const sampleSize = Math.round(bubbleR * 1.4); // Slightly smaller than full circle
                const bx = MathUtils.clamp(Math.round(bubbleCenterX - sampleSize / 2), 0, imgW - 1);
                const by = MathUtils.clamp(Math.round(bubbleCenterY - sampleSize / 2), 0, imgH - 1);
                const bw = MathUtils.clamp(sampleSize, 1, imgW - bx);
                const bh = MathUtils.clamp(sampleSize, 1, imgH - by);

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

    /**
     * Fast marker detection for live preview.
     * Returns the number of markers found (0-4).
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

            // Suppress console.log for fast loop by patching it temporarily
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
