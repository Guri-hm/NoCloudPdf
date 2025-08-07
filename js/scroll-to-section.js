window.scrollToSection = function scrollToSection(element) {
    if (element) {
        element.scrollIntoView({ behavior: "smooth" });
    }
}