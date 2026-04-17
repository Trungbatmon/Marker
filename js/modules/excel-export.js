/**
 * Marker — Excel Export Module
 * Export grading results to .xlsx using SheetJS
 */

const ExcelExport = (() => {

    /**
     * Export results for a project to Excel
     * @param {string} projectId - If null, exports all results
     */
    async function exportProject(projectId = null) {
        try {
            // Load SheetJS if not loaded
            if (typeof XLSX === 'undefined') {
                await loadScript('https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js');
            }

            UIHelpers.showLoading(I18n.t('results.export_excel') + '...');

            const project = projectId 
                ? await MarkerDB.get(MarkerDB.STORES.PROJECTS, projectId)
                : null;

            const results = projectId
                ? await MarkerDB.getByIndex(MarkerDB.STORES.SCAN_RESULTS, 'projectId', projectId)
                : await MarkerDB.getAll(MarkerDB.STORES.SCAN_RESULTS);

            const answerKeys = projectId
                ? await MarkerDB.getByIndex(MarkerDB.STORES.ANSWER_KEYS, 'projectId', projectId)
                : await MarkerDB.getAll(MarkerDB.STORES.ANSWER_KEYS);

            if (results.length === 0) {
                UIHelpers.hideLoading();
                UIHelpers.showToast(I18n.t('results.no_results'), 'warning');
                return;
            }

            // Sort results by studentId
            results.sort((a, b) => (a.studentId || '').localeCompare(b.studentId || ''));

            const wb = XLSX.utils.book_new();

            // ── Sheet 1: Score Summary ──
            const summaryData = results.map((r, i) => ({
                'STT': i + 1,
                [I18n.t('results.student_id')]: r.studentId || '',
                [I18n.t('results.exam_code')]: r.examCode || '',
                [I18n.t('results.correct')]: r.correctCount || 0,
                [I18n.t('results.wrong')]: r.wrongCount || 0,
                [I18n.t('results.blank')]: r.blankCount || 0,
                [I18n.t('results.multi')]: r.multiCount || 0,
                [I18n.t('results.score')]: r.score || 0,
                [I18n.t('results.time')]: r.scannedAt ? new Date(r.scannedAt).toLocaleString() : '',
            }));

            const ws1 = XLSX.utils.json_to_sheet(summaryData);
            
            // Set column widths
            ws1['!cols'] = [
                { wch: 5 },  // STT
                { wch: 12 }, // SBD
                { wch: 8 },  // Mã đề
                { wch: 8 },  // Đúng
                { wch: 8 },  // Sai
                { wch: 8 },  // Trống
                { wch: 8 },  // Multi
                { wch: 8 },  // Điểm
                { wch: 20 }, // Thời gian
            ];

            XLSX.utils.book_append_sheet(wb, ws1, I18n.getLang() === 'vi' ? 'Bảng Điểm' : 'Score Sheet');

            // ── Sheet 2: Detailed Answers ──
            const totalQ = project?.totalQuestions || Math.max(...results.map(r => Object.keys(r.answers || {}).length));
            const detailHeaders = [I18n.t('results.student_id')];
            for (let q = 1; q <= totalQ; q++) {
                detailHeaders.push(`Q${q}`);
            }

            const detailData = results.map(r => {
                const row = { [I18n.t('results.student_id')]: r.studentId || '' };
                for (let q = 1; q <= totalQ; q++) {
                    const ans = r.answers?.[q] || '';
                    // Find if correct
                    const ak = answerKeys.find(k => k.id === r.answerKeyId || k.examCode === r.examCode);
                    const correct = ak?.answers?.[q];
                    
                    if (ans === CONSTANTS.ANSWER_STATUS.BLANK) {
                        row[`Q${q}`] = '-';
                    } else if (ans === CONSTANTS.ANSWER_STATUS.MULTI) {
                        row[`Q${q}`] = 'X';
                    } else if (correct && ans === correct) {
                        row[`Q${q}`] = ans + ' ✓';
                    } else if (correct) {
                        row[`Q${q}`] = ans + ' ✗';
                    } else {
                        row[`Q${q}`] = ans;
                    }
                }
                return row;
            });

            const ws2 = XLSX.utils.json_to_sheet(detailData);
            XLSX.utils.book_append_sheet(wb, ws2, I18n.getLang() === 'vi' ? 'Chi Tiết' : 'Details');

            // ── Sheet 3: Question Analysis ──
            if (answerKeys.length > 0) {
                const analysisData = [];
                for (let q = 1; q <= totalQ; q++) {
                    const row = {
                        [I18n.getLang() === 'vi' ? 'Câu' : 'Q']: q,
                    };

                    // Find correct answer from first answer key
                    const ak = answerKeys[0];
                    row[I18n.getLang() === 'vi' ? 'Đáp án đúng' : 'Correct'] = ak?.answers?.[q] || '?';

                    // Count selections
                    const counts = {};
                    CONSTANTS.OPTION_LABELS.slice(0, project?.optionCount || 4).forEach(opt => {
                        counts[opt] = 0;
                    });
                    counts['BLANK'] = 0;
                    counts['MULTI'] = 0;

                    let correctCount = 0;
                    results.forEach(r => {
                        const ans = r.answers?.[q];
                        if (ans === CONSTANTS.ANSWER_STATUS.BLANK) counts['BLANK']++;
                        else if (ans === CONSTANTS.ANSWER_STATUS.MULTI) counts['MULTI']++;
                        else if (counts[ans] !== undefined) counts[ans]++;

                        if (ans === ak?.answers?.[q]) correctCount++;
                    });

                    const total = results.length;
                    row[I18n.t('results.correct_rate')] = total > 0 
                        ? Math.round((correctCount / total) * 100) + '%' 
                        : '0%';

                    CONSTANTS.OPTION_LABELS.slice(0, project?.optionCount || 4).forEach(opt => {
                        row[opt] = total > 0 ? Math.round((counts[opt] / total) * 100) + '%' : '0%';
                    });

                    row[I18n.t('results.blank')] = total > 0 
                        ? Math.round((counts['BLANK'] / total) * 100) + '%' 
                        : '0%';

                    analysisData.push(row);
                }

                const ws3 = XLSX.utils.json_to_sheet(analysisData);
                XLSX.utils.book_append_sheet(wb, ws3, I18n.getLang() === 'vi' ? 'Phân Tích' : 'Analysis');
            }

            // Generate filename
            const dateSuffix = new Date().toISOString().slice(0, 10);
            const projectName = project ? project.name.replace(/[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF ]/g, '').trim().replace(/\s+/g, '_') : 'All';
            const filename = `${CONSTANTS.EXCEL_FILENAME_PREFIX}${projectName}_${dateSuffix}.xlsx`;

            // Download
            XLSX.writeFile(wb, filename);

            UIHelpers.hideLoading();
            UIHelpers.showToast(I18n.t('misc.success'), 'success');
            UIHelpers.vibrate(50);

            EventBus.emit('export:completed', { projectId, format: 'excel' });

        } catch (error) {
            UIHelpers.hideLoading();
            console.error('[Export] Error:', error);
            UIHelpers.showToast(I18n.t('misc.error') + ': ' + error.message, 'error');
        }
    }

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            if (document.querySelector(`script[src="${src}"]`)) {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    // Bind export button
    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('btn-export-excel')?.addEventListener('click', () => {
            const projectId = (typeof ResultsManager !== 'undefined' && ResultsManager.getProjectId) 
                ? ResultsManager.getProjectId() 
                : null;
            exportProject(projectId);
        });
    });

    return {
        exportProject,
    };
})();

if (typeof window !== 'undefined') {
    window.ExcelExport = ExcelExport;
}
