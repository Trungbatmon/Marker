/**
 * Marker — Vision Scanner Module v2
 * Uses OpenAI GPT-4o Vision API to READ answer sheets (OCR only).
 * 
 * Architecture (following the workflow):
 *   1. AI = "Mắt đọc" (Reader) → ONLY reads image → raw JSON
 *   2. Code = "Giám khảo" (Grader) → compares with answer key → scores
 *   3. Validator → sanity checks + optional double-read verification
 * 
 * Context window management:
 *   - Each scan is an INDEPENDENT API call (no accumulated context)
 *   - Prompt is MINIMAL (~500 tokens) to stay well under 60% context limit
 *   - For batch: each image gets its own fresh call
 *   - Response format is strictly structured JSON
 */

const VisionScanner = (() => {

    const LS_KEY_API = 'marker_openai_api_key';
    const LS_KEY_MODE = 'marker_scan_mode'; // 'vision' | 'omr' | 'auto'
    const LS_KEY_VERIFY = 'marker_vision_verify'; // 'none' | 'validate' | 'double'
    const API_URL = 'https://api.openai.com/v1/chat/completions';
    const MODEL = 'gpt-4o';

    // ══════════════════════════════════════════
    // API KEY & MODE MANAGEMENT
    // ══════════════════════════════════════════

    function getAPIKey() { return localStorage.getItem(LS_KEY_API) || ''; }
    function setAPIKey(key) { localStorage.setItem(LS_KEY_API, (key || '').trim()); }
    function hasAPIKey() { return !!getAPIKey(); }
    function getScanMode() { return localStorage.getItem(LS_KEY_MODE) || 'auto'; }
    function setScanMode(mode) { localStorage.setItem(LS_KEY_MODE, mode); }
    function getVerifyMode() { return localStorage.getItem(LS_KEY_VERIFY) || 'validate'; }
    function setVerifyMode(mode) { localStorage.setItem(LS_KEY_VERIFY, mode); }

    // ══════════════════════════════════════════
    // IMAGE → BASE64
    // ══════════════════════════════════════════

    function canvasToBase64(canvas, quality = 0.85) {
        return canvas.toDataURL('image/jpeg', quality).split(',')[1];
    }

    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    // ══════════════════════════════════════════
    // STEP 1: AI = "MẮT ĐỌC" (Reader Only)
    // Prompt is kept MINIMAL to avoid context bloat.
    // AI only READS — no grading, no comparison.
    // ══════════════════════════════════════════

    function buildReadPrompt(config) {
        const qCount = config.questionCount || 50;
        const optCount = config.optionCount || 4;
        const optLabels = CONSTANTS.OPTION_LABELS.slice(0, optCount).join(',');
        const sbdDigits = config.studentIdDigits || CONSTANTS.STUDENT_ID_DIGITS;
        const codeDigits = config.examCodeDigits || CONSTANTS.EXAM_CODE_DIGITS;

        return `You are an expert OMR Scanner API. Read this answer sheet.
Sheet config: ${qCount} questions, options ${optLabels}, SBD ${sbdDigits} digits, Code ${codeDigits} digits.

RULES:
1. SBD/Code: The grid has columns (digits). Top row is 0, bottom is 9. Find the dark filled circle in each column to form the string.
2. Answers: Read question by question (1 to ${qCount}). They are usually organized in vertical columns. Do not skip any question number.
3. Bubble evaluation:
   - One dark filled circle = the letter (e.g., "A").
   - Light marks or empty = "BLANK".
   - Multiple dark marks = "MULTI".

Read carefully. Return ONLY raw JSON without markdown formatting:
{"studentId":"${"x".repeat(sbdDigits)}","examCode":"${"x".repeat(codeDigits)}","answers":{"1":"A","2":"BLANK",...,"${qCount}":"C"},"confidence":0.95}`;
    }

    /**
     * Call API — one independent call per image.
     * No conversation history. No accumulated context.
     */
    async function callReadAPI(base64Image, config) {
        const apiKey = getAPIKey();
        if (!apiKey) throw new Error('Chưa cấu hình API key. Vào Settings → OpenAI API Key.');

        const body = {
            model: MODEL,
            messages: [{
                role: 'user',
                content: [
                    { type: 'text', text: buildReadPrompt(config) },
                    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}`, detail: 'high' } }
                ]
            }],
            max_tokens: 2048,   // Enough for 120 questions, far below context limit
            temperature: 0.05,  // Near-deterministic for consistent reads
        };

        console.log('[Vision] Calling GPT-4o (Reader mode)...');
        const t0 = Date.now();

        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify(body),
        });

        const elapsed = Date.now() - t0;
        console.log(`[Vision] Response in ${elapsed}ms`);

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            const msg = err.error?.message || response.statusText;
            if (response.status === 401) throw new Error('API key không hợp lệ.');
            if (response.status === 429) throw new Error('Rate limit. Thử lại sau.');
            throw new Error(`API ${response.status}: ${msg}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        if (!content) throw new Error('API trả về rỗng');

        // Parse — strip markdown fences if present
        let json = content.trim();
        if (json.startsWith('```')) json = json.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');

        let parsed;
        try { parsed = JSON.parse(json); }
        catch (e) {
            console.error('[Vision] Parse error:', content);
            throw new Error('AI trả về JSON không hợp lệ');
        }

        if (parsed.error) throw new Error(parsed.message || 'AI không đọc được phiếu');

        parsed._usage = data.usage;
        parsed._elapsed = elapsed;
        parsed._inputTokens = data.usage?.prompt_tokens || 0;
        parsed._outputTokens = data.usage?.completion_tokens || 0;
        return parsed;
    }

    // ══════════════════════════════════════════
    // STEP 2: VALIDATOR — Kiểm tra tính hợp lệ
    // ══════════════════════════════════════════

    /**
     * Validate AI output for sanity.
     * Returns { valid, issues[], fixedResult }
     */
    function validateResult(raw, config) {
        const issues = [];
        const qCount = config.questionCount || 50;
        const optCount = config.optionCount || 4;
        const validOptions = CONSTANTS.OPTION_LABELS.slice(0, optCount);
        const sbdDigits = config.studentIdDigits || CONSTANTS.STUDENT_ID_DIGITS;
        const codeDigits = config.examCodeDigits || CONSTANTS.EXAM_CODE_DIGITS;

        // Clone to fix
        const fixed = {
            studentId: raw.studentId || '',
            examCode: raw.examCode || '',
            answers: { ...(raw.answers || {}) },
            confidence: raw.confidence || 0,
            _usage: raw._usage,
            _elapsed: raw._elapsed,
            _inputTokens: raw._inputTokens,
            _outputTokens: raw._outputTokens,
        };

        // ── Check SBD ──
        if (!fixed.studentId || fixed.studentId.length !== sbdDigits) {
            issues.push(`SBD "${fixed.studentId}" không đúng ${sbdDigits} chữ số`);
        } else if (!/^\d+$/.test(fixed.studentId)) {
            issues.push(`SBD "${fixed.studentId}" chứa ký tự không phải số`);
            fixed.studentId = fixed.studentId.replace(/\D/g, '').padStart(sbdDigits, '0');
        }

        // ── Check Exam Code ──
        if (!fixed.examCode || fixed.examCode.length !== codeDigits) {
            issues.push(`Mã đề "${fixed.examCode}" không đúng ${codeDigits} chữ số`);
        }

        // ── Check Answers ──
        let missingCount = 0;
        let invalidCount = 0;
        for (let q = 1; q <= qCount; q++) {
            const key = String(q);
            let ans = fixed.answers[q] || fixed.answers[key];

            if (!ans) {
                missingCount++;
                fixed.answers[q] = 'BLANK';
                continue;
            }

            // Normalize
            ans = String(ans).toUpperCase().trim();
            if (ans === 'BLANK' || ans === 'MULTI') {
                fixed.answers[q] = ans;
            } else if (validOptions.includes(ans)) {
                fixed.answers[q] = ans;
            } else {
                invalidCount++;
                issues.push(`Câu ${q}: "${ans}" không hợp lệ (expected ${validOptions.join('/')})`);
                fixed.answers[q] = 'BLANK'; // Treat invalid as blank
            }

            // Clean up string keys
            if (fixed.answers[key] && key !== String(q)) {
                delete fixed.answers[key];
            }
        }

        if (missingCount > 0) issues.push(`${missingCount} câu thiếu trong kết quả AI`);
        if (invalidCount > 0) issues.push(`${invalidCount} câu có giá trị không hợp lệ`);

        // ── Check confidence ──
        if (fixed.confidence < 0.5) {
            issues.push(`Độ tin cậy thấp: ${Math.round(fixed.confidence * 100)}%`);
        }

        // ── Check for suspicious all-BLANK ──
        const blankCount = Object.values(fixed.answers).filter(a => a === 'BLANK').length;
        if (blankCount > qCount * 0.8) {
            issues.push(`⚠ ${blankCount}/${qCount} câu trống — có thể AI không đọc được phiếu`);
        }

        // ── Check for suspicious all-same-answer ──
        const answerCounts = {};
        Object.values(fixed.answers).forEach(a => { answerCounts[a] = (answerCounts[a] || 0) + 1; });
        const maxSame = Math.max(...Object.values(answerCounts));
        if (maxSame > qCount * 0.6 && blankCount < qCount * 0.5) {
            const dominant = Object.entries(answerCounts).find(([, c]) => c === maxSame)?.[0];
            issues.push(`⚠ ${maxSame}/${qCount} câu đều là "${dominant}" — có thể sai`);
        }

        return {
            valid: issues.length === 0,
            issues,
            fixedResult: fixed,
            severity: issues.some(i => i.startsWith('⚠')) ? 'warning' : (issues.length > 3 ? 'error' : 'info'),
        };
    }

    // ══════════════════════════════════════════
    // STEP 2b: DOUBLE-READ VERIFICATION
    // Send image twice with different prompts.
    // Compare results — flag discrepancies.
    // ══════════════════════════════════════════

    function buildVerifyPrompt(config) {
        const qCount = config.questionCount || 50;
        const optLabels = CONSTANTS.OPTION_LABELS.slice(0, config.optionCount || 4).join(',');

        // Different phrasing to get independent read
        return `Please do a strict validation read of this OMR answer sheet photo.
Look closely at questions 1 to ${qCount} (valid bubbles: ${optLabels}). Follow the columns sequentially.
For SBD and Code grids at the top, read each column index carefully (0-9).
A dark closed circle is a filled bubble. Report the matched letter. If empty, report "BLANK". If >1 bubble is filled, report "MULTI".
Output JSON only (no markdown): {"studentId":"...","examCode":"...","answers":{"1":"A",...},"confidence":0.9}`;
    }

    async function doubleRead(base64Image, config) {
        console.log('[Vision] Double-read verification...');

        // Read 1: standard prompt
        const read1 = await callReadAPI(base64Image, config);

        // Read 2: different prompt phrasing (independent call)
        const apiKey = getAPIKey();
        const body2 = {
            model: MODEL,
            messages: [{
                role: 'user',
                content: [
                    { type: 'text', text: buildVerifyPrompt(config) },
                    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}`, detail: 'high' } }
                ]
            }],
            max_tokens: 2048,
            temperature: 0.1,  // Slightly different temp
        };

        const t0 = Date.now();
        const resp2 = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify(body2),
        });

        if (!resp2.ok) {
            console.warn('[Vision] Second read failed, using first read only');
            return { result: read1, verified: false, discrepancies: [] };
        }

        const data2 = await resp2.json();
        let json2 = (data2.choices?.[0]?.message?.content || '').trim();
        if (json2.startsWith('```')) json2 = json2.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');

        let read2;
        try { read2 = JSON.parse(json2); }
        catch (e) {
            console.warn('[Vision] Second read parse error, using first read only');
            return { result: read1, verified: false, discrepancies: [] };
        }

        const elapsed2 = Date.now() - t0;
        read1._elapsed = (read1._elapsed || 0) + elapsed2;
        read1._doubleRead = true;

        // ── Compare reads ──
        const discrepancies = [];
        const qCount = config.questionCount || 50;

        // Compare SBD
        if (read1.studentId !== read2.studentId) {
            discrepancies.push({ field: 'SBD', read1: read1.studentId, read2: read2.studentId });
        }

        // Compare exam code
        if (read1.examCode !== read2.examCode) {
            discrepancies.push({ field: 'Mã đề', read1: read1.examCode, read2: read2.examCode });
        }

        // Compare each answer
        for (let q = 1; q <= qCount; q++) {
            const a1 = (read1.answers?.[q] || read1.answers?.[String(q)] || 'BLANK').toUpperCase();
            const a2 = (read2.answers?.[q] || read2.answers?.[String(q)] || 'BLANK').toUpperCase();
            if (a1 !== a2) {
                discrepancies.push({ field: `Câu ${q}`, read1: a1, read2: a2 });
            }
        }

        // ── Merge: prefer higher-confidence read, mark conflicts ──
        const merged = { ...read1 };
        if (discrepancies.length > 0) {
            console.log(`[Vision] ${discrepancies.length} discrepancies found:`, discrepancies);

            // For answer discrepancies, prefer the read with higher confidence
            const useRead = (read1.confidence || 0) >= (read2.confidence || 0) ? read1 : read2;
            merged.studentId = useRead.studentId;
            merged.examCode = useRead.examCode;
            merged.answers = { ...(useRead.answers || {}) };
            merged.confidence = Math.min(read1.confidence || 0, read2.confidence || 0);
            merged._discrepancies = discrepancies;
        } else {
            // Both reads agree — high confidence
            merged.confidence = Math.max(read1.confidence || 0, read2.confidence || 0, 0.95);
        }

        return {
            result: merged,
            verified: true,
            discrepancies,
            agreement: qCount > 0 ? ((qCount - discrepancies.filter(d => d.field.startsWith('Câu')).length) / qCount) : 1,
        };
    }

    // ══════════════════════════════════════════
    // STEP 3: CODE = "GIÁM KHẢO" (Grader)
    // Pure JavaScript — no AI involved.
    // ══════════════════════════════════════════

    function gradeResult(readResult, config, answerKeyAnswers) {
        const qCount = config.questionCount || 50;
        const answers = readResult.answers || {};

        let correctCount = 0, wrongCount = 0, blankCount = 0, multiCount = 0;
        const details = [];

        for (let q = 1; q <= qCount; q++) {
            const selected = (answers[q] || answers[String(q)] || 'BLANK').toUpperCase();

            let status = 'unknown';
            if (answerKeyAnswers) {
                const correct = (answerKeyAnswers[q] || answerKeyAnswers[String(q)] || '').toUpperCase();
                if (selected === 'BLANK') { status = 'blank'; blankCount++; }
                else if (selected === 'MULTI') { status = 'multi'; multiCount++; }
                else if (correct && selected === correct) { status = 'correct'; correctCount++; }
                else { status = 'wrong'; wrongCount++; }
            } else {
                if (selected === 'BLANK') blankCount++;
                else if (selected === 'MULTI') multiCount++;
            }

            details.push({
                question: q,
                selected,
                status,
                confidence: readResult.confidence || 0.5,
            });
        }

        return { correctCount, wrongCount, blankCount, multiCount, details };
    }

    // ══════════════════════════════════════════
    // MAIN ENTRY POINT: processImage
    // Flow: Read → Validate → (Optional: Double-read) → Grade
    // ══════════════════════════════════════════

    async function processImage(imageSource, config, answerKeyAnswers) {
        // ── Convert to base64 ──
        let base64;
        if (imageSource instanceof HTMLCanvasElement) {
            base64 = canvasToBase64(imageSource);
        } else if (imageSource instanceof Blob) {
            base64 = await blobToBase64(imageSource);
        } else if (typeof imageSource === 'string') {
            base64 = imageSource.includes(',') ? imageSource.split(',')[1] : imageSource;
        } else {
            throw new Error('Unsupported image source');
        }

        const verifyMode = getVerifyMode();
        let readResult, validationResult, verifyInfo = null;

        // ── STEP 1: AI Reads ──
        if (verifyMode === 'double') {
            // Double-read: two independent calls, compare
            const dr = await doubleRead(base64, config);
            readResult = dr.result;
            verifyInfo = {
                doubleRead: true,
                verified: dr.verified,
                discrepancies: dr.discrepancies,
                agreement: dr.agreement,
            };
        } else {
            // Single read
            readResult = await callReadAPI(base64, config);
        }

        // ── STEP 2: Validate ──
        validationResult = validateResult(readResult, config);
        const finalRead = validationResult.fixedResult;

        // ── STEP 3: Grade (Code Logic, no AI) ──
        const graded = gradeResult(finalRead, config, answerKeyAnswers);

        // ── Build output ──
        return {
            success: true,
            method: 'vision',
            studentId: finalRead.studentId || '',
            examCode: finalRead.examCode || '',
            answers: finalRead.answers,
            details: graded.details,
            correctCount: graded.correctCount,
            wrongCount: graded.wrongCount,
            blankCount: graded.blankCount,
            multiCount: graded.multiCount,
            avgConfidence: finalRead.confidence || 0,
            _usage: finalRead._usage,
            _elapsed: finalRead._elapsed,
            _inputTokens: finalRead._inputTokens,
            _outputTokens: finalRead._outputTokens,
            // Verification metadata
            _validation: {
                valid: validationResult.valid,
                issues: validationResult.issues,
                severity: validationResult.severity,
            },
            _verify: verifyInfo,
        };
    }

    // ══════════════════════════════════════════
    // TEST API KEY
    // ══════════════════════════════════════════

    async function testAPIKey(key) {
        try {
            const resp = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
                body: JSON.stringify({
                    model: MODEL,
                    messages: [{ role: 'user', content: 'Reply: OK' }],
                    max_tokens: 5,
                }),
            });
            if (resp.ok) return { success: true };
            const err = await resp.json().catch(() => ({}));
            return { success: false, error: err.error?.message || `HTTP ${resp.status}` };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    // ══════════════════════════════════════════
    // PUBLIC API
    // ══════════════════════════════════════════

    return {
        processImage,
        getAPIKey, setAPIKey, hasAPIKey,
        getScanMode, setScanMode,
        getVerifyMode, setVerifyMode,
        testAPIKey,
        validateResult,
        gradeResult,
        doubleRead,
    };
})();

if (typeof window !== 'undefined') {
    window.VisionScanner = VisionScanner;
}
