// wwwroot/js/site.js

window.trimPreviewArea = {
    dotNetRef: null,
    
    initialize: function(dotNetRef) {
        this.dotNetRef = dotNetRef;
        
        document.addEventListener('mousemove', (e) => {
            if (this.dotNetRef) {
                this.dotNetRef.invokeMethodAsync('OnPanelMouseMove', e.clientX);
            }
        });
        
        document.addEventListener('mouseup', () => {
            if (this.dotNetRef) {
                this.dotNetRef.invokeMethodAsync('OnPanelMouseUp');
            }
        });
        
        // プレビュー画像のマウスイベント
        document.querySelectorAll('[id^="preview-img-"]').forEach(img => {
            const container = img.parentElement;
            const pageIndex = parseInt(img.id.split('-')[2]);
            
            container.addEventListener('mousedown', (e) => {
                const rect = img.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                this.dotNetRef.invokeMethodAsync('OnMouseDown', pageIndex, x, y);
            });
        });
        
        document.addEventListener('mousemove', (e) => {
            const activeImg = document.querySelector('[id^="preview-img-"]:hover');
            if (activeImg) {
                const rect = activeImg.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                this.dotNetRef.invokeMethodAsync('OnMouseMove', x, y);
            }
        });
        
        document.addEventListener('mouseup', () => {
            this.dotNetRef.invokeMethodAsync('OnMouseUp');
        });
    },
    
    getImageDimensions: function(imgId) {
        const img = document.getElementById(imgId);
        if (img) {
            return [img.offsetWidth, img.offsetHeight];
        }
        return [0, 0];
    },
    
    scrollToPage: function(pageIndex) {
        const container = document.getElementById(`preview-container-${pageIndex}`);
        if (container) {
            container.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }
};

window.getElementDimensions = function(element) {
    if (!element) return [0, 0];
    return [element.offsetWidth, element.offsetHeight];
};

window.scrollToElement = function(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
};


window._trimResize = window._trimResize || {
    dotNetRef: null,
    cleanupForHandle: null
};


window.registerPanelResize = function (dotNetRef, handleId) {
    try {
        // cleanup previous
        if (window._trimResize.cleanupForHandle) {
            try { window._trimResize.cleanupForHandle(); } catch (e) { }
            window._trimResize.cleanupForHandle = null;
        }

        window._trimResize.dotNetRef = dotNetRef;

        const handle = document.getElementById(handleId);
        const thumbArea = document.getElementById('thumbnail-area');
        if (!handle) {
            console.warn('registerPanelResize: handle element not found:', handleId);
            return;
        }
        if (!thumbArea) {
            console.warn('registerPanelResize: thumbnail-area not found');
        }

        // rAF-based throttle state
        let pending = false;
        let latestClientX = 0;

        const onPointerDown = function (e) {
            try {
                handle.setPointerCapture?.(e.pointerId);

                const onPointerMove = function (ev) {
                    latestClientX = ev.clientX;
                    if (!pending) {
                        pending = true;
                        requestAnimationFrame(function () {
                            pending = false;
                            // compute new width based on clientX and thumbnail area container left
                            const containerRect = thumbArea ? thumbArea.getBoundingClientRect() : handle.parentElement.getBoundingClientRect();
                            // clamp to sensible range
                            const minWidth = 150;
                            const minRightWidth = 260;
                            const splitterWidth = handle.getBoundingClientRect().width || 8;
                            const maxWidth = Math.max(minWidth, window.innerWidth - minRightWidth - splitterWidth);
                            const computed = Math.round(latestClientX - containerRect.left);
                            const newWidth = Math.max(minWidth, Math.min(maxWidth, computed));
                            if (thumbArea) {
                                thumbArea.style.setProperty('--thumbnail-width', newWidth + 'px');
                            } else {
                                // fallback: adjust handle.parentElement width inline
                                handle.parentElement.style.width = newWidth + 'px';
                            }
                        });
                    }
                    // do NOT call C# on every move — visual change handled by JS
                };

                const onPointerUp = function (ev) {
                    try {
                        handle.releasePointerCapture?.(ev.pointerId);
                        // final width compute and inform C# once
                        const containerRect = thumbArea ? thumbArea.getBoundingClientRect() : handle.parentElement.getBoundingClientRect();
                        const minWidth = 150;
                        const minRightWidth = 260;
                        const splitterWidth = handle.getBoundingClientRect().width || 8;
                        const maxWidth = Math.max(minWidth, window.innerWidth - minRightWidth - splitterWidth);
                        const finalWidth = Math.max(minWidth, Math.min(maxWidth, Math.round(ev.clientX - containerRect.left)));

                        if (window._trimResize.dotNetRef && window._trimResize.dotNetRef.invokeMethodAsync) {
                            window._trimResize.dotNetRef.invokeMethodAsync('CommitPanelWidth', finalWidth);
                        }
                    } catch (err) {
                        console.error('onPointerUp error', err);
                    }
                    // cleanup listeners
                    handle.removeEventListener('pointermove', onPointerMove);
                    handle.removeEventListener('pointerup', onPointerUp);
                };

                handle.addEventListener('pointermove', onPointerMove);
                handle.addEventListener('pointerup', onPointerUp);
            } catch (e) {
                console.error('onPointerDown error', e);
            }
        };

        handle.addEventListener('pointerdown', onPointerDown);

        window._trimResize.cleanupForHandle = function () {
            try {
                handle.removeEventListener('pointerdown', onPointerDown);
            } catch (e) { }
            window._trimResize.dotNetRef = null;
        };
    } catch (e) {
        console.error('registerPanelResize error', e);
    }
};

window.unregisterPanelResize = function () {
    try {
        if (window._trimResize.cleanupForHandle) {
            window._trimResize.cleanupForHandle();
            window._trimResize.cleanupForHandle = null;
        }
        window._trimResize.dotNetRef = null;
    } catch (e) {
        console.error('unregisterPanelResize error', e);
    }
};

window.setPreviewZoom = function (zoom, mode = 'contain') {
    try {
        console.log('setPreviewZoom start, zoom=', zoom, 'mode=', mode);
        zoom = Math.max(0.25, Math.min(3, Number(zoom) || 1));
        const canvases = document.querySelectorAll('#trim-preview-container canvas');
        console.log('setPreviewZoom found canvases:', canvases.length);
        
        let redrawCount = 0;
        canvases.forEach(c => {
            const src = c.dataset ? c.dataset.src : null;
            console.log('setPreviewZoom canvas', c.id, 'src exists=', !!src, 'drawImageToCanvas exists=', typeof window.drawImageToCanvas);
            if (src && typeof window.drawImageToCanvas === 'function') {
                try {
                    window.drawImageToCanvas(c.id, src, true, zoom, mode);
                    redrawCount++;
                } catch (e) {
                    console.error('drawImageToCanvas failed for', c.id, e);
                }
            } else {
                console.warn('skip canvas', c.id, 'no src or drawImageToCanvas missing');
            }
        });
        
        console.log('setPreviewZoom done, redrawn', redrawCount, 'canvases');
    } catch (e) {
        console.error('setPreviewZoom error', e);
    }
};