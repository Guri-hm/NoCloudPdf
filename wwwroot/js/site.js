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

window._previewZoomDebounce = window._previewZoomDebounce || { timer: null, lastZoom: 1 };

window.setPreviewZoom = function (zoom, mode = 'contain') {
    try {
        console.log('setPreviewZoom start, zoom=', zoom, 'mode=', mode);
        zoom = Math.max(0.25, Math.min(3, Number(zoom) || 1));

        const viewport = document.querySelector('.preview-zoom-viewport');
        const inner = document.getElementById('preview-zoom-inner');
        if (!inner || !viewport) {
            console.warn('setPreviewZoom: preview elements not found');
            return;
        }

        // 前回のズームを参照（存在しなければ1）
        const prev = (window._previewZoomDebounce && window._previewZoomDebounce.lastZoom) ? window._previewZoomDebounce.lastZoom : 1;

        // ビューポート中心（CSSピクセル）を取得し、"非スケール(元座標)" に変換
        const vpClientW = viewport.clientWidth || 1;
        const vpClientH = viewport.clientHeight || 1;
        const centerX_css = (viewport.scrollLeft || 0) + vpClientW / 2;
        const centerY_css = (viewport.scrollTop || 0) + vpClientH / 2;
        const centerX_unscaled = centerX_css / prev;
        const centerY_unscaled = centerY_css / prev;

        // update transform (use CSS variable + explicit transform for robustness)
        inner.style.setProperty('--preview-zoom', String(zoom));
        inner.style.transform = `scale(${zoom})`;
        // Use top-left origin to make scroll math straightforward
        inner.style.transformOrigin = '0 0';

        // 計算した非スケール中心を新スケールに戻し、スクロール位置をセット
        // clamp to valid range
        const newScrollLeft = Math.max(0, Math.min(inner.scrollWidth * zoom - vpClientW, centerX_unscaled * zoom - vpClientW / 2));
        const newScrollTop = Math.max(0, Math.min(inner.scrollHeight * zoom - vpClientH, centerY_unscaled * zoom - vpClientH / 2));

        // apply scroll (instant). If you want smooth, use behavior: 'smooth' via scrollTo.
        viewport.scrollLeft = Math.round(newScrollLeft);
        viewport.scrollTop = Math.round(newScrollTop);

        // store lastZoom
        window._previewZoomDebounce = window._previewZoomDebounce || { timer: null, lastZoom: 1 };
        window._previewZoomDebounce.lastZoom = zoom;

        console.log('setPreviewZoom done, zoom=', zoom, 'scrollLeft=', viewport.scrollLeft, 'scrollTop=', viewport.scrollTop);
    } catch (e) {
        console.error('setPreviewZoom error', e);
    }
};

// 初期フィット計算（オプション：EditPage と同様に container に合わせる）
window.computeAndApplyFitZoom = function () {
    try {
        const container = document.getElementById('trim-preview-container');
        const inner = document.getElementById('preview-zoom-inner');
        if (!container || !inner) return;
        
        const containerW = container.clientWidth || 1;
        const innerW = inner.scrollWidth || inner.getBoundingClientRect().width || 1;
        
        // フィット倍率（内部が container より大きければ縮小）
        const fit = Math.min(1.0, containerW / innerW);
        
        if (typeof window.setPreviewZoom === 'function') {
            window.setPreviewZoom(fit);
        }
        console.log('computeAndApplyFitZoom ->', { containerW, innerW, fit });
    } catch (e) {
        console.error('computeAndApplyFitZoom error', e);
    }
};