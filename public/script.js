/**
 * MEOW AI AGENT — site scripts
 * Organized as small, independent modules, each with a single job.
 * Every module guards for the elements it needs and no-ops if they're absent,
 * so sections can be added/removed without breaking the rest.
 */
(function () {
  "use strict";

  /* ---------------------------------------------------------
   * Toast — shared tiny notification used by the forms below
   * --------------------------------------------------------- */
  var Toast = (function () {
    var el = document.getElementById("toast");
    var timer = null;
    function show(message) {
      if (!el) return;
      el.textContent = message;
      el.classList.add("show");
      clearTimeout(timer);
      timer = setTimeout(function () { el.classList.remove("show"); }, 2600);
    }
    return { show: show };
  })();

  /* ---------------------------------------------------------
   * ThemeToggle — light/dark, in-memory only (no persistence)
   * --------------------------------------------------------- */
  var ThemeToggle = (function () {
    var btn = document.getElementById("themeToggle");
    if (!btn) return;
    var root = document.documentElement;
    var sunIcon = btn.querySelector(".icon-sun");
    var moonIcon = btn.querySelector(".icon-moon");

    function setTheme(theme) {
      if (theme === "dark") {
        root.setAttribute("data-theme", "dark");
        btn.setAttribute("aria-pressed", "true");
        btn.setAttribute("aria-label", "Switch to light theme");
        sunIcon.classList.add("is-hidden");
        moonIcon.classList.remove("is-hidden");
      } else {
        root.removeAttribute("data-theme");
        btn.setAttribute("aria-pressed", "false");
        btn.setAttribute("aria-label", "Switch to dark theme");
        sunIcon.classList.remove("is-hidden");
        moonIcon.classList.add("is-hidden");
      }
    }

    btn.addEventListener("click", function () {
      var isDark = root.getAttribute("data-theme") === "dark";
      setTheme(isDark ? "light" : "dark");
    });
  })();

  /* ---------------------------------------------------------
   * MobileNav — hamburger toggle for the nav-links list
   * --------------------------------------------------------- */
  var MobileNav = (function () {
    var toggle = document.getElementById("menuToggle");
    var links = document.getElementById("navLinks");
    if (!toggle || !links) return;

    toggle.addEventListener("click", function () {
      var isOpen = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(isOpen));
    });

    links.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        links.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  })();

  /* ---------------------------------------------------------
   * ScrollProgress — thin bar across the top tracking scroll %
   * --------------------------------------------------------- */
  var ScrollProgress = (function () {
    var fill = document.getElementById("progressFill");
    if (!fill) return;
    var ticking = false;

    function update() {
      var scrollTop = window.scrollY;
      var docHeight = document.documentElement.scrollHeight - window.innerHeight;
      var pct = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
      fill.style.width = pct + "%";
      ticking = false;
    }

    window.addEventListener("scroll", function () {
      if (!ticking) {
        requestAnimationFrame(update);
        ticking = true;
      }
    }, { passive: true });

    update();
  })();

  /* ---------------------------------------------------------
   * ScrollSpy — highlights the nav link for the visible section
   * --------------------------------------------------------- */
  var ScrollSpy = (function () {
    var navLinks = document.querySelectorAll(".nav-links a[data-nav]");
    if (!navLinks.length || !("IntersectionObserver" in window)) return;

    var sections = [];
    navLinks.forEach(function (link) {
      var id = link.getAttribute("data-nav");
      var section = document.getElementById(id);
      if (section) sections.push({ link: link, section: section });
    });

    function setActive(id) {
      navLinks.forEach(function (link) {
        link.classList.toggle("active", link.getAttribute("data-nav") === id);
      });
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) setActive(entry.target.id);
      });
    }, { rootMargin: "-40% 0px -50% 0px", threshold: 0 });

    sections.forEach(function (item) { observer.observe(item.section); });
  })();

  /* ---------------------------------------------------------
   * RevealOnScroll — fades/slides in [data-reveal] elements once
   * --------------------------------------------------------- */
  var RevealOnScroll = (function () {
    var items = document.querySelectorAll("[data-reveal]");
    // Elements are visible by default (see stylesheet). Only switch on the
    // hide-then-reveal behavior once we know we can actually observe and
    // reveal them — otherwise leave everything as plainly visible.
    if (!items.length || !("IntersectionObserver" in window)) return;

    document.documentElement.classList.add("reveal-ready");

    var observer = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });

    items.forEach(function (el) { observer.observe(el); });

    // Safety net: if something below the fold never crosses the
    // intersection threshold (e.g. a very short page, a headless
    // renderer that skips scroll events), reveal the rest after the
    // page has settled rather than leaving it invisible forever.
    window.addEventListener("load", function () {
      setTimeout(function () {
        document.querySelectorAll("[data-reveal]:not(.is-visible)").forEach(function (el) {
          var rect = el.getBoundingClientRect();
          if (rect.top < window.innerHeight && rect.bottom > 0) {
            el.classList.add("is-visible");
          }
        });
      }, 1200);
    });
  })();

  /* ---------------------------------------------------------
   * StatCounters — counts stat numbers up when they scroll in
   * --------------------------------------------------------- */
  var StatCounters = (function () {
    var stats = document.querySelectorAll(".stat-num[data-count]");
    if (!stats.length) return;

    function animate(el) {
      var target = parseFloat(el.getAttribute("data-count"));
      var suffix = el.getAttribute("data-suffix") || "";
      var duration = 900;
      var start = null;

      function step(ts) {
        if (start === null) start = ts;
        var progress = Math.min((ts - start) / duration, 1);
        var eased = 1 - Math.pow(1 - progress, 3);
        var value = Math.round(target * eased);
        el.textContent = value.toLocaleString() + suffix;
        if (progress < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }

    if (!("IntersectionObserver" in window)) {
      stats.forEach(animate);
      return;
    }

    var observer = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          animate(entry.target);
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });

    stats.forEach(function (el) { observer.observe(el); });
  })();

  /* ---------------------------------------------------------
   * BackToTop — floating button, appears after scrolling down
   * --------------------------------------------------------- */
  var BackToTop = (function () {
    var btn = document.getElementById("backToTop");
    if (!btn) return;

    window.addEventListener("scroll", function () {
      btn.classList.toggle("show", window.scrollY > 480);
    }, { passive: true });

    btn.hidden = false;
    btn.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  })();

  /* Google is the only supported sign-in method. */
  var AuthModal = (function () {
    document.querySelectorAll("[data-auth]").forEach(function (btn) {
      btn.addEventListener("click", function () { window.location.assign("/auth/google"); });
    });
  })();

  /* ---------------------------------------------------------
   * Validation — small shared helper for inline form errors.
   * Looks for a sibling .field-error under each labeled input.
   * --------------------------------------------------------- */
  var Validation = (function () {
    function messageFor(input) {
      if (input.validity.valueMissing) return "This field is required.";
      if (input.validity.typeMismatch && input.type === "email") return "Enter a valid email address.";
      if (input.validity.tooShort) return "Must be at least " + input.minLength + " characters.";
      return "Please check this field.";
    }

    function showError(input) {
      var errorEl = input.parentElement.querySelector(".field-error");
      input.classList.add("invalid");
      if (errorEl) errorEl.textContent = messageFor(input);
    }

    function clearError(input) {
      var errorEl = input.parentElement.querySelector(".field-error");
      input.classList.remove("invalid");
      if (errorEl) errorEl.textContent = "";
    }

    function clearAll(form) {
      form.querySelectorAll("input, textarea").forEach(clearError);
    }

    function validate(form) {
      var valid = true;
      form.querySelectorAll("input[required], textarea[required]").forEach(function (input) {
        if (!input.checkValidity()) {
          showError(input);
          valid = false;
        } else {
          clearError(input);
        }
      });
      return valid;
    }

    function wireLiveClear(form) {
      form.querySelectorAll("input, textarea").forEach(function (input) {
        input.addEventListener("input", function () {
          if (input.classList.contains("invalid") && input.checkValidity()) clearError(input);
        });
      });
    }

    return { validate: validate, clearAll: clearAll, wireLiveClear: wireLiveClear };
  })();

  /* ---------------------------------------------------------
   * ContactForm
   * --------------------------------------------------------- */
  (function ContactForm() {
    var form = document.getElementById("contactForm");
    if (!form) return;
    Validation.wireLiveClear(form);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!Validation.validate(form)) return;
      form.reset();
      Validation.clearAll(form);
      Toast.show("Message sent — Meow will reply soon.");
    });
  })();

  /* ---------------------------------------------------------
   * NewsletterForm
   * --------------------------------------------------------- */
  (function NewsletterForm() {
    var form = document.getElementById("newsletterForm");
    if (!form) return;
    var input = document.getElementById("newsletterEmail");
    var errorEl = form.querySelector(".field-error");

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!input.checkValidity()) {
        input.classList.add("invalid");
        if (errorEl) errorEl.textContent = "Enter a valid email address.";
        return;
      }
      input.classList.remove("invalid");
      if (errorEl) errorEl.textContent = "";
      form.reset();
      Toast.show("You're on the list.");
    });

    input.addEventListener("input", function () {
      if (input.classList.contains("invalid") && input.checkValidity()) {
        input.classList.remove("invalid");
        if (errorEl) errorEl.textContent = "";
      }
    });
  })();

  /* Show the Google account profile in the landing-page navigation when signed in. */
  (function ProfileNav() {
    var slot = document.querySelector(".auth-buttons");
    if (!slot) return;

    function make(tag, className, text) {
      var el = document.createElement(tag);
      if (className) el.className = className;
      if (text) el.textContent = text;
      return el;
    }

    fetch("/api/auth/me", { cache: "no-store" }).then(function (response) {
      if (!response.ok) return null;
      return response.json();
    }).then(function (data) {
      if (!data || !data.authenticated) return;
      var user = data.user || {};
      var name = user.name || (user.email || "").split("@")[0] || "Yugi user";
      var getStarted = document.querySelector(".hero-actions [data-auth='signup']");
      if (getStarted) {
        var explore = document.createElement("a");
        explore.className = getStarted.className;
        explore.href = "/cli";
        explore.textContent = "Explore Now";
        getStarted.replaceWith(explore);
      }
      var menu = make("div", "profile-menu");
      var trigger = make("button", "profile-trigger");
      trigger.type = "button";
      trigger.setAttribute("aria-expanded", "false");

      var avatarWrap = make("span", "profile-avatar-wrap");
      var initials = make("span", "profile-initials", name.trim().charAt(0).toUpperCase() || "Y");
      avatarWrap.appendChild(initials);
      if (user.picture) {
        try {
          var photo = new URL(user.picture);
          if (photo.protocol === "https:" && (photo.hostname === "googleusercontent.com" || photo.hostname.endsWith(".googleusercontent.com"))) {
            var image = make("img", "profile-avatar");
            image.alt = "";
            image.src = photo.href;
            image.addEventListener("load", function () { initials.hidden = true; }, { once: true });
            image.addEventListener("error", function () { image.remove(); }, { once: true });
            avatarWrap.appendChild(image);
          }
        } catch (_) { /* Use the initial if the Google photo URL is invalid. */ }
      }
      trigger.appendChild(avatarWrap);
      trigger.appendChild(make("span", "profile-trigger-name", name));
      trigger.appendChild(make("span", "profile-chevron", "⌄"));

      var card = make("section", "profile-card");
      card.hidden = true;
      card.setAttribute("aria-label", "Your profile");
      card.appendChild(make("strong", "profile-card-name", name));
      card.appendChild(make("span", "profile-card-email", user.email || ""));
      var signOut = make("button", "btn-link profile-signout", "Sign out");
      signOut.type = "button";
      card.appendChild(signOut);
      trigger.addEventListener("click", function () {
        card.hidden = !card.hidden;
        trigger.setAttribute("aria-expanded", String(!card.hidden));
      });
      document.addEventListener("click", function (event) {
        if (!menu.contains(event.target)) {
          card.hidden = true;
          trigger.setAttribute("aria-expanded", "false");
        }
      });
      signOut.addEventListener("click", function () {
        signOut.disabled = true;
        fetch("/api/auth/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Requested-With": "YugiAgent" },
          body: "{}"
        }).then(function (response) {
          if (response.ok) window.location.reload();
          else { signOut.disabled = false; Toast.show("Could not sign out. Please try again."); }
        }).catch(function () {
          signOut.disabled = false;
          Toast.show("Could not reach the server. Please try again.");
        });
      });

      menu.appendChild(trigger);
      menu.appendChild(card);
      slot.replaceChildren(menu);
    }).catch(function () { /* Landing page remains usable if account status cannot be checked. */ });
  })();
})();
