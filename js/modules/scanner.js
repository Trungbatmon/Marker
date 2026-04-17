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

    /**
     * Initialize scanner for a project
     */
    async function activate(projectId, examCode) {
        _activeProjectId = projectId;
        _activeExamCode = examCode;
        await startCamera();
    }

    async function startCamera(retryAny = false) {
        try {
            // Stop existing stream
            stopCamera();

            const constraints = {
                video: retryAny ? true : { facingMode: _facingMode },
                audio: false,
            };

            _stream = await navigator.mediaDevices.getUserMedia(constraints);
            const video = document.getElementById('scanner-video');
            if (video) {
                video.srcObject = _stream;
                
                // Wait for video to actually start playing
                video.onloadedmetadata = async () => {
                    try {
                        await video.play();
                    } catch(e) {
                        console.warn('Auto-play blocked, waiting for user interaction');
                    }
                };
            }
        } catch (error) {
            // Fallback: If "environment" or "user" is not allowed/found, try ANY camera.
            if (!retryAny && (error.name === 'OverconstrainedError' || error.name === 'NotFoundError' || error.name === 'AbortError')) {
                console.warn('[Scanner] Fallback to any camera');
                return startCamera(true);
            }
            
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

    function stopCamera() {
        if (_stream) {
            _stream.getTracks().forEach(track => track.stop());
            _stream = null;
        }
        const video = document.getElementById('scanner-video');
        if (video) video.srcObject = null;
    }

    /**
     * Capture a frame and process it
     */
    async function capture() {
        const video = document.getElementById('scanner-video');
        if (!video || !_stream) {
            UIHelpers.showToast(I18n.t('scanner.no_camera'), 'error');
            return;
        }

        // Flash effect
        showCaptureFlash();
        UIHelpers.vibrate(100);
        UIHelpers.playSound('click');

        // Capture frame
        const canvas = ImageUtils.captureFrame(video);
        const blob = await ImageUtils.canvasToBlob(canvas);

        // Update status
        const statusEl = document.querySelector('.scanner-status');
        if (statusEl) statusEl.textContent = I18n.t('scanner.processing');

        try {
            // Process with OMR
            if (!App.isOpenCVReady()) {
                UIHelpers.showToast(I18n.t('app.loading_opencv'), 'warning');
                return;
            }

            UIHelpers.showLoading(I18n.t('scanner.processing'));

            // Get answer key
            let answerKey = null;
            if (_activeProjectId) {
                const keys = await MarkerDB.getByIndex(MarkerDB.STORES.ANSWER_KEYS, 'projectId', _activeProjectId);
                if (_activeExamCode) {
                    answerKey = keys.find(k => k.examCode === _activeExamCode);
                } else if (keys.length === 1) {
                    answerKey = keys[0];
                }
            }

            const project = _activeProjectId 
                ? await MarkerDB.get(MarkerDB.STORES.PROJECTS, _activeProjectId) 
                : null;

            // Get template config
            const config = project ? {
                questionCount: project.totalQuestions,
                optionCount: project.optionCount,
                studentIdDigits: project.studentIdDigits || CONSTANTS.STUDENT_ID_DIGITS,
                examCodeDigits: project.examCodeDigits || CONSTANTS.EXAM_CODE_DIGITS,
                columns: project.columns || CONSTANTS.DEFAULT_COLUMNS,
                hasInfoFields: project.hasInfoFields,
                logoBase64: project.logoBase64
            } : {
                // Test Scan Configuration
                questionCount: 40,
                optionCount: 4,
                studentIdDigits: CONSTANTS.STUDENT_ID_DIGITS,
                examCodeDigits: CONSTANTS.EXAM_CODE_DIGITS,
                columns: CONSTANTS.DEFAULT_COLUMNS,
                hasInfoFields: true,
            };

            const threshold = parseFloat(localStorage.getItem(CONSTANTS.LS_KEYS.FILL_THRESHOLD)) || CONSTANTS.DEFAULT_FILL_THRESHOLD;

            // Process image
            const imageData = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
            const result = OMREngine.process(imageData, config, answerKey?.answers, threshold);

            UIHelpers.hideLoading();

            if (result.success) {
                // Show success
                showScanResult(result, blob, answerKey, project);
                UIHelpers.playSound('success');
                UIHelpers.vibrate([50, 50, 50]);
            } else {
                // Show error
                const errorMsg = result.error === 'no_markers' 
                    ? I18n.t('scanner.error_no_markers')
                    : I18n.t('scanner.error_generic');
                UIHelpers.showToast(errorMsg, 'error', CONSTANTS.TOAST_DURATION_LONG);
                if (statusEl) statusEl.textContent = I18n.t('scanner.guide');
            }
        } catch (error) {
            UIHelpers.hideLoading();
            console.error('[Scanner] Process error:', error);
            UIHelpers.showToast(I18n.t('scanner.error_generic'), 'error');
            if (statusEl) statusEl.textContent = I18n.t('scanner.guide');
        }
    }

    async function showScanResult(result, imageBlob, answerKey, project) {
        const score = project 
            ? ((result.correctCount || 0) * project.pointPerQuestion).toFixed(2) 
            : '--';

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

            <div style="display:flex;gap:var(--space-2);font-size:var(--font-size-sm);color:var(--color-text-tertiary);margin-bottom:var(--space-4)">
                <span class="badge badge-warning">${I18n.t('results.blank')}: ${result.blankCount || 0}</span>
                <span class="badge badge-error">${I18n.t('results.multi')}: ${result.multiCount || 0}</span>
            </div>
            
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

        // Reset status
        const statusEl = document.querySelector('.scanner-status');
        if (statusEl) statusEl.textContent = I18n.t('scanner.guide');
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

    return {
        activate,
        startCamera,
        stopCamera,
        capture,
        flipCamera,
        toggleFlash,
        setProject: (id) => { _activeProjectId = id; },
        setExamCode: (code) => { _activeExamCode = code; },
    };
})();

if (typeof window !== 'undefined') {
    window.Scanner = Scanner;
}
