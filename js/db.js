/**
 * Marker — IndexedDB Database Wrapper
 * Rule R3.1: Offline-first storage
 * Rule R3.2: Project isolation
 * Rule R3.3: Original scan images always stored
 */

const MarkerDB = (() => {
    let _db = null;

    const STORES = {
        PROJECTS: 'projects',
        TEMPLATES: 'templates',
        ANSWER_KEYS: 'answerKeys',
        SCAN_RESULTS: 'scanResults',
        SETTINGS: 'settings',
    };

    // ══════════════════════════════════════════
    // INITIALIZATION
    // ══════════════════════════════════════════

    /**
     * Open/create the database
     * @returns {Promise<IDBDatabase>}
     */
    function open() {
        return new Promise((resolve, reject) => {
            if (_db) {
                resolve(_db);
                return;
            }

            const request = indexedDB.open(CONSTANTS.DB_NAME, CONSTANTS.DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // ── Projects Store ──
                if (!db.objectStoreNames.contains(STORES.PROJECTS)) {
                    const store = db.createObjectStore(STORES.PROJECTS, { keyPath: 'id' });
                    store.createIndex('status', 'status', { unique: false });
                    store.createIndex('createdAt', 'createdAt', { unique: false });
                    store.createIndex('updatedAt', 'updatedAt', { unique: false });
                }

                // ── Templates Store ──
                if (!db.objectStoreNames.contains(STORES.TEMPLATES)) {
                    const store = db.createObjectStore(STORES.TEMPLATES, { keyPath: 'id' });
                    store.createIndex('type', 'type', { unique: false });
                    store.createIndex('createdAt', 'createdAt', { unique: false });
                }

                // ── Answer Keys Store ──
                if (!db.objectStoreNames.contains(STORES.ANSWER_KEYS)) {
                    const store = db.createObjectStore(STORES.ANSWER_KEYS, { keyPath: 'id' });
                    store.createIndex('projectId', 'projectId', { unique: false });
                    store.createIndex('examCode', 'examCode', { unique: false });
                }

                // ── Scan Results Store ──
                if (!db.objectStoreNames.contains(STORES.SCAN_RESULTS)) {
                    const store = db.createObjectStore(STORES.SCAN_RESULTS, { keyPath: 'id' });
                    store.createIndex('projectId', 'projectId', { unique: false });
                    store.createIndex('answerKeyId', 'answerKeyId', { unique: false });
                    store.createIndex('studentId', 'studentId', { unique: false });
                    store.createIndex('scannedAt', 'scannedAt', { unique: false });
                }

                // ── Settings Store ──
                if (!db.objectStoreNames.contains(STORES.SETTINGS)) {
                    db.createObjectStore(STORES.SETTINGS, { keyPath: 'key' });
                }
            };

            request.onsuccess = (event) => {
                _db = event.target.result;

                // Handle connection close
                _db.onclose = () => {
                    _db = null;
                };

                resolve(_db);
            };

            request.onerror = (event) => {
                console.error('[DB] Failed to open database:', event.target.error);
                reject(event.target.error);
            };
        });
    }

    // ══════════════════════════════════════════
    // GENERIC CRUD OPERATIONS
    // ══════════════════════════════════════════

    /**
     * Get all records from a store
     * @param {string} storeName
     * @returns {Promise<Array>}
     */
    async function getAll(storeName) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get a single record by ID
     * @param {string} storeName
     * @param {string} id
     * @returns {Promise<Object|undefined>}
     */
    async function get(storeName, id) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Put (insert or update) a record
     * @param {string} storeName
     * @param {Object} data
     * @returns {Promise<string>} The record's key
     */
    async function put(storeName, data) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.put(data);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Delete a record by ID
     * @param {string} storeName
     * @param {string} id
     * @returns {Promise<void>}
     */
    async function remove(storeName, id) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get records by index value
     * @param {string} storeName
     * @param {string} indexName
     * @param {*} value
     * @returns {Promise<Array>}
     */
    async function getByIndex(storeName, indexName, value) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const index = store.index(indexName);
            const request = index.getAll(value);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Count records by index value
     * @param {string} storeName
     * @param {string} indexName
     * @param {*} value
     * @returns {Promise<number>}
     */
    async function countByIndex(storeName, indexName, value) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const index = store.index(indexName);
            const request = index.count(value);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Clear all records from a store
     * @param {string} storeName
     * @returns {Promise<void>}
     */
    async function clear(storeName) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // ══════════════════════════════════════════
    // PROJECT-SPECIFIC OPERATIONS (R3.2)
    // ══════════════════════════════════════════

    /**
     * Delete a project and ALL related data (answer keys, results)
     * @param {string} projectId
     */
    async function deleteProjectCascade(projectId) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(
                [STORES.PROJECTS, STORES.ANSWER_KEYS, STORES.SCAN_RESULTS],
                'readwrite'
            );

            // Delete the project
            tx.objectStore(STORES.PROJECTS).delete(projectId);

            // Delete related answer keys
            const akIndex = tx.objectStore(STORES.ANSWER_KEYS).index('projectId');
            akIndex.openCursor(projectId).onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                }
            };

            // Delete related scan results
            const srIndex = tx.objectStore(STORES.SCAN_RESULTS).index('projectId');
            srIndex.openCursor(projectId).onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                }
            };

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    /**
     * Get scan count for a project
     * @param {string} projectId
     * @returns {Promise<number>}
     */
    async function getProjectScanCount(projectId) {
        return countByIndex(STORES.SCAN_RESULTS, 'projectId', projectId);
    }

    /**
     * Get today's scan count
     * @returns {Promise<number>}
     */
    async function getTodayScanCount() {
        const allResults = await getAll(STORES.SCAN_RESULTS);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return allResults.filter(r => new Date(r.scannedAt) >= today).length;
    }

    /**
     * Get average score for a project
     * @param {string} projectId
     * @returns {Promise<number|null>}
     */
    async function getProjectAvgScore(projectId) {
        const results = await getByIndex(STORES.SCAN_RESULTS, 'projectId', projectId);
        if (results.length === 0) return null;
        const sum = results.reduce((acc, r) => acc + (r.score || 0), 0);
        return Math.round((sum / results.length) * 100) / 100;
    }

    // ══════════════════════════════════════════
    // SETTINGS HELPERS
    // ══════════════════════════════════════════

    async function getSetting(key, defaultValue = null) {
        const record = await get(STORES.SETTINGS, key);
        return record ? record.value : defaultValue;
    }

    async function setSetting(key, value) {
        return put(STORES.SETTINGS, { key, value });
    }

    // ══════════════════════════════════════════
    // BACKUP / RESTORE (R3.4)
    // ══════════════════════════════════════════

    /**
     * Export entire database to JSON
     * @returns {Promise<Object>}
     */
    async function exportAll() {
        const data = {
            version: CONSTANTS.APP_VERSION,
            exportedAt: new Date().toISOString(),
            projects: await getAll(STORES.PROJECTS),
            templates: await getAll(STORES.TEMPLATES),
            answerKeys: await getAll(STORES.ANSWER_KEYS),
            // Note: scan results with Blob images are excluded for size
            scanResults: (await getAll(STORES.SCAN_RESULTS)).map(r => ({
                ...r,
                scanImage: null,       // Exclude blob for portability
                processedImage: null,
            })),
            settings: await getAll(STORES.SETTINGS),
        };
        return data;
    }

    /**
     * Import data from JSON backup
     * @param {Object} data - Previously exported data
     */
    async function importAll(data) {
        if (!data || !data.version) {
            throw new Error('Invalid backup data');
        }

        const storeMap = {
            projects: STORES.PROJECTS,
            templates: STORES.TEMPLATES,
            answerKeys: STORES.ANSWER_KEYS,
            scanResults: STORES.SCAN_RESULTS,
            settings: STORES.SETTINGS,
        };

        for (const [key, storeName] of Object.entries(storeMap)) {
            if (data[key] && Array.isArray(data[key])) {
                for (const record of data[key]) {
                    await put(storeName, record);
                }
            }
        }
    }

    /**
     * Clear the entire database
     */
    async function clearAll() {
        for (const storeName of Object.values(STORES)) {
            await clear(storeName);
        }
    }

    return {
        STORES,
        open,
        getAll,
        get,
        put,
        remove,
        getByIndex,
        countByIndex,
        clear,
        deleteProjectCascade,
        getProjectScanCount,
        getTodayScanCount,
        getProjectAvgScore,
        getSetting,
        setSetting,
        exportAll,
        importAll,
        clearAll,
    };
})();

if (typeof window !== 'undefined') {
    window.MarkerDB = MarkerDB;
}
