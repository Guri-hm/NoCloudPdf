window.fadeInOnScroll = {
    observe: function (el) {
        if (!el) return;
        const cb = (entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.remove("opacity-0", "translate-y-8");
                    entry.target.classList.add("opacity-100", "translate-y-0");
                }
            });
        };
        const observer = new IntersectionObserver(cb, { threshold: 0.5 });
        observer.observe(el);
    }
};

window.scrollToSection = function scrollToSection(element) {
    if (element) {
        element.scrollIntoView({ behavior: "smooth" });
    }
}

window.imageViewerUtils = {
    addWheelListener: function(elementId, dotNetRef) {
        const el = document.getElementById(elementId);
        if (!el) return;

        const handler = (e) => {
            // 画像エリア上でホイール操作があったらズーム処理し、デフォルト動作を抑止
            e.preventDefault();
            dotNetRef.invokeMethodAsync('HandleWheelFromJs', e.deltaY);
        };

        // passive: false で登録することで preventDefault が有効になる
        el.addEventListener('wheel', handler, { passive: false });
        el._wheelHandler = handler;
    },

    removeWheelListener: function(elementId) {
        const el = document.getElementById(elementId);
        if (el && el._wheelHandler) {
            el.removeEventListener('wheel', el._wheelHandler);
            delete el._wheelHandler;
        }
    }
};