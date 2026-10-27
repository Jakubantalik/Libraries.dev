// The chevron does not rotate or flip: it is one line whose tip travels
// through it, a little ahead of the ends, at the same width throughout.
// Down to up and back in 168ms; an interrupted morph turns around from where
// it is. Returns set(t): 0 down, 1 up. Shared by the top bar and the mobile
// menu's Products.
function chevronMorph(svg) {
  if (!svg) return function () {};
  svg.innerHTML = '<path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>';
  var arrow = svg.firstChild, morph = 0, raf = 0;
  function ease(x) { x = Math.max(0, Math.min(1, x)); return 1 - Math.pow(1 - x, 3); }
  function draw(t) {
    // t = 0: down (tip at 8,10). t = 1: up (tip at 8,6.5).
    var tip = 10 - 3.5 * ease(t / 0.9);
    var end = 6.5 + 3.5 * ease((t - 0.1) / 0.9);
    arrow.setAttribute("d", "M4.5 " + end.toFixed(2) + "L8 " + tip.toFixed(2) + "L11.5 " + end.toFixed(2));
  }
  draw(0);
  return function (to) {
    cancelAnimationFrame(raf);
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { morph = to; draw(to); return; }
    var from = morph, start = performance.now(), dur = 168 * Math.abs(to - from);
    (function step(now) {
      var k = dur ? Math.min(1, (now - start) / dur) : 1;
      morph = from + (to - from) * k;
      draw(morph);
      if (k < 1) raf = requestAnimationFrame(step);
    })(start);
  };
}

// The top bar's Products menu: opens on hover with a mouse, on click or tap
// otherwise; arrow keys move between items, Escape closes. Uses the
// .t-dropdown open and close classes the 3-dot menu uses.
(function () {
  "use strict";
  var root = document.querySelector("[data-nav-products]");
  if (!root) return;
  var btn = root.querySelector(".nav-products-btn");
  var menu = root.querySelector(".nav-products-menu");
  var fine = window.matchMedia ? window.matchMedia("(hover: hover) and (pointer: fine)") : { matches: false };
  var open = false, closing = null, leave = null;

  var morphArrow = chevronMorph(btn.querySelector("svg"));

  function set(on) {
    if (on === open) return;
    open = on;
    btn.setAttribute("aria-expanded", String(on));
    morphArrow(on ? 1 : 0);
    clearTimeout(closing);
    if (on) {
      menu.classList.remove("is-closing");
      void menu.offsetWidth;
      menu.classList.add("is-open");
    } else {
      menu.classList.remove("is-open");
      menu.classList.add("is-closing");
      closing = setTimeout(function () { menu.classList.remove("is-closing"); }, 160);
    }
  }
  function items() { return Array.prototype.slice.call(menu.querySelectorAll("a")); }

  btn.addEventListener("click", function (e) {
    e.stopPropagation();
    set(fine.matches ? true : !open);
  });
  root.addEventListener("mouseenter", function () { if (fine.matches) { clearTimeout(leave); set(true); } });
  root.addEventListener("mouseleave", function () { if (fine.matches) leave = setTimeout(function () { set(false); }, 150); });
  document.addEventListener("click", function (e) { if (open && !root.contains(e.target)) set(false); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && open) { set(false); btn.focus(); }
  });
  btn.addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown") { e.preventDefault(); set(true); items()[0].focus(); }
  });
  menu.addEventListener("keydown", function (e) {
    var list = items(), i = list.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); list[(i + 1) % list.length].focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
    if (e.key === "Tab" && !e.shiftKey && i === list.length - 1) set(false);
  });
})();

// The mobile menu: "Products" is an item like the others, with a chevron, and
// its links (the desktop Products menu) expand under it, collapsed until
// tapped. How to use, Studio and Get Pro stay top-level items.
(function () {
  "use strict";
  var list = document.querySelector("#mobile-menu .mobile-menu-list");
  if (!list || list.querySelector(".mobile-menu-products")) return;
  var label = Array.prototype.filter.call(list.querySelectorAll(".mobile-menu-group"), function (li) { return li.textContent.trim() === "Products"; })[0];
  if (!label) return;
  var PRODUCTS = ["/beam.html", "/magnetic.html", "/skill.html"];
  var items = Array.prototype.filter.call(list.children, function (li) {
    var a = li.querySelector("a.mobile-menu-link");
    return a && PRODUCTS.indexOf(a.getAttribute("href")) >= 0;
  });
  if (!items.length) return;
  var CHEV = '<svg class="mobile-menu-chev" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M4.46967 6.46967C4.76256 6.17678 5.23744 6.17678 5.53033 6.46967L8 8.93934L10.4697 6.46967C10.7626 6.17678 11.2374 6.17678 11.5303 6.46967C11.8232 6.76256 11.8232 7.23744 11.5303 7.53033L8.53033 10.5303C8.23744 10.8232 7.76256 10.8232 7.46967 10.5303L4.46967 7.53033C4.17678 7.23744 4.17678 6.76256 4.46967 6.46967Z"/></svg>';
  var li = document.createElement("li");
  li.className = "mobile-menu-products";
  li.setAttribute("data-open", "false");
  li.innerHTML = '<button type="button" class="mobile-menu-link mobile-menu-toggle" aria-expanded="false" aria-controls="mobile-menu-products-list">Products' + CHEV + "</button>" +
    '<div class="mobile-menu-sub"><ul class="mobile-menu-sub-list" id="mobile-menu-products-list"></ul></div>';
  var sub = li.querySelector("ul");
  items.forEach(function (it) {
    var a = it.querySelector("a");
    a.classList.add("mobile-menu-sublink");
    a.tabIndex = -1;
    sub.appendChild(it);
  });
  label.replaceWith(li);
  var btn = li.querySelector("button");
  var morphChev = chevronMorph(btn.querySelector("svg"));
  function setOpen(on) {
    if ((li.getAttribute("data-open") === "true") !== on) morphChev(on ? 1 : 0);
    li.setAttribute("data-open", String(on));
    btn.setAttribute("aria-expanded", String(on));
    sub.querySelectorAll("a").forEach(function (a) { a.tabIndex = on ? 0 : -1; });
  }
  // The page's menu script closes the menu on a click on any
  // .mobile-menu-link (the toggle wears that class for its look).
  btn.addEventListener("click", function (e) { e.stopPropagation(); setOpen(li.getAttribute("data-open") !== "true"); });
  // Collapsed again each time the menu closes.
  new MutationObserver(function () { if (!document.body.classList.contains("menu-open") && !document.body.classList.contains("menu-closing")) setOpen(false); })
    .observe(document.body, { attributes: true, attributeFilter: ["class"] });
  // The entrance stagger, top to bottom, over the top-level items (the
  // signed-in Account links join later).
  function stagger() {
    Array.prototype.forEach.call(list.children, function (row, i) {
      var el = row.querySelector(":scope > .mobile-menu-link");
      // A variable, not transition-delay itself: an inline delay would also
      // hold back the close fade (nav-products.css only uses it on open).
      if (el) el.style.setProperty("--mm-delay", (i * 40) + "ms");
    });
  }
  stagger();
  new MutationObserver(stagger).observe(list, { childList: true });
})();

