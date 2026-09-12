(function () {
  var SVG_NS = 'http://www.w3.org/2000/svg';

  var landing = document.getElementById('hive-landing');
  var interior = document.getElementById('hive-interior');
  var interiorImg = document.getElementById('hive-interior-img');
  var hiveScene = document.getElementById('hive-scene');
  var hiveAltHint = document.querySelector('.hive-alt-hint');
  var cellsSvg = document.getElementById('hive-cells');
  var backBtn = document.getElementById('hive-back');
  var hintEl = document.getElementById('hive-hint');
  var fadeEl = document.getElementById('hive-fade');
  var liveRegion = document.getElementById('hive-live');
  var readoutEl = document.getElementById('hive-readout');
  var readoutN = document.getElementById('hive-readout-n');
  var readoutT = document.getElementById('hive-readout-t');
  var modalBackdrop = document.getElementById('hive-modal-backdrop');
  var modalKicker = document.getElementById('hive-modal-kicker');
  var modalTitle = document.getElementById('hive-modal-title');
  var modalBody = document.getElementById('hive-modal-body');
  var modalTags = document.getElementById('hive-modal-tags');
  var modalLink = document.getElementById('hive-modal-link');
  var modalClose = document.getElementById('hive-modal-close');
  var modalEl = modalBackdrop ? modalBackdrop.querySelector('.hive-modal') : null;
  if (!landing || !interior || !interiorImg) return;

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var mobileQuery = window.matchMedia ? window.matchMedia('(max-width: 640px)') : null;
  function isMobile() { return mobileQuery ? mobileQuery.matches : window.innerWidth <= 640; }

  var debugMode = /(?:^|[?&])cells=debug(?:&|$)/.test(window.location.search);

  // ---------- hex geometry ----------

  // Circumradius (center-to-vertex) of one honeycomb cell, in
  // hive-interior.png's own pixel grid (source image is 1672x941). Derived
  // by sampling the artwork's seam pixels between adjacent cells: the two
  // known real cell centers below sit exactly 6 columns apart (731px),
  // and a flat-top hex grid's column pitch is 1.5 * r, so
  // 731 / (6 * 1.5) = r = ~81.2.
  var HEX = { r: 81.2 };

  // Returns an SVG polygon "points" string for a flat-top hexagon (flat
  // top/bottom edges, pointy left/right vertices) centered at (cx, cy).
  // Confirmed flat-top by sampling hive-interior.png directly: each cell's
  // top/bottom edges are flat horizontal seams, and left/right vertices are
  // single points shared with the diagonally-adjacent cells -- matching
  // the existing flat-top clip-path this file used to rely on.
  function hexPoints(cx, cy, r) {
    r = r || HEX.r;
    var h = r * Math.sqrt(3);
    return [
      [cx + r, cy],
      [cx + r / 2, cy - h / 2],
      [cx - r / 2, cy - h / 2],
      [cx - r, cy],
      [cx - r / 2, cy + h / 2],
      [cx + r / 2, cy + h / 2]
    ].map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ');
  }

  // Hex-cell centres in hive-interior.png's own pixel grid (source image is
  // 1672x941). CELL_SLOTS intentionally reserves more slots than there are
  // projects today, so future projects can be wired in by slot id alone
  // without re-measuring the artwork.
  //
  // slot-1 and slot-2 are real, precisely-measured centres (previously the
  // only two hardcoded .hive-cell buttons; these pixel values are the same
  // ones that used to live in PROJECTS[].cell as cx/cy fractions of
  // 1672x941, just converted back to plain pixels).
  //
  // slot-3..slot-12 were initially computed from the known flat-top hex
  // grid pitch (column step 1.5r ~= 121.8px, row step r*sqrt(3) ~= 140.7px,
  // odd columns offset half a row down), calibrated off slot-1/slot-2,
  // then verified against the actual artwork by sampling pixel colour at
  // each centre (and a small ring around it) to confirm it lands on honey-
  // coloured fill, not the sky background or a seam (Sep 2026). One slot
  // (originally slot-12 at 1409,294) failed this check -- it sat in the sky
  // above the comb's ragged top-right edge -- and was moved to a confirmed
  // clean hexagon instead. Re-run this check via ?cells=debug (plus a pixel
  // sample) if hive-interior.png ever changes.
  var CELL_SLOTS = [
    { id: 'slot-1', cx: 435, cy: 435 },   // real, measured
    { id: 'slot-2', cx: 1166, cy: 434 },  // real, measured
    { id: 'slot-3', cx: 313, cy: 505 },   // verified
    { id: 'slot-4', cx: 557, cy: 505 },   // verified
    { id: 'slot-5', cx: 679, cy: 435 },   // verified
    { id: 'slot-6', cx: 800, cy: 505 },   // verified
    { id: 'slot-7', cx: 922, cy: 435 },   // verified
    { id: 'slot-8', cx: 1044, cy: 505 },  // verified
    { id: 'slot-9', cx: 1288, cy: 505 },  // verified
    { id: 'slot-10', cx: 1409, cy: 435 }, // verified
    { id: 'slot-11', cx: 313, cy: 646 },  // verified
    { id: 'slot-12', cx: 922, cy: 294 }   // verified (relocated from the sky-sitting original estimate)
  ];

  var PROJECTS = [
    {
      name: 'To-Do List', status: 'Shipped', label: '01', href: '/to-do-list/',
      body: "A checklist that saves itself — tasks fade away the moment you tick them off.",
      tags: ['HTML', 'JavaScript'],
      slot: 'slot-1'
    },
    {
      name: 'FPL Team Manager', status: 'Shipped', label: '02', href: '/fpl/',
      body: "A squad builder for my Fantasy Premier League team — real prices and points, with budget and quota rules enforced live.",
      tags: ['HTML', 'JavaScript', 'Excel'],
      slot: 'slot-2'
    }
  ];

  function announce(text) {
    if (liveRegion) liveRegion.textContent = text;
  }

  // ---------- data validation (overflow tripwire / drift check) ----------

  function validateHiveData() {
    var ok = true;
    var slotIds = CELL_SLOTS.map(function (s) { return s.id; });

    if (PROJECTS.length > CELL_SLOTS.length) {
      console.warn('[hive] PROJECTS.length (' + PROJECTS.length + ') exceeds CELL_SLOTS.length (' + CELL_SLOTS.length + '); add more slots before adding more projects.');
      ok = false;
    }

    PROJECTS.forEach(function (project) {
      if (slotIds.indexOf(project.slot) === -1) {
        console.warn('[hive] Project "' + project.name + '" references missing slot id "' + project.slot + '".');
        ok = false;
      }
    });

    // CELL_SLOTS itself must not define the same slot id twice -- that would
    // silently make two hexagons on the wall resolve to the same geometry
    // (or worse, make slotsById drop one of them) with no other signal.
    var seenSlotIds = {};
    CELL_SLOTS.forEach(function (slot) {
      if (seenSlotIds[slot.id]) {
        console.warn('[hive] CELL_SLOTS contains a duplicate slot id "' + slot.id + '".');
        ok = false;
      }
      seenSlotIds[slot.id] = true;
    });

    // Two projects can't share one slot -- one of them would silently fail
    // to render a cell (slotsById[slot.id] only ever points at one hexagon).
    var usedSlots = {};
    PROJECTS.forEach(function (project) {
      if (usedSlots[project.slot]) {
        console.warn('[hive] Slot id "' + project.slot + '" is used by more than one project ("' + usedSlots[project.slot] + '" and "' + project.name + '"); each project must reference a unique slot.');
        ok = false;
      }
      usedSlots[project.slot] = project.name;
    });

    var listHrefs = Array.prototype.map.call(
      document.querySelectorAll('.project-list-link'),
      function (a) { return a.getAttribute('href'); }
    );
    PROJECTS.forEach(function (project) {
      if (listHrefs.indexOf(project.href) === -1) {
        console.warn('[hive] Project "' + project.name + '" href "' + project.href + '" is missing from the static #all-projects list; the hive and the list have drifted out of sync.');
        ok = false;
      }
    });

    return ok;
  }

  var slotsById = {};
  CELL_SLOTS.forEach(function (slot) { slotsById[slot.id] = slot; });

  var dataOk = validateHiveData();

  if (!dataOk && !debugMode) {
    // Skip rendering the hive scene entirely and rely on the static list.
    if (hiveScene) hiveScene.style.display = 'none';
    if (hiveAltHint) hiveAltHint.style.display = 'none';
    return;
  }

  // ---------- SVG cell rendering ----------

  var cellEls = [];

  function renderHiveCells() {
    if (!cellsSvg) return;
    cellsSvg.innerHTML = '';
    cellEls = [];

    if (debugMode) {
      CELL_SLOTS.forEach(function (slot) {
        var g = document.createElementNS(SVG_NS, 'g');
        var poly = document.createElementNS(SVG_NS, 'polygon');
        poly.setAttribute('points', hexPoints(slot.cx, slot.cy));
        poly.setAttribute('class', 'hive-cell-debug-outline');
        g.appendChild(poly);
        var text = document.createElementNS(SVG_NS, 'text');
        text.setAttribute('x', slot.cx);
        text.setAttribute('y', slot.cy);
        text.setAttribute('class', 'hive-cell-debug-label');
        text.textContent = slot.id;
        g.appendChild(text);
        cellsSvg.appendChild(g);
      });
      return;
    }

    PROJECTS.forEach(function (project) {
      var slot = slotsById[project.slot];
      if (!slot) return; // already warned in validateHiveData

      var g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', 'hive-cell');
      g.setAttribute('role', 'button');
      g.setAttribute('tabindex', '-1');
      g.setAttribute('aria-label', 'Open ' + project.name + ' project details');

      var poly = document.createElementNS(SVG_NS, 'polygon');
      poly.setAttribute('points', hexPoints(slot.cx, slot.cy));
      poly.setAttribute('class', 'hive-cell-poly');
      g.appendChild(poly);

      var text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', slot.cx);
      text.setAttribute('y', slot.cy);
      text.setAttribute('class', 'hive-cell-label');
      text.textContent = project.label;
      g.appendChild(text);

      g.addEventListener('mouseenter', function () { setHover(project, true); });
      g.addEventListener('mouseleave', function () { setHover(project, false); });
      g.addEventListener('focus', function () { setHover(project, true); });
      g.addEventListener('blur', function () { setHover(project, false); });
      g.addEventListener('click', function () { openModal(project); });
      g.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          openModal(project);
        }
      });

      cellsSvg.appendChild(g);
      cellEls.push(g);
    });
  }

  renderHiveCells();

  function setHover(project, on) {
    if (on) {
      readoutN.textContent = project.label;
      readoutT.textContent = project.name;
      readoutEl.classList.add('visible');
    } else {
      readoutEl.classList.remove('visible');
    }
  }

  // ---------- mode / fade transition ----------

  var mode = 'landing'; // landing | inside
  var FADE_MS = reduceMotion ? 0 : 280;

  function crossfadeTo(showInside) {
    fadeEl.classList.add('active');
    setTimeout(function () {
      if (showInside) {
        landing.style.display = 'none';
        interior.classList.add('visible');
        interior.setAttribute('aria-hidden', 'false');
        cellEls.forEach(function (el) { el.tabIndex = isMobile() ? -1 : 0; });
        backBtn.classList.add('visible');
        backBtn.tabIndex = 0;
        hintEl.classList.add('visible');
        // Move focus into the interior BEFORE hiding the landing subtree from
        // assistive tech -- aria-hidden must never be set on an ancestor of
        // document.activeElement, even transiently.
        backBtn.focus();
        landing.setAttribute('aria-hidden', 'true');
        mode = 'inside';
        announce('Inside the hive. ' + PROJECTS.length + ' projects on the wall.');
      } else {
        landing.style.display = '';
        landing.setAttribute('aria-hidden', 'false');
        // Move focus back to the landing element BEFORE hiding the interior
        // subtree (a hex cell may still hold focus here) -- same ordering
        // requirement as the entering branch above, mirrored. But only steal
        // focus at all if it's currently somewhere inside the hive scene
        // (e.g. a hex cell or the back button) -- if the user has since
        // moved focus elsewhere on the page (e.g. the static project list),
        // e.g. because this exit was triggered by a resize crossing the
        // mobile breakpoint out from under them, leave their focus alone.
        if (hiveScene && hiveScene.contains(document.activeElement)) {
          landing.focus();
        }
        interior.classList.remove('visible');
        interior.setAttribute('aria-hidden', 'true');
        cellEls.forEach(function (el) { el.tabIndex = -1; });
        backBtn.classList.remove('visible');
        backBtn.tabIndex = -1;
        hintEl.classList.remove('visible');
        mode = 'landing';
        readoutEl.classList.remove('visible');
        announce('Back at the hive.');
      }
      requestAnimationFrame(function () {
        fadeEl.classList.remove('active');
      });
    }, FADE_MS);
  }

  function enterHive() {
    if (mode !== 'landing' || isMobile()) return;
    crossfadeTo(true);
  }
  function exitHive() {
    if (mode !== 'inside') return;
    crossfadeTo(false);
  }

  landing.addEventListener('click', enterHive);
  landing.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      enterHive();
    }
  });
  backBtn.addEventListener('click', exitHive);

  // On mobile, enterHive() is a no-op (see above), so #hive-landing is a
  // dead control -- it must stop presenting itself as an actionable button
  // to assistive tech and keyboard users. Desktop keeps the original
  // role/tabindex/label so the interactive affordance is unchanged there.
  var LANDING_LABEL_DESKTOP = 'Click to open the hive and browse projects on the honeycomb wall inside';
  var LANDING_LABEL_MOBILE = 'An illustrated beehive';
  function syncLandingInteractivity() {
    if (isMobile()) {
      landing.setAttribute('tabindex', '-1');
      landing.removeAttribute('role');
      landing.setAttribute('aria-label', LANDING_LABEL_MOBILE);
    } else {
      landing.setAttribute('tabindex', '0');
      landing.setAttribute('role', 'button');
      landing.setAttribute('aria-label', LANDING_LABEL_DESKTOP);
    }
  }
  syncLandingInteractivity();

  // Re-sync mobile gating live: isMobile()/tabIndex above is only applied at
  // hive-entry time in crossfadeTo(), so a resize/rotation crossing the
  // 640px breakpoint while already inside would otherwise leave hex cells
  // keyboard-focusable (and openModal() has no gating of its own). Rather
  // than duplicating the isMobile() check inside openModal(), the simpler
  // and more robust fix is to treat "became mobile while inside" the same
  // as pressing Escape/Back: exit back to the landing view, which already
  // resets every cell's tabIndex to -1 and restores focus safely.
  function syncMobileGating() {
    if (mode !== 'inside') return;
    if (isMobile()) {
      // A project modal may be open when this fires -- close it first (this
      // also restores focus to whatever triggered it, e.g. a hex cell) so
      // exitHive()'s own focus handling below has a sane starting point
      // instead of leaving the modal orphaned behind the landing view.
      if (modalOpen) closeModal();
      exitHive();
    } else {
      cellEls.forEach(function (el) { el.tabIndex = 0; });
    }
  }
  function handleViewportChange() {
    syncLandingInteractivity();
    syncMobileGating();
  }
  if (mobileQuery && mobileQuery.addEventListener) {
    mobileQuery.addEventListener('change', handleViewportChange);
  } else if (mobileQuery && mobileQuery.addListener) {
    mobileQuery.addListener(handleViewportChange); // Safari <14 fallback
  } else {
    window.addEventListener('resize', handleViewportChange);
  }

  // ---------- project modal ----------

  var modalOpen = false;
  var modalTriggerEl = null;

  // Focusable elements inside the modal, for the Tab trap below. Recomputed
  // each time (rather than cached) since modalLink/modalTags contents change
  // per project.
  function getModalFocusable() {
    if (!modalEl) return [];
    return Array.prototype.slice.call(
      modalEl.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')
    );
  }

  function openModal(project) {
    modalOpen = true;
    // Save whatever had focus (a hex cell, typically) so it can be restored
    // on close instead of letting focus fall through to <body>.
    modalTriggerEl = document.activeElement;
    modalKicker.textContent = project.label + ' · ' + project.status;
    modalTitle.textContent = project.name;
    modalBody.textContent = project.body;
    modalTags.innerHTML = '';
    project.tags.forEach(function (t) {
      var span = document.createElement('span');
      span.textContent = t;
      modalTags.appendChild(span);
    });
    modalLink.href = project.href;
    modalBackdrop.classList.add('open');
    modalClose.focus();
    announce(project.name + ' details open.');
  }

  function closeModal() {
    modalOpen = false;
    modalBackdrop.classList.remove('open');
    var restoreTo = modalTriggerEl;
    modalTriggerEl = null;
    if (restoreTo && typeof restoreTo.focus === 'function') {
      restoreTo.focus();
    }
  }

  modalClose.addEventListener('click', closeModal);
  modalBackdrop.addEventListener('click', function (e) {
    if (e.target === modalBackdrop) closeModal();
  });

  // Minimal focus trap: while the modal is open, Tab/Shift+Tab cycle only
  // through the modal's own focusable elements (close button, visit-project
  // link, any tag links) so keyboard focus can't escape into the page
  // behind the backdrop.
  function trapModalTab(e) {
    var focusable = getModalFocusable();
    if (!focusable.length) { e.preventDefault(); return; }
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    var current = document.activeElement;
    if (e.shiftKey) {
      if (current === first || !modalEl.contains(current)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (current === last || !modalEl.contains(current)) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  document.addEventListener('keydown', function (e) {
    if (modalOpen && e.key === 'Tab') {
      trapModalTab(e);
      return;
    }
    if (e.key !== 'Escape') return;
    if (modalOpen) { e.preventDefault(); closeModal(); }
    else if (mode === 'inside') { e.preventDefault(); exitHive(); }
  });

  // In debug mode, jump straight into the interior so the slot grid is
  // visible without needing to click the hive first.
  if (debugMode && mode === 'landing' && !isMobile()) {
    crossfadeTo(true);
  }
})();
