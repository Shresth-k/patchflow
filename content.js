/* AI Edit & Crop — Content Script (v2) */
(function () {
  if (window.__aiec) return;
  window.__aiec = true;

  /* ── State ─────────────────────────────────── */
  let sessions = [];
  let cropState = null;   // { img, scale, vpX, vpY, zoom, sel: {x,y,w,h} }
  let dragOp = null;       // current drag operation in crop modal
  let previewState = null; // { origImg, editImg, session, origCanvas, topCanvas, displayScale, zoom, panX, panY }
  let eraserState = { active: false, painting: false, size: 24 };
  let spacePressed = false;
  let previewDrag = null;  // { startX, startY, startPanX, startPanY }

  /* ── Storage ───────────────────────────────── */
  const store = {
    async load() {
      try {
        const data = sessionStorage.getItem('aiec');
        sessions = data ? JSON.parse(data) : [];
      } catch (e) {
        sessions = [];
      }
      return Promise.resolve();
    },
    async save() {
      sessions = sessions.slice(0, 12);
      try {
        sessionStorage.setItem('aiec', JSON.stringify(sessions));
      } catch (e) {
        console.error('Failed to save sessions to sessionStorage:', e);
      }
      return Promise.resolve();
    }
  };

  /* ── Helpers ───────────────────────────────── */
  const isContextValid = () => {
    try { return !!(chrome && chrome.runtime && chrome.runtime.id); }
    catch (e) { return false; }
  };
  const h = (tag, cls, attrs) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (attrs) Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style') Object.assign(el.style, v);
      else el.setAttribute(k, v);
    });
    return el;
  };
  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const ftime = ts => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /* ── Icons (inline SVG strings) ────────────── */
  const ICO = {
    crop: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 2v14a2 2 0 002 2h14"/><path d="M18 22V8a2 2 0 00-2-2H2"/></svg>`,
    x: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>`,
    copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`,
    upload: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
    img: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
    dl: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    zoomIn: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>`,
    zoomOut: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>`,
    eraser: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 21h10"/><path d="M5.5 13.5 9 17l7-7-5-5-5.5 5.5a2.83 2.83 0 0 0 0 3z"/></svg>`,
    undo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>`,
    eye: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
    eyeOff: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`,
    info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  };

  /* ── Build DOM ──────────────────────────────── */
  // FAB
  const fab = h('div', 'aiec', { id: 'aiec-fab', html: `${ICO.crop}<span>PatchFlow-Edit Merge</span>` });
  // Sidebar
  const sidebar = h('div', 'aiec', { id: 'aiec-sidebar' });
  sidebar.innerHTML = `
    <div class="aiec-side-head">
      <span>PatchFlow-Edit Merge</span>
      <div style="display: flex; gap: 4px; align-items: center;">
        <button class="aiec-icon-btn aiec-tooltip" id="aiec-info" data-tip="Tip: Instruct the AI to preserve the crop's exact aspect ratio and image resolution in your prompt. This ensures a seamless high-quality merge.">${ICO.info}</button>
        <button class="aiec-icon-btn" id="aiec-close">${ICO.x}</button>
      </div>
    </div>
    <div class="aiec-side-body" id="aiec-cards">
      <button class="aiec-new-btn" id="aiec-new">${ICO.plus}<span>New Crop</span></button>
      <div class="aiec-label">Active Sessions</div>
      <div id="aiec-list"></div>
    </div>`;

  // Crop modal
  const cropModal = h('div', 'aiec', { id: 'aiec-crop-modal' });
  cropModal.innerHTML = `
    <div class="aiec-crop-bar">
      <span class="aiec-crop-bar-title">Crop Selection</span>
      <div class="aiec-crop-bar-right">
        <button class="aiec-icon-btn" id="aiec-zoom-out" title="Zoom out">${ICO.zoomOut}</button>
        <span class="aiec-zoom-display" id="aiec-zoom-label">100%</span>
        <button class="aiec-icon-btn" id="aiec-zoom-in" title="Zoom in">${ICO.zoomIn}</button>
        <button class="aiec-icon-btn" id="aiec-crop-x">${ICO.x}</button>
      </div>
    </div>
    <div class="aiec-crop-stage" id="aiec-stage">
      <div class="aiec-crop-viewport" id="aiec-vp">
        <canvas id="aiec-canvas"></canvas>
        <div class="aiec-sel" id="aiec-sel">
          <div class="aiec-sel-dim" id="aiec-dim">0 × 0</div>
          <div class="aiec-h aiec-h-nw" data-h="nw"></div>
          <div class="aiec-h aiec-h-ne" data-h="ne"></div>
          <div class="aiec-h aiec-h-sw" data-h="sw"></div>
          <div class="aiec-h aiec-h-se" data-h="se"></div>
          <div class="aiec-h aiec-h-n"  data-h="n"></div>
          <div class="aiec-h aiec-h-s"  data-h="s"></div>
          <div class="aiec-h aiec-h-w"  data-h="w"></div>
          <div class="aiec-h aiec-h-e"  data-h="e"></div>
        </div>
      </div>
    </div>
    <div class="aiec-crop-foot">
      <button class="aiec-btn aiec-btn-ghost" id="aiec-crop-cancel">Cancel</button>
      <button class="aiec-btn aiec-btn-fill"  id="aiec-crop-ok">Confirm</button>
    </div>`;

  // Preview modal
  const previewModal = h('div', 'aiec', { id: 'aiec-preview-modal' });
  previewModal.innerHTML = `
    <div class="aiec-preview-bar">
      <span class="aiec-preview-title">Preview</span>
      <button class="aiec-icon-btn" id="aiec-preview-x">${ICO.x}</button>
    </div>
    <div class="aiec-preview-stage" id="aiec-pstage">
      <div class="aiec-preview-canvas-wrap" id="aiec-pwrap">
        <canvas id="aiec-pcanvas-orig" class="aiec-layer-orig"></canvas>
        <canvas id="aiec-pcanvas-top" class="aiec-layer-top"></canvas>
        <div class="aiec-preview-highlight" id="aiec-phighlight"></div>
      </div>
      <div class="aiec-preview-toolbar" id="aiec-ptoolbar">
        <button class="active" data-v="merged">Merged</button>
        <button data-v="original">Original</button>
        <div class="aiec-toolbar-sep"></div>
        <button data-v="eraser">${ICO.eraser} Eraser</button>
        <div class="aiec-eraser-controls" id="aiec-eraser-controls" style="display:none">
          <label>Size</label>
          <input type="range" id="aiec-eraser-size" min="4" max="120" value="24">
          <span class="aiec-size-val" id="aiec-size-val">24</span>
        </div>
        <div class="aiec-toolbar-sep"></div>
        <button data-v="eye" class="active" id="aiec-eye-btn">${ICO.eye} Region</button>
        <div class="aiec-toolbar-sep"></div>
        <button data-v="reset">${ICO.undo} Reset</button>
      </div>
    </div>
    <div class="aiec-preview-foot">
      <button class="aiec-btn aiec-btn-ghost" id="aiec-preview-discard">Discard</button>
      <button class="aiec-btn aiec-btn-fill"  id="aiec-preview-dl">${ICO.dl}<span>Download</span></button>
    </div>`;

  // Eraser cursor ring
  const eraserCursor = h('div', 'aiec-eraser-cursor aiec');
  eraserCursor.id = 'aiec-eraser-cursor';

  // File input
  const fileInput = h('input', null, { type: 'file', accept: 'image/*', style: { display: 'none' } });

  /* ── Mount ──────────────────────────────────── */
  async function init() {
    await store.load();
    [fab, sidebar, cropModal, previewModal, fileInput, eraserCursor].forEach(e => document.body.appendChild(e));
    bindEvents();
    makePanelDraggable();
    renderList();
  }

  /* ── Events ─────────────────────────────────── */
  function bindEvents() {
    fab.onclick = () => sidebar.classList.toggle('open');
    sidebar.querySelector('#aiec-close').onclick = () => sidebar.classList.remove('open');
    sidebar.querySelector('#aiec-new').onclick = () => fileInput.click();

    fileInput.onchange = e => { const f = e.target.files[0]; if (f) openCrop(f); fileInput.value = ''; };

    // Crop modal
    const closeCrop = () => { cropModal.classList.remove('open'); cropState = null; };
    cropModal.querySelector('#aiec-crop-x').onclick = closeCrop;
    cropModal.querySelector('#aiec-crop-cancel').onclick = closeCrop;
    cropModal.querySelector('#aiec-crop-ok').onclick = confirmCrop;

    // Zoom buttons
    cropModal.querySelector('#aiec-zoom-in').onclick = () => zoomBy(0.25);
    cropModal.querySelector('#aiec-zoom-out').onclick = () => zoomBy(-0.25);

    // Mouse wheel zoom on stage
    const stage = cropModal.querySelector('#aiec-stage');
    stage.addEventListener('wheel', e => {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 0.15 : -0.15, e);
    }, { passive: false });

    // Selection drag / resize
    const sel = cropModal.querySelector('#aiec-sel');
    sel.addEventListener('mousedown', onSelDown);
    window.addEventListener('mousemove', onSelMove);
    window.addEventListener('mouseup', onSelUp);

    // Pan with middle click or Alt+drag on stage
    stage.addEventListener('mousedown', onStageDown);

    // Preview modal
    const closePreview = () => {
      previewModal.classList.remove('open');
      previewState = null;
      eraserState.active = false;
      eraserState.painting = false;
      eraserCursor.style.display = 'none';
      previewModal.querySelector('#aiec-pwrap').classList.remove('eraser-active');
    };
    previewModal.querySelector('#aiec-preview-x').onclick = closePreview;
    previewModal.querySelector('#aiec-preview-discard').onclick = closePreview;
    previewModal.querySelector('#aiec-preview-dl').onclick = downloadPreview;

    // Preview toolbar
    previewModal.querySelector('#aiec-ptoolbar').addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn || !previewState) return;
      const v = btn.dataset.v;
      if (!v) return;

      if (v === 'reset') {
        // Reset: redraw the merged top layer fresh
        resetTopCanvas();
        toast('Eraser strokes reset');
        return;
      }

      if (v === 'eraser') {
        // Toggle eraser mode
        eraserState.active = !eraserState.active;
        btn.classList.toggle('active', eraserState.active);
        previewModal.querySelector('#aiec-eraser-controls').style.display = eraserState.active ? 'flex' : 'none';
        previewModal.querySelector('#aiec-pwrap').classList.toggle('eraser-active', eraserState.active);
        if (!eraserState.active) eraserCursor.style.display = 'none';

        // Deactivate view toggles when entering eraser
        if (eraserState.active) {
          previewModal.querySelectorAll('#aiec-ptoolbar button[data-v="merged"], #aiec-ptoolbar button[data-v="original"]').forEach(b => b.classList.remove('active'));
          previewModal.querySelector('#aiec-ptoolbar button[data-v="merged"]').classList.add('active');
          drawPreview(false);
        }
        return;
      }

      if (v === 'eye') {
        // Toggle highlight visibility
        const hl = previewModal.querySelector('#aiec-phighlight');
        const visible = hl.classList.toggle('visible');
        btn.classList.toggle('active', visible);
        btn.innerHTML = (visible ? ICO.eye : ICO.eyeOff) + ' Region';
        return;
      }

      // merged / original toggle
      eraserState.active = false;
      previewModal.querySelector('#aiec-ptoolbar button[data-v="eraser"]').classList.remove('active');
      previewModal.querySelector('#aiec-eraser-controls').style.display = 'none';
      previewModal.querySelector('#aiec-pwrap').classList.remove('eraser-active');
      eraserCursor.style.display = 'none';

      previewModal.querySelectorAll('#aiec-ptoolbar button[data-v="merged"], #aiec-ptoolbar button[data-v="original"]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      drawPreview(v === 'original');
    });

    // Eraser size slider
    previewModal.querySelector('#aiec-eraser-size').addEventListener('input', e => {
      eraserState.size = parseInt(e.target.value, 10);
      previewModal.querySelector('#aiec-size-val').textContent = eraserState.size;
      updateEraserCursorSize();
    });

    // Eraser painting / Panning events on the preview stage
    const getTopCanvas = () => previewModal.querySelector('#aiec-pcanvas-top');
    const pstage = previewModal.querySelector('#aiec-pstage');

    pstage.addEventListener('mousedown', e => {
      if (!previewState) return;

      // Pan condition: middle mouse (button 1), right mouse (button 2), or spacebar is held down
      const isPan = e.button === 1 || e.button === 2 || spacePressed;
      if (isPan) {
        e.preventDefault();
        previewDrag = {
          startX: e.clientX,
          startY: e.clientY,
          startPanX: previewState.panX,
          startPanY: previewState.panY
        };
        pstage.style.cursor = 'grabbing';
        return;
      }

      if (e.button === 0 && eraserState.active) {
        const tc = getTopCanvas();
        if (!tc.contains(e.target) && e.target !== tc) return;
        e.preventDefault();
        eraserState.painting = true;
        eraseAt(e);
      }
    });

    pstage.addEventListener('contextmenu', e => {
      if (previewState) {
        e.preventDefault();
      }
    });

    pstage.addEventListener('wheel', e => {
      if (!previewState) return;
      e.preventDefault();

      const delta = e.deltaY < 0 ? 0.15 : -0.15;
      const oldZ = previewState.zoom;
      const newZ = clamp(oldZ + delta, 0.5, 8);

      // Zoom centered on mouse position
      const rect = pstage.getBoundingClientRect();
      const mX = e.clientX - rect.left - rect.width / 2;
      const mY = e.clientY - rect.top - rect.height / 2;

      previewState.panX = mX - (mX - previewState.panX) * (newZ / oldZ);
      previewState.panY = mY - (mY - previewState.panY) * (newZ / oldZ);
      previewState.zoom = newZ;

      updatePreviewTransform();
    }, { passive: false });

    window.addEventListener('mousemove', e => {
      if (!isContextValid()) return;
      if (!previewState) return;

      if (previewDrag) {
        const dx = e.clientX - previewDrag.startX;
        const dy = e.clientY - previewDrag.startY;
        previewState.panX = previewDrag.startPanX + dx;
        previewState.panY = previewDrag.startPanY + dy;
        updatePreviewTransform();
        return;
      }

      if (eraserState.active) {
        const z = previewState.zoom || 1;
        const s = eraserState.size * (previewState.displayScale || 1) * z;

        const pwrap = previewModal.querySelector('#aiec-pwrap');
        const wrapRect = pwrap.getBoundingClientRect();
        const inside = (
          e.clientX >= wrapRect.left &&
          e.clientX <= wrapRect.right &&
          e.clientY >= wrapRect.top &&
          e.clientY <= wrapRect.bottom
        );

        if (inside && !spacePressed) {
          eraserCursor.style.left = (e.clientX - s / 2) + 'px';
          eraserCursor.style.top = (e.clientY - s / 2) + 'px';
          eraserCursor.style.display = 'block';
          pwrap.style.cursor = 'none';
        } else {
          eraserCursor.style.display = 'none';
          pwrap.style.cursor = spacePressed ? 'grab' : 'default';
        }

        if (eraserState.painting && !spacePressed) eraseAt(e);
      }
    });

    window.addEventListener('mouseup', () => {
      if (!isContextValid()) return;
      if (previewDrag) {
        previewDrag = null;
        pstage.style.cursor = spacePressed ? 'grab' : 'default';
      }
      eraserState.painting = false;
    });

    // Spacebar and Esc key handlers
    window.addEventListener('keydown', e => {
      if (!isContextValid()) return;
      if (e.code === 'Space') {
        if (previewModal.classList.contains('open')) {
          e.preventDefault();
          if (!spacePressed) {
            spacePressed = true;
            pstage.style.cursor = 'grab';
          }
        }
      }
      if (e.key === 'Escape') {
        if (previewModal.classList.contains('open')) { closePreview(); return; }
        if (cropModal.classList.contains('open')) { closeCrop(); return; }
        sidebar.classList.remove('open');
      }
    });

    window.addEventListener('keyup', e => {
      if (!isContextValid()) return;
      if (e.code === 'Space') {
        spacePressed = false;
        pstage.style.cursor = eraserState.active ? 'none' : 'default';
      }
    });
  }

  /* ── Eraser helpers ─────────────────────────── */
  function eraseAt(e) {
    if (!previewState) return;
    const tc = previewModal.querySelector('#aiec-pcanvas-top');
    const rect = tc.getBoundingClientRect();

    // Map mouse position to canvas pixel coordinates
    const scaleX = tc.width / rect.width;
    const scaleY = tc.height / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;
    const r = eraserState.size * scaleX / 2;  // radius in canvas pixels

    const ctx = tc.getContext('2d');
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function updateEraserCursorSize() {
    const z = (previewState && previewState.zoom) ? previewState.zoom : 1;
    const s = eraserState.size * (previewState ? (previewState.displayScale || 1) : 1) * z;
    eraserCursor.style.width = s + 'px';
    eraserCursor.style.height = s + 'px';
  }

  function updatePreviewTransform() {
    if (!previewState) return;
    const pwrap = previewModal.querySelector('#aiec-pwrap');
    pwrap.style.transform = `translate(${previewState.panX}px, ${previewState.panY}px) scale(${previewState.zoom})`;
    updateEraserCursorSize();
  }

  function resetTopCanvas() {
    if (!previewState) return;
    const { mergedCanvas } = previewState;
    const tc = previewModal.querySelector('#aiec-pcanvas-top');
    tc.width = mergedCanvas.width;
    tc.height = mergedCanvas.height;
    tc.getContext('2d').drawImage(mergedCanvas, 0, 0);
  }

  /* ── Crop Modal Logic ──────────────────────── */
  function openCrop(file) {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        const stage = cropModal.querySelector('#aiec-stage');
        const stageW = stage.clientWidth || window.innerWidth;
        const stageH = stage.clientHeight || (window.innerHeight - 100);

        // Fit image inside stage at 1:1 if small, or scale down
        let scale = Math.min(1, stageW * 0.9 / img.width, stageH * 0.9 / img.height);

        const cw = Math.round(img.width * scale);
        const ch = Math.round(img.height * scale);

        cropState = {
          img, file, scale,
          natW: img.width, natH: img.height,
          canW: cw, canH: ch,
          zoom: 1,
          vpX: Math.round((stageW - cw) / 2),
          vpY: Math.round((stageH - ch) / 2),
          sel: { x: Math.round(cw * 0.3), y: Math.round(ch * 0.3), w: Math.round(cw * 0.4), h: Math.round(ch * 0.4) }
        };

        const canvas = cropModal.querySelector('#aiec-canvas');
        canvas.width = cw;
        canvas.height = ch;
        canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);

        applyViewport();
        applySel();
        cropModal.classList.add('open');
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  function applyViewport() {
    if (!cropState) return;
    const vp = cropModal.querySelector('#aiec-vp');
    const z = cropState.zoom;
    vp.style.transform = `translate(${cropState.vpX}px, ${cropState.vpY}px) scale(${z})`;
    cropModal.querySelector('#aiec-zoom-label').textContent = `${Math.round(z * 100)}%`;
  }

  function applySel() {
    if (!cropState) return;
    const { x, y, w, h } = cropState.sel;
    const sel = cropModal.querySelector('#aiec-sel');
    sel.style.left = x + 'px';
    sel.style.top = y + 'px';
    sel.style.width = w + 'px';
    sel.style.height = h + 'px';

    // Show actual pixel dimensions
    const px_w = Math.round(w / cropState.scale);
    const px_h = Math.round(h / cropState.scale);
    cropModal.querySelector('#aiec-dim').textContent = `${px_w} × ${px_h}`;
  }

  function zoomBy(delta, mouseEvt) {
    if (!cropState) return;
    const stage = cropModal.querySelector('#aiec-stage');
    const oldZ = cropState.zoom;
    const newZ = clamp(oldZ + delta, 0.25, 8);
    if (newZ === oldZ) return;

    // Zoom toward mouse or center
    let cx, cy;
    if (mouseEvt) {
      const r = stage.getBoundingClientRect();
      cx = mouseEvt.clientX - r.left;
      cy = mouseEvt.clientY - r.top;
    } else {
      cx = stage.clientWidth / 2;
      cy = stage.clientHeight / 2;
    }

    // Adjust viewport offset so the point under cursor stays put
    cropState.vpX = cx - (cx - cropState.vpX) * (newZ / oldZ);
    cropState.vpY = cy - (cy - cropState.vpY) * (newZ / oldZ);
    cropState.zoom = newZ;
    applyViewport();
  }

  /* Auto-zoom: called when selection shrinks to keep it visible */
  function autoZoom() {
    if (!cropState) return;
    const stage = cropModal.querySelector('#aiec-stage');
    const stageW = stage.clientWidth;
    const stageH = stage.clientHeight;
    const { x, y, w, h } = cropState.sel;

    // Target: the selection should fill ~50-60% of the viewport
    const targetRatio = 0.55;
    const idealZoomW = (stageW * targetRatio) / w;
    const idealZoomH = (stageH * targetRatio) / h;
    const idealZoom = clamp(Math.min(idealZoomW, idealZoomH), 0.5, 6);

    // Only auto-zoom in — don't zoom out if user manually zoomed
    if (idealZoom <= cropState.zoom) return;

    // Smoothly set zoom centered on selection center
    const selCX = x + w / 2;
    const selCY = y + h / 2;

    const newZ = idealZoom;
    const vpCX = stageW / 2;
    const vpCY = stageH / 2;

    cropState.vpX = vpCX - selCX * newZ;
    cropState.vpY = vpCY - selCY * newZ;
    cropState.zoom = newZ;
    applyViewport();
  }

  /* ── Selection drag and resize ─────────────── */
  function onSelDown(e) {
    if (!cropState) return;
    e.stopPropagation();
    e.preventDefault();

    const handle = e.target.dataset.h;
    const s = cropState.sel;
    dragOp = {
      mode: handle || 'move',
      startMX: e.clientX, startMY: e.clientY,
      startSel: { ...s }
    };
  }

  function onSelMove(e) {
    if (!isContextValid()) return;
    if (!dragOp || !cropState) return;
    e.preventDefault();

    const z = cropState.zoom;
    const dx = (e.clientX - dragOp.startMX) / z;
    const dy = (e.clientY - dragOp.startMY) / z;
    const ss = dragOp.startSel;
    const cw = cropState.canW;
    const ch = cropState.canH;
    const MIN = 20;

    let { x, y, w, h } = ss;

    if (dragOp.mode === 'move') {
      x = clamp(ss.x + dx, 0, cw - ss.w);
      y = clamp(ss.y + dy, 0, ch - ss.h);
      w = ss.w; h = ss.h;
    } else {
      const m = dragOp.mode;
      if (m.includes('e'))  w = clamp(ss.w + dx, MIN, cw - ss.x);
      if (m.includes('w'))  { const nw = clamp(ss.w - dx, MIN, ss.x + ss.w); x = ss.x + ss.w - nw; w = nw; }
      if (m.includes('s'))  h = clamp(ss.h + dy, MIN, ch - ss.y);
      if (m.includes('n'))  { const nh = clamp(ss.h - dy, MIN, ss.y + ss.h); y = ss.y + ss.h - nh; h = nh; }
    }

    cropState.sel = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
    applySel();
  }

  function onSelUp() {
    if (!isContextValid()) return;
    if (dragOp && cropState) {
      // After resize completes, auto-zoom into the selection if it's small
      autoZoom();
    }
    dragOp = null;
  }

  /* ── Pan on stage ─────────────────────────── */
  let panOp = null;
  function onStageDown(e) {
    // Only pan if clicking on the stage background (not on selection)
    if (e.target.closest('.aiec-sel')) return;
    if (!cropState) return;
    e.preventDefault();
    panOp = { startMX: e.clientX, startMY: e.clientY, startVPX: cropState.vpX, startVPY: cropState.vpY };

    const onMove = ev => {
      if (!isContextValid()) return;
      if (!panOp) return;
      cropState.vpX = panOp.startVPX + (ev.clientX - panOp.startMX);
      cropState.vpY = panOp.startVPY + (ev.clientY - panOp.startMY);
      applyViewport();
    };
    const onUp = () => { panOp = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  /* ── Confirm Crop ──────────────────────────── */
  async function confirmCrop() {
    if (!cropState) return;
    const { sel, scale, img, file } = cropState;

    // Map to native pixels
    const nx = Math.round(sel.x / scale);
    const ny = Math.round(sel.y / scale);
    const nw = Math.round(sel.w / scale);
    const nh = Math.round(sel.h / scale);

    // Crop canvas
    const cc = document.createElement('canvas');
    cc.width = nw; cc.height = nh;
    cc.getContext('2d').drawImage(img, nx, ny, nw, nh, 0, 0, nw, nh);

    // Copy to clipboard
    let ok = false;
    try {
      const item = new ClipboardItem({ 'image/png': new Promise(r => cc.toBlob(r, 'image/png')) });
      await navigator.clipboard.write([item]);
      ok = true;
    } catch (err) { console.warn('Clipboard write failed', err); }

    toast(ok ? 'Crop copied to clipboard — paste into chat' : 'Clipboard blocked — use the copy button in the sidebar', !ok);

    // Thumbnail
    const tc = document.createElement('canvas');
    const ts = 100;
    tc.width = ts; tc.height = ts;
    const aspect = nw / nh;
    let sw, sh, sx, sy;
    if (aspect > 1) { sh = nh; sw = nh; sx = nx + (nw - sw) / 2; sy = ny; }
    else { sw = nw; sh = nw; sx = nx; sy = ny + (nh - sh) / 2; }
    tc.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, ts, ts);

    const session = {
      id: 'c' + Date.now(),
      name: file.name,
      ts: Date.now(),
      origSrc: img.src,
      thumbSrc: tc.toDataURL('image/png'),
      origW: img.width, origH: img.height,
      cx: nx, cy: ny, cw: nw, ch: nh
    };

    sessions.unshift(session);
    await store.save();
    renderList();
    sidebar.classList.add('open');
    cropModal.classList.remove('open');
    cropState = null;
  }

  /* ── Render Session Cards ──────────────────── */
  function renderList() {
    const list = sidebar.querySelector('#aiec-list');
    list.innerHTML = '';

    if (!sessions.length) {
      list.innerHTML = `<div class="aiec-empty">${ICO.img}<span>No crop sessions yet</span></div>`;
      return;
    }

    sessions.forEach(s => {
      const card = h('div', 'aiec-card');
      card.innerHTML = `
        <div class="aiec-card-top">
          <div class="aiec-card-name" title="${esc(s.name)}">${esc(s.name)}</div>
          <button class="aiec-card-del" data-id="${s.id}">${ICO.trash}</button>
        </div>
        <div class="aiec-card-info">
          <img class="aiec-thumb" src="${s.thumbSrc}">
          <div class="aiec-meta">
            <div>Size <b>${s.cw}×${s.ch}</b></div>
            <div>At <b>${s.cx}, ${s.cy}</b></div>
            <div>${ftime(s.ts)}</div>
          </div>
        </div>
        <div class="aiec-card-actions">
          <button class="aiec-sm-btn" data-copy="${s.id}">${ICO.copy} Re-copy</button>
        </div>
        <div class="aiec-drop" tabindex="0" data-drop="${s.id}">
          ${ICO.upload}
          <span class="aiec-drop-label">Drop or click — edited image</span>
        </div>`;
      list.appendChild(card);
    });

    // Bind card events
    list.querySelectorAll('.aiec-card-del').forEach(btn => {
      btn.onclick = async e => {
        e.stopPropagation();
        sessions = sessions.filter(s => s.id !== btn.dataset.id);
        await store.save();
        renderList();
        toast('Session removed');
      };
    });

    list.querySelectorAll('[data-copy]').forEach(btn => {
      btn.onclick = async e => {
        e.stopPropagation();
        const s = sessions.find(x => x.id === btn.dataset.copy);
        if (!s) return;
        const img = await loadImg(s.origSrc);
        const cc = document.createElement('canvas');
        cc.width = s.cw; cc.height = s.ch;
        cc.getContext('2d').drawImage(img, s.cx, s.cy, s.cw, s.ch, 0, 0, s.cw, s.ch);
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Promise(r => cc.toBlob(r, 'image/png')) })]);
          toast('Crop re-copied');
        } catch { toast('Clipboard blocked', true); }
      };
    });

    list.querySelectorAll('[data-drop]').forEach(dz => {
      const sid = dz.dataset.drop;

      dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
      dz.addEventListener('dragleave', () => dz.classList.remove('over'));
      dz.addEventListener('drop', e => {
        e.preventDefault(); dz.classList.remove('over');
        const s = sessions.find(x => x.id === sid);
        if (!s) return;
        handleDrop(e.dataTransfer, s);
      });

      dz.addEventListener('click', () => {
        const inp = h('input', null, { type: 'file', accept: 'image/*', style: { display: 'none' } });
        inp.onchange = e => { const f = e.target.files[0]; const s = sessions.find(x => x.id === sid); if (f && s) processFile(f, s); };
        document.body.appendChild(inp); inp.click(); inp.remove();
      });

      dz.addEventListener('paste', e => {
        e.preventDefault(); e.stopPropagation();
        const s = sessions.find(x => x.id === sid);
        if (!s) return;
        const items = (e.clipboardData || window.clipboardData).items;
        for (let i = 0; i < items.length; i++) {
          if (items[i].kind === 'file' && items[i].type.startsWith('image/')) {
            processFile(items[i].getAsFile(), s);
            return;
          }
        }
        toast('No image in paste data', true);
      });
    });
  }

  /* ── Drop handler ──────────────────────────── */
  function handleDrop(dt, session) {
    if (dt.files && dt.files.length) {
      const f = dt.files[0];
      if (f.type.startsWith('image/')) { processFile(f, session); return; }
    }
    const url = dt.getData('URL') || dt.getData('text/uri-list');
    if (url) { processURL(url, session); return; }
    const html = dt.getData('text/html');
    if (html) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const img = doc.querySelector('img');
      if (img && img.src) { processURL(img.src, session); return; }
    }
    toast('Could not read dropped image', true);
  }

  function processFile(file, session) {
    const r = new FileReader();
    r.onload = e => openPreview(e.target.result, session);
    r.readAsDataURL(file);
  }

  function processURL(url, session) {
    openPreview(url, session);
  }

  /* ── Preview Modal ─────────────────────────── */
  function openPreview(editedSrc, session) {
    toast('Building merge preview…');

    const origImg = new Image();
    const editImg = new Image();
    origImg.crossOrigin = 'anonymous';
    editImg.crossOrigin = 'anonymous';

    let oOk = false, eOk = false;

    const go = () => {
      // Build merged canvas at full resolution (kept in memory)
      const mc = document.createElement('canvas');
      mc.width = session.origW;
      mc.height = session.origH;
      const ctx = mc.getContext('2d');
      ctx.drawImage(origImg, 0, 0);
      ctx.drawImage(editImg, session.cx, session.cy, session.cw, session.ch);

      previewState = { origImg, editImg, session, mergedCanvas: mc, displayScale: 1, zoom: 1, panX: 0, panY: 0 };
      updatePreviewTransform();

      // Reset toolbar state
      eraserState.active = false;
      eraserState.painting = false;
      eraserCursor.style.display = 'none';
      previewModal.querySelector('#aiec-pwrap').classList.remove('eraser-active');
      previewModal.querySelector('#aiec-eraser-controls').style.display = 'none';
      previewModal.querySelectorAll('#aiec-ptoolbar button').forEach(b => b.classList.remove('active'));
      previewModal.querySelector('#aiec-ptoolbar button[data-v="merged"]').classList.add('active');
      // Reset eye toggle to visible
      const eyeBtn = previewModal.querySelector('#aiec-eye-btn');
      eyeBtn.classList.add('active');
      eyeBtn.innerHTML = ICO.eye + ' Region';

      drawPreview(false);
      previewModal.classList.add('open');
    };

    origImg.onload = () => { oOk = true; if (eOk) go(); };
    editImg.onload = () => { eOk = true; if (oOk) go(); };
    origImg.onerror = () => toast('Failed to load original image', true);
    editImg.onerror = () => toast('Failed to load edited image — try downloading and using the file picker', true);

    origImg.src = session.origSrc;
    editImg.src = editedSrc;
  }

  function drawPreview(showOriginal) {
    if (!previewState) return;
    const { origImg, mergedCanvas, session } = previewState;
    const origCanvas = previewModal.querySelector('#aiec-pcanvas-orig');
    const topCanvas = previewModal.querySelector('#aiec-pcanvas-top');
    const hl = previewModal.querySelector('#aiec-phighlight');

    // Bottom layer: always the original
    origCanvas.width = origImg.width;
    origCanvas.height = origImg.height;
    origCanvas.getContext('2d').drawImage(origImg, 0, 0);

    if (showOriginal) {
      // Hide the top canvas entirely to show just original
      topCanvas.style.opacity = '0';
      hl.classList.remove('visible');
    } else {
      // Top layer: merged result (erasable)
      topCanvas.width = mergedCanvas.width;
      topCanvas.height = mergedCanvas.height;
      topCanvas.getContext('2d').drawImage(mergedCanvas, 0, 0);
      topCanvas.style.opacity = '1';

      // Compute display scale after the canvas is laid out
      requestAnimationFrame(() => {
        const displayW = origCanvas.clientWidth || origCanvas.offsetWidth;
        previewState.displayScale = displayW / origImg.width;

        hl.style.left = (session.cx * previewState.displayScale) + 'px';
        hl.style.top = (session.cy * previewState.displayScale) + 'px';
        hl.style.width = (session.cw * previewState.displayScale) + 'px';
        hl.style.height = (session.ch * previewState.displayScale) + 'px';
        // Respect the eye toggle — check if eye button is active
        const eyeBtn = previewModal.querySelector('#aiec-eye-btn');
        if (eyeBtn && eyeBtn.classList.contains('active')) {
          hl.classList.add('visible');
        }

        updateEraserCursorSize();
      });
    }
  }

  function downloadPreview() {
    if (!previewState) return;
    const { origImg, session } = previewState;
    const topCanvas = previewModal.querySelector('#aiec-pcanvas-top');

    // Composite: draw original, then stamp the (possibly erased) top layer on top
    const outCanvas = document.createElement('canvas');
    outCanvas.width = origImg.width;
    outCanvas.height = origImg.height;
    const ctx = outCanvas.getContext('2d');
    ctx.drawImage(origImg, 0, 0);
    ctx.drawImage(topCanvas, 0, 0);

    outCanvas.toBlob(blob => {
      if (!blob) { toast('Download failed', true); return; }
      const url = URL.createObjectURL(blob);
      const a = h('a', null, { style: { display: 'none' } });
      const base = session.name.replace(/\.[^.]+$/, '');
      a.download = `${base}_edited.png`;
      a.href = url;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 200);
      toast('Download started');
      previewModal.classList.remove('open');
      previewState = null;
      eraserState.active = false;
      eraserCursor.style.display = 'none';
    }, 'image/png');
  }

  /* ── Toast ──────────────────────────────────── */
  function toast(msg, err = false) {
    document.querySelectorAll('.aiec-toast').forEach(t => t.remove());
    const t = h('div', `aiec-toast aiec${err ? ' err' : ''}`, {
      html: `<div class="aiec-toast-dot"></div><span>${msg}</span>`
    });
    document.body.appendChild(t);
    requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 3500);
  }

  /* ── Utils ──────────────────────────────────── */
  function loadImg(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  /* ── Make Panel Draggable ───────────────── */
  function makePanelDraggable() {
    const head = sidebar.querySelector('.aiec-side-head');
    let dragging = false, startX, startY, startLeft, startTop;

    head.addEventListener('mousedown', e => {
      // Don't drag if clicking close button
      if (e.target.closest('.aiec-icon-btn')) return;
      e.preventDefault();
      dragging = true;
      const rect = sidebar.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY;
      startLeft = rect.left; startTop = rect.top;
    });

    window.addEventListener('mousemove', e => {
      if (!isContextValid()) return;
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const newLeft = clamp(startLeft + dx, 0, window.innerWidth - sidebar.offsetWidth);
      const newTop = clamp(startTop + dy, 0, window.innerHeight - 60);
      sidebar.style.left = newLeft + 'px';
      sidebar.style.top = newTop + 'px';
      sidebar.style.right = 'auto';
    });

    window.addEventListener('mouseup', () => {
      if (!isContextValid()) return;
      dragging = false;
    });
  }

  /* ── Memory cleanup ───────────────────── */
  function cleanup() {
    sessions = [];
    cropState = null;
    previewState = null;
  }

  // Clear everything when the tab/window is closed
  window.addEventListener('beforeunload', () => {
    if (isContextValid()) cleanup();
  });
  // Also clear when navigating away (SPA navigations)
  window.addEventListener('pagehide', () => {
    if (isContextValid()) cleanup();
  });

  /* ── Boot ───────────────────────────────── */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
