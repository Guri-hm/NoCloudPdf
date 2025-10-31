window.tooltipHelper = window.tooltipHelper || {};

(function () {
    const OFFSET = 12;
    const EDGE_MARGIN = 8;

    window.tooltipHelper.show = function (wrapperId, tooltipId) {
        try {
            const wrapper = document.getElementById(wrapperId);
            const tooltip = document.getElementById(tooltipId);
            
            if (!wrapper || !tooltip) {
                console.warn('tooltipHelper.show: element not found', { wrapperId, tooltipId });
                return;
            }

            // 位置を計算（非表示のまま）
            positionTooltip(wrapper, tooltip);

            // 位置確定後に表示（次フレームで opacity/visibility を変更）
            requestAnimationFrame(() => {
                tooltip.style.opacity = '1';
                tooltip.style.visibility = 'visible';
            });
        } catch (e) {
            console.error('tooltipHelper.show error', e);
        }
    };

    window.tooltipHelper.hide = function (tooltipId) {
        try {
            const tooltip = document.getElementById(tooltipId);
            if (tooltip) {
                tooltip.style.opacity = '0';
                tooltip.style.visibility = 'hidden';
            }
        } catch (e) {
            console.error('tooltipHelper.hide error', e);
        }
    };

    function positionTooltip(wrapper, tooltip) {
        const triggerRect = wrapper.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        const placements = [
            {
                name: 'top',
                x: triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2,
                y: triggerRect.top - tooltipRect.height - OFFSET
            },
            {
                name: 'bottom',
                x: triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2,
                y: triggerRect.bottom + OFFSET
            },
            {
                name: 'left',
                x: triggerRect.left - tooltipRect.width - OFFSET,
                y: triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2
            },
            {
                name: 'right',
                x: triggerRect.right + OFFSET,
                y: triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2
            }
        ];

        let chosen = null;
        for (const p of placements) {
            const fitsX = p.x >= EDGE_MARGIN && p.x + tooltipRect.width <= viewportWidth - EDGE_MARGIN;
            const fitsY = p.y >= EDGE_MARGIN && p.y + tooltipRect.height <= viewportHeight - EDGE_MARGIN;
            if (fitsX && fitsY) {
                chosen = p;
                break;
            }
        }

        if (!chosen) chosen = placements[0];

        let finalX = Math.max(EDGE_MARGIN, Math.min(chosen.x, viewportWidth - tooltipRect.width - EDGE_MARGIN));
        let finalY = Math.max(EDGE_MARGIN, Math.min(chosen.y, viewportHeight - tooltipRect.height - EDGE_MARGIN));

        tooltip.style.left = finalX + 'px';
        tooltip.style.top = finalY + 'px';
        tooltip.setAttribute('data-placement', chosen.name);
    }
})();