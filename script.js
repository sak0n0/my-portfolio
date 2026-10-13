// Reveal content once as it enters the viewport. The page stays visible if
// JavaScript is disabled or IntersectionObserver is not supported.
const revealItems = document.querySelectorAll("[data-reveal]");
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (prefersReducedMotion || !("IntersectionObserver" in window)) {
    revealItems.forEach((item) => item.classList.add("is-visible"));
} else {
    const revealObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.classList.add("is-visible");
                observer.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.12,
        rootMargin: "0px 0px -36px 0px"
    });

    revealItems.forEach((item) => revealObserver.observe(item));
}

// CSS hides reveal elements only after this class is added, so a script error
// never leaves page content invisible.
document.documentElement.classList.add("js-ready");

// Let the hero artwork gently follow mouse movement inside its own hitbox.
// Touch users and people who prefer reduced motion keep the static artwork.
const heroArt = document.querySelector(".hero-art");
const portraitToggle = document.querySelector(".portrait-toggle");

if (portraitToggle) {
    portraitToggle.addEventListener("click", () => {
        const isNatural = portraitToggle.classList.toggle("is-natural");
        portraitToggle.setAttribute("aria-pressed", String(isNatural));
    });
}

const canFollowPointer = window.matchMedia(
    "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)"
).matches;

if (heroArt && canFollowPointer) {
    const moveArtwork = (event) => {
        const bounds = heroArt.getBoundingClientRect();
        const horizontal = ((event.clientX - bounds.left) / bounds.width - 0.5) * 2;
        const vertical = ((event.clientY - bounds.top) / bounds.height - 0.5) * 2;

        // Keep the travel subtle so text and artwork remain easy to read.
        heroArt.style.setProperty("--pointer-x", `${(horizontal * 8).toFixed(1)}px`);
        heroArt.style.setProperty("--pointer-y", `${(vertical * 8).toFixed(1)}px`);
    };

    const resetArtwork = () => {
        heroArt.classList.remove("is-pointer-active");
        heroArt.style.setProperty("--pointer-x", "0px");
        heroArt.style.setProperty("--pointer-y", "0px");
    };

    heroArt.addEventListener("pointerenter", (event) => {
        heroArt.classList.add("is-pointer-active");
        moveArtwork(event);
    });
    heroArt.addEventListener("pointermove", moveArtwork);
    heroArt.addEventListener("pointerleave", resetArtwork);
    heroArt.addEventListener("pointercancel", resetArtwork);
}

// Build a measured 0–100 page ruler and section jump points from the sections
// that are actually present in the main element.
const scrollRuler = document.querySelector(".scroll-ruler");
const mainContent = document.querySelector("main");

if (scrollRuler && mainContent) {
    const rulerTrack = scrollRuler.querySelector(".ruler-track");
    const rulerTicks = scrollRuler.querySelector(".ruler-ticks");
    const rulerLabels = scrollRuler.querySelector(".ruler-number-labels");
    const rulerCurrent = scrollRuler.querySelector(".ruler-current");
    const rulerSectionNav = scrollRuler.querySelector(".ruler-section-nav");
    let pageSections = [];
    let sectionPositions = new Map();
    let sectionButtons = new Map();
    let animationFramePending = false;
    let lastProgressPercent = -1;
    let currentSectionState = null;

    // Five-point labels make the scale easy to read; short ticks fill the gaps.
    for (let value = 0; value <= 100; value += 5) {
        const tick = document.createElement("span");
        const isMajorTick = value % 25 === 0;
        tick.className = isMajorTick ? "ruler-tick is-major" : "ruler-tick";
        tick.style.setProperty("--tick-position", `${value}%`);
        rulerTicks.append(tick);

        if (isMajorTick) {
            const label = document.createElement("span");
            label.className = "ruler-number-label";
            label.style.setProperty("--tick-position", `${value}%`);
            label.textContent = String(value);
            rulerLabels.append(label);
        }
    }

    const measureSectionPositions = () => {
        sectionPositions = new Map(pageSections.map((section) => [
            section,
            section.getBoundingClientRect().top + window.scrollY
        ]));
    };

    const rebuildSectionNavigation = () => {
        pageSections = Array.from(mainContent.querySelectorAll("section[id]"));
        sectionButtons = new Map();
        currentSectionState = null;
        rulerSectionNav.replaceChildren();

        pageSections.forEach((section) => {
            const heading = section.querySelector("h1, h2, h3");
            const label = section.dataset.navLabel || heading?.textContent.replace(/\s+/g, " ").trim() || section.id;
            const button = document.createElement("button");
            button.className = "ruler-section-marker";
            button.type = "button";
            button.dataset.label = label;
            button.setAttribute("aria-label", `Go to ${label} section`);
            button.addEventListener("click", () => {
                section.scrollIntoView({
                    behavior: prefersReducedMotion ? "auto" : "smooth",
                    block: "start"
                });
            });
            rulerSectionNav.append(button);
            sectionButtons.set(section, button);
        });

        measureSectionPositions();
    };

    const updateRuler = () => {
        animationFramePending = false;

        const documentRoot = document.documentElement;
        const documentHeight = Math.max(
            documentRoot.scrollHeight,
            document.body.scrollHeight,
            documentRoot.offsetHeight
        );
        const scrollRange = Math.max(0, documentHeight - window.innerHeight);
        const scrollPosition = Math.min(
            Math.max(window.scrollY || documentRoot.scrollTop, 0),
            scrollRange
        );
        const progress = scrollRange === 0 ? 0 : scrollPosition / scrollRange;
        const progressPercent = Math.round(progress * 100);
        const sectionMetrics = measureSections();

        scrollRuler.style.setProperty("--scroll-ratio", String(progress));
        scrollRuler.style.setProperty("--scroll-position", `${progress * 100}%`);
        if (progressPercent !== lastProgressPercent) {
            rulerTrack.setAttribute("aria-valuenow", String(progressPercent));
            rulerTrack.setAttribute("aria-valuetext", `${progressPercent}% through page`);
            rulerCurrent.textContent = `${progressPercent}%`;
            lastProgressPercent = progressPercent;
        }

        const sectionReadingLine = scrollPosition + Math.min(window.innerHeight * 0.38, 220);
        let activeSection = pageSections[0] || null;

        pageSections.forEach((section) => {
            const button = sectionButtons.get(section);
            const top = sectionPositions.get(section) || 0;
            const sectionProgress = scrollRange === 0 ? 0 : Math.min(Math.max(top / scrollRange, 0), 1);
            button.style.setProperty("--section-position", `${sectionProgress * 100}%`);

            if (top <= sectionReadingLine) {
                activeSection = section;
            }
        });

        if (scrollRange > 0 && scrollPosition >= scrollRange - 1) {
            activeSection = pageSections[pageSections.length - 1] || activeSection;
        }

        if (activeSection !== currentSectionState) {
            sectionButtons.forEach((button, section) => {
                const isCurrent = section === activeSection;
                button.classList.toggle("is-current", isCurrent);
                if (isCurrent) {
                    button.setAttribute("aria-current", "location");
                } else {
                    button.removeAttribute("aria-current");
                }
            });
            currentSectionState = activeSection;
        }
    };

    const scheduleRulerUpdate = () => {
        if (!animationFramePending) {
            animationFramePending = true;
            window.requestAnimationFrame(updateRuler);
        }
    };

    rebuildSectionNavigation();
    scheduleRulerUpdate();

    // Passive scrolling plus one animation-frame update keeps layout work low.
    window.addEventListener("scroll", scheduleRulerUpdate, { passive: true });
    const handlePageResize = () => {
        measureSectionPositions();
        scheduleRulerUpdate();
    };
    window.addEventListener("resize", handlePageResize, { passive: true });
    window.addEventListener("load", handlePageResize, { once: true });

    if ("ResizeObserver" in window) {
        const pageResizeObserver = new ResizeObserver(handlePageResize);
        pageResizeObserver.observe(document.documentElement);
        pageResizeObserver.observe(document.body);
        pageResizeObserver.observe(mainContent);
    }

    if (mainContent && "MutationObserver" in window) {
        const sectionObserver = new MutationObserver(() => {
            rebuildSectionNavigation();
            scheduleRulerUpdate();
        });
        sectionObserver.observe(mainContent, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["id", "data-nav-label"]
        });
    }
}
