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
        const observer = new IntersectionObserver(cb, { threshold: 0.5 });
        observer.observe(el);
    }
};

window.positionEditorTooltip = function (triggerEl, tooltipId) {
    const tip = document.getElementById(tooltipId);
    if (!tip) return;
    // 表示してサイズを取れるようにしておく
    tip.style.display = "block";
    tip.setAttribute("aria-hidden", "false");
    tip.style.left = "-9999px";
    tip.style.top = "-9999px";
    tip.style.visibility = "hidden";

    const rect = triggerEl.getBoundingClientRect(); // ビューポート基準
    const tipRect = tip.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;

    const spaceTop = rect.top;
    const spaceBottom = vh - rect.bottom;
    const spaceLeft = rect.left;
    const spaceRight = vw - rect.right;

    let dir = "top";
    if (spaceTop < tipRect.height + 12 && spaceBottom > spaceTop) dir = "bottom";
    if ((dir === "top" || dir === "bottom") && tipRect.width > spaceRight && spaceLeft > spaceRight) dir = "left";
    if ((dir === "top" || dir === "bottom") && tipRect.width > spaceLeft && spaceRight > spaceLeft) dir = "right";

    let left = 0, top = 0;
    const margin = 8;
    if (dir === "top") {
        top = rect.top - tipRect.height - 8;
        left = rect.left + (rect.width - tipRect.width) / 2;
    } else if (dir === "bottom") {
        top = rect.bottom + 8;
        left = rect.left + (rect.width - tipRect.width) / 2;
    } else if (dir === "left") {
        top = rect.top + (rect.height - tipRect.height) / 2;
        left = rect.left - tipRect.width - 8;
    } else { // right
        top = rect.top + (rect.height - tipRect.height) / 2;
        left = rect.right + 8;
    }

    // ビューポート内に収める
    left = Math.max(margin, Math.min(left, vw - tipRect.width - margin));
    top = Math.max(margin, Math.min(top, vh - tipRect.height - margin));

    tip.style.left = Math.round(left) + "px";
    tip.style.top = Math.round(top) + "px";
    tip.setAttribute("data-dir", dir);
    tip.style.visibility = "visible";
};

window.hideEditorTooltip = function (tooltipId) {
    const tip = document.getElementById(tooltipId);
    if (!tip) return;
    tip.style.display = "none";
    tip.setAttribute("aria-hidden", "true");
};