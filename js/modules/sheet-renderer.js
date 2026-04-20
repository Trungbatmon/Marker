/**
 * Marker — Sheet Renderer Module
 * Renders answer sheets to Canvas (preview) and PDF (export)
 * Rules: R1.1-R1.8 strictly enforced
 */

const SheetRenderer = (() => {

    const C = CONSTANTS;

    /**
     * Calculate the actual bubble spacing needed based on column count and option count.
     * Prevents bubbles from overlapping in narrow columns.
     * @param {number} colWidthMM - Column width in mm
     * @param {number} optionCount - Number of options (4 or 5)
     * @returns {number} Spacing in mm
     */
    function calcBubbleSpacingX(colWidthMM, optionCount) {
        const questionNumArea = 12; // mm reserved for question number
        const rightPadding = 3;    // mm padding on right side of column
        const availableForBubbles = colWidthMM - questionNumArea - rightPadding;
        
        // Calculate ideal spacing: distribute bubbles evenly in available space
        const idealSpacing = availableForBubbles / optionCount;
        
        // Don't exceed the default spacing (8mm), but allow smaller if needed
        // Minimum spacing = bubble diameter + 1mm gap = 6mm
        const minSpacing = C.BUBBLE_DIAMETER_MM + 1;
        const spacing = Math.max(minSpacing, Math.min(idealSpacing, C.BUBBLE_SPACING_X_MM));
        
        return spacing;
    }

    /**
     * Render answer sheet to canvas
     * @param {HTMLCanvasElement} canvas
     * @param {Object} config - Template configuration
     * @param {number} scale - mm to pixel scale factor
     */
    function renderToCanvas(canvas, config, scale) {
        const ctx = canvas.getContext('2d');
        const s = (mm) => mm * scale; // Convert mm to canvas pixels

        // Clear
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.save();

        // ── 1. Corner Markers (R1.1) ──
        ctx.fillStyle = '#000000';
        const markerS = s(C.MARKER_SIZE_MM);
        const margin = s(C.SAFE_MARGIN_MM);

        // Top-left
        ctx.fillRect(margin, margin, markerS, markerS);
        // Top-right
        ctx.fillRect(canvas.width - margin - markerS, margin, markerS, markerS);
        // Bottom-left
        ctx.fillRect(margin, canvas.height - margin - markerS, markerS, markerS);
        // Bottom-right
        ctx.fillRect(canvas.width - margin - markerS, canvas.height - margin - markerS, markerS, markerS);

        // ── 2. Logo, Header Text & Info Fields ──
        const contentStartX = margin + markerS + s(C.MARKER_TO_CONTENT_MM);
        let currentY = margin + markerS + s(5);

        // Logo (Async draw, okay for preview)
        if (config.logoBase64) {
            const img = new Image();
            img.onload = () => {
                ctx.drawImage(img, contentStartX, margin + markerS, s(18), s(18));
            };
            img.src = config.logoBase64;
        }

        // Header Text
        const headerLines = (config.headerText || '').split('\n').filter(l => l.trim());
        ctx.fillStyle = '#000000';
        ctx.textAlign = 'center';
        if (headerLines.length > 0) {
            ctx.font = `bold ${s(5)}px Inter, Arial, sans-serif`;
            headerLines.forEach((line) => {
                ctx.fillText(line, canvas.width / 2, currentY);
                currentY += s(7);
            });
        }

        currentY += s(3);

        // Info Fields
        if (config.hasInfoFields !== false) {
            let infoY = currentY;
            if (config.logoBase64) {
                const logoBottom = margin + markerS + s(18) + s(5);
                if (infoY < logoBottom) infoY = logoBottom;
            }

            ctx.font = `${s(3.5)}px Inter, Arial, sans-serif`;
            ctx.textAlign = 'left';
            ctx.fillStyle = '#000000';
            ctx.lineWidth = s(0.4);

            const isVi = I18n.getLang() === 'vi';
            
            // Name Line
            ctx.fillText(isVi ? 'Họ và tên / Full Name:' : 'Full Name:', contentStartX, infoY);
            ctx.setLineDash([s(1), s(1.5)]);
            ctx.beginPath();
            ctx.moveTo(contentStartX + (isVi ? s(40) : s(20)), infoY);
            ctx.lineTo(contentStartX + s(110), infoY);
            ctx.stroke();

            infoY += s(8);

            // Class & DOB Lines
            ctx.fillText(isVi ? 'Lớp / Class:' : 'Class:', contentStartX, infoY);
            ctx.beginPath();
            ctx.moveTo(contentStartX + (isVi ? s(22) : s(12)), infoY);
            ctx.lineTo(contentStartX + s(50), infoY);
            ctx.stroke();

            ctx.fillText(isVi ? 'Ngày sinh / DOB:' : 'DOB:', contentStartX + s(55), infoY);
            ctx.beginPath();
            ctx.moveTo(contentStartX + (isVi ? s(85) : s(68)), infoY);
            ctx.lineTo(contentStartX + s(110), infoY);
            ctx.stroke();
            
            ctx.setLineDash([]);
            currentY = infoY + s(10);
        }

        // ── 3. Student ID Section ──
        const sidDigits = config.studentIdDigits || C.STUDENT_ID_DIGITS;
        const ecDigits = config.hasExamCodeSection !== false ? (config.examCodeDigits || C.EXAM_CODE_DIGITS) : 0;
        
        const usableW_MM = C.A4_WIDTH_MM - 2 * C.SAFE_MARGIN_MM - 2 * C.MARKER_SIZE_MM;
        const safeEcDigits = isNaN(ecDigits) ? 0 : ecDigits;
        const safeSidDigits = isNaN(sidDigits) ? C.STUDENT_ID_DIGITS : sidDigits;
        const totalIdBlockWidth_MM = (safeSidDigits * C.BUBBLE_SPACING_X_MM) + (safeEcDigits > 0 ? 25 + safeEcDigits * C.BUBBLE_SPACING_X_MM : 0);
        
        let startXOffset = (usableW_MM - totalIdBlockWidth_MM) / 2;
        if (isNaN(startXOffset) || startXOffset < 0) startXOffset = 0;
        
        const sidStartX = margin + markerS + s(startXOffset);
        const sidStartY = currentY + s(5);

        drawBubbleGrid(ctx, {
            label: 'SBD',
            startX: sidStartX,
            startY: sidStartY,
            columns: sidDigits,
            rows: 10,
            values: ['0','1','2','3','4','5','6','7','8','9'],
            scale,
            showColumnHeaders: true,
        });

        // ── 4. Exam Code Section (R1.2 - manual) ──
        if (config.hasExamCodeSection !== false) {
            const ecStartX = sidStartX + (sidDigits * s(C.BUBBLE_SPACING_X_MM)) + s(25);

            drawBubbleGrid(ctx, {
                label: I18n.getLang() === 'vi' ? 'Mã đề' : 'Code',
                startX: ecStartX,
                startY: sidStartY,
                columns: ecDigits,
                rows: 10,
                values: ['0','1','2','3','4','5','6','7','8','9'],
                scale,
                showColumnHeaders: true,
            });
        }

        // ── 4.1. Sub-markers for ID Block ──
        ctx.fillStyle = '#000000';
        const subM = s(C.SUB_MARKER_SIZE_MM || 6);
        const subPad = s(C.SUB_MARKER_PADDING_MM || 3);
        
        // ID block bounding box in px
        const idBoxLeft = sidStartX - subPad - subM;
        const idBoxTop = sidStartY - subPad - subM;
        const totalIdBlockPx = (safeSidDigits * s(C.BUBBLE_SPACING_X_MM)) + (safeEcDigits > 0 ? s(25) + safeEcDigits * s(C.BUBBLE_SPACING_X_MM) : 0);
        const idBoxRight = sidStartX + totalIdBlockPx + subPad;
        const idBoxBottom = sidStartY + (9 * s(C.BUBBLE_SPACING_Y_MM)) + subPad;
        
        ctx.fillRect(idBoxLeft, idBoxTop, subM, subM);
        ctx.fillRect(idBoxRight, idBoxTop, subM, subM);
        ctx.fillRect(idBoxLeft, idBoxBottom, subM, subM);
        ctx.fillRect(idBoxRight, idBoxBottom, subM, subM);

        // ── 5. Separator Line (solid black — OMR landmark) ──
        const separatorY = sidStartY + (10 * s(C.BUBBLE_SPACING_Y_MM)) + s(8);
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = s(0.8);
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(margin + markerS, separatorY);
        ctx.lineTo(canvas.width - margin - markerS, separatorY);
        ctx.stroke();

        // ── R1.8: Detachable ID zone marker (future) ──
        if (config.detachableId) {
            ctx.strokeStyle = '#CC0000';
            ctx.lineWidth = s(0.5);
            ctx.setLineDash([s(3), s(1)]);
            ctx.beginPath();
            ctx.moveTo(0, separatorY);
            ctx.lineTo(canvas.width, separatorY);
            ctx.stroke();
            ctx.setLineDash([]);
            // Scissors icon placeholder
            ctx.font = `${s(4)}px Arial`;
            ctx.fillStyle = '#CC0000';
            ctx.textAlign = 'left';
            ctx.fillText('✂', s(3), separatorY + s(1));
        }

        // ── 6. Questions Grid ──
        const questionsStartY = separatorY + s(12);
        const questionsPerCol = Math.ceil(config.questionCount / config.columns);
        
        // Calculate usable width for question columns (between markers)
        const contentUsableW = canvas.width - 2 * margin - 2 * markerS;
        const colWidth = contentUsableW / config.columns;
        const colWidthMM = (C.A4_WIDTH_MM - 2 * C.SAFE_MARGIN_MM - 2 * C.MARKER_SIZE_MM) / config.columns;

        // Calculate adaptive bubble spacing based on column width
        const bubbleSpacingXMM = calcBubbleSpacingX(colWidthMM, config.optionCount);

        const availableH = canvas.height - questionsStartY - margin - markerS - s(5);
        let spacingY = s(C.BUBBLE_SPACING_Y_MM);
        if (questionsPerCol * spacingY > availableH) {
            spacingY = availableH / questionsPerCol;
        }

        // Draw column separator lines (solid dark — OMR landmark)
        if (config.columns > 1) {
            ctx.strokeStyle = '#333333';
            ctx.lineWidth = s(0.5);
            ctx.setLineDash([]);
            for (let col = 1; col < config.columns; col++) {
                const sepX = margin + markerS + col * colWidth;
                ctx.beginPath();
                ctx.moveTo(sepX, questionsStartY - s(5));
                ctx.lineTo(sepX, canvas.height - margin - markerS);
                ctx.stroke();
            }
        }

        for (let col = 0; col < config.columns; col++) {
            const colStartX = margin + markerS + s(C.MARKER_TO_CONTENT_MM) + (col * colWidth);

            for (let row = 0; row < questionsPerCol; row++) {
                const qNum = col * questionsPerCol + row + 1;
                if (qNum > config.questionCount) break;

                const y = questionsStartY + (row * spacingY);

                // Timing mark (R1.6) — only for first column
                if (col === 0) {
                    ctx.fillStyle = '#000000';
                    ctx.fillRect(
                        margin + markerS + s(2),
                        y - s(C.TIMING_MARK_H_MM / 2),
                        s(C.TIMING_MARK_W_MM),
                        s(C.TIMING_MARK_H_MM)
                    );
                }

                // Question number
                ctx.fillStyle = '#000000';
                ctx.font = `bold ${s(3)}px Inter, Arial, sans-serif`;
                ctx.textAlign = 'right';
                ctx.fillText(String(qNum), colStartX + s(8), y + s(1.5));

                // Bubbles — use adaptive spacing
                const bubbleStartX = colStartX + s(11);
                for (let opt = 0; opt < config.optionCount; opt++) {
                    const bx = bubbleStartX + (opt * s(bubbleSpacingXMM));
                    const by = y;
                    const radius = s(C.BUBBLE_DIAMETER_MM / 2);

                    // Draw bubble circle
                    ctx.beginPath();
                    ctx.arc(bx, by, radius, 0, Math.PI * 2);
                    ctx.strokeStyle = '#000000';
                    ctx.lineWidth = s(0.5);
                    ctx.stroke();

                    // Option label inside/above bubble
                    ctx.fillStyle = '#111111';
                    ctx.font = `bold ${s(2.5)}px Inter, Arial, sans-serif`;
                    ctx.textAlign = 'center';
                    ctx.fillText(C.OPTION_LABELS[opt], bx, by + s(1));
                }
            }
            }
        }

        // ── 6.1 Sub-markers for Questions Block ──
        ctx.fillStyle = '#000000';
        const qBoxTop = questionsStartY - subPad - subM;
        const qBoxBottom = questionsStartY + ((questionsPerCol - 1) * spacingY) + subPad;
        const qBoxLeft = margin + markerS + s(C.MARKER_TO_CONTENT_MM) - subPad - subM;
        
        const lastColStartX = margin + markerS + s(C.MARKER_TO_CONTENT_MM) + ((config.columns - 1) * colWidth) + s(10);
        const lastColEndX = lastColStartX + ((config.optionCount - 1) * s(bubbleSpacingXMM));
        const qBoxRight = lastColEndX + subPad;
        
        ctx.fillRect(qBoxLeft, qBoxTop, subM, subM);
        ctx.fillRect(qBoxRight, qBoxTop, subM, subM);
        ctx.fillRect(qBoxLeft, qBoxBottom, subM, subM);
        ctx.fillRect(qBoxRight, qBoxBottom, subM, subM);

        ctx.restore();
    }

    /**
     * Draw a bubble grid (used for Student ID and Exam Code sections)
     */
    function drawBubbleGrid(ctx, { label, startX, startY, columns, rows, values, scale, showColumnHeaders }) {
        const s = (mm) => mm * scale;

        // Label
        ctx.fillStyle = '#000000';
        ctx.font = `bold ${s(3.5)}px Inter, Arial, sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillText(label, startX, startY - s(3));

        for (let col = 0; col < columns; col++) {
            const cx = startX + (col * s(C.BUBBLE_SPACING_X_MM));

            // Column header (digit position)
            if (showColumnHeaders) {
                ctx.fillStyle = '#666666';
                ctx.font = `${s(2.5)}px Inter, Arial, sans-serif`;
                ctx.textAlign = 'center';
            }

            for (let row = 0; row < rows; row++) {
                const cy = startY + (row * s(C.BUBBLE_SPACING_Y_MM));
                const radius = s(C.BUBBLE_DIAMETER_MM / 2);

                // Bubble
                ctx.beginPath();
                ctx.arc(cx, cy, radius, 0, Math.PI * 2);
                ctx.strokeStyle = '#000000';
                ctx.lineWidth = s(0.5);
                ctx.stroke();

                // Value label
                ctx.fillStyle = '#111111';
                ctx.font = `bold ${s(2.5)}px Inter, Arial, sans-serif`;
                ctx.textAlign = 'center';
                ctx.fillText(values[row], cx, cy + s(1));
            }
        }
    }

    /**
     * Generate PDF using jsPDF
     * @param {Object} config - Template configuration
     */
    function generatePDF(config) {
        const { jsPDF } = window.jspdf || window;
        if (!jsPDF) {
            throw new Error('jsPDF not loaded. Please wait for download.');
        }

        const doc = new jsPDF({
            orientation: config.orientation || 'portrait',
            unit: 'mm',
            format: config.paperSize?.toLowerCase() || 'a4',
        });

        const pageW = C.A4_WIDTH_MM;
        const pageH = C.A4_HEIGHT_MM;

        // ── 1. Corner Markers ──
        doc.setFillColor(0, 0, 0);
        const m = C.SAFE_MARGIN_MM;
        const ms = C.MARKER_SIZE_MM;
        doc.rect(m, m, ms, ms, 'F');
        doc.rect(pageW - m - ms, m, ms, ms, 'F');
        doc.rect(m, pageH - m - ms, ms, ms, 'F');
        doc.rect(pageW - m - ms, pageH - m - ms, ms, ms, 'F');

        // ── 2. Logo, Header Text & Info Fields ──
        const contentStartX = m + ms + C.MARKER_TO_CONTENT_MM;
        let currentY = m + ms + 5;

        // Logo
        if (config.logoBase64) {
            try {
                let format = 'PNG';
                if (config.logoBase64.includes('image/jpeg')) format = 'JPEG';
                doc.addImage(config.logoBase64, format, contentStartX, m + ms, 18, 18);
            } catch(e) { console.warn('Could not add logo', e); }
        }

        // Header Text
        const headerLines = (config.headerText || '').split('\n').filter(l => l.trim());
        if (headerLines.length > 0) {
            doc.setFontSize(14);
            doc.setFont(undefined, 'bold');
            headerLines.forEach((line) => {
                doc.text(line, pageW / 2, currentY, { align: 'center' });
                currentY += 6;
            });
        }

        currentY += 3;

        // Info Fields
        if (config.hasInfoFields !== false) {
            let infoY = currentY;
            if (config.logoBase64) {
                const logoBottom = m + ms + 18 + 5;
                if (infoY < logoBottom) infoY = logoBottom;
            }

            doc.setFontSize(10);
            doc.setFont(undefined, 'normal');
            doc.setDrawColor(0);
            doc.setLineWidth(0.4);
            doc.setLineDashPattern([1, 1.5], 0);

            const isVi = I18n.getLang() === 'vi';
            
            // Name Line
            doc.text(isVi ? 'Ho va ten / Full Name:' : 'Full Name:', contentStartX, infoY);
            doc.line(contentStartX + (isVi ? 40 : 20), infoY + 1, contentStartX + 110, infoY + 1);

            infoY += 8;

            // Class & DOB Lines
            doc.text(isVi ? 'Lop / Class:' : 'Class:', contentStartX, infoY);
            doc.line(contentStartX + (isVi ? 22 : 12), infoY + 1, contentStartX + 50, infoY + 1);

            doc.text(isVi ? 'Ngay sinh / DOB:' : 'DOB:', contentStartX + 55, infoY);
            doc.line(contentStartX + (isVi ? 85 : 68), infoY + 1, contentStartX + 110, infoY + 1);
            
            doc.setLineDashPattern([], 0);
            currentY = infoY + 10;
        }

        // ── 3. Student ID ──
        const usableW = pageW - 2 * m - 2 * ms;
        const sidDigits = config.studentIdDigits || C.STUDENT_ID_DIGITS;
        const ecDigits = config.hasExamCodeSection !== false ? (config.examCodeDigits || C.EXAM_CODE_DIGITS) : 0;
        
        const safeEcDigits = isNaN(ecDigits) ? 0 : ecDigits;
        const safeSidDigits = isNaN(sidDigits) ? C.STUDENT_ID_DIGITS : sidDigits;
        const totalIdBlockWidth_MM = (safeSidDigits * C.BUBBLE_SPACING_X_MM) + (safeEcDigits > 0 ? 25 + safeEcDigits * C.BUBBLE_SPACING_X_MM : 0);
        
        let startXOffset = (usableW - totalIdBlockWidth_MM) / 2;
        if (isNaN(startXOffset) || startXOffset < 0) startXOffset = 0;
        
        const sidStartX = m + ms + startXOffset;
        const sidStartY = currentY + 10;

        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        doc.text('SBD', sidStartX, sidStartY - 3);

        doc.setFontSize(7);
        doc.setFont(undefined, 'bold');
        const bubbleR = C.BUBBLE_DIAMETER_MM / 2;

        for (let col = 0; col < sidDigits; col++) {
            const cx = sidStartX + (col * C.BUBBLE_SPACING_X_MM);
            for (let row = 0; row < 10; row++) {
                const cy = sidStartY + (row * C.BUBBLE_SPACING_Y_MM);
                doc.setDrawColor(0);
                doc.setLineWidth(0.5);
                doc.circle(cx, cy, bubbleR, 'S');
                doc.setTextColor(0);
                doc.text(String(row), cx, cy + 1, { align: 'center' });
            }
        }

        // ── 4. Exam Code ──
        if (config.hasExamCodeSection !== false) {
            const ecStartX = sidStartX + (sidDigits * C.BUBBLE_SPACING_X_MM) + 25;

            doc.setFontSize(10);
            doc.setFont(undefined, 'bold');
            doc.text(I18n.getLang() === 'vi' ? 'Ma de' : 'Code', ecStartX, sidStartY - 3);

            doc.setFontSize(7);
            doc.setFont(undefined, 'bold');
            for (let col = 0; col < ecDigits; col++) {
                const cx = ecStartX + (col * C.BUBBLE_SPACING_X_MM);
                for (let row = 0; row < 10; row++) {
                    const cy = sidStartY + (row * C.BUBBLE_SPACING_Y_MM);
                    doc.setDrawColor(0);
                    doc.setLineWidth(0.5);
                    doc.circle(cx, cy, bubbleR, 'S');
                    doc.setTextColor(0);
                    doc.text(String(row), cx, cy + 1, { align: 'center' });
                }
            }
        }

        // ── 4.1. Sub-markers for ID Block ──
        doc.setFillColor(0, 0, 0);
        const subM = C.SUB_MARKER_SIZE_MM || 6;
        const subPad = C.SUB_MARKER_PADDING_MM || 3;
        
        // Define bounding box for ID block
        const idBoxLeft = sidStartX - subPad - subM;
        const idBoxTop = sidStartY - subPad - subM;
        // Total block width starts at sidStartX and ends after ecDigits. BUBBLE_SPACING_X_MM acts as an approx center-to-center string. The actual bubble occupies more.
        const idBoxRight = sidStartX + totalIdBlockWidth_MM + subPad;
        const idBoxBottom = sidStartY + (9 * C.BUBBLE_SPACING_Y_MM) + subPad;
        
        // TL, TR, BL, BR sub-markers
        doc.rect(idBoxLeft, idBoxTop, subM, subM, 'F');
        doc.rect(idBoxRight, idBoxTop, subM, subM, 'F');
        doc.rect(idBoxLeft, idBoxBottom, subM, subM, 'F');
        doc.rect(idBoxRight, idBoxBottom, subM, subM, 'F');

        // ── 5. Separator (solid black — OMR landmark) ──
        const sepY = sidStartY + (10 * C.BUBBLE_SPACING_Y_MM) + 8;
        doc.setDrawColor(0);
        doc.setLineWidth(0.8);
        doc.setLineDashPattern([], 0);
        doc.line(m + ms, sepY, pageW - m - ms, sepY);

        // ── 6. Questions ──
        const qStartY = sepY + 10;
        const questionsPerCol = Math.ceil(config.questionCount / config.columns);
        const colW = usableW / config.columns;
        
        // Calculate adaptive bubble spacing for PDF
        const colWidthMM = usableW / config.columns;
        const bubbleSpacingXMM = calcBubbleSpacingX(colWidthMM, config.optionCount);
        
        const availableH = pageH - qStartY - m - ms - 5;
        let spacingY = C.BUBBLE_SPACING_Y_MM;
        if (questionsPerCol * spacingY > availableH) {
            spacingY = availableH / questionsPerCol;
        }

        doc.setDrawColor(0);
        doc.setFontSize(8);

        // Draw column separator lines (solid dark — OMR landmark)
        if (config.columns > 1) {
            doc.setDrawColor(50);
            doc.setLineWidth(0.5);
            doc.setLineDashPattern([], 0);
            for (let col = 1; col < config.columns; col++) {
                const sepX = m + ms + col * colW;
                doc.line(sepX, qStartY - 5, sepX, pageH - m - ms);
            }
            doc.setDrawColor(0);
        }

        for (let col = 0; col < config.columns; col++) {
            const colX = m + ms + C.MARKER_TO_CONTENT_MM + (col * colW);

            for (let row = 0; row < questionsPerCol; row++) {
                const qNum = col * questionsPerCol + row + 1;
                if (qNum > config.questionCount) break;

                const y = qStartY + (row * spacingY);

                // Timing mark (first column only)
                if (col === 0) {
                    doc.setFillColor(0, 0, 0);
                    doc.rect(
                        m + ms + 2,
                        y - C.TIMING_MARK_H_MM / 2,
                        C.TIMING_MARK_W_MM,
                        C.TIMING_MARK_H_MM,
                        'F'
                    );
                }

                // Question number
                doc.setFontSize(8);
                doc.setFont(undefined, 'bold');
                doc.setTextColor(0);
                doc.text(String(qNum) + '.', colX + 7, y + 1, { align: 'right' });

                // Bubbles — use adaptive spacing
                doc.setDrawColor(0);
                doc.setLineWidth(0.5);
                doc.setFontSize(7);
                doc.setFont(undefined, 'bold');
                const bStartX = colX + 10;
                for (let opt = 0; opt < config.optionCount; opt++) {
                    const bx = bStartX + (opt * bubbleSpacingXMM);
                    doc.circle(bx, y, bubbleR, 'S');
                    doc.setTextColor(0);
                    doc.text(C.OPTION_LABELS[opt], bx, y + 1, { align: 'center' });
                }
            }
        }

        // ── 6.1 Sub-markers for Questions Block ──
        doc.setFillColor(0, 0, 0);
        // Define bounding box for Questions block
        // Top Y
        const qBoxTop = qStartY - subPad - subM;
        // Bottom Y (last row index is questionsPerCol - 1)
        const qBoxBottom = qStartY + ((questionsPerCol - 1) * spacingY) + subPad;
        
        // Left X (first column startX)
        const qBoxLeft = m + ms + C.MARKER_TO_CONTENT_MM - subPad - subM;
        // Right X (last column endX)
        const lastColStartX = m + ms + C.MARKER_TO_CONTENT_MM + ((config.columns - 1) * colW) + 10;
        const lastColEndX = lastColStartX + ((config.optionCount - 1) * bubbleSpacingXMM);
        const qBoxRight = lastColEndX + subPad;
        
        // TL, TR, BL, BR sub-markers
        doc.rect(qBoxLeft, qBoxTop, subM, subM, 'F');
        doc.rect(qBoxRight, qBoxTop, subM, subM, 'F');
        doc.rect(qBoxLeft, qBoxBottom, subM, subM, 'F');
        doc.rect(qBoxRight, qBoxBottom, subM, subM, 'F');

        // Save
        const filename = `AnswerSheet_${config.questionCount}Q_${config.optionCount}Opt.pdf`;
        doc.save(filename);
    }

    return {
        renderToCanvas,
        generatePDF,
    };
})();

if (typeof window !== 'undefined') {
    window.SheetRenderer = SheetRenderer;
}
