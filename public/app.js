/**
 * app.js
 * Frontend application logic for Projectile Motion Calculator.
 * Interfaces with Emscripten WebAssembly module for all kinematics and position math.
 * Implements interactive canvas rendering, 60fps animation, comparison baseline,
 * live validation, and CSV export.
 */

(() => {
  'use strict';

  // --- Global Application State ---
  const state = {
    wasmReady: false,
    wasmModule: null,
    wasmFuncs: {
      compute: null,
      position: null,
    },
    wasmPointers: {
      outPtr: 0,
      xPtr: 0,
      yPtr: 0,
    },
    params: {
      v0: 20.0,
      angle: 45.0,
      h0: 0.0,
      g: 9.81,
    },
    results: null,
    previousRun: null, // For comparison mode: { params, results }
    animation: {
      isPlaying: false,
      currentTime: 0.0,
      speedMultiplier: 1.0,
      lastTimestamp: null,
      reqId: null,
      trail: [], // Trail of recent positions for visual effect
    },
    hoverInfo: null, // Scrubbed/hovered coordinate on canvas
    sampleStep: 0.1,
  };

  // --- DOM Elements Cache ---
  const DOM = {
    html: document.documentElement,
    themeToggleBtn: document.getElementById('themeToggleBtn'),
    wasmStatusBadge: document.getElementById('wasmStatusBadge'),
    resetDefaultsBtn: document.getElementById('resetDefaultsBtn'),
    loadTestCaseBtn: document.getElementById('loadTestCaseBtn'),
    validationBanner: document.getElementById('validationBanner'),
    validationMessage: document.getElementById('validationMessage'),

    // Inputs
    velocityInput: document.getElementById('velocityInput'),
    angleSlider: document.getElementById('angleSlider'),
    angleInput: document.getElementById('angleInput'),
    angleDisplay: document.getElementById('angleDisplay'),
    heightSlider: document.getElementById('heightSlider'),
    heightInput: document.getElementById('heightInput'),
    gravityInput: document.getElementById('gravityInput'),
    customGravityWrapper: document.getElementById('customGravityWrapper'),
    presetPills: document.querySelectorAll('.preset-pill'),
    quickChips: document.querySelectorAll('.quick-presets .chip'),

    // Compare Mode
    compareToggleBtn: document.getElementById('compareToggleBtn'),
    comparisonActiveBadge: document.getElementById('comparisonActiveBadge'),
    pinnedSummary: document.getElementById('pinnedSummary'),
    clearCompareBtn: document.getElementById('clearCompareBtn'),
    compareLegendItem: document.getElementById('compareLegendItem'),

    // Canvas & Controls
    canvasViewport: document.getElementById('canvasViewport'),
    trajectoryCanvas: document.getElementById('trajectoryCanvas'),
    scaleIndicator: document.getElementById('scaleIndicator'),
    playPauseBtn: document.getElementById('playPauseBtn'),
    playBtnText: document.getElementById('playBtnText'),
    playIcon: document.querySelector('.play-icon'),
    pauseIcon: document.querySelector('.pause-icon'),
    resetSimBtn: document.getElementById('resetSimBtn'),
    simSpeedSelect: document.getElementById('simSpeedSelect'),
    timeScrubber: document.getElementById('timeScrubber'),
    scrubberMaxLabel: document.getElementById('scrubberMaxLabel'),

    // Canvas HUD
    canvasHud: document.getElementById('canvasHud'),
    hudTime: document.getElementById('hudTime'),
    hudX: document.getElementById('hudX'),
    hudY: document.getElementById('hudY'),
    hudV: document.getElementById('hudV'),

    // Result Values
    valPeakTime: document.getElementById('valPeakTime'),
    valMaxHeight: document.getElementById('valMaxHeight'),
    valFlightTime: document.getElementById('valFlightTime'),
    valRange: document.getElementById('valRange'),
    valImpactSpeed: document.getElementById('valImpactSpeed'),
    valImpactAngle: document.getElementById('valImpactAngle'),

    // Delta Badges
    deltaPeakTime: document.getElementById('deltaPeakTime'),
    deltaMaxHeight: document.getElementById('deltaMaxHeight'),
    deltaFlightTime: document.getElementById('deltaFlightTime'),
    deltaRange: document.getElementById('deltaRange'),
    deltaImpactSpeed: document.getElementById('deltaImpactSpeed'),
    deltaImpactAngle: document.getElementById('deltaImpactAngle'),

    // Kinematic Components
    valVx: document.getElementById('valVx'),
    valVy: document.getElementById('valVy'),
    valVyImpact: document.getElementById('valVyImpact'),

    // Data Table & CSV
    stepIntervalSelect: document.getElementById('stepIntervalSelect'),
    downloadCsvBtn: document.getElementById('downloadCsvBtn'),
    trajectoryTableBody: document.getElementById('trajectoryTableBody'),
    tableRowCountBadge: document.getElementById('tableRowCountBadge'),
  };

  // Canvas context
  const ctx = DOM.trajectoryCanvas.getContext('2d');

  // ==========================================================================
  // WebAssembly Initialization
  // ==========================================================================

  async function initWasmEngine() {
    try {
      if (typeof createModule !== 'function') {
        throw new Error('createModule function not found. Ensure projectile.js is loaded.');
      }

      DOM.wasmStatusBadge.innerHTML = '<span class="pulse-dot"></span> Compiling WASM...';

      const Module = await createModule();
      state.wasmModule = Module;

      // Wrap exported C functions
      state.wasmFuncs.compute = Module.cwrap(
        'compute',
        'number', // return int status (0 = success)
        ['number', 'number', 'number', 'number', 'number'] // v0, angle, h0, g, double* out
      );

      state.wasmFuncs.position = Module.cwrap(
        'position',
        'number', // return int status
        ['number', 'number', 'number', 'number', 'number', 'number', 'number'] // v0, angle, h0, g, t, double* x, double* y
      );

      // Allocate memory in WASM heap
      // out array: 8 doubles (64 bytes)
      state.wasmPointers.outPtr = Module._malloc(8 * 8);
      // coordinates x and y: 1 double each (8 bytes each)
      state.wasmPointers.xPtr = Module._malloc(8);
      state.wasmPointers.yPtr = Module._malloc(8);

      state.wasmReady = true;

      DOM.wasmStatusBadge.className = 'badge wasm-badge ready';
      DOM.wasmStatusBadge.innerHTML = '<span class="pulse-dot"></span> C / WASM Engine Active';

      // Perform initial calculation
      calculateAndRender();
    } catch (err) {
      console.error('Failed to load WebAssembly engine:', err);
      DOM.wasmStatusBadge.className = 'badge wasm-badge';
      DOM.wasmStatusBadge.style.borderColor = 'var(--accent-rose)';
      DOM.wasmStatusBadge.style.color = 'var(--accent-rose)';
      DOM.wasmStatusBadge.innerHTML = '⚠️ WASM Engine Failed';
      showValidationError('WebAssembly module failed to initialize. Check console for details.');
    }
  }

  // Helper to read double from WASM heap
  function readWasmDouble(ptrOffset) {
    return state.wasmModule.getValue(ptrOffset, 'double');
  }

  // ==========================================================================
  // Physics Calculation via WebAssembly
  // ==========================================================================

  function computeTrajectory(v0, angle, h0, g) {
    if (!state.wasmReady) return null;

    const outPtr = state.wasmPointers.outPtr;
    const status = state.wasmFuncs.compute(v0, angle, h0, g, outPtr);

    if (status !== 0) {
      return null;
    }

    return {
      vx: readWasmDouble(outPtr + 0 * 8),
      vy: readWasmDouble(outPtr + 1 * 8),
      timeToPeak: readWasmDouble(outPtr + 2 * 8),
      maxHeight: readWasmDouble(outPtr + 3 * 8),
      timeOfFlight: readWasmDouble(outPtr + 4 * 8),
      range: readWasmDouble(outPtr + 5 * 8),
      impactSpeed: readWasmDouble(outPtr + 6 * 8),
      impactAngle: readWasmDouble(outPtr + 7 * 8),
    };
  }

  function getPositionAtTime(v0, angle, h0, g, t) {
    if (!state.wasmReady) return { x: 0, y: 0 };

    const { xPtr, yPtr } = state.wasmPointers;
    state.wasmFuncs.position(v0, angle, h0, g, t, xPtr, yPtr);

    return {
      x: readWasmDouble(xPtr),
      y: readWasmDouble(yPtr),
    };
  }

  // ==========================================================================
  // Validation & Input Parsing
  // ==========================================================================

  function validateAndGetInputs() {
    const v0 = parseFloat(DOM.velocityInput.value);
    const angle = parseFloat(DOM.angleInput.value);
    const h0 = parseFloat(DOM.heightInput.value);
    const g = parseFloat(DOM.gravityInput.value);

    // Validation rules
    if (isNaN(v0) || v0 < 0) {
      return { valid: false, message: 'Initial velocity (v₀) must be a non-negative number (≥ 0 m/s).' };
    }
    if (isNaN(angle) || angle < 0 || angle > 90) {
      return { valid: false, message: 'Launch angle (θ) must be between 0° and 90°.' };
    }
    if (isNaN(h0) || h0 < 0) {
      return { valid: false, message: 'Initial height (h₀) must be non-negative (≥ 0 m).' };
    }
    if (isNaN(g) || g <= 0) {
      return { valid: false, message: 'Gravitational acceleration (g) must be strictly positive (> 0 m/s²).' };
    }

    return {
      valid: true,
      params: { v0, angle, h0, g },
    };
  }

  function showValidationError(message) {
    DOM.validationMessage.textContent = message;
    DOM.validationBanner.classList.remove('hidden');
  }

  function hideValidationError() {
    DOM.validationBanner.classList.add('hidden');
  }

  // ==========================================================================
  // UI Synchronization & Updates
  // ==========================================================================

  function calculateAndRender() {
    const check = validateAndGetInputs();

    if (!check.valid) {
      showValidationError(check.message);
      return;
    }

    hideValidationError();
    state.params = check.params;

    // Run pure C kinematics computation in WASM
    const results = computeTrajectory(
      state.params.v0,
      state.params.angle,
      state.params.h0,
      state.params.g
    );

    if (!results) {
      showValidationError('Kinematic calculation returned invalid results.');
      return;
    }

    state.results = results;

    // Update Result Cards
    renderResultCards(results, state.previousRun ? state.previousRun.results : null);

    // Update Scrubber Max
    DOM.scrubberMaxLabel.textContent = `${results.timeOfFlight.toFixed(2)}s`;
    if (state.animation.currentTime > results.timeOfFlight) {
      state.animation.currentTime = results.timeOfFlight;
    }

    // Update Table & CSV
    renderDataTable();

    // Redraw Canvas
    drawCanvas();
  }

  function renderResultCards(current, previous) {
    DOM.valPeakTime.textContent = current.timeToPeak.toFixed(3);
    DOM.valMaxHeight.textContent = current.maxHeight.toFixed(3);
    DOM.valFlightTime.textContent = current.timeOfFlight.toFixed(3);
    DOM.valRange.textContent = current.range.toFixed(3);
    DOM.valImpactSpeed.textContent = current.impactSpeed.toFixed(3);
    DOM.valImpactAngle.textContent = current.impactAngle.toFixed(3);

    DOM.valVx.textContent = `${current.vx.toFixed(3)} m/s`;
    DOM.valVy.textContent = `${current.vy.toFixed(3)} m/s`;
    const vyImpact = current.vy - state.params.g * current.timeOfFlight;
    DOM.valVyImpact.textContent = `${vyImpact.toFixed(3)} m/s`;

    // Render delta comparisons if previous run is available
    if (previous) {
      renderDelta(DOM.deltaPeakTime, current.timeToPeak, previous.timeToPeak, 's');
      renderDelta(DOM.deltaMaxHeight, current.maxHeight, previous.maxHeight, 'm');
      renderDelta(DOM.deltaFlightTime, current.timeOfFlight, previous.timeOfFlight, 's');
      renderDelta(DOM.deltaRange, current.range, previous.range, 'm');
      renderDelta(DOM.deltaImpactSpeed, current.impactSpeed, previous.impactSpeed, 'm/s');
      renderDelta(DOM.deltaImpactAngle, current.impactAngle, previous.impactAngle, '°');
    } else {
      clearDeltas();
    }
  }

  function renderDelta(container, cur, prev, unit) {
    const diff = cur - prev;
    if (Math.abs(diff) < 0.001) {
      container.innerHTML = '<span class="delta-badge delta-neutral">±0.00 ' + unit + '</span>';
      return;
    }
    const isPos = diff > 0;
    const sign = isPos ? '+' : '';
    const pct = prev !== 0 ? ((diff / Math.abs(prev)) * 100).toFixed(1) : null;
    const pctStr = pct !== null ? ` (${sign}${pct}%)` : '';
    const cls = isPos ? 'delta-positive' : 'delta-negative';
    container.innerHTML = `<span class="delta-badge ${cls}">${sign}${diff.toFixed(2)}${unit}${pctStr}</span>`;
  }

  function clearDeltas() {
    DOM.deltaPeakTime.innerHTML = '';
    DOM.deltaMaxHeight.innerHTML = '';
    DOM.deltaFlightTime.innerHTML = '';
    DOM.deltaRange.innerHTML = '';
    DOM.deltaImpactSpeed.innerHTML = '';
    DOM.deltaImpactAngle.innerHTML = '';
  }

  // ==========================================================================
  // Data Table & CSV Generation
  // ==========================================================================

  function generateTrajectoryPoints() {
    if (!state.results) return [];

    const { v0, angle, h0, g } = state.params;
    const { timeOfFlight, timeToPeak, vx } = state.results;
    const step = state.sampleStep;

    const points = [];
    let t = 0.0;

    // We also want to include apex time precisely if not aligned
    let apexAdded = false;

    while (t < timeOfFlight - 1e-6) {
      if (!apexAdded && timeToPeak > 0 && t > timeToPeak) {
        // Insert apex sample
        const apexPos = getPositionAtTime(v0, angle, h0, g, timeToPeak);
        points.push({
          t: timeToPeak,
          x: apexPos.x,
          y: apexPos.y,
          vx: vx,
          vy: 0.0,
          v: Math.abs(vx),
          isApex: true,
        });
        apexAdded = true;
      }

      const pos = getPositionAtTime(v0, angle, h0, g, t);
      const vy = v0 * Math.sin(angle * (Math.PI / 180.0)) - g * t;
      const v = Math.sqrt(vx * vx + vy * vy);

      points.push({
        t: t,
        x: pos.x,
        y: pos.y,
        vx: vx,
        vy: vy,
        v: v,
        isApex: false,
      });

      t += step;
    }

    // Exact Landing Point
    const landPos = getPositionAtTime(v0, angle, h0, g, timeOfFlight);
    const vyLand = v0 * Math.sin(angle * (Math.PI / 180.0)) - g * timeOfFlight;
    points.push({
      t: timeOfFlight,
      x: landPos.x,
      y: landPos.y,
      vx: vx,
      vy: vyLand,
      v: Math.sqrt(vx * vx + vyLand * vyLand),
      isLanding: true,
    });

    // Sort by time in case apex was inserted
    points.sort((a, b) => a.t - b.t);
    return points;
  }

  function renderDataTable() {
    const points = generateTrajectoryPoints();
    DOM.tableRowCountBadge.textContent = `${points.length} samples`;

    const fragment = document.createDocumentFragment();
    points.forEach((pt) => {
      const tr = document.createElement('tr');
      if (pt.isApex) tr.style.backgroundColor = 'rgba(168, 85, 247, 0.12)';
      if (pt.isLanding) tr.style.backgroundColor = 'rgba(16, 185, 129, 0.12)';

      tr.innerHTML = `
        <td>${pt.t.toFixed(3)} ${pt.isApex ? '★ Apex' : pt.isLanding ? '🎯 Land' : ''}</td>
        <td>${pt.x.toFixed(3)}</td>
        <td>${pt.y.toFixed(3)}</td>
        <td>${pt.vx.toFixed(3)}</td>
        <td>${pt.vy.toFixed(3)}</td>
        <td><strong>${pt.v.toFixed(3)}</strong></td>
      `;
      fragment.appendChild(tr);
    });

    DOM.trajectoryTableBody.innerHTML = '';
    DOM.trajectoryTableBody.appendChild(fragment);
  }

  function exportCsv() {
    const points = generateTrajectoryPoints();
    if (!points || points.length === 0) return;

    const { v0, angle, h0, g } = state.params;
    const { range, maxHeight, timeOfFlight, impactSpeed, impactAngle } = state.results;

    let csvContent = '';
    csvContent += `# Projectile Motion Simulation Data\n`;
    csvContent += `# Physics Engine: Pure C via WebAssembly (Emscripten)\n`;
    csvContent += `# Parameters: Velocity(v0)=${v0} m/s, Angle(theta)=${angle} deg, Height(h0)=${h0} m, Gravity(g)=${g} m/s^2\n`;
    csvContent += `# Metrics: Range=${range.toFixed(4)} m, MaxHeight=${maxHeight.toFixed(4)} m, FlightTime=${timeOfFlight.toFixed(4)} s, ImpactSpeed=${impactSpeed.toFixed(4)} m/s, ImpactAngle=${impactAngle.toFixed(4)} deg\n`;
    csvContent += `Time (s),Position X (m),Height Y (m),Velocity Vx (m/s),Velocity Vy (m/s),Speed V (m/s)\n`;

    points.forEach((pt) => {
      csvContent += `${pt.t.toFixed(4)},${pt.x.toFixed(4)},${pt.y.toFixed(4)},${pt.vx.toFixed(4)},${pt.vy.toFixed(4)},${pt.v.toFixed(4)}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute(
      'download',
      `projectile_v${v0}_a${angle}_h${h0}_g${g}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  // ==========================================================================
  // Canvas Rendering & Coordinate Transformations
  // ==========================================================================

  function getThemeColors() {
    const isDark = DOM.html.getAttribute('data-theme') !== 'light';
    return {
      bg: isDark ? '#090d16' : '#f8fafc',
      grid: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.07)',
      gridSubtle: isDark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)',
      axis: isDark ? 'rgba(255, 255, 255, 0.25)' : 'rgba(0, 0, 0, 0.3)',
      text: isDark ? '#94a3b8' : '#64748b',
      pathCurrent: isDark ? '#06b6d4' : '#0284c7',
      pathCurrentGlow: isDark ? 'rgba(6, 182, 212, 0.35)' : 'rgba(2, 132, 199, 0.2)',
      pathCompare: isDark ? '#f59e0b' : '#d97706',
      apex: isDark ? '#c084fc' : '#9333ea',
      landing: isDark ? '#34d399' : '#059669',
      projectile: isDark ? '#38bdf8' : '#0284c7',
      projectileGlow: isDark ? 'rgba(56, 189, 248, 0.6)' : 'rgba(2, 132, 199, 0.4)',
    };
  }

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = DOM.canvasViewport.getBoundingClientRect();

    const displayWidth = Math.floor(rect.width);
    const displayHeight = Math.floor(rect.height);

    if (
      DOM.trajectoryCanvas.width !== displayWidth * dpr ||
      DOM.trajectoryCanvas.height !== displayHeight * dpr
    ) {
      DOM.trajectoryCanvas.width = displayWidth * dpr;
      DOM.trajectoryCanvas.height = displayHeight * dpr;
    }

    ctx.resetTransform();
    ctx.scale(dpr, dpr);

    return { width: displayWidth, height: displayHeight };
  }

  function calculateViewBounds() {
    let maxX = state.results ? state.results.range : 10;
    let maxY = state.results ? state.results.maxHeight : 10;

    // If initial height is higher than max height
    if (state.params.h0 > maxY) maxY = state.params.h0;

    // Include comparison run bounds if present
    if (state.previousRun && state.previousRun.results) {
      if (state.previousRun.results.range > maxX) maxX = state.previousRun.results.range;
      if (state.previousRun.results.maxHeight > maxY) maxY = state.previousRun.results.maxHeight;
      if (state.previousRun.params.h0 > maxY) maxY = state.previousRun.params.h0;
    }

    // Minimum boundary to avoid degenerate canvas
    if (maxX < 5) maxX = 5;
    if (maxY < 5) maxY = 5;

    // Add 18% headroom/padding for aesthetics and marker labels
    return {
      maxX: maxX * 1.15,
      maxY: maxY * 1.25,
    };
  }

  function drawCanvas() {
    const { width, height } = resizeCanvas();
    const colors = getThemeColors();

    // Canvas Margins for Axes & Labels
    const margin = { top: 32, right: 36, bottom: 48, left: 60 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;

    if (plotWidth <= 0 || plotHeight <= 0) return;

    const bounds = calculateViewBounds();
    const scaleX = plotWidth / bounds.maxX;
    const scaleY = plotHeight / bounds.maxY;

    // Coordinate mapping functions (Physics meters -> Canvas screen pixels)
    const toScreenX = (x) => margin.left + x * scaleX;
    const toScreenY = (y) => margin.top + plotHeight - y * scaleY;

    // Screen -> Physics coordinate mapping
    const toPhysicsX = (sx) => (sx - margin.left) / scaleX;
    const toPhysicsY = (sy) => (margin.top + plotHeight - sy) / scaleY;

    // Clear background
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, height);

    // Update scale indicator in card header
    DOM.scaleIndicator.textContent = `Grid: 1m = ${(scaleX * 1).toFixed(1)}px | Max X: ${bounds.maxX.toFixed(1)}m, Max Y: ${bounds.maxY.toFixed(1)}m`;

    // 1. Draw Grid Lines & Ticks
    drawGrid(ctx, margin, plotWidth, plotHeight, bounds, scaleX, scaleY, colors);

    // 2. Draw Launch Tower / Pedestal if h0 > 0
    if (state.params.h0 > 0) {
      const towerBaseX = toScreenX(0);
      const towerBaseY = toScreenY(0);
      const towerTopY = toScreenY(state.params.h0);

      ctx.save();
      ctx.fillStyle = colors.grid;
      ctx.fillRect(towerBaseX - 8, towerTopY, 16, towerBaseY - towerTopY);
      ctx.strokeStyle = colors.axis;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(towerBaseX - 8, towerTopY, 16, towerBaseY - towerTopY);

      // Height text label
      ctx.fillStyle = colors.text;
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`h₀=${state.params.h0.toFixed(1)}m`, towerBaseX - 12, (towerTopY + towerBaseY) / 2);
      ctx.restore();
    }

    // 3. Draw Previous Comparison Trajectory (if active)
    if (state.previousRun && state.previousRun.results) {
      drawTrajectoryPath(
        ctx,
        state.previousRun.params,
        state.previousRun.results,
        toScreenX,
        toScreenY,
        colors.pathCompare,
        true // dashed
      );
    }

    // 4. Draw Current Trajectory
    if (state.results) {
      drawTrajectoryPath(
        ctx,
        state.params,
        state.results,
        toScreenX,
        toScreenY,
        colors.pathCurrent,
        false // solid with glow
      );

      // Apex Marker
      drawApexMarker(ctx, state.params, state.results, toScreenX, toScreenY, colors);

      // Impact Marker
      drawImpactMarker(ctx, state.results, toScreenX, toScreenY, colors);
    }

    // 5. Draw Animated Projectile and Trail
    drawProjectile(ctx, toScreenX, toScreenY, colors);

    // 6. Draw Interactive Cursor Inspection (Hover Scrub)
    if (state.hoverInfo && state.results) {
      drawHoverInspection(ctx, state.hoverInfo, toScreenX, toScreenY, colors, margin, plotHeight);
    }
  }

  function drawGrid(ctx, margin, plotWidth, plotHeight, bounds, scaleX, scaleY, colors) {
    ctx.save();

    // Determine nice step intervals for grid
    const roughSteps = 6;
    const stepX = getNiceStep(bounds.maxX / roughSteps);
    const stepY = getNiceStep(bounds.maxY / roughSteps);

    // Vertical gridlines (X distance)
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    for (let x = 0; x <= bounds.maxX; x += stepX) {
      const sx = margin.left + x * scaleX;
      if (sx > margin.left + plotWidth) break;

      // Line
      ctx.strokeStyle = x === 0 ? colors.axis : colors.grid;
      ctx.lineWidth = x === 0 ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(sx, margin.top);
      ctx.lineTo(sx, margin.top + plotHeight);
      ctx.stroke();

      // Label
      ctx.fillStyle = colors.text;
      ctx.fillText(`${x.toFixed(x % 1 === 0 ? 0 : 1)}m`, sx, margin.top + plotHeight + 8);
    }

    // Horizontal gridlines (Y height)
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let y = 0; y <= bounds.maxY; y += stepY) {
      const sy = margin.top + plotHeight - y * scaleY;
      if (sy < margin.top) break;

      // Line
      ctx.strokeStyle = y === 0 ? colors.axis : colors.grid;
      ctx.lineWidth = y === 0 ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(margin.left, sy);
      ctx.lineTo(margin.left + plotWidth, sy);
      ctx.stroke();

      // Label
      ctx.fillStyle = colors.text;
      ctx.fillText(`${y.toFixed(y % 1 === 0 ? 0 : 1)}m`, margin.left - 8, sy);
    }

    // Axis Labels
    ctx.fillStyle = colors.text;
    ctx.font = '11px "Inter", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Horizontal Distance x (meters)', margin.left + plotWidth / 2, margin.top + plotHeight + 30);

    ctx.save();
    ctx.translate(16, margin.top + plotHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('Vertical Height y (meters)', 0, 0);
    ctx.restore();

    ctx.restore();
  }

  function getNiceStep(val) {
    const exp = Math.floor(Math.log10(val));
    const frac = val / Math.pow(10, exp);
    let nice;
    if (frac < 1.5) nice = 1;
    else if (frac < 3) nice = 2;
    else if (frac < 7) nice = 5;
    else nice = 10;
    return nice * Math.pow(10, exp);
  }

  function drawTrajectoryPath(ctx, params, results, toScreenX, toScreenY, color, isDashed) {
    const { v0, angle, h0, g } = params;
    const { timeOfFlight } = results;

    const samples = 140;
    const dt = timeOfFlight / samples;

    ctx.save();
    ctx.beginPath();

    for (let i = 0; i <= samples; i++) {
      const t = i * dt;
      const pos = getPositionAtTime(v0, angle, h0, g, t);
      const sx = toScreenX(pos.x);
      const sy = toScreenY(pos.y);

      if (i === 0) {
        ctx.moveTo(sx, sy);
      } else {
        ctx.lineTo(sx, sy);
      }
    }

    if (isDashed) {
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      // Glow effect
      ctx.setLineDash([]);
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawApexMarker(ctx, params, results, toScreenX, toScreenY, colors) {
    const { v0, angle, h0, g } = params;
    const { timeToPeak, maxHeight } = results;

    const apexPos = getPositionAtTime(v0, angle, h0, g, timeToPeak);
    const sx = toScreenX(apexPos.x);
    const sy = toScreenY(maxHeight);

    ctx.save();
    // Vertical dashed marker line to ground
    ctx.beginPath();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = colors.apex;
    ctx.lineWidth = 1;
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx, toScreenY(0));
    ctx.stroke();

    // Apex Dot
    ctx.beginPath();
    ctx.setLineDash([]);
    ctx.fillStyle = colors.apex;
    ctx.arc(sx, sy, 5, 0, Math.PI * 2);
    ctx.fill();

    // Pulsing outer ring
    ctx.beginPath();
    ctx.strokeStyle = colors.apex;
    ctx.lineWidth = 1.5;
    ctx.arc(sx, sy, 9, 0, Math.PI * 2);
    ctx.stroke();

    // Apex Tag
    const label = `Apex: ${maxHeight.toFixed(2)}m (${timeToPeak.toFixed(2)}s)`;
    ctx.font = 'bold 10px "JetBrains Mono", monospace';
    const textWidth = ctx.measureText(label).width;

    ctx.fillStyle = 'rgba(17, 24, 39, 0.85)';
    ctx.fillRect(sx - textWidth / 2 - 4, sy - 24, textWidth + 8, 16);
    ctx.strokeStyle = colors.apex;
    ctx.lineWidth = 1;
    ctx.strokeRect(sx - textWidth / 2 - 4, sy - 24, textWidth + 8, 16);

    ctx.fillStyle = colors.apex;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, sx, sy - 16);

    ctx.restore();
  }

  function drawImpactMarker(ctx, results, toScreenX, toScreenY, colors) {
    const { range, impactAngle } = results;
    const sx = toScreenX(range);
    const sy = toScreenY(0);

    ctx.save();
    // Landing Target Dot
    ctx.beginPath();
    ctx.fillStyle = colors.landing;
    ctx.arc(sx, sy, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.strokeStyle = colors.landing;
    ctx.lineWidth = 1.5;
    ctx.arc(sx, sy, 9, 0, Math.PI * 2);
    ctx.stroke();

    // Label tag
    const label = `Range: ${range.toFixed(2)}m @ ${impactAngle.toFixed(1)}°`;
    ctx.font = 'bold 10px "JetBrains Mono", monospace';
    const textWidth = ctx.measureText(label).width;

    let tagX = sx;
    if (tagX + textWidth / 2 > DOM.trajectoryCanvas.width / (window.devicePixelRatio || 1) - 10) {
      tagX = sx - textWidth / 2;
    }

    ctx.fillStyle = 'rgba(17, 24, 39, 0.85)';
    ctx.fillRect(tagX - textWidth / 2 - 4, sy - 26, textWidth + 8, 16);
    ctx.strokeStyle = colors.landing;
    ctx.lineWidth = 1;
    ctx.strokeRect(tagX - textWidth / 2 - 4, sy - 26, textWidth + 8, 16);

    ctx.fillStyle = colors.landing;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, tagX, sy - 18);

    ctx.restore();
  }

  function drawProjectile(ctx, toScreenX, toScreenY, colors) {
    if (!state.results) return;

    const { v0, angle, h0, g } = state.params;
    const t = state.animation.currentTime;
    const pos = getPositionAtTime(v0, angle, h0, g, t);

    const sx = toScreenX(pos.x);
    const sy = toScreenY(pos.y);

    // Compute instantaneous velocity
    const vx = v0 * Math.cos(angle * (Math.PI / 180.0));
    const vy = v0 * Math.sin(angle * (Math.PI / 180.0)) - g * t;
    const v = Math.sqrt(vx * vx + vy * vy);

    // Update HUD
    DOM.hudTime.textContent = t.toFixed(2);
    DOM.hudX.textContent = pos.x.toFixed(2);
    DOM.hudY.textContent = pos.y.toFixed(2);
    DOM.hudV.textContent = v.toFixed(2);

    ctx.save();

    // Velocity Vector Arrow
    if (v > 0.1) {
      const arrowLen = Math.min(45, 12 + v * 0.8);
      const angleRad = Math.atan2(-vy, vx); // canvas y is inverted
      const endX = sx + Math.cos(angleRad) * arrowLen;
      const endY = sy + Math.sin(angleRad) * arrowLen;

      ctx.beginPath();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.7)';
      ctx.lineWidth = 2;
      ctx.moveTo(sx, sy);
      ctx.lineTo(endX, endY);
      ctx.stroke();

      // Arrowhead
      const headLen = 6;
      ctx.beginPath();
      ctx.fillStyle = 'rgba(56, 189, 248, 0.9)';
      ctx.moveTo(endX, endY);
      ctx.lineTo(
        endX - headLen * Math.cos(angleRad - Math.PI / 6),
        endY - headLen * Math.sin(angleRad - Math.PI / 6)
      );
      ctx.lineTo(
        endX - headLen * Math.cos(angleRad + Math.PI / 6),
        endY - headLen * Math.sin(angleRad + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fill();
    }

    // Outer glow
    ctx.beginPath();
    ctx.fillStyle = colors.projectileGlow;
    ctx.arc(sx, sy, 12, 0, Math.PI * 2);
    ctx.fill();

    // Inner Projectile Core
    ctx.beginPath();
    ctx.fillStyle = colors.projectile;
    ctx.arc(sx, sy, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = '#ffffff';
    ctx.arc(sx - 1.5, sy - 1.5, 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawHoverInspection(ctx, hoverInfo, toScreenX, toScreenY, colors, margin, plotHeight) {
    const sx = toScreenX(hoverInfo.x);
    const sy = toScreenY(hoverInfo.y);

    ctx.save();
    // Crosshair lines
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.setLineDash([2, 2]);
    ctx.moveTo(sx, margin.top);
    ctx.lineTo(sx, margin.top + plotHeight);
    ctx.moveTo(margin.left, sy);
    ctx.lineTo(toScreenX(state.results.range), sy);
    ctx.stroke();

    // Point highlight
    ctx.beginPath();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffffff';
    ctx.arc(sx, sy, 4, 0, Math.PI * 2);
    ctx.fill();

    // Tooltip box
    const text1 = `t = ${hoverInfo.t.toFixed(2)}s`;
    const text2 = `x = ${hoverInfo.x.toFixed(2)}m, y = ${hoverInfo.y.toFixed(2)}m`;
    const text3 = `v = ${hoverInfo.v.toFixed(2)}m/s`;

    ctx.font = '10px "JetBrains Mono", monospace';
    const boxW = 140;
    const boxH = 50;
    let boxX = sx + 12;
    let boxY = sy - 55;

    if (boxX + boxW > DOM.trajectoryCanvas.width / (window.devicePixelRatio || 1) - 10) {
      boxX = sx - boxW - 12;
    }
    if (boxY < 10) boxY = sy + 15;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = colors.pathCurrent;
    ctx.lineWidth = 1;
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText(text1, boxX + 8, boxY + 16);
    ctx.fillText(text2, boxX + 8, boxY + 30);
    ctx.fillStyle = colors.pathCurrent;
    ctx.fillText(text3, boxX + 8, boxY + 44);

    ctx.restore();
  }

  // ==========================================================================
  // Animation Loop & Playback Controls
  // ==========================================================================

  function animationStep(timestamp) {
    if (!state.animation.isPlaying) return;

    if (!state.animation.lastTimestamp) {
      state.animation.lastTimestamp = timestamp;
    }

    const elapsed = (timestamp - state.animation.lastTimestamp) / 1000.0;
    state.animation.lastTimestamp = timestamp;

    const delta = elapsed * state.animation.speedMultiplier;
    state.animation.currentTime += delta;

    const maxTime = state.results ? state.results.timeOfFlight : 0;

    if (state.animation.currentTime >= maxTime) {
      state.animation.currentTime = maxTime;
      pauseAnimation();
    }

    // Update scrubber input
    if (maxTime > 0) {
      const pct = (state.animation.currentTime / maxTime) * 100;
      DOM.timeScrubber.value = pct.toFixed(1);
    }

    drawCanvas();

    if (state.animation.isPlaying) {
      state.animation.reqId = requestAnimationFrame(animationStep);
    }
  }

  function playAnimation() {
    if (!state.results) return;

    if (state.animation.currentTime >= state.results.timeOfFlight) {
      state.animation.currentTime = 0;
    }

    state.animation.isPlaying = true;
    state.animation.lastTimestamp = null;

    DOM.playBtnText.textContent = 'Pause';
    DOM.playIcon.classList.add('hidden');
    DOM.pauseIcon.classList.remove('hidden');

    state.animation.reqId = requestAnimationFrame(animationStep);
  }

  function pauseAnimation() {
    state.animation.isPlaying = false;
    DOM.playBtnText.textContent = 'Play';
    DOM.playIcon.classList.remove('hidden');
    DOM.pauseIcon.classList.add('hidden');

    if (state.animation.reqId) {
      cancelAnimationFrame(state.animation.reqId);
      state.animation.reqId = null;
    }
  }

  function togglePlayPause() {
    if (state.animation.isPlaying) {
      pauseAnimation();
    } else {
      playAnimation();
    }
  }

  function resetAnimation() {
    pauseAnimation();
    state.animation.currentTime = 0.0;
    DOM.timeScrubber.value = 0;
    drawCanvas();
  }

  // ==========================================================================
  // Comparison Mode
  // ==========================================================================

  function pinComparisonBaseline() {
    if (!state.results) return;

    state.previousRun = {
      params: { ...state.params },
      results: { ...state.results },
    };

    DOM.pinnedSummary.textContent = `v₀=${state.previousRun.params.v0}m/s, ${state.previousRun.params.angle}°, h₀=${state.previousRun.params.h0}m`;
    DOM.comparisonActiveBadge.classList.remove('hidden');
    DOM.compareLegendItem.classList.remove('hidden');
    DOM.compareToggleBtn.textContent = 'Update Baseline';

    calculateAndRender();
  }

  function clearComparison() {
    state.previousRun = null;
    DOM.comparisonActiveBadge.classList.add('hidden');
    DOM.compareLegendItem.classList.add('hidden');
    DOM.compareToggleBtn.textContent = 'Pin Baseline';
    clearDeltas();
    drawCanvas();
  }

  // ==========================================================================
  // Event Listeners & Setup
  // ==========================================================================

  function setupEventListeners() {
    // 1. Theme toggle
    DOM.themeToggleBtn.addEventListener('click', () => {
      const currentTheme = DOM.html.getAttribute('data-theme');
      const newTheme = currentTheme === 'light' ? 'dark' : 'light';
      DOM.html.setAttribute('data-theme', newTheme);
      localStorage.setItem('projectile_theme', newTheme);
      drawCanvas();
    });

    // Restore saved theme
    const savedTheme = localStorage.getItem('projectile_theme');
    if (savedTheme) {
      DOM.html.setAttribute('data-theme', savedTheme);
    }

    // 2. Velocity quick chips
    DOM.quickChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        DOM.quickChips.forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        DOM.velocityInput.value = chip.getAttribute('data-v');
        calculateAndRender();
      });
    });

    DOM.velocityInput.addEventListener('input', () => {
      const v = parseFloat(DOM.velocityInput.value);
      DOM.quickChips.forEach((chip) => {
        if (parseFloat(chip.getAttribute('data-v')) === v) {
          chip.classList.add('active');
        } else {
          chip.classList.remove('active');
        }
      });
      calculateAndRender();
    });

    // 3. Launch angle sync (slider + input)
    DOM.angleSlider.addEventListener('input', () => {
      DOM.angleInput.value = DOM.angleSlider.value;
      DOM.angleDisplay.textContent = DOM.angleSlider.value;
      calculateAndRender();
    });

    DOM.angleInput.addEventListener('input', () => {
      DOM.angleSlider.value = DOM.angleInput.value;
      DOM.angleDisplay.textContent = DOM.angleInput.value;
      calculateAndRender();
    });

    // 4. Initial Height sync
    DOM.heightSlider.addEventListener('input', () => {
      DOM.heightInput.value = DOM.heightSlider.value;
      calculateAndRender();
    });

    DOM.heightInput.addEventListener('input', () => {
      DOM.heightSlider.value = DOM.heightInput.value;
      calculateAndRender();
    });

    // 5. Gravity presets
    DOM.presetPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        DOM.presetPills.forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');

        const preset = pill.getAttribute('data-preset');
        if (preset === 'custom') {
          DOM.customGravityWrapper.classList.remove('hidden');
          DOM.gravityInput.focus();
        } else {
          DOM.customGravityWrapper.classList.add('hidden');
          const gVal = parseFloat(pill.getAttribute('data-g'));
          DOM.gravityInput.value = gVal;
          calculateAndRender();
        }
      });
    });

    DOM.gravityInput.addEventListener('input', () => {
      calculateAndRender();
    });

    // 6. Reset & Test Case buttons
    DOM.resetDefaultsBtn.addEventListener('click', () => {
      loadTestCase();
    });

    DOM.loadTestCaseBtn.addEventListener('click', () => {
      loadTestCase();
    });

    // 7. Compare Mode
    DOM.compareToggleBtn.addEventListener('click', () => {
      pinComparisonBaseline();
    });

    DOM.clearCompareBtn.addEventListener('click', () => {
      clearComparison();
    });

    // 8. Animation & Scrubber
    DOM.playPauseBtn.addEventListener('click', () => {
      togglePlayPause();
    });

    DOM.resetSimBtn.addEventListener('click', () => {
      resetAnimation();
    });

    DOM.simSpeedSelect.addEventListener('change', () => {
      state.animation.speedMultiplier = parseFloat(DOM.simSpeedSelect.value);
    });

    DOM.timeScrubber.addEventListener('input', () => {
      if (!state.results) return;
      pauseAnimation();
      const pct = parseFloat(DOM.timeScrubber.value);
      state.animation.currentTime = (pct / 100.0) * state.results.timeOfFlight;
      drawCanvas();
    });

    // 9. Table step & CSV download
    DOM.stepIntervalSelect.addEventListener('change', () => {
      state.sampleStep = parseFloat(DOM.stepIntervalSelect.value);
      renderDataTable();
    });

    DOM.downloadCsvBtn.addEventListener('click', () => {
      exportCsv();
    });

    // 10. Canvas mouse inspection (scrub on hover)
    DOM.trajectoryCanvas.addEventListener('mousemove', (e) => {
      if (!state.results) return;

      const rect = DOM.trajectoryCanvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const margin = { top: 32, right: 36, bottom: 48, left: 60 };
      const bounds = calculateViewBounds();
      const plotWidth = rect.width - margin.left - margin.right;
      const plotHeight = rect.height - margin.top - margin.bottom;

      if (
        mouseX >= margin.left &&
        mouseX <= margin.left + plotWidth &&
        mouseY >= margin.top &&
        mouseY <= margin.top + plotHeight
      ) {
        // Physics X at mouse position
        const scaleX = plotWidth / bounds.maxX;
        const physX = (mouseX - margin.left) / scaleX;

        if (physX >= 0 && physX <= state.results.range) {
          // Corresponding time t
          const t = physX / state.results.vx;
          const pos = getPositionAtTime(
            state.params.v0,
            state.params.angle,
            state.params.h0,
            state.params.g,
            t
          );
          const vy = state.params.v0 * Math.sin(state.params.angle * (Math.PI / 180.0)) - state.params.g * t;
          const v = Math.sqrt(state.results.vx * state.results.vx + vy * vy);

          state.hoverInfo = {
            t: t,
            x: pos.x,
            y: pos.y,
            v: v,
          };
          drawCanvas();
          return;
        }
      }

      if (state.hoverInfo) {
        state.hoverInfo = null;
        drawCanvas();
      }
    });

    DOM.trajectoryCanvas.addEventListener('mouseleave', () => {
      if (state.hoverInfo) {
        state.hoverInfo = null;
        drawCanvas();
      }
    });

    // 11. Window resize handling
    window.addEventListener('resize', () => {
      drawCanvas();
    });
  }

  function loadTestCase() {
    DOM.velocityInput.value = 20;
    DOM.angleSlider.value = 45;
    DOM.angleInput.value = 45;
    DOM.angleDisplay.textContent = '45';
    DOM.heightSlider.value = 0;
    DOM.heightInput.value = 0;
    DOM.gravityInput.value = 9.81;

    // Reset preset chips
    DOM.quickChips.forEach((chip) => {
      if (chip.getAttribute('data-v') === '20') chip.classList.add('active');
      else chip.classList.remove('active');
    });

    // Reset earth preset
    DOM.presetPills.forEach((p) => {
      if (p.getAttribute('data-preset') === 'earth') p.classList.add('active');
      else p.classList.remove('active');
    });
    DOM.customGravityWrapper.classList.add('hidden');

    resetAnimation();
    calculateAndRender();
  }

  // --- Bootstrapping ---
  document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    initWasmEngine();
  });
})();
