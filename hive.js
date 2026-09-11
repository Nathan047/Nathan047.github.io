(function () {
  var landing = document.getElementById('hive-landing');
  var canvas = document.getElementById('hive-canvas');
  var sceneEl = document.getElementById('hive-scene');
  var backBtn = document.getElementById('hive-back');
  var hintEl = document.getElementById('hive-hint');
  var fadeEl = document.getElementById('hive-fade');
  var liveRegion = document.getElementById('hive-live');
  if (typeof THREE === 'undefined' || typeof THREE.CSS3DRenderer === 'undefined' || !canvas || !landing) return;

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var isLowPower = (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
    (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

  var PROJECTS = [
    { name: 'To-Do List', status: 'Shipped', label: '№ 001', href: '/to-do-list/' },
    { name: 'FPL Team Manager', status: 'Shipped', label: '№ 002', href: '/fpl/' }
  ];

  var STATUS_STYLE = {
    shipped: { bg: 'var(--status-shipped-bg)', fg: 'var(--status-shipped)' },
    'in progress': { bg: 'var(--status-progress-bg)', fg: 'var(--status-progress)' },
    archived: { bg: 'var(--status-archived-bg)', fg: 'var(--status-archived)' }
  };
  function statusStyle(status) {
    return STATUS_STYLE[(status || '').toLowerCase()] || STATUS_STYLE.shipped;
  }

  function announce(text) {
    if (liveRegion) liveRegion.textContent = text;
  }

  // ---------- interior scene: a rotating cylindrical honeycomb wall built
  // from the same lattice the comb-sphere.jpg texture is stamped on, so
  // project cells land exactly on a textured cell rather than a seam ----------

  var scene = new THREE.Scene();
  var cssScene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(90, 1, 0.01, 20);

  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isLowPower ? 1.5 : 2));

  var cssRenderer = new THREE.CSS3DRenderer();
  cssRenderer.domElement.id = 'hive-css';
  sceneEl.appendChild(cssRenderer.domElement);

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

  // One slot per textured cell; phi matches CylinderGeometry's own u
  // mapping so a slot's world position lands on the matching texture cell.
  var rxW = ((2 * Math.PI * R) / COUNT) / Math.sqrt(3);
  var ryW = rowH / 1.5;

  // Project cells all sit on the one ring closest to eye level, spread
  // evenly all the way round the azimuth (not picked from a flat list of
  // eligible slots, which spreads across ring/height first and barely
  // touches angle -- with few projects that leaves them stacked near the
  // same yaw instead of spread around the wall).
  var centerRing = Math.floor(TALL / 2);
  var centerY = H - rowH * (centerRing + 0.5);
  var centerStagger = (centerRing % 2) * 0.5;
  function projectSlot(pIdx, count) {
    var k = Math.round((pIdx / count) * COUNT) % COUNT;
    var u = (k + centerStagger) / COUNT;
    return { y: centerY, phi: Math.PI * 0.5 - u * Math.PI * 2 };
  }

  function buildCardElement(project) {
    var style = statusStyle(project.status);
    var el = document.createElement('div');
    el.className = 'hive-card';
    el.innerHTML =
      '<span class="hive-card-label">' + project.label + '</span>' +
      '<h3>' + project.name + '</h3>' +
      '<span class="hive-card-status" style="background:' + style.bg + ';color:' + style.fg + '">' + project.status + '</span>' +
      '<br><a class="hive-card-link" href="' + project.href + '">Open project →</a>';
    return el;
  }

  var CARD_SCALE = 0.0065;
  var fwd = new THREE.Vector3(0, 0, 1);
  var raycastTargets = [];

  PROJECTS.forEach(function (project, pIdx) {
    var slot = projectSlot(pIdx, PROJECTS.length);
    var pos = new THREE.Vector3(Math.cos(slot.phi) * R, slot.y, Math.sin(slot.phi) * R);
    var inward = new THREE.Vector3(-Math.cos(slot.phi), 0, -Math.sin(slot.phi));

    // Invisible hex hit-target, sized to the same cell footprint the
    // texture was stamped at, for raycasting and the hover lift.
    var hitGeo = new THREE.CircleGeometry(1, 6);
    hitGeo.rotateZ(Math.PI / 6);
    hitGeo.scale(rxW, ryW, 1);
    var hitMat = new THREE.MeshBasicMaterial({
      color: 0xec3013, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false
    });
    var hitMesh = new THREE.Mesh(hitGeo, hitMat);
    hitMesh.position.copy(pos);
    hitMesh.quaternion.setFromUnitVectors(fwd, inward);
    hitMesh.userData.project = project;
    hitMesh.userData.baseOpacity = 0;
    scene.add(hitMesh);
    raycastTargets.push(hitMesh);

    var cardEl = buildCardElement(project);
    var cardObj = new THREE.CSS3DObject(cardEl);
    cardObj.position.copy(pos.clone().addScaledVector(inward, 0.55));
    cardObj.quaternion.setFromUnitVectors(fwd, inward);
    cardObj.scale.set(CARD_SCALE, CARD_SCALE, CARD_SCALE);
    cardObj.userData.project = project;
    cssScene.add(cardObj);
  });

  function resize() {
    var w = sceneEl.clientWidth || 1;
    var h = sceneEl.clientHeight || 1;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    cssRenderer.setSize(w, h);
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
        cssRenderer.domElement.style.display = 'block';
        cssRenderer.domElement.classList.add('visible');
        cssRenderer.domElement.style.pointerEvents = 'auto';
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
        cssRenderer.domElement.classList.remove('visible');
        cssRenderer.domElement.style.display = 'none';
        cssRenderer.domElement.style.pointerEvents = 'none';
        backBtn.classList.remove('visible');
        backBtn.tabIndex = -1;
        hintEl.classList.remove('visible');
        mode = 'landing';
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
  canvas.addEventListener('keydown', function (e) {
    if (mode === 'inside' && e.key === 'Escape') {
      e.preventDefault();
      exitHive();
    }
  });

  // ---------- look-around: the camera sits fixed at the wall's axis, so
  // "orbiting" is just turning the camera's yaw. Rotating the camera
  // instead of the wall keeps the WebGL and CSS3D scenes in sync for free,
  // since both render through the same camera. ----------

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
  var lastInputTime = -Infinity;

  function setHover(mesh, on) {
    if (!mesh) return;
    mesh.material.opacity = on ? 0.22 : mesh.userData.baseOpacity;
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
    if (mode !== 'inside') return;
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
    if (mode === 'inside') raycastAt(e.clientX, e.clientY);
  });
  window.addEventListener('mouseup', dragEnd);
  canvas.addEventListener('mouseleave', function () {
    if (!dragging) { setHover(hovered, false); hovered = null; }
  });
  canvas.addEventListener('click', function (e) {
    if (suppressClick) { suppressClick = false; return; }
    if (mode !== 'inside') return;
    var hit = raycastAt(e.clientX, e.clientY);
    if (hit) {
      announce(hit.userData.project.name + ' — opening.');
      window.location.href = hit.userData.project.href;
    }
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
    if (wasDrag || !e.changedTouches.length) return;
    var t = e.changedTouches[0];
    var hit = raycastAt(t.clientX, t.clientY);
    if (hit) window.location.href = hit.userData.project.href;
  });

  canvas.addEventListener('keydown', function (e) {
    if (mode !== 'inside') return;
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
      if (!dragging) {
        var idleFor = elapsed - lastInputTime;
        if (!reduceMotion && idleFor > 1.2) yaw += dt * IDLE_SPIN;
        yawVel *= 0.9;
      }
      camera.rotation.y = yaw;
      // Cards and the wall itself stay fixed in world space -- like a
      // poster on a wall, they don't need to move; only the camera's own
      // yaw changes each frame, which is what reveals different cards as
      // it pans.
    }

    renderer.render(scene, camera);
    cssRenderer.render(cssScene, camera);
  }
  animate();
})();
