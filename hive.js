(function () {
  var landing = document.getElementById('hive-landing');
  var interior = document.getElementById('hive-interior');
  var hiveScene = document.getElementById('hive-scene');
  var hiveAltHint = document.querySelector('.hive-alt-hint');
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
  if (!landing || !interior) return;

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var mobileQuery = window.matchMedia ? window.matchMedia('(max-width: 640px)') : null;
  function isMobile() { return mobileQuery ? mobileQuery.matches : window.innerWidth <= 640; }

  // ---------- hex layout (ported verbatim from the reviewed
  // hive-comb-preview.html mockup) ----------
  //
  // Flat-top hexagon comb: alternating half-pitch row offset, with a
  // partial last row picking a centered subset of columns from the SAME
  // alternating grid as a full row of that parity (rather than being
  // independently centered), so it nests into the notches of the row above
  // instead of sitting on its own phase.

  function layout(n, r) {
    var cols = Math.min(5, Math.max(2, Math.ceil(Math.sqrt(n * 1.4))));
    var rows = Math.ceil(n / cols);
    var hw = Math.sqrt(3) * r, hh = 2 * r, vPitch = 1.5 * r;
    var W = cols * hw + hw / 2, H = (rows - 1) * vPitch + hh;
    var cells = [], idx = 0;
    for (var row = 0; row < rows; row++) {
      var itemsInRow = Math.min(cols, n - idx);
      var isOdd = row % 2 === 1;
      // A partial row still picks columns off the SAME alternating grid as a
      // full row of this parity (just a centered subset of them), so it nests
      // into the notches of the row above instead of sitting on its own phase.
      var startCol = Math.floor((cols - itemsInRow) / 2);
      for (var c = 0; c < itemsInRow; c++) {
        var col = startCol + c;
        var cx = (isOdd ? hw / 2 : 0) + col * hw + hw / 2;
        var cy = row * vPitch + hh / 2;
        cells.push({ cx: cx, cy: cy });
        idx++;
      }
    }
    return { cols: cols, rows: rows, hw: hw, hh: hh, W: W, H: H, cells: cells };
  }

  // Tiled hex-outline background used behind the comb, so a small number of
  // projects still reads as a wall of honeycomb rather than floating in
  // empty space. Also ported from the mockup.
  function hexTileUrl(r, color) {
    var hw = Math.sqrt(3) * r, w = hw, h = 3 * r;
    function pts(cx, cy) {
      var p = [];
      for (var i = 0; i < 6; i++) {
        var a = (-90 + i * 60) * Math.PI / 180;
        p.push((cx + r * Math.cos(a)).toFixed(1) + ',' + (cy + r * Math.sin(a)).toFixed(1));
      }
      return p.join(' ');
    }
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
      '<polygon points="' + pts(w / 2, r) + '" fill="none" stroke="' + color + '" stroke-width="1"/>' +
      '<polygon points="' + pts(0, 2.5 * r) + '" fill="none" stroke="' + color + '" stroke-width="1"/>' +
      '<polygon points="' + pts(w, 2.5 * r) + '" fill="none" stroke="' + color + '" stroke-width="1"/>' +
      '</svg>';
    return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
  }

  var PROJECTS = [
    {
      name: 'To-Do List', status: 'Shipped', label: '01', href: '/to-do-list/',
      body: "A checklist that saves itself — tasks fade away the moment you tick them off.",
      tags: ['HTML', 'JavaScript']
    },
    {
      name: 'FPL Team Manager', status: 'Shipped', label: '02', href: '/fpl/',
      body: "A squad builder for my Fantasy Premier League team — real prices and points, with budget and quota rules enforced live.",
      tags: ['HTML', 'JavaScript', 'Excel']
    }
  ];

  function announce(text) {
    if (liveRegion) liveRegion.textContent = text;
  }

  // ---------- data validation (drift check) ----------
  //
  // There's no fixed artwork/slot ceiling any more -- the comb always has
  // exactly as many hexagons as PROJECTS has entries. The one remaining
  // real drift risk between the two hand-maintained lists is the static
  // #all-projects markup in index.html falling out of sync with PROJECTS.

  function validateHiveData() {
    var ok = true;

    if (!PROJECTS.length) {
      console.warn('[hive] PROJECTS is empty; nothing to render on the comb.');
      ok = false;
    }

    var seenHrefs = {};
    var seenLabels = {};
    PROJECTS.forEach(function (project) {
      if (!project.name || !project.label || !project.href || !project.body || !project.tags) {
        console.warn('[hive] Project is missing a required field (name/label/href/body/tags): ' + JSON.stringify(project));
        ok = false;
        return;
      }
      if (seenHrefs[project.href]) {
        console.warn('[hive] Duplicate project href "' + project.href + '" ("' + seenHrefs[project.href] + '" and "' + project.name + '").');
        ok = false;
      }
      seenHrefs[project.href] = project.name;

      if (seenLabels[project.label]) {
        console.warn('[hive] Duplicate project label "' + project.label + '" ("' + seenLabels[project.label] + '" and "' + project.name + '").');
        ok = false;
      }
      seenLabels[project.label] = project.name;
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

  var dataOk = validateHiveData();

  if (!dataOk) {
    // Skip rendering the hive scene entirely and rely on the static list.
    if (hiveScene) hiveScene.style.display = 'none';
    if (hiveAltHint) hiveAltHint.style.display = 'none';
    return;
  }

  // ---------- mode / fade transition ----------

  var mode = 'landing'; // landing | inside
  var FADE_MS = reduceMotion ? 0 : 280;

  // ---------- comb rendering ----------

  var cellEls = [];
  var combStage = null;
  var combEl = null;

  // Phase (a): build the comb structure and one button per project. This
  // only needs to run once (or if PROJECTS itself ever changed, which it
  // doesn't dynamically today) -- element identity must survive resizes so
  // that focus and openModal()'s saved modalTriggerEl reference stay valid.
  function buildHiveComb() {
    interior.innerHTML = '';
    cellEls = [];

    var wall = document.createElement('div');
    wall.className = 'hive-wall';
    wall.style.backgroundImage = hexTileUrl(19, 'rgba(134,156,192,0.45)');
    wall.style.backgroundSize = (Math.sqrt(3) * 19) + 'px 57px';
    interior.appendChild(wall);

    var stage = document.createElement('div');
    stage.className = 'hive-comb-stage';
    interior.appendChild(stage);

    var comb = document.createElement('div');
    comb.className = 'hive-comb';
    stage.appendChild(comb);

    combStage = stage;
    combEl = comb;

    PROJECTS.forEach(function (project) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hive-hex';
      btn.tabIndex = -1; // synced to 0 by crossfadeTo()/syncMobileGating() when appropriate
      btn.setAttribute('aria-label', 'Open ' + project.name + ' project details');

      var rim = document.createElement('div');
      rim.className = 'hive-hex-rim';

      var fill = document.createElement('div');
      fill.className = 'hive-hex-fill';

      var num = document.createElement('span');
      num.className = 'hive-hex-num';
      num.textContent = project.label;

      var name = document.createElement('span');
      name.className = 'hive-hex-name';
      name.textContent = project.name;

      fill.appendChild(num);
      fill.appendChild(name);
      btn.appendChild(rim);
      btn.appendChild(fill);

      btn.addEventListener('mouseenter', function () { setHover(project, true); });
      btn.addEventListener('mouseleave', function () { setHover(project, false); });
      btn.addEventListener('focus', function () { setHover(project, true); });
      btn.addEventListener('blur', function () { setHover(project, false); });
      btn.addEventListener('click', function () { openModal(project); });

      // Stash the label spans on the button itself so positionHiveComb()
      // can restyle them in place without re-querying the DOM.
      btn._numEl = num;
      btn._nameEl = name;

      comb.appendChild(btn);
      cellEls.push(btn);
    });
  }

  // Phase (b): compute layout(n, r) geometry against the current stage size
  // and apply left/top/width/height/font-sizes to the EXISTING buttons. Safe
  // to call repeatedly (e.g. on every resize) since it never touches DOM
  // structure or element identity.
  function positionHiveComb() {
    if (!combStage || !combEl) return;

    var stageW = combStage.clientWidth - 40;
    var stageH = combStage.clientHeight - 92;
    var r = 62;
    var geo = layout(PROJECTS.length, r);
    var scale = Math.min(1, stageW / geo.W, stageH / geo.H, (geo.cols <= 2 ? 1 : 190 * geo.cols / geo.W));

    combEl.style.width = (geo.W * scale) + 'px';
    combEl.style.height = (geo.H * scale) + 'px';

    PROJECTS.forEach(function (project, i) {
      var cell = geo.cells[i];
      var btn = cellEls[i];
      if (!btn) return;

      btn.style.left = ((cell.cx - geo.hw / 2) * scale) + 'px';
      btn.style.top = ((cell.cy - geo.hh / 2) * scale) + 'px';
      btn.style.width = (geo.hw * scale) + 'px';
      btn.style.height = (geo.hh * scale) + 'px';

      if (btn._numEl) btn._numEl.style.fontSize = Math.max(13, geo.hh * scale * 0.22) + 'px';
      if (btn._nameEl) btn._nameEl.style.fontSize = Math.max(9, geo.hh * scale * 0.1) + 'px';
    });
  }

  buildHiveComb();
  positionHiveComb();

  // Arriving with a #hash (e.g. the sub-apps' "All projects" back link)
  // relies on the browser's native scroll-to-fragment, which fires before
  // hive.png (a large, unsized <img>) has finished loading and pushed the
  // rest of the page down -- so it lands well short of the target and never
  // re-corrects. Re-run the scroll once everything (images included) has
  // actually settled. This has to run after buildHiveComb()/positionHiveComb()
  // above (and after `mode` is initialized) since the immediate branch below
  // can call enterHive() synchronously, before the page's own `load` event.
  if (window.location.hash) {
    var landOnHash = function () {
      var hash = window.location.hash.slice(1);
      // On desktop the honeycomb interior -- not the plain zero-JS list
      // further down the page -- is the primary way to browse projects (see
      // the mobile media query in hive.css), so a trip back from a project
      // should reopen straight into it rather than land on the exterior
      // hive with the static list scrolled into view behind it. Mobile has
      // no interior to open (enterHive() no-ops there), so it keeps landing
      // on the static list, which is already its primary interface.
      if (hash === 'all-projects' && !isMobile()) {
        enterHive();
        hiveScene.scrollIntoView();
        return;
      }
      var target = document.getElementById(hash);
      if (target) target.scrollIntoView();
    };
    // 'load' fires only once, so if hive.png is already cached from an
    // earlier visit (the common case for this back-link, since the user was
    // just on this same hive minutes ago) it can finish -- and 'load' can
    // fire -- before this deferred script even starts running, in which case
    // the listener below would never fire at all. Run immediately in that
    // case instead of waiting on an event that has already happened.
    if (document.readyState === 'complete') {
      landOnHash();
    } else {
      window.addEventListener('load', landOnHash);
    }
  }

  // The comb's cell positions/sizes are computed in JS pixels (not a scaling
  // SVG viewBox), so a viewport width change that doesn't cross the mobile
  // breakpoint (e.g. resizing a desktop window) still needs a re-layout to
  // keep the comb correctly scaled to the available stage area. Only the
  // positioning phase runs here -- rebuilding the buttons on every resize
  // would destroy element identity, dropping focus off a focused hex and
  // breaking openModal()'s saved modalTriggerEl reference if a modal is
  // open. Rapid resize events (e.g. a drag-resize) are coalesced to at most
  // one reposition per animation frame via rAF de-duping.
  var resizeRaf = null;
  window.addEventListener('resize', function () {
    if (resizeRaf !== null) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(function () {
      resizeRaf = null;
      positionHiveComb();
      if (mode === 'inside') {
        cellEls.forEach(function (el) { el.tabIndex = isMobile() ? -1 : 0; });
      }
    });
  });

  function setHover(project, on) {
    if (on) {
      readoutN.textContent = project.label;
      readoutT.textContent = project.name;
      readoutEl.classList.add('visible');
    } else {
      readoutEl.classList.remove('visible');
    }
  }

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
})();
