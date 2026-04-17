/**
 * Marker — Extensibility Hooks
 * Rule R5.1: Plugin-ready architecture via event bus + hook points.
 * This module provides extension points for future features:
 * - Rọc phách (detachable student ID)
 * - Essay/subjective grading
 * - AI-assisted grading
 * - Multi-school deployment
 */

const Extensibility = (() => {

    // ══════════════════════════════════════════
    // EVENT BUS (for module communication)
    // ══════════════════════════════════════════

    const _listeners = {};

    /**
     * Subscribe to an event
     * @param {string} event - Event name
     * @param {Function} callback - Handler function
     * @returns {Function} Unsubscribe function
     */
    function on(event, callback) {
        if (!_listeners[event]) _listeners[event] = [];
        _listeners[event].push(callback);

        // Return unsubscribe function
        return () => {
            _listeners[event] = _listeners[event].filter(cb => cb !== callback);
        };
    }

    /**
     * Subscribe to an event once
     */
    function once(event, callback) {
        const unsub = on(event, (...args) => {
            unsub();
            callback(...args);
        });
        return unsub;
    }

    /**
     * Emit an event
     * @param {string} event - Event name
     * @param {*} data - Event data
     */
    function emit(event, data) {
        const handlers = _listeners[event];
        if (handlers) {
            handlers.forEach(cb => {
                try {
                    cb(data);
                } catch (err) {
                    console.error(`[EventBus] Error in handler for "${event}":`, err);
                }
            });
        }
    }

    // ══════════════════════════════════════════
    // HOOK POINTS (for extending functionality)
    // ══════════════════════════════════════════

    const _hooks = {};

    /**
     * Register a hook
     * @param {string} hookName - Hook point name
     * @param {Function} handler - Hook handler (receives data, returns modified data)
     * @param {number} priority - Lower = runs first (default: 10)
     */
    function addHook(hookName, handler, priority = 10) {
        if (!_hooks[hookName]) _hooks[hookName] = [];
        _hooks[hookName].push({ handler, priority });
        _hooks[hookName].sort((a, b) => a.priority - b.priority);
    }

    /**
     * Run all hooks for a given hook point (waterfall pattern)
     * Each hook receives the output of the previous one
     * @param {string} hookName
     * @param {*} data - Initial data
     * @returns {*} Modified data
     */
    function applyHooks(hookName, data) {
        const hooks = _hooks[hookName];
        if (!hooks || hooks.length === 0) return data;

        let result = data;
        for (const { handler } of hooks) {
            try {
                result = handler(result);
            } catch (err) {
                console.error(`[Hook] Error in "${hookName}":`, err);
            }
        }
        return result;
    }

    /**
     * Run all hooks asynchronously
     */
    async function applyHooksAsync(hookName, data) {
        const hooks = _hooks[hookName];
        if (!hooks || hooks.length === 0) return data;

        let result = data;
        for (const { handler } of hooks) {
            try {
                result = await handler(result);
            } catch (err) {
                console.error(`[Hook] Async error in "${hookName}":`, err);
            }
        }
        return result;
    }

    // ══════════════════════════════════════════
    // GRADING STRATEGY REGISTRY (R5.3)
    // ══════════════════════════════════════════

    const _gradingStrategies = {};

    /**
     * Register a grading strategy
     * @param {string} mode - Grading mode name (e.g., 'omr', 'manual', 'ai')
     * @param {Object} strategy - { name, grade(scanData, answerKey): result }
     */
    function registerGradingStrategy(mode, strategy) {
        _gradingStrategies[mode] = strategy;
    }

    /**
     * Get a grading strategy by mode
     */
    function getGradingStrategy(mode) {
        return _gradingStrategies[mode] || null;
    }

    /**
     * Get all registered grading strategies
     */
    function getGradingStrategies() {
        return { ..._gradingStrategies };
    }

    // ══════════════════════════════════════════
    // SHEET TYPE REGISTRY (R5.2)
    // ══════════════════════════════════════════

    const _sheetTypes = {};

    /**
     * Register a sheet type
     * @param {string} type - Sheet type (e.g., 'multiple-choice', 'essay')
     * @param {Object} definition - { name, render(template), validate(config) }
     */
    function registerSheetType(type, definition) {
        _sheetTypes[type] = definition;
    }

    function getSheetType(type) {
        return _sheetTypes[type] || null;
    }

    function getSheetTypes() {
        return { ..._sheetTypes };
    }

    // ══════════════════════════════════════════
    // PREDEFINED HOOK POINTS
    // ══════════════════════════════════════════

    /**
     * Available hook points (documented for future extension):
     * 
     * - 'before_scan'           : Called before OMR processing starts
     * - 'after_scan'            : Called after OMR processing completes
     * - 'before_grade'          : Called before grading (comparing answers)
     * - 'after_grade'           : Called after grading, can modify result
     * - 'before_export'         : Called before Excel/JSON export
     * - 'after_export'          : Called after export
     * - 'sheet_render'          : Called during sheet PDF rendering
     * - 'project_create'        : Called when a new project is created
     * - 'project_delete'        : Called when a project is deleted
     * - 'result_save'           : Called when a scan result is saved
     * - 'result_modify'         : Called when a result is manually modified
     * - 'detach_student_id'     : [FUTURE] Hook for rọc phách processing
     * - 'essay_grade'           : [FUTURE] Hook for essay grading
     */

    // ══════════════════════════════════════════
    // PREDEFINED EVENTS
    // ══════════════════════════════════════════

    /**
     * Available events:
     * 
     * - 'view:changed'          : { from, to } - Navigation event
     * - 'project:created'       : { project }
     * - 'project:updated'       : { project }
     * - 'project:deleted'       : { projectId }
     * - 'scan:started'          : { projectId }
     * - 'scan:completed'        : { result }
     * - 'scan:failed'           : { error }
     * - 'result:saved'          : { result }
     * - 'result:deleted'        : { resultId }
     * - 'export:started'        : { projectId, format }
     * - 'export:completed'      : { projectId, format }
     * - 'settings:changed'      : { key, value }
     * - 'lang:changed'          : { lang }
     * - 'theme:changed'         : { theme }
     * - 'opencv:loaded'         : {}
     * - 'opencv:error'          : { error }
     */

    return {
        // Event bus
        on,
        once,
        emit,

        // Hooks
        addHook,
        applyHooks,
        applyHooksAsync,

        // Registries
        registerGradingStrategy,
        getGradingStrategy,
        getGradingStrategies,
        registerSheetType,
        getSheetType,
        getSheetTypes,
    };
})();

if (typeof window !== 'undefined') {
    window.Extensibility = Extensibility;
    // Alias for convenience
    window.EventBus = {
        on: Extensibility.on,
        once: Extensibility.once,
        emit: Extensibility.emit,
    };
}
