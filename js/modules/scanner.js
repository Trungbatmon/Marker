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

        // Validate video is actually playing and has data
        if (video.readyState < 2) {
            UIHelpers.showToast('Camera chưa sẵn sàng, vui lòng thử lại', 'warning');
            return;
        }

        if (video.videoWidth === 0 || video.videoHeight === 0) {
            UIHelpers.showToast('Không nhận được dữ liệu từ camera', 'error');
            return;
        }

        // Flash effect
        showCaptureFlash();
        UIHelpers.vibrate(100);
        UIHelpers.playSound('click');

        // Capture frame at full resolution
        const canvas = ImageUtils.captureFrame(video);
        const blob = await ImageUtils.canvasToBlob(canvas);

        console.log(`[Scanner] Captured frame: ${canvas.width}×${canvas.height}`);

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
                // Show detailed error
                let errorMsg = '';
                if (result.error === 'no_markers') {
                    errorMsg = I18n.t('scanner.error_no_markers') + 
                        ` (Tìm thấy ${result.markersFound || 0}/4 marker. Ảnh: ${canvas.width}×${canvas.height})`;
                } else if (result.error === 'opencv_not_loaded') {
                    errorMsg = 'OpenCV chưa được tải. Vui lòng đợi và thử lại.';
                } else {
                    errorMsg = I18n.t('scanner.error_generic') + (result.message ? `: ${result.message}` : '');
                }
                UIHelpers.showToast(errorMsg, 'error', CONSTANTS.TOAST_DURATION_LONG);
                console.warn('[Scanner] OMR failed:', result);
                if (statusEl) statusEl.textContent = I18n.t('scanner.guide');
                // Re-show resolution info
                logCameraInfo();
            }
        } catch (error) {
            UIHelpers.hideLoading();
            console.error('[Scanner] Process error:', error);
            UIHelpers.showToast(I18n.t('scanner.error_generic') + ': ' + error.message, 'error');
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

        // Reset status with camera info
        logCameraInfo();
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
