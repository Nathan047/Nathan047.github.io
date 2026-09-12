(function () {
  var landing = document.getElementById('hive-landing');
  var interior = document.getElementById('hive-interior');
  var interiorImg = document.getElementById('hive-interior-img');
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
  if (!landing || !interior || !interiorImg) return;

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Each cell's box as a fraction of hive-interior.png's own pixel grid
  // (1672x941). The hexagons are flat-top (flat top/bottom edges, pointy
  // left/right vertices) -- these centers and the w/h box were found by
  // sampling the artwork's actual border pixels and confirmed by drawing
  // the resulting hexagon back over the image until it traced the real
  // cell edges exactly (see .hive-cell's clip-path in hive.css for the
  // matching flat-top polygon).
  var PROJECTS = [
    {
      name: 'To-Do List', status: 'Shipped', label: '01', href: '/to-do-list/',
      body: "A checklist that saves itself — tasks fade away the moment you tick them off.",
      tags: ['HTML', 'JavaScript'],
      cell: { cx: 435 / 1672, cy: 435 / 941, w: 118 / 1672, h: 108 / 941 }
    },
    {
      name: 'FPL Team Manager', status: 'Shipped', label: '02', href: '/fpl/',
      body: "A squad builder for my Fantasy Premier League team — real prices and points, with budget and quota rules enforced live.",
      tags: ['HTML', 'JavaScript', 'Excel'],
      cell: { cx: 1166 / 1672, cy: 434 / 941, w: 118 / 1672, h: 108 / 941 }
    }
  ];

  function announce(text) {
    if (liveRegion) liveRegion.textContent = text;
  }

  var cellEls = PROJECTS.map(function (project, i) {
    var el = document.getElementById('hive-cell-' + i);
    el.setAttribute('aria-label', 'Open ' + project.name + ' project details');
    el.addEventListener('mouseenter', function () { setHover(project, true); });
    el.addEventListener('mouseleave', function () { setHover(project, false); });
    el.addEventListener('focus', function () { setHover(project, true); });
    el.addEventListener('blur', function () { setHover(project, false); });
    el.addEventListener('click', function () { openModal(project); });
    return el;
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

  // The artwork sits under object-fit: contain, so its rendered box moves
  // and letterboxes as the scene resizes -- position each cell from the
  // image's own getBoundingClientRect() rather than the container's, so
  // hotspots always land on the actual drawn hexagons.
  function layoutCells() {
    var imgRect = interiorImg.getBoundingClientRect();
    var hostRect = interior.getBoundingClientRect();
    if (!imgRect.width || !imgRect.height) return;
    PROJECTS.forEach(function (project, i) {
      var el = cellEls[i];
      var c = project.cell;
      var w = c.w * imgRect.width;
      var h = c.h * imgRect.height;
      el.style.left = (imgRect.left - hostRect.left + c.cx * imgRect.width - w / 2) + 'px';
      el.style.top = (imgRect.top - hostRect.top + c.cy * imgRect.height - h / 2) + 'px';
      el.style.width = w + 'px';
      el.style.height = h + 'px';
    });
  }
  window.addEventListener('resize', layoutCells);
  if (interiorImg.complete) layoutCells();
  else interiorImg.addEventListener('load', layoutCells);

  // ---------- mode / fade transition ----------

  var mode = 'landing'; // landing | inside
  var FADE_MS = reduceMotion ? 0 : 280;

  function crossfadeTo(showInside) {
    fadeEl.classList.add('active');
    setTimeout(function () {
      if (showInside) {
        landing.style.display = 'none';
        interior.classList.add('visible');
        cellEls.forEach(function (el) { el.tabIndex = 0; });
        backBtn.classList.add('visible');
        backBtn.tabIndex = 0;
        hintEl.classList.add('visible');
        mode = 'inside';
        layoutCells();
        backBtn.focus();
        announce('Inside the hive. ' + PROJECTS.length + ' projects on the wall.');
      } else {
        landing.style.display = '';
        interior.classList.remove('visible');
        cellEls.forEach(function (el) { el.tabIndex = -1; });
        backBtn.classList.remove('visible');
        backBtn.tabIndex = -1;
        hintEl.classList.remove('visible');
        mode = 'landing';
        readoutEl.classList.remove('visible');
        landing.focus();
        announce('Back at the hive.');
      }
      requestAnimationFrame(function () {
        fadeEl.classList.remove('active');
      });
    }, FADE_MS);
  }

  function enterHive() {
    if (mode !== 'landing') return;
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

  // ---------- project modal ----------

  var modalOpen = false;

  function openModal(project) {
    modalOpen = true;
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
  }

  modalClose.addEventListener('click', closeModal);
  modalBackdrop.addEventListener('click', function (e) {
    if (e.target === modalBackdrop) closeModal();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (modalOpen) { e.preventDefault(); closeModal(); }
    else if (mode === 'inside') { e.preventDefault(); exitHive(); }
  });
})();
