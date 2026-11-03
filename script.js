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

// Keep the ambient light tied to one animation frame, even on high-rate mice.
if (canFollowPointer) {
    let cursorFramePending = false;
    let latestPointer = null;

    window.addEventListener("pointermove", (event) => {
        latestPointer = event;
        if (cursorFramePending) return;

        cursorFramePending = true;
        window.requestAnimationFrame(() => {
            cursorFramePending = false;
            if (!latestPointer) return;
            document.documentElement.style.setProperty("--cursor-x", `${latestPointer.clientX}px`);
            document.documentElement.style.setProperty("--cursor-y", `${latestPointer.clientY}px`);
        });
    }, { passive: true });

    document.querySelectorAll("[data-pointer-glow]").forEach((surface) => {
        surface.addEventListener("pointermove", (event) => {
            const bounds = surface.getBoundingClientRect();
            surface.style.setProperty("--glow-x", `${event.clientX - bounds.left}px`);
            surface.style.setProperty("--glow-y", `${event.clientY - bounds.top}px`);
        }, { passive: true });

        surface.addEventListener("pointerleave", () => {
            surface.style.setProperty("--glow-x", "50%");
            surface.style.setProperty("--glow-y", "50%");
        });
    });
}

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
    const rulerCurrentValue = scrollRuler.querySelector(".ruler-current-value");
    const rulerSectionNav = scrollRuler.querySelector(".ruler-section-nav");
    let pageSections = [];
    let sectionButtons = new Map();
    let animationFramePending = false;
    let lastProgressPercent = -1;
    let lastFlipAt = 0;
    let currentSectionState = null;

    // Match the reference's 0–100 scale: one short tick per point and a label
    // at every fifth point.
    for (let value = 0; value <= 100; value += 1) {
        const tick = document.createElement("span");
        const isMajorTick = value % 5 === 0;
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

    const measureSections = () => {
        const metrics = pageSections.map((section) => ({
            section,
            top: section.getBoundingClientRect().top + window.scrollY
        }));

        return metrics;
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

        measureSections();
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

        scrollRuler.style.setProperty("--scroll-position", `${progress * 100}%`);
        scrollRuler.classList.toggle("is-at-start", progressPercent === 0);
        scrollRuler.classList.toggle("is-at-end", progressPercent === 100);
        if (progressPercent !== lastProgressPercent) {
            rulerTrack.setAttribute("aria-valuenow", String(progressPercent));
            rulerTrack.setAttribute("aria-valuetext", `${progressPercent}% through page`);

            const shouldFlip = lastProgressPercent >= 0
                && !prefersReducedMotion
                && performance.now() - lastFlipAt >= 175;
            rulerCurrentValue.textContent = String(progressPercent);

            if (shouldFlip) {
                rulerCurrentValue.classList.remove("is-flipping");
                // Restart the split-flap animation for this new reading.
                void rulerCurrentValue.offsetWidth;
                rulerCurrentValue.classList.add("is-flipping");
                lastFlipAt = performance.now();
            }

            lastProgressPercent = progressPercent;
        }

        const sectionReadingLine = scrollPosition + Math.min(window.innerHeight * 0.38, 220);
        let activeSection = pageSections[0] || null;

        sectionMetrics.forEach(({ section, top }) => {
            const button = sectionButtons.get(section);
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

            document.querySelectorAll(".nav-links a[href^='#']").forEach((link) => {
                const isCurrent = activeSection?.id !== "top" && link.hash === `#${activeSection?.id}`;
                link.classList.toggle("is-current", isCurrent);
                if (isCurrent) {
                    link.setAttribute("aria-current", "location");
                } else {
                    link.removeAttribute("aria-current");
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
        measureSections();
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

// Claude portfolio chat. The API key stays on the server; this page only calls
// the same-origin /api/chat endpoint.
const claudeChat = document.querySelector(".claude-chat");

if (claudeChat) {
    const launcher = claudeChat.querySelector(".claude-chat-launcher");
    const panel = claudeChat.querySelector(".claude-chat-panel");
    const closeButton = claudeChat.querySelector(".claude-chat-close");
    const form = claudeChat.querySelector(".claude-chat-form");
    const input = claudeChat.querySelector("#claude-chat-input");
    const messageList = claudeChat.querySelector(".claude-chat-messages");
    const conversation = [];

    const setOpen = (isOpen) => {
        panel.hidden = !isOpen;
        launcher.setAttribute("aria-expanded", String(isOpen));
        if (isOpen) input.focus();
        else launcher.focus();
    };

    const appendMessage = (content, role, extraClass = "") => {
        const message = document.createElement("p");
        message.className = `claude-chat-message is-${role}${extraClass ? ` ${extraClass}` : ""}`;
        message.textContent = content;
        messageList.append(message);
        messageList.scrollTop = messageList.scrollHeight;
        return message;
    };

    launcher.addEventListener("click", () => setOpen(panel.hidden));
    closeButton.addEventListener("click", () => setOpen(false));
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !panel.hidden) setOpen(false);
    });

    input.addEventListener("input", () => {
        input.style.height = "auto";
        input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
    });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const userText = input.value.trim();
        if (!userText || form.dataset.sending === "true") return;

        appendMessage(userText, "user");
        conversation.push({ role: "user", content: userText });
        input.value = "";
        input.style.height = "auto";
        form.dataset.sending = "true";
        const sendButton = form.querySelector("button[type='submit']");
        sendButton.disabled = true;
        input.disabled = true;
        const pendingMessage = appendMessage("Thinking…", "assistant", "is-pending");

        try {
            const response = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ messages: conversation.slice(-12) })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Claude couldn’t reply just now.");

            const reply = typeof data.reply === "string" ? data.reply.trim() : "";
            if (!reply) throw new Error("Claude returned an empty reply. Please try again.");
            pendingMessage.remove();
            conversation.push({ role: "assistant", content: reply });
            appendMessage(reply, "assistant");
        } catch (error) {
            pendingMessage.remove();
            conversation.pop();
            appendMessage(error.message || "I couldn’t connect just now. Please try again.", "assistant", "is-error");
        } finally {
            form.dataset.sending = "false";
            sendButton.disabled = false;
            input.disabled = false;
            input.focus();
        }
    });
}
