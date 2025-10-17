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

                            const splitContainerRect = handle.parentElement.getBoundingClientRect();
                            const minLeft = 150;
                            const minRight = 260;
                            const splitterWidth = handle.getBoundingClientRect().width || 8;

                            // compute left width (clamped to split container width)
                            const maxLeft = Math.max(minLeft, Math.round(splitContainerRect.width - minRight - splitterWidth));
                            const computedLeft = Math.round(latestClientX - splitContainerRect.left);
                            const newLeftWidth = Math.max(minLeft, Math.min(maxLeft, computedLeft));

                            // compute right width so left+splitter+right == splitContainerRect.width (clamped)
                            const newRightWidthUnclamped = Math.round(splitContainerRect.width - newLeftWidth - splitterWidth);
                            const newRightWidth = Math.max(minRight, Math.min(Math.round(splitContainerRect.width - minLeft - splitterWidth), newRightWidthUnclamped));

                            // apply to left pane
                            if (thumbArea) {
                                thumbArea.style.setProperty('--thumbnail-width', newLeftWidth + 'px');
                                thumbArea.style.width = newLeftWidth + 'px';
                                thumbArea.style.maxWidth = maxLeft + 'px';
                            } else {
                                handle.parentElement.style.width = newLeftWidth + 'px';
                            }
                            // apply to right pane (handle.nextElementSibling is the right pane)
                            const rightPane = handle.nextElementSibling;
                            if (rightPane) {
                                rightPane.style.width = newRightWidth + 'px';
                                rightPane.style.flex = '0 0 auto';
                            }
                        });
                    }
                };
                const onPointerUp = function (ev) {
                    try {
                        handle.releasePointerCapture?.(ev.pointerId);
                        
                        const splitContainerRect = handle.parentElement.getBoundingClientRect();
                        const minWidth = 150;
                        const minRightWidth = 260;
                        const splitterWidth = handle.getBoundingClientRect().width || 8;

                        const maxLeft = Math.max(minLeft, Math.round(splitContainerRect.width - minRight - splitterWidth));
                        const computedFinalLeft = Math.round(ev.clientX - splitContainerRect.left);
                        const finalLeftWidth = Math.max(minLeft, Math.min(maxLeft, computedFinalLeft));
                        const finalRightUnclamped = Math.round(splitContainerRect.width - finalLeftWidth - splitterWidth);
                    
                        if (window._trimResize.dotNetRef && window._trimResize.dotNetRef.invokeMethodAsync) {
                            window._trimResize.dotNetRef.invokeMethodAsync('CommitPanelWidth', finalLeftWidth);
                        }
                        // persist styles on final commit
                        if (thumbArea) {
                            thumbArea.style.setProperty('--thumbnail-width', finalLeftWidth + 'px');
                            thumbArea.style.width = finalLeftWidth + 'px';
                            thumbArea.style.maxWidth = maxLeft + 'px';
                        }
                        const rightPaneFinal = handle.nextElementSibling;
                        if (rightPaneFinal) {
                            rightPaneFinal.style.width = finalRightWidth + 'px';
                            rightPaneFinal.style.flex = '0 0 auto';
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
        zoom = Math.max(0.25, Math.min(3, Number(zoom) || 1));

        const viewport = document.querySelector('.preview-zoom-viewport');
        const inner = document.getElementById('preview-zoom-inner');
        if (!inner || !viewport) return;

        // 前回のズーム（なければ1）
        const prev = (window._previewZoomState && window._previewZoomState.lastZoom) ? window._previewZoomState.lastZoom : 1;

        // 1) ビューポートの画面上中心を inner のクライアント座標系に変換（現在のスケール prev のまま）
        const vpRect = viewport.getBoundingClientRect();
        const innerRect = inner.getBoundingClientRect();
        const centerClientX = vpRect.left + vpRect.width / 2;
        const centerClientY = vpRect.top + vpRect.height / 2;
        // center position inside inner's client rect (still scaled by prev)
        const centerInnerClientX = centerClientX - innerRect.left;
        const centerInnerClientY = centerClientY - innerRect.top;
        // convert to unscaled (logical) coordinates
        const centerUnscaledX = centerInnerClientX / prev;
        const centerUnscaledY = centerInnerClientY / prev;

        // 2) apply transform (scale) using top-left origin
        inner.style.setProperty('--preview-zoom', String(zoom));
        inner.style.transform = `scale(${zoom})`;
        inner.style.transformOrigin = '0 0';

        // 3) compute new scroll so that the same content-center stays centered in viewport
        const vpW = vpRect.width;
        const vpH = vpRect.height;
        // scaled content size (use inner.scrollWidth/Height * zoom as fallback)
        const contentScaledW = (inner.scrollWidth || innerRect.width) * zoom;
        const contentScaledH = (inner.scrollHeight || innerRect.height) * zoom;

        let newScrollLeft = centerUnscaledX * zoom - vpW / 2;
        let newScrollTop  = centerUnscaledY * zoom - vpH / 2;

        // clamp
        newScrollLeft = Math.max(0, Math.min(contentScaledW - vpW, newScrollLeft));
        newScrollTop  = Math.max(0, Math.min(contentScaledH - vpH, newScrollTop));

        viewport.scrollLeft = Math.round(newScrollLeft);
        viewport.scrollTop = Math.round(newScrollTop);

        // store last zoom
        window._previewZoomState = window._previewZoomState || {};
        window._previewZoomState.lastZoom = zoom;
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