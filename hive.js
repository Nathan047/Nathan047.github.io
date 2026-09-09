(function () {
  var canvas = document.getElementById('hive-canvas');
  var sceneEl = document.getElementById('hive-scene');
  var tooltip = document.getElementById('hive-tooltip');
  var backBtn = document.getElementById('hive-back');
  if (typeof THREE === 'undefined' || typeof THREE.CSS3DRenderer === 'undefined' || !canvas) return;

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Magic numbers hoisted out of the body of the script so every consumer
  // reads from one place. (Phase 0 refactor -- exterior silhouette numbers
  // arrive in Phase 1.)
  var CONFIG = {
    SPHERE_R: 3.2,
    INTERIOR_Y_SCALE: 1.15,
    INTERIOR_R: 1.7,
    INTERIOR_COUNT: 44,
    INTERIOR_HEX_R: 0.62,
    INTERIOR_SCALE: 60,
    CARD_SCALE: 0.0012
  };

  var STATUS_STYLE = {
    shipped: { bg: 'var(--status-shipped-bg)', fg: 'var(--status-shipped)' },
    'in progress': { bg: 'var(--status-progress-bg)', fg: 'var(--status-progress)' },
    archived: { bg: 'var(--status-archived-bg)', fg: 'var(--status-archived)' }
  };
  function statusStyle(status) {
    return STATUS_STYLE[(status || '').toLowerCase()] || STATUS_STYLE.shipped;
  }

  var PROJECTS = [
    { name: 'To-Do List', status: 'Shipped', label: '№ 001', href: '/to-do-list/' },
    { name: 'FPL Team Manager', status: 'Shipped', label: '№ 002', href: '/fpl/' }
  ];

  var scene = new THREE.Scene();
  var cssScene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
  camera.position.set(0, 1.5, 12.5);
  camera.lookAt(0, 0, 0);

  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  var cssRenderer = new THREE.CSS3DRenderer();
  cssRenderer.domElement.id = 'hive-css';
  sceneEl.appendChild(cssRenderer.domElement);

  scene.add(new THREE.AmbientLight(0x8fa3c0, 0.85));
  var key = new THREE.DirectionalLight(0xffd9a0, 0.65);
  key.position.set(4, 5, 6);
  scene.add(key);
  var rim = new THREE.DirectionalLight(0x5577cc, 0.4);
  rim.position.set(-5, -2, -4);
  scene.add(rim);

  var hive = new THREE.Group();
  hive.rotation.x = -0.18;
  scene.add(hive);

  var SPHERE_R = CONFIG.SPHERE_R;

  // Beehive (skep) silhouette, defined as radius-at-height control points
  // from top to base: a tight tapered crown, a flared shoulder, and a
  // rounded, broader foot -- deliberately asymmetric, unlike a sphere.
  //
  // This curve now feeds ONLY the interior chamber (buildHiveDirections).
  // The exterior silhouette gets its own profile in Phase 1 -- keeping them
  // separate is required so reshaping the outside can't silently deform the
  // inside.
  var INTERIOR_PROFILE = [
    [1.00, 0.10],
    [0.65, 0.50],
    [0.25, 0.95],
    [0.00, 1.00],
    [-0.25, 1.10],
    [-0.55, 1.06],
    [-0.85, 0.88],
    [-1.00, 0.64]
  ];
  function interiorProfile(y) {
    for (var j = 0; j < INTERIOR_PROFILE.length - 1; j++) {
      var a = INTERIOR_PROFILE[j], b = INTERIOR_PROFILE[j + 1];
      if (y <= a[0] && y >= b[0]) {
        var t = (a[0] - y) / (a[0] - b[0]);
        return a[1] + (b[1] - a[1]) * t;
      }
    }
    return 1.0;
  }

  // Temporary alias so the exterior consumers below (lathe, entrance, hex
  // windows) keep working unchanged during this pure refactor pass. Phase 1
  // replaces this with a real, independent exterior profile.
  var hiveProfile = interiorProfile;

  var golden = Math.PI * (3 - Math.sqrt(5));
  function buildHiveDirections(count) {
    var pts = [];
    for (var i = 0; i < count; i++) {
      var y = 1 - (i / (count - 1)) * 2;
      var radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
      var theta = golden * i;
      var azX = radiusAtY > 1e-6 ? Math.cos(theta) : 0;
      var azZ = radiusAtY > 1e-6 ? Math.sin(theta) : 0;
      var profileR = interiorProfile(y);
      pts.push(new THREE.Vector3(azX * profileR, y * CONFIG.INTERIOR_Y_SCALE, azZ * profileR));
    }
    return pts;
  }

  // Pick, for each project, the direction whose angle around the equator is
  // closest to an even split -- spreads project cells uniformly around the
  // shell instead of letting them land next to each other by chance.
  function pickProjectIndices(dirPoints, projects) {
    var equatorial = [];
    dirPoints.forEach(function (p, idx) {
      if (Math.abs(p.y) < 0.28) equatorial.push(idx);
    });
    var used = {};
    var indices = [];
    for (var k = 0; k < projects.length; k++) {
      var targetAngle = (k / projects.length) * Math.PI * 2;
      var best = null, bestDiff = Infinity;
      equatorial.forEach(function (idx) {
        if (used[idx]) return;
        var a = Math.atan2(dirPoints[idx].z, dirPoints[idx].x);
        var diff = Math.abs(Math.atan2(Math.sin(a - targetAngle), Math.cos(a - targetAngle)));
        if (diff < bestDiff) { bestDiff = diff; best = idx; }
      });
      if (best !== null) { used[best] = true; indices.push(best); }
    }
    return indices;
  }

  // Guarantee a visible gap (never an overlap) between every cell and its
  // closest neighbour: size each hex off its own nearest-neighbour
  // distance rather than a single fixed radius.
  function nearestDistances(worldPosArr) {
    return worldPosArr.map(function (p, i) {
      var min = Infinity;
      for (var j = 0; j < worldPosArr.length; j++) {
        if (j === i) continue;
        var d = p.distanceTo(worldPosArr[j]);
        if (d < min) min = d;
      }
      return min;
    });
  }

  function hexShape(r) {
    var shape = new THREE.Shape();
    for (var s = 0; s < 6; s++) {
      var ang = (Math.PI / 3) * s;
      var x = Math.cos(ang) * r;
      var y = Math.sin(ang) * r;
      if (s === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
    }
    shape.closePath();
    return shape;
  }

  function hexGeo(r) {
    var geo = new THREE.ExtrudeGeometry(hexShape(r), {
      depth: 0.16,
      bevelEnabled: true,
      bevelThickness: 0.06,
      bevelSize: r * 0.1,
      bevelSegments: 3,
      curveSegments: 1
    });
    geo.translate(0, 0, -0.08);
    return geo;
  }

  // A hard-stepped gradient (not a smooth ramp) is what makes MeshToonMaterial
  // shade in flat bands instead of a photoreal falloff -- the classic
  // cel-shaded video-game look. NearestFilter keeps the steps crisp.
  function buildToonGradient(stops) {
    var canvas = document.createElement('canvas');
    canvas.width = stops.length;
    canvas.height = 1;
    var ctx = canvas.getContext('2d');
    for (var i = 0; i < stops.length; i++) {
      ctx.fillStyle = stops[i];
      ctx.fillRect(i, 0, 1, 1);
    }
    var tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = tex.magFilter = THREE.NearestFilter;
    return tex;
  }
  var toonGradient = buildToonGradient(['#3a2a12', '#8a5f22', '#d9a53d', '#ffe08a']);

  // A thin black backface shell just outside every exterior mesh, the
  // standard "inverted hull" trick for a cartoon outline.
  var outlineMat = new THREE.MeshBasicMaterial({ color: 0x1c1206, side: THREE.BackSide });
  function addOutline(mesh, scale) {
    var outline = new THREE.Mesh(mesh.geometry, outlineMat);
    outline.position.copy(mesh.position);
    outline.quaternion.copy(mesh.quaternion);
    outline.scale.copy(mesh.scale).multiplyScalar(scale || 1.045);
    hive.add(outline);
    return outline;
  }

  // material index 0 = extruded sides + bevel (the darker rim),
  // material index 1 = the flat front/back caps (the glossy face)
  var projectRimMat = new THREE.MeshToonMaterial({ color: 0xc47a1f, gradientMap: toonGradient });
  var projectCapMat = new THREE.MeshToonMaterial({
    color: 0xffe08a,
    emissive: 0x4a2c06,
    emissiveIntensity: 0.7,
    gradientMap: toonGradient
  });

  var fwd = new THREE.Vector3(0, 0, 1);
  var projectMeshes = [];

  // ---------- woven straw body: a lathed skep silhouette with coiled
  // ridges baked into the profile and a procedural straw texture, so the
  // outside reads as a basket rather than a tiled honeycomb ball ----------

  function buildStrawTextures() {
    var w = 512, h = 512;
    var colorCanvas = document.createElement('canvas');
    var bumpCanvas = document.createElement('canvas');
    colorCanvas.width = bumpCanvas.width = w;
    colorCanvas.height = bumpCanvas.height = h;
    var cctx = colorCanvas.getContext('2d');
    var bctx = bumpCanvas.getContext('2d');

    var grad = cctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#dfbd74');
    grad.addColorStop(0.55, '#c69a4e');
    grad.addColorStop(1, '#a67c3a');
    cctx.fillStyle = grad;
    cctx.fillRect(0, 0, w, h);
    bctx.fillStyle = '#888';
    bctx.fillRect(0, 0, w, h);

    var bands = 22;
    for (var i = 0; i < bands; i++) {
      var y = (i / bands) * h, bh = h / bands;
      cctx.fillStyle = 'rgba(255,235,180,0.14)';
      cctx.fillRect(0, y, w, bh * 0.42);
      cctx.fillStyle = 'rgba(70,45,15,0.16)';
      cctx.fillRect(0, y + bh * 0.42, w, bh * 0.18);
      bctx.fillStyle = 'rgba(255,255,255,0.55)';
      bctx.fillRect(0, y, w, bh * 0.42);
      bctx.fillStyle = 'rgba(0,0,0,0.55)';
      bctx.fillRect(0, y + bh * 0.42, w, bh * 0.18);
    }

    for (var n = 0; n < 2400; n++) {
      var x = Math.random() * w, yy = Math.random() * h;
      var len = 6 + Math.random() * 16;
      var ang = Math.random() * 0.5 - 0.25;
      var light = Math.random() < 0.5;
      var x2 = x + Math.cos(ang) * len, y2 = yy + Math.sin(ang) * len;
      cctx.strokeStyle = light ? 'rgba(255,240,205,0.45)' : 'rgba(70,45,15,0.4)';
      cctx.lineWidth = 1;
      cctx.beginPath(); cctx.moveTo(x, yy); cctx.lineTo(x2, y2); cctx.stroke();
      bctx.strokeStyle = light ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)';
      bctx.lineWidth = 1;
      bctx.beginPath(); bctx.moveTo(x, yy); bctx.lineTo(x2, y2); bctx.stroke();
    }

    var colorTex = new THREE.CanvasTexture(colorCanvas);
    var bumpTex = new THREE.CanvasTexture(bumpCanvas);
    [colorTex, bumpTex].forEach(function (t) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(10, 7);
    });
    return { map: colorTex, bumpMap: bumpTex };
  }


  var LATHE_SAMPLES = 96;
  var RING_COUNT = 16;
  var RING_AMPLITUDE = 0.045;
  // Built bottom-to-top: LatheGeometry derives outward-facing normals from
  // the winding direction of the profile, and a top-to-bottom order left
  // the whole shell shaded as if lit from inside.
  var latheProfile = [];
  for (var li = LATHE_SAMPLES; li >= 0; li--) {
    var ly = 1 - (li / LATHE_SAMPLES) * 2.05;
    var baseR = hiveProfile(Math.max(-1, Math.min(1, ly)));
    var ridge = RING_AMPLITUDE * Math.sin(ly * RING_COUNT * Math.PI);
    var lr = Math.max(0.001, baseR + ridge) * SPHERE_R;
    latheProfile.push(new THREE.Vector2(lr, ly * CONFIG.INTERIOR_Y_SCALE * SPHERE_R));
  }
  // Close with a short inward taper into a flat base board, rather than
  // tapering all the way to a point -- real skeps sit on a board, they
  // don't come to an egg-like tip.
  var baseEdge = latheProfile[0];
  var baseBoardR = baseEdge.x * 0.88;
  var baseBoardY = baseEdge.y - 0.05 * SPHERE_R;
  latheProfile.unshift(new THREE.Vector2(baseBoardR, baseBoardY));

  var strawTex = buildStrawTextures();
  var strawMat = new THREE.MeshToonMaterial({
    map: strawTex.map,
    bumpMap: strawTex.bumpMap,
    bumpScale: 0.6,
    gradientMap: toonGradient
  });
  var latheMesh = new THREE.Mesh(new THREE.LatheGeometry(latheProfile, 48), strawMat);
  hive.add(latheMesh);
  addOutline(latheMesh, 1.035);

  var baseBoardMat = new THREE.MeshToonMaterial({ color: 0x6b4a26, gradientMap: toonGradient });
  var baseBoard = new THREE.Mesh(new THREE.CircleGeometry(baseBoardR, 48), baseBoardMat);
  baseBoard.rotation.x = Math.PI / 2;
  baseBoard.position.y = baseBoardY;
  hive.add(baseBoard);

  // a dark entrance gap near the base, like a real skep
  var entranceY = -0.62;
  var entranceR = hiveProfile(entranceY) * SPHERE_R;
  var entranceNormal = new THREE.Vector3(1, 0, 0);
  var entrancePos = new THREE.Vector3(entranceR, entranceY * CONFIG.INTERIOR_Y_SCALE * SPHERE_R, 0);
  var entranceOuterMat = new THREE.MeshToonMaterial({ color: 0x3a2a12, gradientMap: toonGradient });
  var entranceInnerMat = new THREE.MeshToonMaterial({ color: 0x0c0805, gradientMap: toonGradient });
  var entranceOuter = new THREE.Mesh(new THREE.CircleGeometry(0.34, 24), entranceOuterMat);
  entranceOuter.position.copy(entrancePos).addScaledVector(entranceNormal, 0.01);
  entranceOuter.quaternion.setFromUnitVectors(fwd, entranceNormal);
  hive.add(entranceOuter);
  var entranceInner = new THREE.Mesh(new THREE.CircleGeometry(0.2, 24), entranceInnerMat);
  entranceInner.position.copy(entrancePos).addScaledVector(entranceNormal, 0.02);
  entranceInner.quaternion.copy(entranceOuter.quaternion);
  hive.add(entranceInner);

  // glowing hex windows set into the woven wall, one per project
  var WINDOW_R = 0.42;
  var WINDOW_Y = 0;
  var windowProfileR = hiveProfile(WINDOW_Y) * SPHERE_R;
  var windowWorldY = WINDOW_Y * CONFIG.INTERIOR_Y_SCALE * SPHERE_R;
  var windowMeshes = [];

  PROJECTS.forEach(function (pdata, k) {
    var az = (k / PROJECTS.length) * Math.PI * 2 + 0.4;
    var outward = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    var pos = new THREE.Vector3(outward.x * windowProfileR, windowWorldY, outward.z * windowProfileR);
    var geo = hexGeo(WINDOW_R);
    var mesh = new THREE.Mesh(geo, [projectCapMat, projectRimMat]);
    mesh.position.copy(pos).addScaledVector(outward, 0.05);
    mesh.quaternion.setFromUnitVectors(fwd, outward);
    mesh.userData.project = pdata;
    hive.add(mesh);
    addOutline(mesh, 1.12);
    projectMeshes.push(mesh);
    windowMeshes.push(mesh);
  });

  // ---------- interior of the hive: a smaller inward-facing shell of the
  // same silhouette, walked with project cards floating on its walls ----------

  var INTERIOR_R = CONFIG.INTERIOR_R;
  var INTERIOR_COUNT = CONFIG.INTERIOR_COUNT;
  var INTERIOR_HEX_R = CONFIG.INTERIOR_HEX_R;

  // CSS3DRenderer treats one Three.js unit as one literal CSS pixel, so the
  // interior -- built in the same small units as the exterior for proportion
  // -- is scaled up as a whole group to sit a realistic pixel-distance from
  // the camera. Camera.far above was extended to still see it at that size.
  var INTERIOR_SCALE = CONFIG.INTERIOR_SCALE;

  var interiorGroup = new THREE.Group();
  interiorGroup.visible = false;
  interiorGroup.scale.setScalar(INTERIOR_SCALE);
  scene.add(interiorGroup);

  var interiorCssGroup = new THREE.Object3D();
  interiorCssGroup.scale.setScalar(INTERIOR_SCALE);
  cssScene.add(interiorCssGroup);

  var interiorRimMat = new THREE.MeshStandardMaterial({ color: 0x7a4e18, roughness: 0.7, metalness: 0.05, transparent: true, opacity: 0 });
  var interiorCapMat = new THREE.MeshPhysicalMaterial({ color: 0xd9a53d, roughness: 0.45, metalness: 0.05, clearcoat: 0.3, clearcoatRoughness: 0.5, transparent: true, opacity: 0 });
  var interiorProjectRimMat = new THREE.MeshStandardMaterial({ color: 0xc47a1f, roughness: 0.5, metalness: 0.08, transparent: true, opacity: 0 });
  var interiorProjectCapMat = new THREE.MeshPhysicalMaterial({
    color: 0xffe08a,
    emissive: 0x4a2c06,
    emissiveIntensity: 0.5,
    roughness: 0.28,
    metalness: 0.05,
    clearcoat: 0.65,
    clearcoatRoughness: 0.3,
    transparent: true,
    opacity: 0
  });
  var interiorMaterials = [interiorRimMat, interiorCapMat, interiorProjectRimMat, interiorProjectCapMat];

  var interiorPoints = buildHiveDirections(INTERIOR_COUNT);
  var interiorProjectIndices = pickProjectIndices(interiorPoints, PROJECTS);
  var interiorWorldPos = interiorPoints.map(function (p) { return p.clone().multiplyScalar(INTERIOR_R); });
  var interiorNearestDist = nearestDistances(interiorWorldPos);

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

  var CARD_SCALE = CONFIG.CARD_SCALE;

  interiorPoints.forEach(function (dir, idx) {
    var pIdx = interiorProjectIndices.indexOf(idx);
    var pos = dir.clone().multiplyScalar(INTERIOR_R);
    var inwardDir = dir.clone().normalize().multiplyScalar(-1);
    var r = Math.min(interiorNearestDist[idx] * 0.497, INTERIOR_HEX_R);

    if (pIdx !== -1) {
      var pdata = PROJECTS[pIdx];
      var geo = hexGeo(r * 1.12);
      var mesh = new THREE.Mesh(geo, [interiorProjectCapMat, interiorProjectRimMat]);
      mesh.position.copy(pos);
      mesh.quaternion.setFromUnitVectors(fwd, inwardDir);
      interiorGroup.add(mesh);

      var cardEl = buildCardElement(pdata);
      var cardObj = new THREE.CSS3DObject(cardEl);
      cardObj.position.copy(pos.clone().addScaledVector(inwardDir, 0.35));
      cardObj.quaternion.setFromUnitVectors(fwd, inwardDir);
      cardObj.scale.set(CARD_SCALE, CARD_SCALE, CARD_SCALE);
      cardObj.userData.project = pdata;
      cardObj.userData.dir = dir.clone();
      interiorCssGroup.add(cardObj);
    } else {
      var cellGeo = hexGeo(r);
      var cellMesh = new THREE.Mesh(cellGeo, [interiorCapMat, interiorRimMat]);
      cellMesh.position.copy(pos);
      cellMesh.quaternion.setFromUnitVectors(fwd, inwardDir);
      interiorGroup.add(cellMesh);
    }
  });

  function setExteriorOpacity(op) {
    strawMat.transparent = true; strawMat.opacity = op;
    projectRimMat.transparent = true; projectCapMat.transparent = true;
    projectRimMat.opacity = op; projectCapMat.opacity = op;
    entranceOuterMat.transparent = true; entranceInnerMat.transparent = true;
    entranceOuterMat.opacity = op; entranceInnerMat.opacity = op;
    baseBoardMat.transparent = true; baseBoardMat.opacity = op;
    hive.visible = op > 0.001;
  }

  function setInteriorOpacity(op) {
    interiorMaterials.forEach(function (m) { m.opacity = op; });
    interiorGroup.visible = op > 0.001;
    cssRenderer.domElement.style.opacity = String(op);
    cssRenderer.domElement.style.pointerEvents = (mode === 'inside') ? 'auto' : 'none';
  }

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

  var raycaster = new THREE.Raycaster();
  var mouse = new THREE.Vector2();
  var hovered = null;
  var paused = false;

  // ---------- fly-in / fly-out camera choreography ----------

  var mode = 'orbit'; // orbit | flying-in | inside | flying-out
  var flightT = 1;
  var FLIGHT_DURATION = reduceMotion ? 0.001 : 1.3;
  var flightFrom = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  var flightVia = new THREE.Vector3();
  var flightTo = { pos: new THREE.Vector3(), look: new THREE.Vector3() };

  var ORBIT_POS = camera.position.clone();
  var ORBIT_LOOK = new THREE.Vector3(0, 0, 0);
  var INSIDE_POS = new THREE.Vector3(0, 0.1, 0.05);
  var INSIDE_LOOK = new THREE.Vector3(0, 0.1, -1);
  var lastEntryPoint = new THREE.Vector3();
  var interiorYaw = 0;
  var lookOffset = 0;
  var insideHovering = false;

  function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  function quadBezier(p0, p1, p2, t, out) {
    var it = 1 - t;
    out.set(
      it * it * p0.x + 2 * it * t * p1.x + t * t * p2.x,
      it * it * p0.y + 2 * it * t * p1.y + t * t * p2.y,
      it * it * p0.z + 2 * it * t * p1.z + t * t * p2.z
    );
    return out;
  }

  function setInteractivity() {
    cssRenderer.domElement.style.pointerEvents = (mode === 'inside') ? 'auto' : 'none';
  }

  // Rotate the interior so the card matching the clicked project is already
  // facing the camera on arrival, instead of leaving it to chance as the
  // slow ambient rotation eventually brings it around.
  function yawToFace(dir) {
    return Math.PI - Math.atan2(dir.x, dir.z);
  }

  function startFlightIn(mesh) {
    mesh.getWorldPosition(lastEntryPoint);
    flightFrom.pos.copy(camera.position);
    flightFrom.look.copy(ORBIT_LOOK);
    flightVia.copy(lastEntryPoint);
    flightTo.pos.copy(INSIDE_POS);
    flightTo.look.copy(INSIDE_LOOK);
    flightT = 0;
    mode = 'flying-in';
    hovered = null;
    paused = true;
    canvas.style.cursor = 'default';
    tooltip.style.opacity = '0';

    var targetProject = mesh.userData.project;
    interiorCssGroup.children.forEach(function (c) {
      if (c.userData.project === targetProject) interiorYaw = yawToFace(c.userData.dir);
    });
    lookOffset = 0;

    setInteractivity();
  }

  function startFlightOut() {
    flightFrom.pos.copy(camera.position);
    flightFrom.look.copy(INSIDE_LOOK);
    flightVia.copy(lastEntryPoint);
    flightTo.pos.copy(ORBIT_POS);
    flightTo.look.copy(ORBIT_LOOK);
    flightT = 0;
    mode = 'flying-out';
    backBtn.classList.remove('visible');
    setInteractivity();
  }

  backBtn.addEventListener('click', function () {
    if (mode !== 'inside') return;
    startFlightOut();
  });

  function pointerAt(clientX, clientY) {
    if (mode !== 'orbit') return;
    var rect = canvas.getBoundingClientRect();
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    var hits = raycaster.intersectObjects(projectMeshes);
    if (hits.length) {
      hovered = hits[0].object;
      paused = true;
      canvas.style.cursor = 'pointer';
      tooltip.textContent = hovered.userData.project.name + ' — ' + hovered.userData.project.status;
      tooltip.style.opacity = '1';
      tooltip.style.transform = 'translate(' + (clientX - rect.left + 14) + 'px,' + (clientY - rect.top + 10) + 'px)';
    } else {
      hovered = null;
      paused = false;
      canvas.style.cursor = 'default';
      tooltip.style.opacity = '0';
    }
  }

  canvas.addEventListener('mousemove', function (e) {
    if (mode === 'inside') {
      var rect = canvas.getBoundingClientRect();
      var nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      lookOffset = -nx * 0.6;
      return;
    }
    pointerAt(e.clientX, e.clientY);
  });
  canvas.addEventListener('mouseleave', function () {
    lookOffset = 0;
    if (mode !== 'orbit') return;
    hovered = null;
    paused = false;
    canvas.style.cursor = 'default';
    tooltip.style.opacity = '0';
  });
  canvas.addEventListener('click', function (e) {
    if (mode !== 'orbit') return;
    pointerAt(e.clientX, e.clientY);
    if (hovered) startFlightIn(hovered);
  });
  canvas.addEventListener('touchend', function (e) {
    if (mode !== 'orbit' || !e.changedTouches.length) return;
    var t = e.changedTouches[0];
    pointerAt(t.clientX, t.clientY);
    if (hovered) startFlightIn(hovered);
  });

  sceneEl.addEventListener('mouseenter', function () { insideHovering = true; });
  sceneEl.addEventListener('mouseleave', function () { insideHovering = false; });

  var lookPoint = new THREE.Vector3();

  var clock = new THREE.Clock();
  var elapsed = 0;
  function animate() {
    requestAnimationFrame(animate);
    var dt = clock.getDelta();
    elapsed += dt;

    if (mode === 'flying-in' || mode === 'flying-out') {
      flightT = Math.min(1, flightT + dt / FLIGHT_DURATION);
      var e = easeInOutCubic(flightT);
      quadBezier(flightFrom.pos, flightVia, flightTo.pos, e, camera.position);
      lookPoint.lerpVectors(flightFrom.look, flightTo.look, e);
      camera.lookAt(lookPoint);

      var exteriorOp, interiorOp;
      if (mode === 'flying-in') {
        exteriorOp = THREE.MathUtils.clamp(1 - flightT / 0.4, 0, 1);
        interiorOp = THREE.MathUtils.clamp((flightT - 0.55) / 0.35, 0, 1);
      } else {
        exteriorOp = THREE.MathUtils.clamp((flightT - 0.6) / 0.4, 0, 1);
        interiorOp = THREE.MathUtils.clamp(1 - flightT / 0.35, 0, 1);
      }
      setExteriorOpacity(exteriorOp);
      setInteriorOpacity(interiorOp);

      if (flightT >= 1) {
        if (mode === 'flying-in') {
          mode = 'inside';
          backBtn.classList.add('visible');
        } else {
          mode = 'orbit';
        }
        setInteractivity();
      }
    } else if (mode === 'inside') {
      if (!insideHovering && !reduceMotion) interiorYaw += dt * 0.05;
      var yaw = interiorYaw + lookOffset;
      interiorGroup.rotation.y = yaw;
      interiorCssGroup.rotation.y = yaw;
    } else {
      if (!paused && !reduceMotion) {
        hive.rotation.y += dt * 0.18;
      }
      if (!reduceMotion) {
        hive.position.y = Math.sin(elapsed * 1.1) * 0.08;
        var glow = 0.7 + Math.sin(elapsed * 2.2) * 0.25;
        projectCapMat.emissiveIntensity = glow;
      }
    }

    renderer.render(scene, camera);
    cssRenderer.render(cssScene, camera);
  }
  animate();
})();
