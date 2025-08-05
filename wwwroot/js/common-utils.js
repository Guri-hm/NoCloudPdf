window.getPageType = function () {
    if (window.location.pathname.includes("/split")) return "split";
    if (window.location.pathname.includes("/merge")) return "merge";
    return "unknown";
};
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
        const observer = new IntersectionObserver(cb, { threshold: 0.2 });
        observer.observe(el);
    }
};