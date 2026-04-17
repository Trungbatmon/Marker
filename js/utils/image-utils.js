/**
 * Marker — Image Utilities
 * Camera capture, format conversion helpers
 */

const ImageUtils = (() => {

    /**
     * Capture a frame from a video element
     * @param {HTMLVideoElement} video
     * @param {number} maxWidth - Max width to resize to (for performance)
     * @returns {HTMLCanvasElement}
     */
    function captureFrame(video, maxWidth = 1920) {
        const canvas = document.createElement('canvas');
        let w = video.videoWidth;
        let h = video.videoHeight;

        // Scale down if too large
        if (w > maxWidth) {
            const scale = maxWidth / w;
            w = maxWidth;
            h = Math.round(h * scale);
        }

        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, w, h);
        return canvas;
    }

    /**
     * Convert canvas to Blob
     * @param {HTMLCanvasElement} canvas
     * @param {string} type - MIME type
     * @param {number} quality - 0 to 1
     * @returns {Promise<Blob>}
     */
    function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.85) {
        return new Promise((resolve) => {
            canvas.toBlob(resolve, type, quality);
        });
    }

    /**
     * Convert Blob to Image element
     * @param {Blob} blob
     * @returns {Promise<HTMLImageElement>}
     */
    function blobToImage(blob) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(blob);
            img.onload = () => {
                URL.revokeObjectURL(url);
                resolve(img);
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Failed to load image from blob'));
            };
            img.src = url;
        });
    }

    /**
     * Convert Image element to canvas
     * @param {HTMLImageElement} img
     * @returns {HTMLCanvasElement}
     */
    function imageToCanvas(img) {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        return canvas;
    }

    /**
     * Convert canvas ImageData to cv.Mat (for OpenCV.js)
     * Must be called when OpenCV is loaded
     * @param {ImageData} imageData
     * @returns {cv.Mat}
     */
    function imageDataToMat(imageData) {
        if (typeof cv === 'undefined') throw new Error('OpenCV.js not loaded');
        return cv.matFromImageData(imageData);
    }

    /**
     * Convert cv.Mat to canvas
     * @param {cv.Mat} mat
     * @param {HTMLCanvasElement} canvas
     */
    function matToCanvas(mat, canvas) {
        if (typeof cv === 'undefined') throw new Error('OpenCV.js not loaded');
        cv.imshow(canvas, mat);
    }

    /**
     * Load image from URL/path
     * @param {string} src
     * @returns {Promise<HTMLImageElement>}
     */
    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
            img.src = src;
        });
    }

    /**
     * Resize image maintaining aspect ratio
     * @param {HTMLCanvasElement|HTMLImageElement} source
     * @param {number} maxDim - Max dimension (width or height)
     * @returns {HTMLCanvasElement}
     */
    function resize(source, maxDim) {
        const canvas = document.createElement('canvas');
        const w = source.width || source.naturalWidth;
        const h = source.height || source.naturalHeight;
        const scale = Math.min(maxDim / w, maxDim / h, 1);

        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
        return canvas;
    }

    /**
     * Get ImageData from canvas region
     * @param {HTMLCanvasElement} canvas
     * @param {number} x
     * @param {number} y
     * @param {number} w
     * @param {number} h
     * @returns {ImageData}
     */
    function getRegion(canvas, x, y, w, h) {
        const ctx = canvas.getContext('2d');
        return ctx.getImageData(x, y, w, h);
    }

    /**
     * Calculate mean brightness of an ImageData region
     * @param {ImageData} imageData
     * @returns {number} 0-255
     */
    function meanBrightness(imageData) {
        const data = imageData.data;
        let sum = 0;
        const pixelCount = data.length / 4;
        for (let i = 0; i < data.length; i += 4) {
            // Grayscale approximation: 0.299R + 0.587G + 0.114B
            sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        }
        return sum / pixelCount;
    }

    /**
     * Calculate fill ratio (% of dark pixels)
     * @param {ImageData} imageData
     * @param {number} threshold - Brightness threshold (0-255), pixels below are "dark"
     * @returns {number} 0-1
     */
    function fillRatio(imageData, threshold = 128) {
        const data = imageData.data;
        let darkCount = 0;
        const pixelCount = data.length / 4;
        for (let i = 0; i < data.length; i += 4) {
            const brightness = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
            if (brightness < threshold) darkCount++;
        }
        return darkCount / pixelCount;
    }

    return {
        captureFrame,
        canvasToBlob,
        blobToImage,
        imageToCanvas,
        imageDataToMat,
        matToCanvas,
        loadImage,
        resize,
        getRegion,
        meanBrightness,
        fillRatio,
    };
})();

if (typeof window !== 'undefined') {
    window.ImageUtils = ImageUtils;
}
