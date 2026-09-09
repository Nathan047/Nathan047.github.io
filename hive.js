(function () {
  var canvas = document.getElementById('hive-canvas');
  var sceneEl = document.getElementById('hive-scene');
  var tooltip = document.getElementById('hive-tooltip');
  var backBtn = document.getElementById('hive-back');
  if (typeof THREE === 'undefined' || typeof THREE.CSS3DRenderer === 'undefined' || !canvas) return;

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Lower-powered / touch devices get a cheaper build: fewer lathe facets,
  // fewer pollen motes, no light shaft, capped pixel ratio.
  var isLowPower = (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
    (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

  // Flat vector-icon palette. hive.css duplicates a couple of these values
  // for CSS-only fallbacks (see the comment at the top of that file) --
  // there is no build step wiring the two together, so keep them in sync
  // by hand if this changes.
  var PALETTE = {
    outline: 0x23374a,
    bodyGold: 0xe9a83b,
    badgeCream: 0xffd979,
    badgeHover: 0xfff0be,
    archFill: 0x23374a,
    groundShade: 'rgba(12,22,38,0.35)',
    groundShadeTransparent: 'rgba(12,22,38,0)',
    skyTop: '#16283f',
    skyBottom: '#24405c'
  };

  // Magic numbers hoisted out of the body of the script so every consumer
  // reads from one place.
  var CONFIG = {
    SPHERE_R: 3.2,
    HEIGHT_RATIO: 1.9,        // exterior total height = HEIGHT_RATIO * SPHERE_R
    INTERIOR_Y_SCALE: 1.15,   // legacy y-scale, interior profile only
    INTERIOR_R: 1.7,
    INTERIOR_COUNT: 44,
    INTERIOR_HEX_R: 0.62,
    INTERIOR_SCALE: 60,
    CARD_SCALE: 0.0012,

    outlineWidth: 0.055,           // world-space silhouette hull offset
    latheRadialSegments: isLowPower ? 32 : 64,
    seamTubeRadius: 0.045,
    seamTubularSegments: 64,
    seamRadialSegments: 10,

    badgeCount: 6,
    badgeHexR: 0.34,
    badgeBackingPad: 0.07,
    badgeEpsilonFill: 0.03,
    badgeEpsilonBacking: 0.012,
    badgeBandYNorm: 0.38,

    entranceYNorm: 0.05,
    entranceWidth: 0.85,
    entranceArchY: 0.62,
    entranceEpsilon: 0.02,

    swayAmplitude: THREE.MathUtils.degToRad(12),
    swaySpeed: 0.35,
    swayResumeDelay: 2,
    bobAmplitude: 0.08,
    bobSpeed: 1.1,

    // Escape hatch: bump to 2 to try a hard 2-stop toon gradient instead of
    // a fully flat body material. Not wired to a UI toggle -- change here
    // and reload to preview. Default 1 = flat MeshBasicMaterial.
    flatShadeSteps: 1,

    pollenCount: isLowPower ? 40 : 80,

    dragYawSpeed: 0.008,
    dragPolarSpeed: 0.15,
    dragDamping: 0.92,
    orbitPolarMin: -15,
    orbitPolarMax: 35,
    tapMoveThreshold: 8
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

  // Flat MeshBasicMaterial doesn't respond to lights at all -- this ambient
  // light is kept only so nothing else in the scene graph (if anything ever
  // needs a lit material again) silently renders black.
  scene.add(new THREE.AmbientLight(0x8fa3c0, 0.85));

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

  // ---------- exterior silhouette: independent of the interior profile
  // above on purpose. This is a stacked-skep outline (small cap + three
  // bulging bands pinched at the seams) rather than a smooth dome, defined
  // as (yNorm, r) control points from the base (yNorm=0) to the crown
  // (yNorm=1), r in units of the max radius. Run through a Catmull-Rom
  // curve and resampled so the bulges/pinches read as smooth curves rather
  // than sharp joints. ----------
  var EXTERIOR_CONTROL = [
    [0.00, 0.90], // base, flat disc closes it
    [0.02, 0.90], // bottom rim
    [0.12, 1.00], // band 3 bulge
    [0.26, 0.90], // seam A
    [0.38, 0.93], // band 2 bulge
    [0.52, 0.80], // seam B
    [0.62, 0.82], // band 1 bulge
    [0.74, 0.62], // seam C
    [0.82, 0.52], // cap bulge
    [0.95, 0.22], // round toward crown
    [1.00, 0.00]  // crown point
  ];
  // Seam y-positions, exposed separately so the seam rings and the hex
  // badge band can reference them without re-deriving from the control
  // array above.
  var SEAM_Y_NORMS = [0.26, 0.52, 0.74];

  function buildExteriorProfile() {
    var pts = EXTERIOR_CONTROL.map(function (p) { return new THREE.Vector3(p[0], p[1], 0); });
    var curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
    var sampled = curve.getPoints(120);
    return sampled.map(function (v) {
      return { y: THREE.MathUtils.clamp(v.x, 0, 1), r: Math.max(0, v.y) };
    });
  }
  var EXTERIOR_PROFILE = buildExteriorProfile();

  // Piecewise-linear lookup over the resampled curve, same shape as
  // interiorProfile() above but operating on yNorm in [0, 1] rather than
  // [-1, 1].
  function exteriorProfile(yNorm) {
    yNorm = THREE.MathUtils.clamp(yNorm, 0, 1);
    var pts = EXTERIOR_PROFILE;
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1];
      if (yNorm >= a.y && yNorm <= b.y) {
        var span = b.y - a.y;
        var t = span > 1e-6 ? (yNorm - a.y) / span : 0;
        return a.r + (b.r - a.r) * t;
      }
    }
    return pts[pts.length - 1].r;
  }

  var HIVE_H = CONFIG.HEIGHT_RATIO * CONFIG.SPHERE_R; // width:height ~= 1.05:1
  function yNormToWorldY(yNorm) { return (yNorm - 0.5) * HIVE_H; }
  function worldYToYNorm(worldY) { return worldY / HIVE_H + 0.5; }
  function exteriorRadiusAtWorldY(worldY) {
    return exteriorProfile(worldYToYNorm(worldY)) * CONFIG.SPHERE_R;
  }

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
  // shade in flat bands instead of a photoreal falloff. Only used if
  // CONFIG.flatShadeSteps is bumped to 2 -- unwired by default.
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
  var twoStepGradient = null;
  function makeBodyMaterial(colorHex) {
    if (CONFIG.flatShadeSteps === 2) {
      if (!twoStepGradient) twoStepGradient = buildToonGradient(['#000000', '#ffffff']);
      return new THREE.MeshToonMaterial({ color: colorHex, gradientMap: twoStepGradient });
    }
    return new THREE.MeshBasicMaterial({ color: colorHex });
  }

  var fwd = new THREE.Vector3(0, 0, 1);
  var projectMeshes = [];

  // Every material that belongs to the exterior (the flat vector-icon hive
  // body, its outline, seams, entrance and badges) is collected here as it
  // is created, so setExteriorOpacity() below can never silently miss one.
  var exteriorMaterials = [];

  // Offset every vertex of a source geometry outward along its own vertex
  // normal by a FIXED WORLD-SPACE distance. Used for the silhouette hull --
  // unlike scale.multiplyScalar(), this gives a uniform line thickness
  // regardless of local curvature.
  function offsetGeometryAlongNormals(geo, dist) {
    var g = geo.clone();
    g.computeVertexNormals();
    var pos = g.attributes.position, norm = g.attributes.normal;
    for (var i = 0; i < pos.count; i++) {
      pos.setXYZ(i,
        pos.getX(i) + norm.getX(i) * dist,
        pos.getY(i) + norm.getY(i) * dist,
        pos.getZ(i) + norm.getZ(i) * dist);
    }
    pos.needsUpdate = true;
    return g;
  }

  // Wrap a flat 2D shape (built with shape-x = arc-length around the axis,
  // shape-y = height, both in world units, centred on 0,0) onto the
  // exterior silhouette at a given azimuth/height. Small shapes only --
  // the arc-length-to-angle conversion uses the profile radius AT the
  // shape's centre height as a constant, which is a good approximation for
  // anything not spanning a big chunk of the circumference.
  function wrapShapeToProfile(shapeGeo, centreAzimuth, centreWorldY, epsilon) {
    var pos = shapeGeo.attributes.position;
    var centreR = Math.max(0.05, exteriorRadiusAtWorldY(centreWorldY));
    for (var i = 0; i < pos.count; i++) {
      var sx = pos.getX(i), sy = pos.getY(i);
      var h = centreWorldY + sy;
      var theta = centreAzimuth + sx / centreR;
      var r = exteriorRadiusAtWorldY(h) + epsilon;
      pos.setXYZ(i, r * Math.cos(theta), h, r * Math.sin(theta));
    }
    pos.needsUpdate = true;
    shapeGeo.computeVertexNormals();
    return shapeGeo;
  }

  // ---------- exterior body: a lathed skep silhouette in flat body gold,
  // with a separate inverted-hull outline mesh and three seam rings drawn
  // as lines rather than shaded geometry ----------

  var LATHE_SAMPLES = 96;
  var latheSegments = CONFIG.latheRadialSegments;
  // Built bottom-to-top (yNorm 0 -> 1): LatheGeometry derives outward-facing
  // normals from the winding direction of the profile, and a top-to-bottom
  // order would leave the whole shell shaded as if lit from inside.
  var latheProfile = [];
  for (var li = 0; li <= LATHE_SAMPLES; li++) {
    var yN = li / LATHE_SAMPLES;
    var lr = exteriorProfile(yN) * SPHERE_R;
    latheProfile.push(new THREE.Vector2(Math.max(0, lr), yNormToWorldY(yN)));
  }

  var bodyMat = makeBodyMaterial(PALETTE.bodyGold);
  exteriorMaterials.push(bodyMat);
  var latheGeo = new THREE.LatheGeometry(latheProfile, latheSegments);
  var latheMesh = new THREE.Mesh(latheGeo, bodyMat);
  hive.add(latheMesh);

  // Flat disc closes the bottom -- no base board, just enough geometry to
  // not see through the hive from below.
  var baseR = exteriorProfile(0) * SPHERE_R;
  var baseDisc = new THREE.Mesh(new THREE.CircleGeometry(baseR, latheSegments), bodyMat);
  baseDisc.rotation.x = Math.PI / 2;
  baseDisc.position.y = yNormToWorldY(0);
  hive.add(baseDisc);

  // Bold uniform navy silhouette: an inverted hull offset a fixed
  // world-space distance outward, rendered back-face-only so it only shows
  // past the body's own edges.
  var outlineMat = new THREE.MeshBasicMaterial({
    color: PALETTE.outline,
    side: THREE.BackSide,
    depthWrite: false
  });
  exteriorMaterials.push(outlineMat);
  var hullOutline = new THREE.Mesh(offsetGeometryAlongNormals(latheGeo, CONFIG.outlineWidth), outlineMat);
  hive.add(hullOutline);

  // Band seams: a navy ring seated in each pinch groove so it reads as a
  // drawn line rather than a bead.
  var seamRingMat = new THREE.MeshBasicMaterial({ color: PALETTE.outline });
  exteriorMaterials.push(seamRingMat);
  SEAM_Y_NORMS.forEach(function (yN) {
    var r = exteriorProfile(yN) * SPHERE_R;
    var torus = new THREE.Mesh(
      new THREE.TorusGeometry(r, CONFIG.seamTubeRadius, CONFIG.seamRadialSegments, CONFIG.seamTubularSegments),
      seamRingMat
    );
    torus.rotation.x = Math.PI / 2;
    torus.position.y = yNormToWorldY(yN);
    hive.add(torus);
  });

  // ---------- entrance arch: a curved decal wrapped onto band 3, low on
  // the front of the hive. Solid navy fill only -- a navy backing ring
  // against navy fill would be invisible, and a navy hole read directly
  // against the gold body already looks correct on its own ----------

  function buildEntranceShape() {
    var w = CONFIG.entranceWidth, archY = CONFIG.entranceArchY, r = w / 2;
    var shape = new THREE.Shape();
    shape.moveTo(-w / 2, 0);
    shape.lineTo(-w / 2, archY);
    shape.absarc(0, archY, r, Math.PI, 0, true);
    shape.lineTo(w / 2, 0);
    shape.closePath();
    return shape;
  }

  var entranceMat = new THREE.MeshBasicMaterial({ color: PALETTE.archFill });
  exteriorMaterials.push(entranceMat);
  var entranceAzimuth = 0;
  var entranceBottomWorldY = yNormToWorldY(CONFIG.entranceYNorm);
  var entranceGeo = new THREE.ShapeGeometry(buildEntranceShape());
  wrapShapeToProfile(entranceGeo, entranceAzimuth, entranceBottomWorldY, CONFIG.entranceEpsilon);
  var entranceMesh = new THREE.Mesh(entranceGeo, entranceMat);
  hive.add(entranceMesh);

  // ---------- hex badges: six evenly-spaced slots on the middle band
  // (band 2). Two carry real projects (cream fill, clickable); four are
  // decorative "locked" cells padding out the ring (body-gold fill, navy
  // outline only, unclickable, excluded from the raycast target array) ----------

  var badgeCenterWorldY = yNormToWorldY(CONFIG.badgeBandYNorm);
  var badgeR = CONFIG.badgeHexR;
  var badgeBackingR = badgeR + CONFIG.badgeBackingPad;

  var badgeLockedMat = new THREE.MeshBasicMaterial({ color: PALETTE.bodyGold });
  var badgeBackingMat = new THREE.MeshBasicMaterial({ color: PALETTE.outline });
  exteriorMaterials.push(badgeLockedMat, badgeBackingMat);

  var badgeSlots = [];
  for (var b = 0; b < CONFIG.badgeCount; b++) {
    badgeSlots.push((b / CONFIG.badgeCount) * Math.PI * 2 + Math.PI * 0.15);
  }
  // Which slots carry real projects -- spread across the ring rather than
  // bunched together.
  var ACTIVE_SLOT_INDICES = [0, 3];

  var badgeMeshes = [];

  badgeSlots.forEach(function (az, idx) {
    var backingGeo = new THREE.ShapeGeometry(hexShape(badgeBackingR));
    wrapShapeToProfile(backingGeo, az, badgeCenterWorldY, CONFIG.badgeEpsilonBacking);
    var backingMesh = new THREE.Mesh(backingGeo, badgeBackingMat);
    hive.add(backingMesh);

    var activeSlot = ACTIVE_SLOT_INDICES.indexOf(idx);
    var fillGeo = new THREE.ShapeGeometry(hexShape(badgeR));
    wrapShapeToProfile(fillGeo, az, badgeCenterWorldY, CONFIG.badgeEpsilonFill);

    if (activeSlot !== -1 && PROJECTS[activeSlot]) {
      var pdata = PROJECTS[activeSlot];
      var fillMat = new THREE.MeshBasicMaterial({ color: PALETTE.badgeCream });
      exteriorMaterials.push(fillMat);
      var fillMesh = new THREE.Mesh(fillGeo, fillMat);
      fillMesh.userData.project = pdata;
      fillMesh.userData.isBadge = true;
      hive.add(fillMesh);
      projectMeshes.push(fillMesh);
      badgeMeshes.push(fillMesh);
    } else {
      var lockedMesh = new THREE.Mesh(fillGeo, badgeLockedMat);
      hive.add(lockedMesh);
      badgeMeshes.push(lockedMesh);
    }
  });

  function setBadgeVisualState(mesh, active) {
    if (!mesh || !mesh.userData.isBadge) return;
    mesh.material.color.set(active ? PALETTE.badgeHover : PALETTE.badgeCream);
    mesh.scale.setScalar(active ? 1.06 : 1);
  }

  // ---------- staging: a soft diorama behind and around the hive --
  // gradient backdrop, a contact shadow on the ground, a warm light shaft,
  // and drifting pollen motes. None of this is parented to the `hive`
  // group -- it stays put while the body sways/bobs/orbits ----------

  function buildVerticalGradientTexture(topColor, bottomColor) {
    var c = document.createElement('canvas');
    c.width = 4;
    c.height = 256;
    var ctx = c.getContext('2d');
    var g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, topColor);
    g.addColorStop(1, bottomColor);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 256);
    var tex = new THREE.CanvasTexture(c);
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    return tex;
  }

  // Full-frame quad, deliberately oversized so it covers the frustum at any
  // aspect ratio without per-resize recomputation. depthTest disabled so it
  // always renders behind everything regardless of draw order.
  var backdropTex = buildVerticalGradientTexture(PALETTE.skyTop, PALETTE.skyBottom);
  var backdropMat = new THREE.MeshBasicMaterial({ map: backdropTex, depthWrite: false, depthTest: false });
  var backdrop = new THREE.Mesh(new THREE.PlaneGeometry(120, 70), backdropMat);
  backdrop.position.set(0, 1, -25);
  backdrop.renderOrder = -1000;
  scene.add(backdrop);

  function buildRadialShadowTexture() {
    var c = document.createElement('canvas');
    c.width = c.height = 256;
    var ctx = c.getContext('2d');
    var g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, PALETTE.groundShade);
    g.addColorStop(1, PALETTE.groundShadeTransparent);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  }
  var groundShadowTex = buildRadialShadowTexture();
  var groundShadowMat = new THREE.MeshBasicMaterial({
    map: groundShadowTex,
    transparent: true,
    depthWrite: false
  });
  var groundShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(CONFIG.SPHERE_R * 2.6, CONFIG.SPHERE_R * 1.6),
    groundShadowMat
  );
  groundShadow.rotation.x = -Math.PI / 2;
  groundShadow.position.y = yNormToWorldY(0) - 0.02;
  groundShadow.renderOrder = -500;
  scene.add(groundShadow);

  // Soft warm diagonal quad, additive + low opacity, seated well behind the
  // hive body (z more negative than the hive's own back edge) so it never
  // crosses over the front and tints the flat fill.
  var lightShaft = null;
  if (!isLowPower) {
    var shaftMat = new THREE.MeshBasicMaterial({
      color: 0xfff2c8,
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    lightShaft = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 16), shaftMat);
    lightShaft.position.set(-1.5, 1, -6);
    lightShaft.rotation.z = Math.PI / 8;
    lightShaft.rotation.y = Math.PI / 10;
    lightShaft.renderOrder = -400;
    scene.add(lightShaft);
  }

  // Pollen motes: fully disabled under prefers-reduced-motion rather than
  // just frozen in place, per the plan's non-goals around motion.
  var pollen = null;
  var pollenSpeed = null;
  var pollenDrift = null;
  var POLLEN_COUNT = CONFIG.pollenCount;
  if (!reduceMotion) {
    function buildPollenTexture() {
      var c = document.createElement('canvas');
      c.width = c.height = 32;
      var ctx = c.getContext('2d');
      var g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
      g.addColorStop(0, 'rgba(255,238,180,1)');
      g.addColorStop(1, 'rgba(255,238,180,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 32, 32);
      return new THREE.CanvasTexture(c);
    }
    var pollenGeo = new THREE.BufferGeometry();
    var pollenPos = new Float32Array(POLLEN_COUNT * 3);
    pollenSpeed = new Float32Array(POLLEN_COUNT);
    pollenDrift = new Float32Array(POLLEN_COUNT);
    for (var pi = 0; pi < POLLEN_COUNT; pi++) {
      var pang = Math.random() * Math.PI * 2;
      var prad = Math.random() * CONFIG.SPHERE_R * 2.2;
      pollenPos[pi * 3] = Math.cos(pang) * prad;
      pollenPos[pi * 3 + 1] = (Math.random() - 0.3) * HIVE_H * 1.4;
      pollenPos[pi * 3 + 2] = Math.sin(pang) * prad * 0.6 + (Math.random() - 0.5) * 4;
      pollenSpeed[pi] = 0.15 + Math.random() * 0.25;
      pollenDrift[pi] = Math.random() * Math.PI * 2;
    }
    pollenGeo.setAttribute('position', new THREE.BufferAttribute(pollenPos, 3));
    var pollenMat = new THREE.PointsMaterial({
      color: 0xffe9a8,
      size: 0.09,
      map: buildPollenTexture(),
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      sizeAttenuation: true
    });
    pollen = new THREE.Points(pollenGeo, pollenMat);
    scene.add(pollen);
  }

  function updatePollen(dt) {
    if (!pollen) return;
    var arr = pollen.geometry.attributes.position.array;
    for (var qi = 0; qi < POLLEN_COUNT; qi++) {
      arr[qi * 3 + 1] += pollenSpeed[qi] * dt * 0.3;
      arr[qi * 3] += Math.sin(elapsed * 0.5 + pollenDrift[qi]) * dt * 0.05;
      if (arr[qi * 3 + 1] > HIVE_H) arr[qi * 3 + 1] = -HIVE_H * 0.6;
    }
    pollen.geometry.attributes.position.needsUpdate = true;
  }

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

  // Flat MeshBasicMaterial, coherent with the exterior treatment -- the
  // clearcoat/roughness/emissive photoreal properties from the old
  // MeshPhysicalMaterial versions are dropped since Basic ignores them
  // anyway. Colors kept close to their previous values.
  var interiorRimMat = new THREE.MeshBasicMaterial({ color: 0x7a4e18, transparent: true, opacity: 0 });
  var interiorCapMat = new THREE.MeshBasicMaterial({ color: 0xd9a53d, transparent: true, opacity: 0 });
  var interiorProjectRimMat = new THREE.MeshBasicMaterial({ color: 0xc47a1f, transparent: true, opacity: 0 });
  var interiorProjectCapMat = new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0 });
  // Shared navy backing hex, one instance per interior cell, offset a hair
  // further from the chamber centre (i.e. into the wall, behind the cell
  // as seen from inside) so it peeks out as an outline ring.
  var interiorBackingMat = new THREE.MeshBasicMaterial({ color: PALETTE.outline, transparent: true, opacity: 0 });
  var interiorMaterials = [interiorRimMat, interiorCapMat, interiorProjectRimMat, interiorProjectCapMat, interiorBackingMat];

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

    var backingGeo = new THREE.ShapeGeometry(hexShape(r * 1.1));
    var backingMesh = new THREE.Mesh(backingGeo, interiorBackingMat);
    backingMesh.position.copy(pos).addScaledVector(dir.clone().normalize(), 0.02);
    backingMesh.quaternion.setFromUnitVectors(fwd, inwardDir);
    interiorGroup.add(backingMesh);

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

  // Iterates the exteriorMaterials array collected at build time, rather
  // than naming individual materials by hand -- fixes a bug in the
  // original version of this function, which enumerated specific materials
  // by name and would silently miss any new one added later.
  function setExteriorOpacity(op) {
    exteriorMaterials.forEach(function (m) {
      m.transparent = true;
      m.opacity = op;
    });
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
  var swayPhase = 0;
  var orbitYaw = 0;      // user-controlled base yaw, from drag-orbit / keyboard
  var orbitPolarDeg = 0; // user-controlled polar tilt, clamped orbitPolarMin..Max
  var dragYawVel = 0;
  var dragPolarVel = 0;
  var isDragging = false;
  var lastInputTime = -Infinity;
  var yawTween = null; // { from, to, t } -- keyboard-triggered yaw animation

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

  // Entrance arch is an optional second fly-in affordance (null-project
  // target) -- included in the raycast set but not in projectMeshes, so it
  // isn't reachable via the Left/Right keyboard badge cycle.
  var raycastTargets = projectMeshes.concat([entranceMesh]);

  function pointerAt(clientX, clientY) {
    if (mode !== 'orbit') return;
    var rect = canvas.getBoundingClientRect();
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    var hits = raycaster.intersectObjects(raycastTargets);
    if (hits.length) {
      if (hovered !== hits[0].object) {
        setBadgeVisualState(hovered, false);
        hovered = hits[0].object;
        setBadgeVisualState(hovered, true);
      }
      paused = true;
      canvas.style.cursor = 'pointer';
      tooltip.textContent = hovered.userData.project
        ? hovered.userData.project.name + ' — ' + hovered.userData.project.status
        : 'Fly into the hive';
      tooltip.style.opacity = '1';
      tooltip.style.transform = 'translate(' + (clientX - rect.left + 14) + 'px,' + (clientY - rect.top + 10) + 'px)';
    } else {
      setBadgeVisualState(hovered, false);
      hovered = null;
      paused = false;
      canvas.style.cursor = 'default';
      tooltip.style.opacity = '0';
    }
  }

  // ---------- drag-to-orbit with inertia ----------
  // Pointer drag: X drags yaw, Y drags polar angle (clamped). No zoom.
  // A short tap (movement under CONFIG.tapMoveThreshold) still counts as a
  // click/tap-to-select; a real drag suppresses the following click so
  // dragging the hive around never accidentally flies into a badge.
  var dragState = { active: false, startX: 0, startY: 0, lastX: 0, lastY: 0, moved: false };
  var suppressClick = false;

  function dragStart(x, y) {
    if (mode !== 'orbit') return;
    dragState.active = true;
    dragState.moved = false;
    dragState.startX = dragState.lastX = x;
    dragState.startY = dragState.lastY = y;
    isDragging = true;
    dragYawVel = 0;
    dragPolarVel = 0;
    yawTween = null;
  }
  function dragMove(x, y) {
    if (!dragState.active) return;
    var dx = x - dragState.lastX;
    var dy = y - dragState.lastY;
    if (!dragState.moved &&
      (Math.abs(x - dragState.startX) > CONFIG.tapMoveThreshold ||
       Math.abs(y - dragState.startY) > CONFIG.tapMoveThreshold)) {
      dragState.moved = true;
      setBadgeVisualState(hovered, false);
      hovered = null;
      tooltip.style.opacity = '0';
    }
    if (dragState.moved) {
      var yawDelta = dx * CONFIG.dragYawSpeed;
      var polarDelta = -dy * CONFIG.dragPolarSpeed;
      orbitYaw += yawDelta;
      orbitPolarDeg = THREE.MathUtils.clamp(orbitPolarDeg + polarDelta, CONFIG.orbitPolarMin, CONFIG.orbitPolarMax);
      dragYawVel = yawDelta;
      dragPolarVel = polarDelta;
      lastInputTime = elapsed;
    }
    dragState.lastX = x;
    dragState.lastY = y;
  }
  function dragEnd() {
    if (!dragState.active) return;
    dragState.active = false;
    isDragging = false;
    lastInputTime = elapsed;
    if (dragState.moved) suppressClick = true;
  }

  canvas.addEventListener('mousedown', function (e) {
    if (mode !== 'orbit') return;
    dragStart(e.clientX, e.clientY);
  });
  window.addEventListener('mousemove', function (e) {
    if (dragState.active) dragMove(e.clientX, e.clientY);
  });
  window.addEventListener('mouseup', function () {
    dragEnd();
  });

  canvas.addEventListener('mousemove', function (e) {
    if (mode === 'inside') {
      var rect = canvas.getBoundingClientRect();
      var nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      lookOffset = -nx * 0.6;
      return;
    }
    if (dragState.active) return;
    pointerAt(e.clientX, e.clientY);
  });
  canvas.addEventListener('mouseleave', function () {
    lookOffset = 0;
    if (mode !== 'orbit') return;
    setBadgeVisualState(hovered, false);
    hovered = null;
    paused = false;
    canvas.style.cursor = 'default';
    tooltip.style.opacity = '0';
  });
  canvas.addEventListener('click', function (e) {
    if (suppressClick) { suppressClick = false; return; }
    if (mode !== 'orbit') return;
    pointerAt(e.clientX, e.clientY);
    if (hovered) startFlightIn(hovered);
  });

  canvas.addEventListener('touchstart', function (e) {
    if (mode !== 'orbit' || !e.touches.length) return;
    var t = e.touches[0];
    dragStart(t.clientX, t.clientY);
  }, { passive: true });
  canvas.addEventListener('touchmove', function (e) {
    if (!dragState.active || !e.touches.length) return;
    var t = e.touches[0];
    dragMove(t.clientX, t.clientY);
  }, { passive: true });
  canvas.addEventListener('touchend', function (e) {
    if (mode !== 'orbit' || !e.changedTouches.length) return;
    var wasDrag = dragState.moved;
    dragEnd();
    if (wasDrag) return;
    var t = e.changedTouches[0];
    pointerAt(t.clientX, t.clientY);
    if (hovered) startFlightIn(hovered);
  });

  sceneEl.addEventListener('mouseenter', function () { insideHovering = true; });
  sceneEl.addEventListener('mouseleave', function () { insideHovering = false; });

  // ---------- keyboard navigation ----------
  // Left/Right cycles the active (real-project) badges, yaw-animating the
  // hive so the selected one faces the camera. Enter/Space flies in,
  // Escape flies back out while inside.
  var liveRegion = document.getElementById('hive-live');
  function announce(text) {
    if (liveRegion) liveRegion.textContent = text;
  }

  function badgeAzimuth(mesh) {
    return Math.atan2(mesh.position.z, mesh.position.x);
  }

  // Rotating the hive group by rotation.y = theta shifts every point's
  // effective azimuth by -theta (see Ry matrix), so to bring a badge at
  // local azimuth phi to face the camera (+Z, azimuth pi/2) we need
  // theta = phi - pi/2. Animated via the shortest angular path.
  function animateYawTo(targetYaw) {
    var current = orbitYaw;
    var delta = ((targetYaw - current + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    yawTween = { from: current, to: current + delta, t: 0 };
    lastInputTime = elapsed;
  }

  var keyboardIndex = -1;

  canvas.addEventListener('keydown', function (e) {
    if (mode === 'orbit') {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (!projectMeshes.length) return;
        e.preventDefault();
        if (keyboardIndex >= 0 && projectMeshes[keyboardIndex]) {
          setBadgeVisualState(projectMeshes[keyboardIndex], false);
        }
        var dir = e.key === 'ArrowRight' ? 1 : -1;
        keyboardIndex = ((keyboardIndex < 0 ? 0 : keyboardIndex + dir) + projectMeshes.length) % projectMeshes.length;
        var mesh = projectMeshes[keyboardIndex];
        setBadgeVisualState(mesh, true);
        animateYawTo(badgeAzimuth(mesh) - Math.PI / 2);
        announce(mesh.userData.project.name + ' — ' + mesh.userData.project.status + '. Press Enter to open.');
      } else if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        if (keyboardIndex >= 0 && projectMeshes[keyboardIndex]) {
          e.preventDefault();
          startFlightIn(projectMeshes[keyboardIndex]);
        }
      }
    } else if (mode === 'inside') {
      if (e.key === 'Escape') {
        e.preventDefault();
        startFlightOut();
      }
    }
  });

  var lookPoint = new THREE.Vector3();

  var clock = new THREE.Clock();
  var elapsed = 0;
  function animate() {
    requestAnimationFrame(animate);
    var dt = clock.getDelta();
    elapsed += dt;
    updatePollen(dt);

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
      // Keyboard-triggered yaw animation takes priority over inertia.
      if (yawTween) {
        yawTween.t += dt / 0.6;
        if (yawTween.t >= 1) {
          orbitYaw = yawTween.to;
          yawTween = null;
        } else {
          orbitYaw = yawTween.from + (yawTween.to - yawTween.from) * easeInOutCubic(yawTween.t);
        }
      } else if (!isDragging) {
        // Inertia: keep coasting on the last drag velocity, damping toward
        // zero rather than stopping dead the instant the pointer lifts.
        orbitYaw += dragYawVel;
        orbitPolarDeg = THREE.MathUtils.clamp(orbitPolarDeg + dragPolarVel, CONFIG.orbitPolarMin, CONFIG.orbitPolarMax);
        var damping = Math.pow(CONFIG.dragDamping, Math.max(dt * 60, 0.0001));
        dragYawVel *= damping;
        dragPolarVel *= damping;
      }

      // Flat MeshBasicMaterial looks identical from every yaw angle on a
      // rotationally-symmetric lathe under a full spin, so idle motion is a
      // gentle yaw sway instead -- drag-orbit lets a visitor rotate past it
      // to see the badges on other sides. Sway resumes a couple of seconds
      // after the last drag/keyboard input, not immediately.
      var idleFor = elapsed - lastInputTime;
      var swayActive = !paused && !reduceMotion && !isDragging && !yawTween && idleFor > CONFIG.swayResumeDelay;
      if (swayActive) swayPhase += dt * CONFIG.swaySpeed;
      var swayOffset = swayActive ? Math.sin(swayPhase) * CONFIG.swayAmplitude : 0;
      hive.rotation.y = orbitYaw + swayOffset;
      hive.rotation.x = -0.18 + THREE.MathUtils.degToRad(orbitPolarDeg);
      if (!reduceMotion) {
        hive.position.y = Math.sin(elapsed * CONFIG.bobSpeed) * CONFIG.bobAmplitude;
      }
    }

    renderer.render(scene, camera);
    cssRenderer.render(cssScene, camera);
  }
  animate();
})();
