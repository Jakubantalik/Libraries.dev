/* Libraries.dev — shared nav behaviors (mobile menu, 3-dot menu,
 * ⌘K palette, GitHub stars). Ported from transitions.dev inline
 * scripts; theme handling removed (site is dark-only). */
(function () {
  "use strict";

  /* ── Mobile menu ─────────────────────────────────────────── */
  var burger = document.getElementById("nav-burger");
  var backdrop = document.getElementById("mobile-menu-backdrop");
  var CLOSE_MS = 300;
  var closeTimer = null;

  function openMenu() {
    document.body.classList.remove("menu-closing");
    document.body.classList.add("menu-open");
    if (burger) burger.setAttribute("aria-expanded", "true");
  }
  function closeMenu() {
    if (!document.body.classList.contains("menu-open")) return;
    document.body.classList.remove("menu-open");
    document.body.classList.add("menu-closing");
    if (burger) burger.setAttribute("aria-expanded", "false");
    clearTimeout(closeTimer);
    closeTimer = setTimeout(function () {
      document.body.classList.remove("menu-closing");
    }, CLOSE_MS);
  }
  if (burger) {
    burger.addEventListener("click", function () {
      document.body.classList.contains("menu-open") ? closeMenu() : openMenu();
    });
  }
  if (backdrop) backdrop.addEventListener("click", closeMenu);
  document.querySelectorAll(".mobile-menu-link, .mobile-menu-cta").forEach(function (el) {
    el.addEventListener("click", closeMenu);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeMenu();
  });
  window.addEventListener("resize", function () {
    if (window.innerWidth > 639) {
      document.body.classList.remove("menu-open", "menu-closing");
      if (burger) burger.setAttribute("aria-expanded", "false");
    }
  });

  /* ── 3-dot menu ──────────────────────────────────────────── */
  var moreBtn = document.getElementById("more-btn");
  var moreMenu = document.getElementById("more-menu");
  var MENU_CLOSE_MS = 150;
  var menuCloseTimer = null;

  function menuIsOpen() { return moreMenu && moreMenu.classList.contains("is-open"); }
  function openMore() {
    if (!moreMenu) return;
    clearTimeout(menuCloseTimer);
    moreMenu.classList.remove("is-closing");
    moreMenu.classList.add("is-open");
    if (moreBtn) moreBtn.setAttribute("aria-expanded", "true");
  }
  function closeMore() {
    if (!menuIsOpen()) return;
    moreMenu.classList.remove("is-open");
    moreMenu.classList.add("is-closing");
    if (moreBtn) moreBtn.setAttribute("aria-expanded", "false");
    clearTimeout(menuCloseTimer);
    menuCloseTimer = setTimeout(function () {
      moreMenu.classList.remove("is-closing");
    }, MENU_CLOSE_MS);
  }
  if (moreBtn) {
    moreBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      menuIsOpen() ? closeMore() : openMore();
    });
    document.addEventListener("click", function (e) {
      if (menuIsOpen() && !moreMenu.contains(e.target)) closeMore();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeMore();
    });
  }

  /* ── ⌘K command palette ──────────────────────────────────── */
  var PAGES = [
    { label: "Home", href: "/" },
    { label: "Beam", href: "/beam.html" },
    { label: "Orb", href: "/orbs.html" },
    { label: "Gooey", href: "/gooey.html" },
    { label: "Metal", href: "/metal.html" },
    { label: "Image", href: "/image.html" },
    { label: "Studio", href: "/studio.html" },
    { label: "Libraries Pro", href: "/pro.html" }
  ];
  var ACTIONS = [
    { label: "Get Pro access", href: "/pro.html" },
    { label: "View on GitHub", href: "https://github.com/Jakubantalik/Libraries.dev", external: true },
    { label: "Contact support", href: "mailto:jakubja@gmail.com" }
  ];

  var searchBtn = document.getElementById("nav-search-btn");
  var kbdEl = document.getElementById("nav-search-kbd");
  var isMac = /Mac|iPhone|iPad/.test(navigator.platform || "");
  if (kbdEl) kbdEl.textContent = isMac ? "⌘K" : "Ctrl K";

  var overlay = null, input = null, listEl = null, activeIdx = 0, items = [];

  function buildPalette() {
    overlay = document.createElement("div");
    overlay.className = "cmdk-overlay";
    overlay.innerHTML =
      '<div class="cmdk-panel" role="dialog" aria-label="Search">' +
      '<div class="cmdk-search">' +
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="5"/><path d="M14 14l-3.5-3.5"/></svg>' +
      '<input class="cmdk-input" type="text" placeholder="Search libraries, pages…" aria-label="Search" />' +
      '<span class="cmdk-esc">Esc</span>' +
      "</div>" +
      '<div class="cmdk-list" role="listbox"></div>' +
      "</div>";
    document.body.appendChild(overlay);
    input = overlay.querySelector(".cmdk-input");
    listEl = overlay.querySelector(".cmdk-list");
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closePalette();
    });
    input.addEventListener("input", function () { render(input.value); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      else if (e.key === "Enter") {
        e.preventDefault();
        var el = items[activeIdx];
        if (el) el.click();
      }
    });
    render("");
  }

  function makeItem(entry, group) {
    var a = document.createElement("a");
    a.className = "cmdk-item";
    a.href = entry.href;
    if (entry.external) { a.target = "_blank"; a.rel = "noopener noreferrer"; }
    a.innerHTML = '<span class="cmdk-item-label"></span><span class="cmdk-item-hint">' + group + "</span>";
    a.querySelector(".cmdk-item-label").textContent = entry.label;
    return a;
  }

  function render(q) {
    if (!listEl) return;
    q = (q || "").trim().toLowerCase();
    listEl.innerHTML = "";
    items = [];
    activeIdx = 0;
    var groups = [
      { name: "Pages", entries: PAGES },
      { name: "Actions", entries: ACTIONS }
    ];
    groups.forEach(function (g) {
      var matched = g.entries.filter(function (e) {
        return !q || e.label.toLowerCase().indexOf(q) !== -1;
      });
      if (!matched.length) return;
      var label = document.createElement("div");
      label.className = "cmdk-group-label";
      label.textContent = g.name;
      listEl.appendChild(label);
      matched.forEach(function (entry) {
        var el = makeItem(entry, g.name);
        listEl.appendChild(el);
        items.push(el);
      });
    });
    if (!items.length) {
      var empty = document.createElement("div");
      empty.className = "cmdk-empty";
      empty.textContent = "No results";
      listEl.appendChild(empty);
    }
    highlight();
  }

  function highlight() {
    items.forEach(function (el, i) {
      el.setAttribute("data-active", i === activeIdx ? "true" : "false");
    });
  }
  function move(d) {
    if (!items.length) return;
    activeIdx = (activeIdx + d + items.length) % items.length;
    highlight();
    items[activeIdx].scrollIntoView({ block: "nearest" });
  }

  function openPalette() {
    if (!overlay) buildPalette();
    overlay.setAttribute("data-open", "true");
    input.value = "";
    render("");
    requestAnimationFrame(function () { input.focus(); });
  }
  function closePalette() {
    if (overlay) overlay.removeAttribute("data-open");
  }

  if (searchBtn) searchBtn.addEventListener("click", openPalette);
  document.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      overlay && overlay.getAttribute("data-open") === "true" ? closePalette() : openPalette();
    } else if (e.key === "Escape") {
      closePalette();
    }
  });

  /* ── GitHub stars ────────────────────────────────────────── */
  var starsBtn = document.getElementById("gh-stars-btn");
  var starsCount = document.getElementById("gh-stars-count");
  var GH_REPO = "Jakubantalik/Libraries.dev";
  var GH_KEY = "ldev:gh-stars";
  var GH_TTL = 5 * 60 * 1000;

  function fmtStars(n) {
    if (n >= 1000) return (Math.round(n / 100) / 10) + "k";
    return String(n);
  }
  function setStars(n) {
    if (starsCount) starsCount.textContent = fmtStars(n);
    if (starsBtn) starsBtn.removeAttribute("data-loading");
  }
  if (starsBtn && starsCount) {
    var cached = null;
    try { cached = JSON.parse(sessionStorage.getItem(GH_KEY) || "null"); } catch (e) {}
    if (cached && Date.now() - cached.t < GH_TTL) {
      setStars(cached.n);
    } else {
      fetch("https://api.github.com/repos/" + GH_REPO)
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (typeof d.stargazers_count === "number") {
            try { sessionStorage.setItem(GH_KEY, JSON.stringify({ n: d.stargazers_count, t: Date.now() })); } catch (e) {}
            setStars(d.stargazers_count);
          } else if (cached) { setStars(cached.n); }
          else { if (starsCount) starsCount.textContent = "Star"; if (starsBtn) starsBtn.removeAttribute("data-loading"); }
        })
        .catch(function () {
          if (cached) setStars(cached.n);
          else { if (starsCount) starsCount.textContent = "Star"; if (starsBtn) starsBtn.removeAttribute("data-loading"); }
        });
    }
  }

  /* ── Copy buttons (per-card) ─────────────────────────────── */
  /* Every .card-copy with data-copy-text (or data-copy-target
     pointing at a <script type="text/plain">) gets the tooltip +
     copied-state behavior from transitions.dev. */
  document.querySelectorAll(".card-copy").forEach(function (btn) {
    var tip = document.createElement("span");
    tip.className = "card-copy-tooltip";
    tip.setAttribute("aria-hidden", "true");
    tip.innerHTML =
      '<span class="tt-text">Cop<span class="tt-swap"><span class="tt-label tt-a">y code</span><span class="tt-label tt-b">ied</span></span></span>';
    btn.appendChild(tip);
    var swap = tip.querySelector(".tt-swap");
    var a = tip.querySelector(".tt-a");
    var b = tip.querySelector(".tt-b");
    requestAnimationFrame(function () {
      var wa = a.getBoundingClientRect().width;
      var prevPos = b.style.position;
      b.style.position = "static";
      a.style.display = "none";
      var wb = b.getBoundingClientRect().width;
      a.style.display = "";
      b.style.position = prevPos;
      swap.style.setProperty("--tt-w-a", wa + "px");
      swap.style.setProperty("--tt-w-b", wb + "px");
    });
    var resetTimer = null;
    btn.addEventListener("click", function () {
      var text = btn.getAttribute("data-copy-text");
      if (!text) {
        var sel = btn.getAttribute("data-copy-target");
        if (sel) {
          var src = document.querySelector(sel);
          if (src) text = src.textContent;
        }
      }
      if (!text) return;
      navigator.clipboard && navigator.clipboard.writeText(text).catch(function () {});
      btn.setAttribute("data-copied", "true");
      swap.setAttribute("data-state", "copied");
      clearTimeout(resetTimer);
      resetTimer = setTimeout(function () {
        btn.removeAttribute("data-copied");
        swap.removeAttribute("data-state");
      }, 1600);
    });
  });

  /* ── Code-block copy buttons (detail pages, how-to-use) ───────
   * The static <pre> blocks' .code-copy buttons get the same tooltip
   * and copied state the Studio's CodeCopy renders (controls.tsx): the
   * label tail cross-blurs "y code" -> "ied" and the pill tweens between
   * the two measured widths. data-copy-static reads the sibling <pre>;
   * data-copy-target points at an element by selector. Install & Usage
   * starts hidden, so widths are re-measured when the block can be
   * seen and a 0 is never written. */
  var codeCopyMeasures = [];
  function remeasureCodeCopies() {
    /* Synchronously first — the block is already un-hidden by the time this
       runs, so layout can be forced — then once more on the next frame in
       case fonts or a transition settle the width. */
    codeCopyMeasures.forEach(function (m) { m(); });
    requestAnimationFrame(function () { codeCopyMeasures.forEach(function (m) { m(); }); });
  }
  document.querySelectorAll(".code-copy[data-copy-static], .code-copy[data-copy-target]").forEach(function (btn) {
    if (btn.querySelector(".code-copy-tooltip")) return;
    var label = btn.getAttribute("aria-label") || "Copy";
    var tip = document.createElement("span");
    tip.className = "code-copy-tooltip";
    tip.setAttribute("aria-hidden", "true");
    tip.innerHTML =
      '<span class="tt-text">Cop<span class="tt-swap"><span class="tt-label tt-a">y code</span><span class="tt-label tt-b">ied</span></span></span>';
    btn.appendChild(tip);
    var swap = tip.querySelector(".tt-swap");
    var a = tip.querySelector(".tt-a");
    var b = tip.querySelector(".tt-b");
    function measure() {
      var wa = a.getBoundingClientRect().width;
      if (!wa) return;
      var prevPos = b.style.position;
      b.style.position = "static";
      a.style.display = "none";
      var wb = b.getBoundingClientRect().width;
      a.style.display = "";
      b.style.position = prevPos;
      swap.style.setProperty("--tt-w-a", wa + "px");
      swap.style.setProperty("--tt-w-b", wb + "px");
    }
    requestAnimationFrame(measure);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
    if (window.ResizeObserver) new ResizeObserver(measure).observe(swap);
    /* The panel these live in starts hidden and the observer does not
       always catch it opening, so measure again at the moments that
       matter: when the tab or platform switch reveals the block, and on
       the way into the button. */
    codeCopyMeasures.push(measure);
    btn.addEventListener("mouseenter", measure);
    btn.addEventListener("focus", measure);

    var timer = null;
    btn.addEventListener("click", function () {
      measure();
      var text = "";
      var sel = btn.getAttribute("data-copy-target");
      if (sel) {
        var src = document.querySelector(sel);
        if (src) text = src.textContent || "";
      } else {
        var block = btn.closest(".code-block");
        var pre = block && block.querySelector("pre");
        if (pre) text = pre.textContent || "";
      }
      if (!text) return;
      if (navigator.clipboard) navigator.clipboard.writeText(text).catch(function () {});
      btn.setAttribute("data-copied", "true");
      btn.setAttribute("aria-label", "Copied");
      swap.setAttribute("data-state", "copied");
      clearTimeout(timer);
      timer = setTimeout(function () {
        btn.removeAttribute("data-copied");
        btn.setAttribute("aria-label", label);
        swap.removeAttribute("data-state");
      }, 1600);
    });
  });

  /* ── Platform row under Install & Usage ───────────────────
   * Beam and Orb ship ports, so the row swaps the whole install+usage
   * pair — the same thing the Studio's StageBar does with its platform
   * state. Pages without ports simply have no row. */
  var platformBar = document.querySelector("[data-detail-platforms]");
  if (platformBar) {
    var pTabs = [].slice.call(platformBar.querySelectorAll("[data-platform-tab]"));
    var pPanels = [].slice.call(document.querySelectorAll("[data-platform]"));

    var selectPlatform = function (id) {
      pTabs.forEach(function (t) {
        var on = t.getAttribute("data-platform-tab") === id;
        t.setAttribute("aria-selected", on ? "true" : "false");
        if (on) t.setAttribute("data-active", "true");
        else t.removeAttribute("data-active");
      });
      pPanels.forEach(function (panel) {
        if (panel.getAttribute("data-platform") === id) panel.removeAttribute("hidden");
        else panel.setAttribute("hidden", "");
      });
      remeasureCodeCopies();
    };

    pTabs.forEach(function (t) {
      t.addEventListener("click", function () {
        selectPlatform(t.getAttribute("data-platform-tab"));
      });
    });
  }

  /* ── Detail-page tabs (Preview / Install / Usage) ──────────
   * The pill indicator is positioned from the selected button's own
   * box, so it stays correct when the label widths differ per page.
   * Measured on demand rather than cached: the tab bar is inside a
   * flex row that reflows on resize. */
  var tabBar = document.querySelector("[data-detail-tabs]");
  if (tabBar) {
    var indicator = tabBar.querySelector(".proto-modal-tabs-indicator");
    var tabs = [].slice.call(tabBar.querySelectorAll("[data-detail-tab]"));
    var panels = [].slice.call(document.querySelectorAll("[data-detail-panel]"));

    function moveIndicator(btn) {
      if (!indicator || !btn) return;
      indicator.style.width = btn.offsetWidth + "px";
      indicator.style.transform = "translateX(" + btn.offsetLeft + "px)";
    }

    function selectTab(name) {
      tabs.forEach(function (t) {
        var on = t.getAttribute("data-detail-tab") === name;
        t.setAttribute("aria-selected", on ? "true" : "false");
        if (on) moveIndicator(t);
      });
      panels.forEach(function (p) {
        if (p.getAttribute("data-detail-panel") === name) p.removeAttribute("hidden");
        else p.setAttribute("hidden", "");
      });
      remeasureCodeCopies();
    }

    tabs.forEach(function (t) {
      t.addEventListener("click", function () {
        selectTab(t.getAttribute("data-detail-tab"));
      });
    });

    var initial = tabs.filter(function (t) {
      return t.getAttribute("aria-selected") === "true";
    })[0] || tabs[0];
    if (initial) {
      // Wait for webfonts: measuring before Saans/Inter land sizes the
      // indicator to the fallback face and leaves it short.
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () { moveIndicator(initial); });
      }
      moveIndicator(initial);
    }
    window.addEventListener("resize", function () {
      var current = tabs.filter(function (t) {
        return t.getAttribute("aria-selected") === "true";
      })[0];
      moveIndicator(current);
    });
  }

  /* ── Copy prompt ───────────────────────────────────────────
   * Hands the whole library — install line, usage, prop vocabulary —
   * to a coding agent in one paste. The wording lives in a hidden
   * element the button points at, so each detail page keeps its
   * prompt as readable source rather than an escaped attribute. */
  var promptBtns = [].slice.call(document.querySelectorAll("[data-prompt-target]"));
  promptBtns.forEach(function (btn) {
    var timer = null;
    btn.addEventListener("click", function () {
      var src = document.querySelector(btn.getAttribute("data-prompt-target"));
      var text = src ? (src.textContent || "").trim() : "";
      if (!text) return;
      if (navigator.clipboard) navigator.clipboard.writeText(text).catch(function () {});
      /* Only the icon reacts: the CSS swaps copy for check off this
         attribute, and the label never changes, so the pill holds its
         size and position. */
      btn.setAttribute("data-copied", "true");
      clearTimeout(timer);
      timer = setTimeout(function () {
        btn.removeAttribute("data-copied");
      }, 1600);
    });
  });
})();

/* Edge fades on the static code blocks (the detail pages' Install & Usage,
   how-to-use). The React playgrounds do this with a hook; these are plain
   markup, so the same attribute is set here — playground.css draws a fade
   only on the side that still has code beyond it. */
(function () {
  function wire(pre) {
    function update() {
      // 2px slack absorbs sub-pixel widths, which would otherwise leave a
      // permanent fade on a block that is not actually scrollable.
      var more = pre.scrollWidth - pre.clientWidth - pre.scrollLeft > 2;
      var before = pre.scrollLeft > 2;
      pre.setAttribute("data-fade", more && before ? "both" : more ? "right" : before ? "left" : "none");
    }
    update();
    pre.addEventListener("scroll", update, { passive: true });
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(update).observe(pre);
  }
  function init() {
    var list = document.querySelectorAll(".code-block pre");
    for (var i = 0; i < list.length; i++) wire(list[i]);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

/* ── Docs strip (library pages, ≤900px) ───────────────────────
 * The sidebar becomes a horizontal chip strip on phones. Two jobs, both
 * from transitions.dev's detail page: fade the edge that has more strip
 * past it (a fully scrolled end stays crisp), and start with the current
 * page's chip in the middle so landing on Metal shows Metal, not the
 * first three chips. */
(function () {
  "use strict";
  var sidebar = document.querySelector(".docs-sidebar");
  if (!sidebar) return;
  var mq = window.matchMedia("(max-width: 900px)");
  var SIZE = 24;

  function update() {
    if (!mq.matches) {
      sidebar.style.removeProperty("--fade-start");
      sidebar.style.removeProperty("--fade-end");
      return;
    }
    var max = Math.max(sidebar.scrollWidth - sidebar.clientWidth, 0);
    var pos = sidebar.scrollLeft;
    if (max <= 1) {
      sidebar.style.setProperty("--fade-start", "0px");
      sidebar.style.setProperty("--fade-end", "0px");
      return;
    }
    sidebar.style.setProperty("--fade-start", Math.min(pos, SIZE) + "px");
    sidebar.style.setProperty("--fade-end", Math.min(max - pos, SIZE) + "px");
  }

  function centerActive() {
    if (!mq.matches) return;
    var active = sidebar.querySelector(".docs-link.is-active");
    if (!active) return;
    var left = active.offsetLeft - (sidebar.clientWidth - active.offsetWidth) / 2;
    sidebar.scrollLeft = Math.max(left, 0);
  }

  sidebar.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
  if (mq.addEventListener) mq.addEventListener("change", function () { centerActive(); update(); });
  if (window.ResizeObserver) new ResizeObserver(update).observe(sidebar);
  centerActive();
  update();
})();
