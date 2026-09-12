(function () {
  var landing = document.getElementById('hive-landing');
  var canvas = document.getElementById('hive-canvas');
  var sceneEl = document.getElementById('hive-scene');
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
  if (typeof THREE === 'undefined' || !canvas || !landing) return;

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var isLowPower = (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
    (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

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

  // ---------- interior scene: a rotating cylindrical honeycomb wall built
  // from the same lattice the comb-sphere.jpg texture is stamped on, so
  // project cells land exactly on a textured cell rather than a seam ----------

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(90, 1, 0.01, 20);

  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isLowPower ? 1.5 : 2));

  // Lattice constants: must agree with the ones build-comb-texture.js used
  // to bake comb-sphere.jpg, or the project cells will straddle texture
  // cells instead of sitting inside one.
  var R = 2.6, COUNT = 25, RINGS = 14;
  var dTheta = Math.PI / RINGS;
  var rowH = R * dTheta;
  var TALL = Math.round(RINGS * 2.5);
  var H = rowH * TALL;
  var midY = H / 2;

  var texLoader = new THREE.TextureLoader();
  var combTex = texLoader.load('comb-sphere.jpg');
  combTex.wrapS = THREE.RepeatWrapping;
  combTex.wrapT = THREE.RepeatWrapping;
  combTex.repeat.set(1, 2.5);
  combTex.anisotropy = isLowPower ? 1 : 8;
  if ('colorSpace' in combTex) combTex.colorSpace = THREE.SRGBColorSpace;
  else if ('encoding' in combTex) combTex.encoding = THREE.sRGBEncoding;

  // MeshBasicMaterial is deliberate: the shell's normals face inward (it's
  // the inside of a cylinder), and a lit material would go dark since
  // nothing is lit from inside it.
  var shellMat = new THREE.MeshBasicMaterial({ map: combTex, side: THREE.BackSide });
  var shell = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R, H, isLowPower ? 48 : 96, 1, true),
    shellMat
  );
  shell.position.y = midY;
  scene.add(shell);

  var lamp = new THREE.PointLight(0xffe3ab, 6, 9, 1.5);
  lamp.position.set(0, midY, 0);
  scene.add(lamp);
  scene.add(new THREE.AmbientLight(0xffd89a, 0.55));

  // Cell footprint sized to the same lattice the texture was stamped at.
  var rxW = ((2 * Math.PI * R) / COUNT) / Math.sqrt(3);
  var ryW = rowH / 1.5;

  // Project cells all sit on the ring closest to eye level, spread evenly
  // all the way round the azimuth.
  var centerRing = Math.floor(TALL / 2);
  var centerY = H - rowH * (centerRing + 0.5);
  var centerStagger = (centerRing % 2) * 0.5;
  function projectSlot(pIdx, count) {
    var k = Math.round((pIdx / count) * COUNT) % COUNT;
    var u = (k + centerStagger) / COUNT;
    return { y: centerY, phi: Math.PI * 0.5 - u * Math.PI * 2 };
  }

  // Cell label texture, drawn to match the design handoff's spec: cream
  // ground, a red two-digit index, a brown rule, and the project title.
  function buildLabelTexture(project) {
    var size = 512, cx = size / 2;
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#f8ecd0';
    ctx.fillRect(0, 0, size, size);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#ec3013';
    ctx.font = '800 44px Archivo, sans-serif';
    ctx.fillText(project.label, cx, 200);

    ctx.fillStyle = '#6b4526';
    ctx.fillRect(cx - 38, 224, 76, 7);

    ctx.fillStyle = '#3d2611';
    ctx.font = '800 42px Archivo, sans-serif';
    var words = project.name.split(' ');
    var lines = [], line = '';
    words.forEach(function (w) {
      var test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > 300 && line) { lines.push(line); line = w; }
      else line = test;
    });
    lines.push(line);
    var startY = 280 - (lines.length - 1) * 24;
    lines.forEach(function (l, i) { ctx.fillText(l, cx, startY + i * 48); });

    var tex = new THREE.CanvasTexture(c);
    if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  var fwd = new THREE.Vector3(0, 0, 1);
  var raycastTargets = [];

  document.fonts && document.fonts.load('800 44px Archivo').catch(function () {});

  PROJECTS.forEach(function (project, pIdx) {
    var slot = projectSlot(pIdx, PROJECTS.length);
    var pos = new THREE.Vector3(Math.cos(slot.phi) * R, slot.y, Math.sin(slot.phi) * R);
    var inward = new THREE.Vector3(-Math.cos(slot.phi), 0, -Math.sin(slot.phi));

    // Both sit pulled in from the wall's own radius -- at the wall's exact
    // radius they're coplanar with the textured shell and z-fight with it
    // (which one wins the depth test becomes arbitrary, so the label can
    // vanish behind the wall texture entirely).
    var rimPos = pos.clone().addScaledVector(inward, 0.01);
    var labelPos = pos.clone().addScaledVector(inward, 0.025);

    // Rim: a backing hex a touch larger than the label, swaps to accent
    // red on hover.
    var rimGeo = new THREE.CircleGeometry(1, 6);
    rimGeo.rotateZ(Math.PI / 6);
    rimGeo.scale(rxW * 1.08, ryW * 1.08, 1);
    var rimMat = new THREE.MeshBasicMaterial({ color: 0x6b4526, side: THREE.DoubleSide });
    var rimMesh = new THREE.Mesh(rimGeo, rimMat);
    rimMesh.position.copy(rimPos);
    rimMesh.quaternion.setFromUnitVectors(fwd, inward);
    scene.add(rimMesh);

    // Label: the cream cell face with the index/title texture.
    var labelGeo = new THREE.CircleGeometry(1, 6);
    labelGeo.rotateZ(Math.PI / 6);
    labelGeo.scale(rxW, ryW, 1);
    var labelMat = new THREE.MeshBasicMaterial({ map: buildLabelTexture(project), side: THREE.DoubleSide });
    var labelMesh = new THREE.Mesh(labelGeo, labelMat);
    labelMesh.position.copy(labelPos);
    labelMesh.quaternion.setFromUnitVectors(fwd, inward);
    labelMesh.userData.project = project;
    labelMesh.userData.rim = rimMesh;
    labelMesh.userData.basePos = labelPos.clone();
    labelMesh.userData.rimBasePos = rimMesh.position.clone();
    labelMesh.userData.inward = inward;
    scene.add(labelMesh);
    raycastTargets.push(labelMesh);
  });

  function resize() {
    var w = sceneEl.clientWidth || 1;
    var h = sceneEl.clientHeight || 1;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- mode / fade transition ----------
  // No 3D flight path: the landing is a flat image with no position in the
  // WebGL scene to fly from, so entering/leaving is a plain crossfade.

  var mode = 'landing'; // landing | inside
  var FADE_MS = reduceMotion ? 0 : 280;

  function crossfadeTo(showInside) {
    fadeEl.classList.add('active');
    setTimeout(function () {
      if (showInside) {
        landing.style.display = 'none';
        canvas.classList.add('visible');
        canvas.style.pointerEvents = 'auto';
        backBtn.classList.add('visible');
        backBtn.tabIndex = 0;
        hintEl.classList.add('visible');
        mode = 'inside';
        canvas.focus();
        announce('Inside the hive. ' + PROJECTS.length + ' projects on the wall.');
      } else {
        landing.style.display = '';
        canvas.classList.remove('visible');
        canvas.style.pointerEvents = 'none';
        backBtn.classList.remove('visible');
        backBtn.tabIndex = -1;
        hintEl.classList.remove('visible');
        mode = 'landing';
        setHover(hovered, false);
        hovered = null;
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
    canvas.focus();
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

  // ---------- look-around: the camera sits fixed at the wall's axis, so
  // "orbiting" is just turning the camera's yaw. ----------

  camera.position.set(0, midY, 0.001);
  camera.rotation.order = 'YXZ';

  var yaw = 0;
  var raycaster = new THREE.Raycaster();
  var mouseNDC = new THREE.Vector2();
  var hovered = null;
  var dragging = false;
  var dragMoved = false;
  var lastX = 0;
  var yawVel = 0;
  var suppressClick = false;
  var DRAG_SENSITIVITY = 0.0035;
  var TAP_THRESHOLD = 8;
  var IDLE_SPIN = 0.05; // rad/s
  var HOVER_LIFT = 0.06;
  var lastInputTime = -Infinity;

  function setHover(mesh, on) {
    if (!mesh) return;
    mesh.userData.rim.material.color.set(on ? 0xec3013 : 0x6b4526);
    var target = on
      ? mesh.userData.basePos.clone().addScaledVector(mesh.userData.inward, HOVER_LIFT)
      : mesh.userData.basePos;
    mesh.position.copy(target);
    var rimTarget = on
      ? mesh.userData.rimBasePos.clone().addScaledVector(mesh.userData.inward, HOVER_LIFT)
      : mesh.userData.rimBasePos;
    mesh.userData.rim.position.copy(rimTarget);
    if (on) {
      readoutN.textContent = mesh.userData.project.label;
      readoutT.textContent = mesh.userData.project.name;
      readoutEl.classList.add('visible');
    } else {
      readoutEl.classList.remove('visible');
    }
  }

  function raycastAt(clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    mouseNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouseNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouseNDC, camera);
    var hits = raycaster.intersectObjects(raycastTargets);
    var hit = hits.length ? hits[0].object : null;
    if (hit !== hovered) {
      setHover(hovered, false);
      hovered = hit;
      setHover(hovered, true);
    }
    canvas.style.cursor = hovered ? 'pointer' : 'default';
    return hovered;
  }

  function dragStart(x, y) {
    if (mode !== 'inside' || modalOpen) return;
    dragging = true;
    dragMoved = false;
    lastX = x;
    yawVel = 0;
  }
  function dragMove(x, y) {
    if (!dragging) return;
    var dx = x - lastX;
    if (!dragMoved && Math.abs(dx) > TAP_THRESHOLD) dragMoved = true;
    if (dragMoved) {
      var delta = -dx * DRAG_SENSITIVITY;
      yaw += delta;
      yawVel = delta;
      lastInputTime = elapsed;
    }
    lastX = x;
  }
  function dragEnd() {
    if (!dragging) return;
    dragging = false;
    if (dragMoved) suppressClick = true;
  }

  canvas.addEventListener('mousedown', function (e) { dragStart(e.clientX, e.clientY); });
  window.addEventListener('mousemove', function (e) {
    if (dragging) { dragMove(e.clientX, e.clientY); return; }
    if (mode === 'inside' && !modalOpen) raycastAt(e.clientX, e.clientY);
  });
  window.addEventListener('mouseup', dragEnd);
  canvas.addEventListener('mouseleave', function () {
    if (!dragging) { setHover(hovered, false); hovered = null; }
  });
  canvas.addEventListener('click', function (e) {
    if (suppressClick) { suppressClick = false; return; }
    if (mode !== 'inside' || modalOpen) return;
    var hit = raycastAt(e.clientX, e.clientY);
    if (hit) openModal(hit.userData.project);
  });

  canvas.addEventListener('touchstart', function (e) {
    if (!e.touches.length) return;
    dragStart(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  canvas.addEventListener('touchmove', function (e) {
    if (!dragging || !e.touches.length) return;
    dragMove(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  canvas.addEventListener('touchend', function (e) {
    var wasDrag = dragMoved;
    dragEnd();
    if (wasDrag || !e.changedTouches.length || modalOpen) return;
    var t = e.changedTouches[0];
    var hit = raycastAt(t.clientX, t.clientY);
    if (hit) openModal(hit.userData.project);
  });

  canvas.addEventListener('keydown', function (e) {
    if (mode !== 'inside' || modalOpen) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      yaw += (e.key === 'ArrowLeft' ? -1 : 1) * 0.18;
      lastInputTime = elapsed;
    }
  });

  var clock = new THREE.Clock();
  var elapsed = 0;
  function animate() {
    requestAnimationFrame(animate);
    var dt = clock.getDelta();
    elapsed += dt;

    if (mode === 'inside') {
      if (!dragging && !hovered && !modalOpen) {
        var idleFor = elapsed - lastInputTime;
        if (!reduceMotion && idleFor > 1.2) yaw += dt * IDLE_SPIN;
        yawVel *= 0.9;
      }
      camera.rotation.y = yaw;
      // Cells and the wall itself stay fixed in world space -- like a
      // poster on a wall; only the camera's own yaw changes each frame,
      // which is what reveals different cells as it pans.
    }

    renderer.render(scene, camera);
  }
  animate();
})();
