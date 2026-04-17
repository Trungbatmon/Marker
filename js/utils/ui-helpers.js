/**
 * Marker — UI Helper Utilities
 * Toast notifications, modals, loading, vibration, sound
 */

const UIHelpers = (() => {
    // ══════════════════════════════════════════
    // TOAST NOTIFICATIONS
    // ══════════════════════════════════════════

    /**
     * Show a toast notification
     * @param {string} message - Message to display
     * @param {'success'|'error'|'warning'|'info'} type - Toast type
     * @param {number} duration - Duration in ms (default: CONSTANTS.TOAST_DURATION)
     */
    function showToast(message, type = 'info', duration = null) {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const d = duration || CONSTANTS.TOAST_DURATION;
        const icons = {
            success: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
            error: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
            warning: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
            info: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
        };

        const colors = {
            success: 'var(--color-success)',
            error: 'var(--color-error)',
            warning: 'var(--color-warning)',
            info: 'var(--color-info)',
        };

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <span class="toast-icon" style="color:${colors[type]}">${icons[type]}</span>
            <span class="toast-message">${message}</span>
            <button class="toast-close" aria-label="Close">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        `;

        // Close button
        toast.querySelector('.toast-close').addEventListener('click', () => {
            removeToast(toast);
        });

        container.appendChild(toast);

        // Auto-remove
        const timer = setTimeout(() => removeToast(toast), d);
        toast._timer = timer;
    }

    function removeToast(toast) {
        if (toast._removing) return;
        toast._removing = true;
        clearTimeout(toast._timer);
        toast.classList.add('removing');
        setTimeout(() => {
            toast.remove();
        }, 250);
    }

    // ══════════════════════════════════════════
    // MODAL DIALOG
    // ══════════════════════════════════════════

    let _modalResolve = null;

    /**
     * Show a modal dialog
     * @param {Object} options
     * @param {string} options.title - Modal title
     * @param {string} options.content - HTML content for modal body
     * @param {Array} options.actions - Array of {label, className, value}
     * @returns {Promise<string|null>} Resolves with action value or null if dismissed
     */
    function showModal({ title, content, actions = [] }) {
        return new Promise((resolve) => {
            _modalResolve = resolve;

            const backdrop = document.getElementById('modal-backdrop');
            const modal = document.getElementById('modal');
            const titleEl = document.getElementById('modal-title');
            const bodyEl = document.getElementById('modal-body');
            const footerEl = document.getElementById('modal-footer');

            titleEl.textContent = title;
            bodyEl.innerHTML = content;

            // Render actions
            footerEl.innerHTML = '';
            actions.forEach(action => {
                const btn = document.createElement('button');
                btn.className = `btn ${action.className || 'btn-secondary'}`;
                btn.textContent = action.label;
                btn.addEventListener('click', () => {
                    closeModal();
                    resolve(action.value || action.label);
                });
                footerEl.appendChild(btn);
            });

            // Show
            backdrop.classList.add('active');
            modal.classList.add('active');
            document.body.classList.add('no-scroll');

            // Close on backdrop click
            backdrop.onclick = () => {
                closeModal();
                resolve(null);
            };

            // Close button
            document.getElementById('modal-close-btn').onclick = () => {
                closeModal();
                resolve(null);
            };
        });
    }

    function closeModal() {
        const backdrop = document.getElementById('modal-backdrop');
        const modal = document.getElementById('modal');
        backdrop.classList.remove('active');
        modal.classList.remove('active');
        document.body.classList.remove('no-scroll');
    }

    /**
     * Show a confirmation dialog
     * @param {string} message - Message to display
     * @param {Object} options - { title, confirmLabel, cancelLabel, danger }
     * @returns {Promise<boolean>}
     */
    async function confirm(message, options = {}) {
        const {
            title = I18n.t('action.confirm'),
            confirmLabel = I18n.t('action.yes'),
            cancelLabel = I18n.t('action.cancel'),
            danger = false
        } = options;

        const result = await showModal({
            title,
            content: `<p style="color:var(--color-text-secondary);line-height:1.6">${message}</p>`,
            actions: [
                { label: cancelLabel, className: 'btn-secondary', value: 'cancel' },
                { label: confirmLabel, className: danger ? 'btn-danger' : 'btn-primary', value: 'confirm' },
            ]
        });

        return result === 'confirm';
    }

    // ══════════════════════════════════════════
    // LOADING OVERLAY
    // ══════════════════════════════════════════

    /**
     * Show global loading overlay
     * @param {string} message - Loading message
     */
    function showLoading(message = null) {
        const overlay = document.getElementById('loading-overlay');
        const text = document.getElementById('loading-text');
        if (message) {
            text.textContent = message;
        }
        overlay.classList.add('active');
    }

    /**
     * Hide global loading overlay
     */
    function hideLoading() {
        const overlay = document.getElementById('loading-overlay');
        overlay.classList.remove('active');
    }

    // ══════════════════════════════════════════
    // HAPTIC FEEDBACK
    // ══════════════════════════════════════════

    /**
     * Trigger vibration feedback
     * @param {number|number[]} pattern - Duration(s) in ms
     */
    function vibrate(pattern = 50) {
        const enabled = localStorage.getItem(CONSTANTS.LS_KEYS.VIBRATION_ENABLED);
        if (enabled === 'false') return;
        if ('vibrate' in navigator) {
            navigator.vibrate(pattern);
        }
    }

    // ══════════════════════════════════════════
    // SOUND EFFECTS
    // ══════════════════════════════════════════

    const _audioCache = {};

    /**
     * Play a sound effect
     * @param {'success'|'error'|'click'} type
     */
    function playSound(type = 'click') {
        const enabled = localStorage.getItem(CONSTANTS.LS_KEYS.SOUND_ENABLED);
        if (enabled === 'false') return;

        // Generate simple tones using Web Audio API
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = ctx.createOscillator();
            const gainNode = ctx.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(ctx.destination);

            const configs = {
                success: { freq: 880, duration: 0.15, type: 'sine' },
                error: { freq: 220, duration: 0.3, type: 'sawtooth' },
                click: { freq: 600, duration: 0.05, type: 'sine' },
            };

            const config = configs[type] || configs.click;
            oscillator.type = config.type;
            oscillator.frequency.setValueAtTime(config.freq, ctx.currentTime);
            gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + config.duration);

            oscillator.start(ctx.currentTime);
            oscillator.stop(ctx.currentTime + config.duration);
        } catch (e) {
            // Audio not available, ignore silently
        }
    }

    // ══════════════════════════════════════════
    // DATE FORMATTING
    // ══════════════════════════════════════════

    /**
     * Format a date
     * @param {Date|string|number} date
     * @param {string} format - 'short', 'long', 'relative'
     * @returns {string}
     */
    function formatDate(date, format = 'short') {
        const d = new Date(date);
        const lang = I18n.getLang();

        if (format === 'relative') {
            return getRelativeTime(d, lang);
        }

        const options = format === 'long'
            ? { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }
            : { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };

        const locale = lang === 'vi' ? 'vi-VN' : 'en-US';
        return d.toLocaleDateString(locale, options);
    }

    function getRelativeTime(date, lang) {
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (lang === 'vi') {
            if (diffMins < 1) return 'Vừa xong';
            if (diffMins < 60) return `${diffMins} phút trước`;
            if (diffHours < 24) return `${diffHours} giờ trước`;
            if (diffDays < 7) return `${diffDays} ngày trước`;
            return formatDate(date, 'short');
        } else {
            if (diffMins < 1) return 'Just now';
            if (diffMins < 60) return `${diffMins}m ago`;
            if (diffHours < 24) return `${diffHours}h ago`;
            if (diffDays < 7) return `${diffDays}d ago`;
            return formatDate(date, 'short');
        }
    }

    // ══════════════════════════════════════════
    // UTILITY
    // ══════════════════════════════════════════

    /**
     * Generate a UUID v4
     */
    function uuid() {
        return crypto.randomUUID
            ? crypto.randomUUID()
            : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                const r = Math.random() * 16 | 0;
                const v = c === 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
    }

    /**
     * Debounce a function
     */
    function debounce(fn, delay = CONSTANTS.DEBOUNCE_DELAY) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), delay);
        };
    }

    /**
     * Escape HTML to prevent XSS
     */
    function escapeHTML(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    return {
        showToast,
        showModal,
        closeModal,
        confirm,
        showLoading,
        hideLoading,
        vibrate,
        playSound,
        formatDate,
        uuid,
        debounce,
        escapeHTML,
    };
})();

if (typeof window !== 'undefined') {
    window.UIHelpers = UIHelpers;
}
