/**
 * Marker — Scanner Module
 * Camera UI and capture flow
 */

const Scanner = (() => {
    let _stream = null;
    let _facingMode = CONSTANTS.CAMERA_FACING.BACK;
    let _flashOn = false;
    let _activeProjectId = null;
    let _activeExamCode = null;
    let _cameraRetryLevel = 0; // Track fallback level

    /**
     * Initialize scanner for a project
     */
    async function activate(projectId, examCode) {
        _activeProjectId = projectId;
        _activeExamCode = examCode;
        await startCamera();
    }

    /**
     * Camera constraint profiles — from highest to lowest quality.
     * Targets: iPhone 16 Pro Max (4K), Poco X8 Pro (4K), modern phones.
     * Will try each level in order until one succeeds.
     */
    function getCameraConstraints(level) {
        switch (level) {
            case 0: // Best: 4K with specific facing mode
                return {
                    video: {
                        facingMode: { exact: _facingMode },
                        width: { ideal: 3840, min: 1920 },
                        height: { ideal: 2160, min: 1080 },
                        frameRate: { ideal: 30, max: 60 },
                    },
                    audio: false,
                };
            case 1: // High: 4K with preferred (not exact) facing mode
                return {
                    video: {
                        facingMode: { ideal: _facingMode },
                        width: { ideal: 3840 },
                        height: { ideal: 2160 },
                        frameRate: { ideal: 30 },
                    },
                    audio: false,
                };
            case 2: // Medium: 1080p with preferred facing mode
                return {
                    video: {
                        facingMode: { ideal: _facingMode },
                        width: { ideal: 1920 },
                        height: { ideal: 1080 },
                    },
                    audio: false,
                };
            case 3: // Low: Just facing mode
                return {
                    video: { facingMode: _facingMode },
                    audio: false,
                };
            case 4: // Fallback: Any camera
                return {
                    video: true,
                    audio: false,
                };
            default:
                return null;
        }
    }

    async function startCamera() {
        try {
            // Stop existing stream
            stopCamera();
            _cameraRetryLevel = 0;

            // Try progressive constraint levels
            let stream = null;
            let usedLevel = -1;

            for (let level = 0; level <= 4; level++) {
                const constraints = getCameraConstraints(level);
                if (!constraints) break;

                try {
                    stream = await navigator.mediaDevices.getUserMedia(constraints);
                    usedLevel = level;
                    console.log(`[Scanner] Camera opened at constraint level ${level}`);
                    break;
                } catch (err) {
                    console.warn(`[Scanner] Constraint level ${level} failed:`, err.name, err.message);
                    // Continue to next level
                }
            }

            if (!stream) {
                throw new Error('No camera available after all fallback levels');
            }

            _stream = stream;
            _cameraRetryLevel = usedLevel;

            const video = document.getElementById('scanner-video');
            if (video) {
                video.srcObject = _stream;
                
                // Wait for video to actually start playing
                video.onloadedmetadata = async () => {
                    try {
                        await video.play();
                        // Log actual camera resolution
                        logCameraInfo();
                        // Start live marker tracking
                        startDetectionLoop();
                    } catch(e) {
                        console.warn('Auto-play blocked, waiting for user interaction');
                    }
                };
            }
        } catch (error) {
            console.error('[Scanner] Camera error:', error);
            
            // Show explicit error and prompt button
            const statusEl = document.querySelector('.scanner-status');
            if (statusEl) {
                statusEl.innerHTML = `
                    <div style="color:var(--color-error);margin-bottom:8px">Lỗi truy cập Camera (${error.name || 'Unknown'})</div>
                    <button class="btn btn-sm btn-primary" onclick="Scanner.startCamera()">Bấm vào đây để cấp quyền</button>
                `;
            }
            
            if (error.name === 'NotAllowedError') {
                UIHelpers.showToast(I18n.t('scanner.camera_permission'), 'warning', CONSTANTS.TOAST_DURATION_LONG);
            } else {
                UIHelpers.showToast(I18n.t('scanner.no_camera') + ': ' + error.message, 'error');
            }
        }
    }

    /**
     * Log and display actual camera resolution
     */
    function logCameraInfo() {
        if (!_stream) return;
        const track = _stream.getVideoTracks()[0];
        if (!track) return;

        const settings = track.getSettings();
        const w = settings.width || 0;
        const h = settings.height || 0;
        const fps = settings.frameRate || 0;
        const label = track.label || 'Unknown';

        console.log(`[Scanner] Camera: "${label}" ${w}×${h} @${Math.round(fps)}fps (level ${_cameraRetryLevel})`);

        // Show resolution badge on UI
        const statusEl = document.querySelector('.scanner-status');
        if (statusEl && w > 0) {
            const quality = w >= 3840 ? '4K' : w >= 1920 ? 'FHD' : w >= 1280 ? 'HD' : 'SD';
            const color = w >= 1920 ? 'var(--color-success)' : 'var(--color-warning)';
            statusEl.innerHTML = `${I18n.t('scanner.guide')} <span style="color:${color};font-weight:600;margin-left:4px">${quality} ${w}×${h}</span>`;
        }
    }

    let _detectionLoopId = null;
    let _isDetecting = false;
    let _lastMarkerCount = 0;

    function stopCamera() {
        stopDetectionLoop();
        if (_stream) {
            _stream.getTracks().forEach(track => track.stop());
            _stream = null;
        }
        const video = document.getElementById('scanner-video');
        if (video) video.srcObject = null;
    }

    /**
     * Start live detection loop for markers
     */
    function startDetectionLoop() {
        if (_isDetecting) return;
        _isDetecting = true;
        _lastMarkerCount = 0;
        
        const video = document.getElementById('scanner-video');
        if (!video) return;

        // Use a hidden canvas for fast downscaled capture
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        
        // Downscale to 640px max for speed
        const MAX_WIDTH = 640;

        const loop = () => {
            if (!_isDetecting) return;

            if (video.readyState >= 2 && video.videoWidth > 0 && App.isOpenCVReady()) {
                try {
                    // Calculate scaled dimensions
                    const scale = Math.min(1.0, MAX_WIDTH / video.videoWidth);
                    canvas.width = video.videoWidth * scale;
                    canvas.height = video.videoHeight * scale;

                    // Draw video frame to canvas
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

                    // Detect markers
                    const count = OMREngine.detectMarkersFast(imageData);
                    updateDetectionUI(count);
                } catch (e) {
                    // Ignore errors in loop
                }
            }

            // Run at ~5 fps (every 200ms) to save battery and reduce CPU heat
            _detectionLoopId = setTimeout(() => requestAnimationFrame(loop), 200);
        };

        loop();
    }

    function stopDetectionLoop() {
        _isDetecting = false;
        if (_detectionLoopId) {
            clearTimeout(_detectionLoopId);
            _detectionLoopId = null;
        }
        updateDetectionUI(0);
    }

    function updateDetectionUI(count) {
        if (count === _lastMarkerCount) return;
        _lastMarkerCount = count;

        const statusEl = document.querySelector('.scanner-status');
        const guideEl = document.querySelector('.scanner-guide');
        
        if (!statusEl || !guideEl) return;

        if (count >= 4) {
            statusEl.innerHTML = `<span style="color:var(--color-success);font-weight:700">Đã nhận diện đủ (${count}/4) markers</span>`;
            guideEl.style.borderColor = 'var(--color-success)';
        } else if (count > 0) {
            statusEl.innerHTML = `<span style="color:var(--color-warning)">Đang căn chỉnh... (${count}/4)</span>`;
            guideEl.style.borderColor = 'var(--color-warning)';
        } else {
            // Revert to camera info
            logCameraInfo();
            guideEl.style.borderColor = 'rgba(255, 255, 255, 0.7)';
        }
    }

    /**
     * Capture a frame and process it
     */
    async function capture() {
        console.log('[Scanner] Capture triggered');
        
        const video = document.getElementById('scanner-video');
        const statusEl = document.querySelector('.scanner-status');
        
        // ── Validate camera state ──
        if (!video) {
            UIHelpers.showToast('Lỗi: Không tìm thấy video element', 'error');
            console.error('[Scanner] No video element found');
            return;
        }
        
        if (!_stream) {
            UIHelpers.showToast('Camera chưa được bật. Đang khởi động lại...', 'warning');
            console.warn('[Scanner] No stream, restarting camera');
            await startCamera();
            return;
        }

        // Check if camera stream is actually active
        const tracks = _stream.getVideoTracks();
        if (!tracks.length || tracks[0].readyState !== 'live') {
            UIHelpers.showToast('Camera đã bị ngắt. Đang kết nối lại...', 'warning');
            console.warn('[Scanner] Stream track not live, restarting');
            await startCamera();
            return;
        }

        // Validate video has data
        if (video.videoWidth === 0 || video.videoHeight === 0) {
            UIHelpers.showToast('Camera chưa sẵn sàng, vui lòng đợi...', 'warning');
            console.warn('[Scanner] Video dimensions are 0');
            return;
        }

        // ── Visual feedback IMMEDIATELY ──
        showCaptureFlash();
        UIHelpers.vibrate(100);
        UIHelpers.playSound('click');

        // Pause tracking while processing high-res image
        stopDetectionLoop();

        if (statusEl) statusEl.textContent = 'Đang xử lý...';

        try {
            // ── Capture frame ──
            const canvas = ImageUtils.captureFrame(video);
            console.log(`[Scanner] Captured frame: ${canvas.width}×${canvas.height}`);
            
            let blob = null;
            try { blob = await ImageUtils.canvasToBlob(canvas); } catch(e) { /* non-critical */ }

            const scanMode = VisionScanner.getScanMode(); // 'vision' | 'omr' | 'auto'
            const hasVisionKey = VisionScanner.hasAPIKey();

            // OpenCV check only needed for OMR mode
            if (scanMode === 'omr' && !App.isOpenCVReady()) {
                const isVi = I18n.getLang() === 'vi';
                UIHelpers.showToast(
                    isVi ? 'OpenCV đang tải... Vui lòng đợi 5-10 giây rồi bấm chụp lại' 
                         : 'OpenCV is loading... Please wait 5-10s and try again',
                    'warning', 
                    5000
                );
                if (statusEl) statusEl.innerHTML = `<span style="color:var(--color-warning)">⏳ Đang tải OpenCV...</span>`;
                console.warn('[Scanner] OpenCV not loaded yet');
                return;
            }

            UIHelpers.showLoading(
                scanMode === 'vision' ? '🤖 Đang gửi ảnh tới AI...' 
                : scanMode === 'auto' ? '🔍 Đang xử lý...'
                : (I18n.t('scanner.processing') || 'Đang xử lý...')
            );

            // ── Get answer key ──
            let answerKey = null;
            if (_activeProjectId) {
                try {
                    const keys = await MarkerDB.getByIndex(MarkerDB.STORES.ANSWER_KEYS, 'projectId', _activeProjectId);
                    if (_activeExamCode) {
                        answerKey = keys.find(k => k.examCode === _activeExamCode);
                    } else if (keys.length === 1) {
                        answerKey = keys[0];
                    }
                } catch(e) {
                    console.warn('[Scanner] Failed to get answer keys:', e);
                }
            }

            let project = null;
            if (_activeProjectId) {
                try {
                    project = await MarkerDB.get(MarkerDB.STORES.PROJECTS, _activeProjectId);
                } catch(e) {
                    console.warn('[Scanner] Failed to get project:', e);
                }
            }

            // ── Build config (must match SheetRenderer PDF layout) ──
            const config = project ? {
                questionCount: project.totalQuestions,
                optionCount: project.optionCount,
                studentIdDigits: project.studentIdDigits || CONSTANTS.STUDENT_ID_DIGITS,
                examCodeDigits: project.examCodeDigits || CONSTANTS.EXAM_CODE_DIGITS,
                columns: project.columns || CONSTANTS.DEFAULT_COLUMNS,
                hasInfoFields: project.hasInfoFields !== undefined ? project.hasInfoFields : true,
                hasExamCodeSection: project.hasExamCodeSection !== undefined ? project.hasExamCodeSection : true,
                headerText: project.headerText || '',
                logoBase64: project.logoBase64 || null,
            } : (() => {
                // Test Scan — use last designer config from localStorage for accurate layout
                try {
                    const s = JSON.parse(localStorage.getItem('marker_last_template_config') || '{}');
                    return {
                        questionCount: s.questionCount || CONSTANTS.DEFAULT_QUESTIONS,
                        optionCount: s.optionCount || CONSTANTS.DEFAULT_OPTIONS,
                        studentIdDigits: s.studentIdDigits || CONSTANTS.STUDENT_ID_DIGITS,
                        examCodeDigits: s.examCodeDigits || CONSTANTS.EXAM_CODE_DIGITS,
                        columns: s.columns || CONSTANTS.DEFAULT_COLUMNS,
                        hasInfoFields: s.hasInfoFields !== undefined ? s.hasInfoFields : true,
                        hasExamCodeSection: s.hasExamCodeSection !== undefined ? s.hasExamCodeSection : true,
                        headerText: s.headerText || '',
                        logoBase64: s.logoBase64 || null,
                    };
                } catch(e) {
                    return {
                        questionCount: CONSTANTS.DEFAULT_QUESTIONS,
                        optionCount: CONSTANTS.DEFAULT_OPTIONS,
                        studentIdDigits: CONSTANTS.STUDENT_ID_DIGITS,
                        examCodeDigits: CONSTANTS.EXAM_CODE_DIGITS,
                        columns: CONSTANTS.DEFAULT_COLUMNS,
                        hasInfoFields: true,
                        hasExamCodeSection: true,
                        headerText: '',
                    };
                }
            })();

            // ── Process image ──
            let result = null;

            if (scanMode === 'vision' && hasVisionKey) {
                // Vision API only
                console.log('[Scanner] Using Vision API (GPT-4o)');
                result = await VisionScanner.processImage(canvas, config, answerKey?.answers);

            } else if (scanMode === 'auto') {
                // Auto: try OMR first, fallback to Vision
                if (App.isOpenCVReady()) {
                    console.log('[Scanner] Auto mode: trying OMR first...');
                    const threshold = parseFloat(localStorage.getItem(CONSTANTS.LS_KEYS.FILL_THRESHOLD)) || CONSTANTS.DEFAULT_FILL_THRESHOLD;
                    const imageData = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
                    result = OMREngine.process(imageData, config, answerKey?.answers, threshold);
                    console.log('[Scanner] OMR result:', result);
                }

                // If OMR failed OR not available, try Vision
                if ((!result || !result.success) && hasVisionKey) {
                    console.log('[Scanner] OMR failed/unavailable, falling back to Vision API...');
                    const lt = document.getElementById('loading-text');
                    if (lt) lt.textContent = '🤖 OMR thất bại, đang thử AI...';
                    try {
                        result = await VisionScanner.processImage(canvas, config, answerKey?.answers);
                    } catch (visionErr) {
                        console.warn('[Scanner] Vision fallback also failed:', visionErr);
                        // Keep the OMR error result
                        if (!result) result = { success: false, error: 'both_failed', message: visionErr.message };
                    }
                }

                if (!result) {
                    result = { success: false, error: 'no_engine', message: 'Không có engine khả dụng' };
                }

            } else {
                // OMR only (default)
                console.log('[Scanner] Using OMR engine');
                const threshold = parseFloat(localStorage.getItem(CONSTANTS.LS_KEYS.FILL_THRESHOLD)) || CONSTANTS.DEFAULT_FILL_THRESHOLD;
                const imageData = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
                result = OMREngine.process(imageData, config, answerKey?.answers, threshold);
                console.log('[Scanner] OMR result:', result);
            }

            UIHelpers.hideLoading();

            if (result.success) {
                // ── Show success ──
                showScanResult(result, blob, answerKey, project);
                UIHelpers.playSound('success');
                UIHelpers.vibrate([50, 50, 50]);
            } else {
                // ── Show detailed error ──
                let errorMsg = '';
                if (result.error === 'no_markers') {
                    errorMsg = (I18n.t('scanner.error_no_markers') || 'Không tìm thấy marker') + 
                        ` (${result.markersFound || 0}/4). Ảnh: ${canvas.width}×${canvas.height}`;
                    if (hasVisionKey && scanMode !== 'auto') {
                        errorMsg += '\n💡 Thử đổi sang chế độ "AI Vision" trong Settings.';
                    }
                } else if (result.error === 'opencv_not_loaded') {
                    errorMsg = 'OpenCV chưa được tải. Vui lòng đợi và thử lại.';
                } else {
                    errorMsg = (I18n.t('scanner.error_generic') || 'Lỗi xử lý') + (result.message ? `: ${result.message}` : '');
                }
                UIHelpers.showToast(errorMsg, 'error', CONSTANTS.TOAST_DURATION_LONG || 5000);
                console.warn('[Scanner] Scan failed:', result);
                
                // Restart tracking after error
                startDetectionLoop();
            }
        } catch (error) {
            UIHelpers.hideLoading();
            console.error('[Scanner] Capture/Process error:', error);
            UIHelpers.showToast('Lỗi xử lý ảnh: ' + (error.message || 'Unknown'), 'error', 5000);
            
            startDetectionLoop();
        }

        // Always restore status if we restarted
        if (_isDetecting) {
            updateDetectionUI(_lastMarkerCount);
        } else {
            logCameraInfo();
        }
    }

    async function showScanResult(result, imageBlob, answerKey, project) {
        const score = project 
            ? ((result.correctCount || 0) * project.pointPerQuestion).toFixed(2) 
            : '--';

        const answersObj = result.answers || {};
        
        // Normalize details for table rendering (OMR returns object, Vision returns array)
        const detailsArray = Array.isArray(result.details) 
            ? result.details 
            : Object.keys(answersObj).map(qStr => {
                const q = parseInt(qStr);
                const selected = answersObj[qStr];
                const correct = answerKey?.answers?.[q] || '?';
                let status = 'unknown';
                if (selected === 'BLANK' || selected === CONSTANTS.ANSWER_STATUS.BLANK) status = 'blank';
                else if (selected === 'MULTI' || selected === CONSTANTS.ANSWER_STATUS.MULTI) status = 'multi';
                else if (correct !== '?' && selected === correct) status = 'correct';
                else if (correct !== '?') status = 'wrong';
                
                return {
                    question: q,
                    selected: (selected === CONSTANTS.ANSWER_STATUS.BLANK || selected === 'BLANK') ? 'BLANK' : (selected === CONSTANTS.ANSWER_STATUS.MULTI || selected === 'MULTI') ? 'MULTI' : selected,
                    status: status,
                    confidence: result.details?.[q]?.confidence || 0
                };
            }).sort((a, b) => a.question - b.question);

        const blanks = Object.keys(answersObj)
            .filter(q => answersObj[q] === 'BLANK' || answersObj[q] === CONSTANTS.ANSWER_STATUS?.BLANK)
            .map(q => parseInt(q)).sort((a,b)=>a-b);
            
        const multis = Object.keys(answersObj)
            .filter(q => answersObj[q] === 'MULTI' || answersObj[q] === CONSTANTS.ANSWER_STATUS?.MULTI)
            .map(q => parseInt(q)).sort((a,b)=>a-b);

        const content = `
            <div style="text-align:center;margin-bottom:var(--space-4)">
                <div style="font-size:var(--font-size-3xl);font-weight:700;color:var(--color-success);margin-bottom:var(--space-2)">
                    ${project ? I18n.t('scanner.success') : 'Chế độ thử nghiệm'}
                </div>
                <div style="font-size:var(--font-size-4xl);font-weight:700;color:var(--color-primary)">
                    ${score} <span style="font-size:var(--font-size-md);color:var(--color-text-tertiary)">/ ${project?.totalPoints || '?'}</span>
                </div>
            </div>

            <div class="stat-grid" style="margin-bottom:var(--space-4)">
                <div class="stat-card stat-primary">
                    <div class="stat-value">${result.studentId || '--'}</div>
                    <div class="stat-label">${I18n.t('results.student_id')}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${result.examCode || '--'}</div>
                    <div class="stat-label">${I18n.t('results.exam_code')}</div>
                </div>
                <div class="stat-card stat-success">
                    <div class="stat-value">${result.correctCount || 0}</div>
                    <div class="stat-label">${project ? I18n.t('results.correct') : 'Số ô đen đọc được'}</div>
                </div>
                <div class="stat-card stat-error">
                    <div class="stat-value">${result.wrongCount || 0}</div>
                    <div class="stat-label">${project ? I18n.t('results.wrong') : 'Sai / Bất thường'}</div>
                </div>
            </div>

            <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;font-size:var(--font-size-sm);color:var(--color-text-tertiary);margin-bottom:var(--space-4)">
                <span class="badge badge-warning">${I18n.t('results.blank')}: ${result.blankCount || 0}</span>
                <span class="badge badge-error">${I18n.t('results.multi')}: ${result.multiCount || 0}</span>
                <span class="badge ${result.method === 'vision' ? 'badge-info' : 'badge-success'}">${result.method === 'vision' ? '🤖 AI Vision' : '📐 OMR'}</span>
                ${result._elapsed ? `<span class="badge" style="background:var(--color-bg-tertiary)">⏱ ${(result._elapsed / 1000).toFixed(1)}s</span>` : ''}
                ${result.avgConfidence ? `<span class="badge" style="background:var(--color-bg-tertiary)">🎯 ${Math.round(result.avgConfidence * 100)}%</span>` : ''}
            </div>
            
            ${blanks.length > 0 ? `<div style="font-size:var(--font-size-sm);color:var(--color-warning);margin-bottom:var(--space-2);text-align:left;">
                <strong>Câu trống:</strong> ${blanks.join(', ')}
            </div>` : ''}
            
            ${multis.length > 0 ? `<div style="font-size:var(--font-size-sm);color:var(--color-error);margin-bottom:var(--space-2);text-align:left;">
                <strong>Phạm quy (tô nhiều ô):</strong> ${multis.join(', ')}
            </div>` : ''}

            ${result._validation && !result._validation.valid ? `
                <div style="margin:var(--space-3) 0;padding:var(--space-3);border-radius:var(--radius-md);
                    background:${result._validation.severity === 'error' ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)'};
                    border:1px solid ${result._validation.severity === 'error' ? 'rgba(239,68,68,0.2)' : 'rgba(245,158,11,0.2)'}">
                    <div style="font-size:var(--font-size-sm);font-weight:600;margin-bottom:var(--space-1);
                        color:${result._validation.severity === 'error' ? 'var(--color-error)' : 'var(--color-warning)'}">
                        ${result._validation.severity === 'error' ? '⚠ Cảnh báo nghiêm trọng' : '⚠ Lưu ý'}
                    </div>
                    <ul style="margin:0;padding-left:var(--space-4);font-size:var(--font-size-xs);color:var(--color-text-secondary)">
                        ${result._validation.issues.map(i => `<li>${UIHelpers.escapeHTML(i)}</li>`).join('')}
                    </ul>
                </div>
            ` : ''}

            ${result._verify?.doubleRead ? `
                <div style="margin:var(--space-2) 0;padding:var(--space-2) var(--space-3);border-radius:var(--radius-md);
                    background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.15);font-size:var(--font-size-xs)">
                    🔄 <strong>Double-read:</strong> 
                    ${result._verify.discrepancies.length === 0 
                        ? '<span style="color:var(--color-success)">✅ Hai lần đọc khớp 100%</span>' 
                        : `<span style="color:var(--color-warning)">⚠ ${result._verify.discrepancies.length} khác biệt (${Math.round((result._verify.agreement || 0) * 100)}% khớp)</span>`
                    }
                </div>
            ` : ''}

            ${detailsArray && detailsArray.length > 0 ? `
                <div style="margin-top:var(--space-4); margin-bottom:var(--space-2); max-height: 250px; overflow-y: auto; border: 1px solid var(--color-border); border-radius: var(--radius-md);">
                    <table class="table" style="font-size: var(--font-size-xs); margin: 0; width: 100%; text-align: center; border-collapse: collapse;">
                        <thead style="position: sticky; top: 0; background: var(--color-bg-secondary); z-index: 1;">
                            <tr>
                                <th style="padding:var(--space-2)">Câu</th>
                                <th style="padding:var(--space-2)">Chọn</th>
                                <th style="padding:var(--space-2)">Đ.Án</th>
                                <th style="padding:var(--space-2)">KQ</th>
                                ${result.method === 'vision' ? '<th style="padding:var(--space-2)">Tin cậy</th>' : ''}
                            </tr>
                        </thead>
                        <tbody>
                            ${detailsArray.map(d => {
                                const correctAns = answerKey?.answers?.[d.question] || '?';
                                let statusLabel = '--';
                                let rowBg = '';
                                if (d.status === 'correct') { statusLabel = '✓'; rowBg = 'background:rgba(16,185,129,0.06)'; }
                                else if (d.status === 'wrong') { statusLabel = '✗'; rowBg = 'background:rgba(239,68,68,0.06)'; }
                                else if (d.status === 'blank') { statusLabel = '—'; }
                                else if (d.status === 'multi') { statusLabel = '⚠'; rowBg = 'background:rgba(245,158,11,0.06)'; }
                                
                                const conf = d.confidence ? Math.round(d.confidence * 100) + '%' : '--';
                                const colorConf = d.confidence < 0.8 ? 'var(--color-warning)' : 'inherit';
                                const colorStatus = d.status === 'correct' ? 'var(--color-success)' : 'var(--color-error)';
                                
                                let str = '<tr style="' + rowBg + '; border-bottom: 1px solid var(--color-border);">';
                                str += '<td style="padding:var(--space-2)">' + d.question + '</td>';
                                str += '<td style="padding:var(--space-2)"><strong style="color:var(--color-primary)">' + d.selected + '</strong></td>';
                                str += '<td style="padding:var(--space-2)">' + correctAns + '</td>';
                                str += '<td style="padding:var(--space-2); font-weight:bold; color: ' + colorStatus + '">' + statusLabel + '</td>';
                                if (result.method === 'vision') {
                                    str += '<td style="padding:var(--space-2)"><span style="color:' + colorConf + '">' + conf + '</span></td>';
                                }
                                str += '</tr>';
                                return str;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            ` : ''}

            ${result._inputTokens ? `
                <div style="font-size:var(--font-size-xs);color:var(--color-text-tertiary);text-align:right;margin-top:var(--space-2)">
                    Tokens: ${result._inputTokens} in / ${result._outputTokens || 0} out
                </div>
            ` : ''}
            
            ${!project ? '<p style="text-align:center;color:var(--color-warning);font-size:var(--font-size-sm)">* <em>Không lưu kết quả do chưa chọn dự án</em></p>' : ''}
        `;

        const action = await UIHelpers.showModal({
            title: project ? I18n.t('scanner.success') : 'Test Scan',
            content,
            actions: [
                { label: I18n.t('scanner.retake'), className: 'btn-secondary', value: 'retake' },
                ...(project ? [{ label: I18n.t('scanner.save_result'), className: 'btn-success', value: 'save' }] : [])
            ]
        });

        if (action === 'save' && _activeProjectId) {
            const scanResult = {
                id: UIHelpers.uuid(),
                projectId: _activeProjectId,
                answerKeyId: answerKey?.id || null,
                studentId: result.studentId || '',
                examCode: result.examCode || '',
                answers: result.answers || {},
                details: result.details || [],
                correctCount: result.correctCount || 0,
                wrongCount: result.wrongCount || 0,
                blankCount: result.blankCount || 0,
                multiCount: result.multiCount || 0,
                score: parseFloat(score) || 0,
                scanImage: imageBlob,
                processedImage: null,
                confidence: result.avgConfidence || 0,
                scannedAt: new Date().toISOString(),
                verified: false,
            };

            await MarkerDB.put(MarkerDB.STORES.SCAN_RESULTS, scanResult);
            UIHelpers.showToast(I18n.t('misc.saved'), 'success');
            EventBus.emit('result:saved', { result: scanResult });
        }

        // Reset status and resume tracking
        startDetectionLoop();
        if (_isDetecting) {
            updateDetectionUI(_lastMarkerCount);
        } else {
            logCameraInfo();
        }
    }

    function showCaptureFlash() {
        const flash = document.createElement('div');
        flash.className = 'capture-flash';
        document.body.appendChild(flash);
        setTimeout(() => flash.remove(), 300);
    }

    function flipCamera() {
        _facingMode = _facingMode === CONSTANTS.CAMERA_FACING.BACK 
            ? CONSTANTS.CAMERA_FACING.FRONT 
            : CONSTANTS.CAMERA_FACING.BACK;
        startCamera();
    }

    async function toggleFlash() {
        if (!_stream) return;
        const track = _stream.getVideoTracks()[0];
        if (!track) return;

        try {
            _flashOn = !_flashOn;
            await track.applyConstraints({ advanced: [{ torch: _flashOn }] });
        } catch (e) {
            console.warn('[Scanner] Flash not supported');
        }
    }

    // ── Event Bindings ──
    function setupEvents() {
        document.getElementById('btn-capture')?.addEventListener('click', capture);
        document.getElementById('btn-flip-camera')?.addEventListener('click', flipCamera);
        document.getElementById('btn-flash')?.addEventListener('click', toggleFlash);

        // Batch import
        const batchInput = document.getElementById('batch-import-input');
        if (batchInput && !batchInput._bound) {
            batchInput._bound = true;
            batchInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files.length > 0) {
                    processBatch(Array.from(e.target.files));
                    e.target.value = ''; // Reset for re-selection
                }
            });
        }
    }

    // Auto-start/stop camera on view change
    if (typeof EventBus !== 'undefined') {
        EventBus.on('view:changed', ({ from, to }) => {
            if (to === 'scanner') {
                startCamera();
                setupEvents();
            }
            if (from === 'scanner') {
                stopCamera();
            }
        });
    }

    // ── Batch Import ──

    function triggerBatchImport() {
        const input = document.getElementById('batch-import-input');
        if (input) input.click();
    }

    function loadImageFromFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error('Cannot load: ' + file.name));
                img.src = e.target.result;
            };
            reader.onerror = () => reject(new Error('Cannot read: ' + file.name));
            reader.readAsDataURL(file);
        });
    }

    async function processBatch(files) {
        if (!files || files.length === 0) return;

        const scanMode = VisionScanner.getScanMode();
        const hasVisionKey = VisionScanner.hasAPIKey();

        if (scanMode === 'omr' && !App.isOpenCVReady()) {
            UIHelpers.showToast('OpenCV chưa tải xong. Vui lòng đợi...', 'warning', 5000);
            return;
        }
        if (scanMode === 'vision' && !hasVisionKey) {
            UIHelpers.showToast('Chưa cấu hình API key. Vào Settings để thêm.', 'warning', 5000);
            return;
        }

        // Build config (same logic as capture)
        let answerKey = null;
        let project = null;
        if (_activeProjectId) {
            try {
                const keys = await MarkerDB.getByIndex(MarkerDB.STORES.ANSWER_KEYS, 'projectId', _activeProjectId);
                if (_activeExamCode) {
                    answerKey = keys.find(k => k.examCode === _activeExamCode);
                } else if (keys.length === 1) {
                    answerKey = keys[0];
                }
            } catch(e) { console.warn('[Batch] keys error:', e); }
            try {
                project = await MarkerDB.get(MarkerDB.STORES.PROJECTS, _activeProjectId);
            } catch(e) { console.warn('[Batch] project error:', e); }
        }

        const config = project ? {
            questionCount: project.totalQuestions,
            optionCount: project.optionCount,
            studentIdDigits: project.studentIdDigits || CONSTANTS.STUDENT_ID_DIGITS,
            examCodeDigits: project.examCodeDigits || CONSTANTS.EXAM_CODE_DIGITS,
            columns: project.columns || CONSTANTS.DEFAULT_COLUMNS,
            hasInfoFields: project.hasInfoFields !== undefined ? project.hasInfoFields : true,
            hasExamCodeSection: project.hasExamCodeSection !== undefined ? project.hasExamCodeSection : true,
            headerText: project.headerText || '',
            logoBase64: project.logoBase64 || null,
        } : (() => {
            try {
                const s = JSON.parse(localStorage.getItem('marker_last_template_config') || '{}');
                return {
                    questionCount: s.questionCount || CONSTANTS.DEFAULT_QUESTIONS,
                    optionCount: s.optionCount || CONSTANTS.DEFAULT_OPTIONS,
                    studentIdDigits: s.studentIdDigits || CONSTANTS.STUDENT_ID_DIGITS,
                    examCodeDigits: s.examCodeDigits || CONSTANTS.EXAM_CODE_DIGITS,
                    columns: s.columns || CONSTANTS.DEFAULT_COLUMNS,
                    hasInfoFields: s.hasInfoFields !== undefined ? s.hasInfoFields : true,
                    hasExamCodeSection: s.hasExamCodeSection !== undefined ? s.hasExamCodeSection : true,
                    headerText: s.headerText || '',
                    logoBase64: s.logoBase64 || null,
                };
            } catch(e) {
                return {
                    questionCount: CONSTANTS.DEFAULT_QUESTIONS, optionCount: CONSTANTS.DEFAULT_OPTIONS,
                    studentIdDigits: CONSTANTS.STUDENT_ID_DIGITS, examCodeDigits: CONSTANTS.EXAM_CODE_DIGITS,
                    columns: CONSTANTS.DEFAULT_COLUMNS, hasInfoFields: true, hasExamCodeSection: true, headerText: '',
                };
            }
        })();

        const threshold = parseFloat(localStorage.getItem(CONSTANTS.LS_KEYS.FILL_THRESHOLD)) || CONSTANTS.DEFAULT_FILL_THRESHOLD;
        const batchResults = [];
        let processed = 0;
        const total = files.length;
        const modeLabel = scanMode === 'vision' ? '🤖 AI' : scanMode === 'auto' ? '🔍 Auto' : '📐 OMR';

        UIHelpers.showLoading(`${modeLabel} — 0/${total}...`);

        for (const file of files) {
            processed++;
            const lt = document.getElementById('loading-text');
            if (lt) lt.textContent = `${modeLabel} — ${processed}/${total}...`;

            try {
                const img = await loadImageFromFile(file);
                const canvas = ImageUtils.imageToCanvas(img);
                console.log(`[Batch] ${processed}/${total}: ${file.name} (${canvas.width}×${canvas.height}) mode=${scanMode}`);

                let result = null;

                if (scanMode === 'vision' && hasVisionKey) {
                    result = await VisionScanner.processImage(canvas, config, answerKey?.answers);
                } else if (scanMode === 'auto') {
                    // Try OMR first
                    if (App.isOpenCVReady()) {
                        const imageData = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
                        result = OMREngine.process(imageData, config, answerKey?.answers, threshold);
                    }
                    // Fallback to Vision
                    if ((!result || !result.success) && hasVisionKey) {
                        if (lt) lt.textContent = `🤖 AI fallback — ${processed}/${total}...`;
                        try {
                            result = await VisionScanner.processImage(canvas, config, answerKey?.answers);
                        } catch(ve) {
                            console.warn(`[Batch] Vision fallback failed for ${file.name}:`, ve);
                            if (!result) result = { success: false, error: ve.message };
                        }
                    }
                    if (!result) result = { success: false, error: 'no_engine' };
                } else {
                    // OMR only
                    const imageData = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
                    result = OMREngine.process(imageData, config, answerKey?.answers, threshold);
                }

                if (result.success) {
                    const score = project ? ((result.correctCount || 0) * project.pointPerQuestion) : 0;
                    let blob = null;
                    try { blob = await ImageUtils.canvasToBlob(canvas); } catch(e) {}

                    if (project) {
                        const scanResult = {
                            id: UIHelpers.uuid(),
                            projectId: _activeProjectId,
                            answerKeyId: answerKey?.id || null,
                            studentId: result.studentId || '',
                            examCode: result.examCode || '',
                            answers: result.answers || {},
                            details: result.details || [],
                            correctCount: result.correctCount || 0,
                            wrongCount: result.wrongCount || 0,
                            blankCount: result.blankCount || 0,
                            multiCount: result.multiCount || 0,
                            score: parseFloat(score.toFixed(2)) || 0,
                            scanImage: blob,
                            processedImage: null,
                            confidence: result.avgConfidence || 0,
                            scannedAt: new Date().toISOString(),
                            verified: false,
                        };
                        await MarkerDB.put(MarkerDB.STORES.SCAN_RESULTS, scanResult);
                    }

                    batchResults.push({
                        fileName: file.name, success: true, saved: !!project,
                        method: result.method || 'omr',
                        studentId: result.studentId || '--',
                        examCode: result.examCode || '--',
                        correctCount: result.correctCount || 0,
                        wrongCount: result.wrongCount || 0,
                        blankCount: result.blankCount || 0,
                        score: project ? score.toFixed(2) : '--',
                    });
                } else {
                    batchResults.push({
                        fileName: file.name, success: false,
                        error: result.error || 'unknown',
                        markersFound: result.markersFound || 0,
                    });
                }
            } catch (e) {
                console.error(`[Batch] Error for ${file.name}:`, e);
                batchResults.push({ fileName: file.name, success: false, error: e.message || 'unknown' });
            }

            // Rate limiting for Vision API
            const delay = scanMode === 'vision' ? 200 : 50;
            await new Promise(r => setTimeout(r, delay));
        }

        UIHelpers.hideLoading();
        showBatchResults(batchResults, project);
    }

    function showBatchResults(results, project) {
        const successCount = results.filter(r => r.success).length;
        const failCount = results.length - successCount;

        let tableHtml = '';
        results.forEach((r, i) => {
            if (r.success) {
                tableHtml += `<tr>
                    <td>${i + 1}</td>
                    <td><strong>${UIHelpers.escapeHTML(r.studentId)}</strong></td>
                    <td>${r.correctCount}</td>
                    <td>${r.score}</td>
                    <td><span class="badge badge-success">OK</span></td>
                </tr>`;
            } else {
                tableHtml += `<tr style="opacity:0.6">
                    <td>${i + 1}</td>
                    <td colspan="3" style="color:var(--color-error)">${UIHelpers.escapeHTML(r.fileName)}: ${r.error}</td>
                    <td><span class="badge badge-error">Lỗi</span></td>
                </tr>`;
            }
        });

        const content = `
            <div class="stat-grid" style="margin-bottom:var(--space-4)">
                <div class="stat-card stat-success">
                    <div class="stat-value">${successCount}</div>
                    <div class="stat-label">Thành công</div>
                </div>
                <div class="stat-card stat-error">
                    <div class="stat-value">${failCount}</div>
                    <div class="stat-label">Thất bại</div>
                </div>
            </div>
            <div style="overflow-x:auto;max-height:50vh;border:1px solid var(--color-border);border-radius:var(--radius-lg)">
                <table class="results-table">
                    <thead><tr>
                        <th>#</th><th>SBD</th><th>Đúng</th><th>Điểm</th><th>Trạng thái</th>
                    </tr></thead>
                    <tbody>${tableHtml}</tbody>
                </table>
            </div>
            ${project ? '' : '<p style="text-align:center;color:var(--color-warning);font-size:var(--font-size-sm);margin-top:var(--space-3)">* Chưa chọn dự án — kết quả không được lưu</p>'}
        `;

        UIHelpers.showModal({
            title: `Import hoàn tất (${results.length} phiếu)`,
            content,
            actions: [{ label: 'Đóng', className: 'btn-primary', value: 'close' }]
        });

        if (successCount > 0) {
            EventBus.emit('result:saved', {});
        }
    }

    return {
        activate,
        startCamera,
        stopCamera,
        capture,
        flipCamera,
        toggleFlash,
        triggerBatchImport,
        processBatch,
        setProject: (id) => { _activeProjectId = id; },
        setExamCode: (code) => { _activeExamCode = code; },
    };
})();

if (typeof window !== 'undefined') {
    window.Scanner = Scanner;
}
