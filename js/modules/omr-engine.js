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

            // Calculate layout parameters matching SheetRenderer PDF output exactly
            const layout = calculateLayout(config, warped.cols, warped.rows);

            // Debug: log layout info
            console.log('[OMR] Warped: ' + warped.cols + 'x' + warped.rows + 'px, qStartY_A4=' + layout.qStartY.toFixed(1) + 'mm');

            // Step 6-7: Extract Student ID and Exam Code
            const studentId = extractBubbleRegion(warpedThresh, 
                layout.sidRegion, 
                config.studentIdDigits || CONSTANTS.STUDENT_ID_DIGITS, 10, fillThreshold);
            
            const examCode = (config.examCodeDigits) 
                ? extractBubbleRegion(warpedThresh, 
                    layout.ecRegion, 
                    config.examCodeDigits || CONSTANTS.EXAM_CODE_DIGITS, 10, fillThreshold)
                : '';

            console.log('[OMR] SBD="' + studentId + '" Code="' + examCode + '"');

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
     * Calculate layout regions matching SheetRenderer.generatePDF() EXACTLY.
     * 
     * Key insight: Perspective transform maps the 4 marker CENTERS to
     * the 4 corners of the warped image. So:
     *   warped(0,0) = A4 paper coordinate (margin+markerSize/2, margin+markerSize/2)
     *   warped(W,H) = A4 paper coordinate (pageW-margin-markerSize/2, pageH-margin-markerSize/2)
     * 
     * To convert any A4 absolute position to warped pixel:
     *   px = (a4mm - origin) * imgSize / span
     */
    function calculateLayout(config, imgW, imgH) {
        const C = CONSTANTS;

        // ── Warped ↔ A4 coordinate mapping ──
        const m = C.SAFE_MARGIN_MM;           // 10mm
        const ms = C.MARKER_SIZE_MM;          // 12mm
        const originX = m + ms / 2;           // 16mm — TL marker center X on A4
        const originY = m + ms / 2;           // 16mm — TL marker center Y on A4
        const spanX = C.A4_WIDTH_MM - 2 * originX;   // 178mm (marker-center to marker-center)
        const spanY = C.A4_HEIGHT_MM - 2 * originY;  // 265mm

        const sX = imgW / spanX;  // pixels per mm (horizontal)
        const sY = imgH / spanY;  // pixels per mm (vertical)

        // Convert A4 absolute position (mm from paper edge) → warped pixel
        const toX = (a4mm) => (a4mm - originX) * sX;
        const toY = (a4mm) => (a4mm - originY) * sY;

        // ═══════════════════════════════════════════════════════════════
        // Replicate SheetRenderer.generatePDF() layout EXACTLY.
        // ALL positions below are in A4 mm from paper top-left edge.
        // Reference: sheet-renderer.js generatePDF() lines 344-554
        // ═══════════════════════════════════════════════════════════════

        let currentY = m + ms + 5; // 27mm (PDF line 358)

        // ── Header text ──
        const headerLines = (config.headerText || '').split('\n').filter(l => l.trim());
        if (headerLines.length > 0) {
            currentY += headerLines.length * 6; // PDF: 6mm per header line
        }
        currentY += 3; // gap after header (PDF line 380)

        // ── Info fields (Name, Class, DOB) ──
        if (config.hasInfoFields !== false) {
            let infoY = currentY;
            if (config.logoBase64) {
                const logoBottom = m + ms + 18 + 5;
                if (infoY < logoBottom) infoY = logoBottom;
            }
            infoY += 8;  // after Name line → Class/DOB line (PDF line 402)
            currentY = infoY + 10; // gap after info fields (PDF line 412)
        }

        // ── Student ID (SBD) Section ──
        const sidDigits = config.studentIdDigits || C.STUDENT_ID_DIGITS;
        const ecDigits = config.examCodeDigits || C.EXAM_CODE_DIGITS;
        const hasEC = config.hasExamCodeSection !== false;
        const safeEc = hasEC ? (isNaN(ecDigits) ? 0 : ecDigits) : 0;
        const safeSid = isNaN(sidDigits) ? C.STUDENT_ID_DIGITS : sidDigits;

        // Usable width = space between marker inner edges (PDF line 416)
        const usableW = C.A4_WIDTH_MM - 2 * m - 2 * ms; // 166mm
        const totalIdBlock = (safeSid * C.BUBBLE_SPACING_X_MM) +
            (safeEc > 0 ? 25 + safeEc * C.BUBBLE_SPACING_X_MM : 0);

        let startXOff = (usableW - totalIdBlock) / 2;
        if (isNaN(startXOff) || startXOff < 0) startXOff = 0;

        // SBD grid origin = center of first bubble (col=0, row=0) in A4 mm
        const sidStartX = m + ms + startXOff;   // PDF line 427
        const sidStartY = currentY + 10;         // PDF line 428: +10mm gap before SBD

        // Bounding box for extractBubbleRegion (half-spacing padding)
        const hsx = C.BUBBLE_SPACING_X_MM / 2;
        const hsy = C.BUBBLE_SPACING_Y_MM / 2;

        const sidRegion = {
            x: toX(sidStartX - hsx),
            y: toY(sidStartY - hsy),
            width: safeSid * C.BUBBLE_SPACING_X_MM * sX,
            height: 10 * C.BUBBLE_SPACING_Y_MM * sY,
        };

        // Exam Code grid origin (PDF line 452)
        const ecStartX = sidStartX + safeSid * C.BUBBLE_SPACING_X_MM + 25;
        const ecRegion = {
            x: toX(ecStartX - hsx),
            y: toY(sidStartY - hsy),
            width: safeEc * C.BUBBLE_SPACING_X_MM * sX,
            height: 10 * C.BUBBLE_SPACING_Y_MM * sY,
        };

        // ── Separator ── (PDF line 474)
        const sepY = sidStartY + 10 * C.BUBBLE_SPACING_Y_MM + 8;

        // ── Questions Grid ── (PDF line 481)
        const qStartY = sepY + 10; // +10mm after separator
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

        // Bubble start X offset within each column (PDF line 542: colX + 10)
        const bubbleXOff = 10;

        return {
            sidRegion, ecRegion,
            qStartY, questionsPerCol, columns, colWidthMM,
            bubbleSpX, spY, bubbleXOff,
            m, ms, toX, toY, sX, sY,
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

        // CRITICAL FIX: Force proper aspect ratio scaling based on A4 template!
        // The distance between TL and TR markers horizontally is spanX (178mm)
        // The distance between TL and BL markers vertically is spanY (265mm)
        const m = CONSTANTS.SAFE_MARGIN_MM;
        const ms = CONSTANTS.MARKER_SIZE_MM;
        const originX = m + ms / 2;
        const originY = m + ms / 2;
        const spanX = CONSTANTS.A4_WIDTH_MM - 2 * originX;
        const spanY = CONSTANTS.A4_HEIGHT_MM - 2 * originY;
        
        // Target aspect ratio of the marker bounding box
        const targetAspectRatio = spanX / spanY;
        
        // Instead of relying on pixel height (which suffers from foreshortening when camera is tilted)
        // We force the mathematical height required by the known physical width
        const maxHeight = Math.round(maxWidth / targetAspectRatio);

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
     * Analyze answer bubbles using A4-matched coordinates.
     * Positions match SheetRenderer.generatePDF() exactly.
     */
    function analyzeAnswers(warpedThresh, config, imgW, imgH, fillThreshold, layout) {
        const answers = {};
        const details = {};
        const C = CONSTANTS;

        for (let q = 1; q <= config.questionCount; q++) {
            const col = Math.floor((q - 1) / layout.questionsPerCol);
            const row = (q - 1) % layout.questionsPerCol;

            // A4 coordinates — exactly matching SheetRenderer.generatePDF()
            // PDF line 511: colX = m + ms + MARKER_TO_CONTENT_MM + col * colW
            const colX_A4 = layout.m + layout.ms + C.MARKER_TO_CONTENT_MM + col * layout.colWidthMM;
            // PDF line 542: bStartX = colX + 10
            const bubStartX_A4 = colX_A4 + layout.bubbleXOff;
            // PDF line 517: y = qStartY + row * spacingY
            const qY_A4 = layout.qStartY + row * layout.spY;

            const fills = [];
            for (let opt = 0; opt < config.optionCount; opt++) {
                // PDF line 544: bx = bStartX + opt * bubbleSpacingXMM
                const cx_A4 = bubStartX_A4 + opt * layout.bubbleSpX;
                const cy_A4 = qY_A4;

                // Convert A4mm → warped pixel
                const px = layout.toX(cx_A4);
                const py = layout.toY(cy_A4);
                const bubbleR = (C.BUBBLE_DIAMETER_MM / 2) * layout.sX;

                // Sample square region centered on bubble
                const sampleSize = Math.round(bubbleR * 1.4);
                const bx = MathUtils.clamp(Math.round(px - sampleSize / 2), 0, imgW - 1);
                const by = MathUtils.clamp(Math.round(py - sampleSize / 2), 0, imgH - 1);
                const bw = MathUtils.clamp(sampleSize, 1, imgW - bx);
                const bh = MathUtils.clamp(sampleSize, 1, imgH - by);

                try {
                    const roi = warpedThresh.roi(new cv.Rect(bx, by, bw, bh));
                    const nonZero = cv.countNonZero(roi);
                    const fill = nonZero / (bw * bh);
                    roi.delete();
                    fills.push({ option: C.OPTION_LABELS[opt], fill });
                } catch (e) {
                    fills.push({ option: C.OPTION_LABELS[opt], fill: 0 });
                }
            }

            // Debug: log first 3 questions
            if (q <= 3) {
                console.log(`[OMR] Q${q}: ${fills.map(f => f.option + ':' + f.fill.toFixed(2)).join(' ')} (threshold=${fillThreshold})`);
            }

            // Determine which bubble(s) are marked (R2.2, R2.3, R2.4)
            const marked = fills.filter(f => f.fill >= fillThreshold);
            const maxFill = Math.max(...fills.map(f => f.fill));

            if (marked.length === 0) {
                // R2.4: No bubble marked → BLANK
                answers[q] = C.ANSWER_STATUS.BLANK;
            } else if (marked.length === 1) {
                answers[q] = marked[0].option;
            } else {
                // R2.3: Multiple bubbles marked → MULTI
                answers[q] = C.ANSWER_STATUS.MULTI;
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
