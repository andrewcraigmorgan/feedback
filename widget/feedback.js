(function () {
  'use strict';
  if (window.__feedbackWidgetLoaded) return;
  window.__feedbackWidgetLoaded = true;

  var script = document.currentScript;
  var origin = script ? new URL(script.src).origin : '';
  var cfg = {
    endpoint: (script && script.dataset.endpoint) || (origin + '/api/feedback'),
    vendor: (script && script.dataset.vendor) || (origin + '/widget/vendor'),
    project: (script && script.dataset.project) || 'default',
    accent: (script && script.dataset.accent) || '#1f2937',
    position: (script && script.dataset.position) || 'bottom-right',
  };

  // ---- styles ----
  var css = `
    .fb-root, .fb-root * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .fb-launcher { position: fixed; ${cfg.position.indexOf('bottom') === 0 ? 'bottom:20px' : 'top:20px'}; ${cfg.position.indexOf('right') >= 0 ? 'right:20px' : 'left:20px'}; height:44px; min-width:44px; padding:0 13px; border-radius:22px; background:${cfg.accent}; color:#fff; border:none; cursor:pointer; box-shadow:0 2px 6px rgba(0,0,0,.10); display:flex; align-items:center; justify-content:center; gap:8px; z-index:2147483600; opacity:.55; transition:opacity .18s ease, transform .18s ease, box-shadow .18s ease, padding .2s ease; font:600 14px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; letter-spacing:.01em; }
    .fb-launcher:hover, .fb-launcher:focus-visible, .fb-launcher.fb-launcher-open { opacity:1; transform:translateY(-1px); box-shadow:0 6px 16px rgba(0,0,0,.22); outline:none; padding:0 16px 0 14px; }
    .fb-launcher .fb-launcher-label { white-space:nowrap; max-width:0; overflow:hidden; opacity:0; margin-left:-8px; transition:max-width .22s ease, opacity .15s ease .04s, margin-left .22s ease; }
    .fb-launcher:hover .fb-launcher-label,
    .fb-launcher:focus-visible .fb-launcher-label,
    .fb-launcher.fb-launcher-open .fb-launcher-label { max-width:120px; opacity:1; margin-left:0; }
    .fb-launcher svg { width:18px; height:18px; flex-shrink:0; }
    .fb-panel { position: fixed; ${cfg.position.indexOf('bottom') === 0 ? 'bottom:80px' : 'top:80px'}; ${cfg.position.indexOf('right') >= 0 ? 'right:20px' : 'left:20px'}; width:340px; max-width:calc(100vw - 40px); background:#fff; border-radius:14px; box-shadow:0 12px 40px rgba(0,0,0,.18); z-index:2147483601; padding:18px; color:#111; }
    .fb-close { position:absolute; top:10px; right:10px; background:none; border:none; cursor:pointer; color:#666; padding:4px; line-height:0; }
    .fb-option { display:flex; align-items:center; gap:12px; padding:12px; border-radius:10px; cursor:pointer; border:1px solid transparent; transition:background .12s, border-color .12s; }
    .fb-option:hover { background:#f5f6f8; border-color:#e5e7eb; }
    .fb-option-icon { width:40px; height:40px; border-radius:50%; background:#eef2ff; color:#4338ca; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
    .fb-option-icon.feature { background:#fef3c7; color:#92400e; }
    .fb-option-icon svg { width:20px; height:20px; }
    .fb-option-title { font-weight:600; font-size:14px; color:#111; }
    .fb-option-sub { font-size:12px; color:#666; margin-top:2px; }
    .fb-form-title { font-weight:600; font-size:15px; margin:0 0 10px; display:flex; align-items:center; gap:8px; }
    .fb-back { background:none; border:none; cursor:pointer; color:#666; padding:0; font-size:13px; display:flex; align-items:center; gap:4px; margin-bottom:10px; }
    .fb-back:hover { color:#111; }
    .fb-textarea { width:100%; min-height:96px; padding:10px; border:1px solid #e5e7eb; border-radius:8px; font-size:13px; resize:vertical; font-family:inherit; outline:none; }
    .fb-textarea:focus { border-color:${cfg.accent}; }
    .fb-input { width:100%; padding:9px 10px; border:1px solid #e5e7eb; border-radius:8px; font-size:13px; outline:none; margin-top:8px; font-family:inherit; }
    .fb-input:focus { border-color:${cfg.accent}; }
    .fb-row { display:flex; gap:8px; align-items:center; margin-top:10px; }
    .fb-btn { padding:9px 14px; border-radius:8px; border:none; cursor:pointer; font-size:13px; font-weight:500; }
    .fb-btn-primary { background:${cfg.accent}; color:#fff; }
    .fb-btn-primary:hover { opacity:.9; }
    .fb-btn-primary:disabled { opacity:.5; cursor:not-allowed; }
    .fb-btn-ghost { background:#f5f6f8; color:#111; }
    .fb-btn-ghost:hover { background:#eceef2; }
    .fb-thumb { position:relative; margin-top:10px; border:1px solid #e5e7eb; border-radius:8px; overflow:hidden; background:#fafafa; }
    .fb-thumb img { display:block; width:100%; max-height:140px; object-fit:cover; }
    .fb-thumb-x { position:absolute; top:6px; right:6px; background:rgba(0,0,0,.55); color:#fff; border:none; border-radius:50%; width:22px; height:22px; cursor:pointer; line-height:0; display:flex; align-items:center; justify-content:center; }
    .fb-snip-overlay { position:fixed; inset:0; z-index:2147483647; cursor:crosshair; user-select:none; }
    .fb-snip-bg { position:absolute; inset:0; background:rgba(0,0,0,.35); }
    .fb-snip-img { position:absolute; inset:0; width:100%; height:100%; }
    .fb-snip-rect { position:absolute; border:2px solid ${cfg.accent}; box-shadow:0 0 0 9999px rgba(0,0,0,.45); }
    .fb-snip-hint { position:fixed; top:16px; left:50%; transform:translateX(-50%); background:rgba(0,0,0,.8); color:#fff; padding:8px 14px; border-radius:6px; font-size:13px; z-index:2147483647; pointer-events:none; }
    .fb-toast { position:fixed; bottom:90px; right:20px; background:#111; color:#fff; padding:10px 14px; border-radius:8px; font-size:13px; z-index:2147483647; opacity:0; transition:opacity .2s; }
    .fb-toast.show { opacity:1; }
    .fb-spinner { width:14px; height:14px; border:2px solid rgba(255,255,255,.4); border-top-color:#fff; border-radius:50%; animation:fb-spin .7s linear infinite; display:inline-block; vertical-align:-2px; margin-right:6px; }
    @keyframes fb-spin { to { transform:rotate(360deg); } }
  `;
  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ---- icons ----
  var ICON_BUG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="6" width="8" height="14" rx="4"/><path d="M8 10H4M16 10h4M8 14H4M16 14h4M8 18H4M16 18h4M9 6V4M15 6V4"/></svg>';
  var ICON_FEATURE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.4 5.6L20 10l-5.6 2.4L12 18l-2.4-5.6L4 10l5.6-2.4L12 2zM18 16l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2zM4 16l.7 1.3 1.3.7-1.3.7L4 20l-.7-1.3L2 18l1.3-.7L4 16z"/></svg>';
  // Pencil-on-paper — instantly reads as "write us a note".
  var ICON_CHAT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L13 14l-4 1 1-4 8.5-8.5z"/></svg>';
  var ICON_X = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  // ---- root + state ----
  var root = document.createElement('div');
  root.className = 'fb-root';
  document.body.appendChild(root);

  var state = { open: false, view: 'menu', kind: null, screenshot: null, message: '', reporter: '' };
  function escHtml(s) { return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function saveFields() {
    var msg = document.getElementById('fb-msg'); if (msg) state.message = msg.value;
    var email = document.getElementById('fb-email'); if (email) state.reporter = email.value;
  }

  function render() {
    if (!state.open) { root.innerHTML = renderLauncher(); bind(); return; }
    root.innerHTML = renderLauncher() + (state.view === 'menu' ? renderMenu() : renderForm());
    bind();
  }

  function renderLauncher() {
    var openCls = state.open ? ' fb-launcher-open' : '';
    return '<button class="fb-launcher' + openCls + '" id="fb-launcher" aria-label="Send feedback" title="Send feedback">' +
      ICON_CHAT +
      '<span class="fb-launcher-label">Feedback</span>' +
      '</button>';
  }

  function renderMenu() {
    return '' +
      '<div class="fb-panel" role="dialog" aria-label="Feedback">' +
      '  <button class="fb-close" id="fb-close" aria-label="Close">' + ICON_X + '</button>' +
      '  <div class="fb-form-title">Send feedback</div>' +
      '  <div class="fb-option" data-kind="bug">' +
      '    <div class="fb-option-icon">' + ICON_BUG + '</div>' +
      '    <div><div class="fb-option-title">Report a bug</div><div class="fb-option-sub">Let us know what\'s broken</div></div>' +
      '  </div>' +
      '  <div class="fb-option" data-kind="feature">' +
      '    <div class="fb-option-icon feature">' + ICON_FEATURE + '</div>' +
      '    <div><div class="fb-option-title">Request a feature</div><div class="fb-option-sub">Tell us how we can improve</div></div>' +
      '  </div>' +
      '</div>';
  }

  function renderForm() {
    var isBug = state.kind === 'bug';
    var thumb = state.screenshot
      ? '<div class="fb-thumb"><img src="' + state.screenshot + '" alt=""><button class="fb-thumb-x" id="fb-shot-clear" aria-label="Remove screenshot">' + ICON_X + '</button></div>'
      : '';
    return '' +
      '<div class="fb-panel" role="dialog">' +
      '  <button class="fb-close" id="fb-close" aria-label="Close">' + ICON_X + '</button>' +
      '  <button class="fb-back" id="fb-back">&larr; back</button>' +
      '  <div class="fb-form-title">' + (isBug ? 'Report a bug' : 'Request a feature') + '</div>' +
      '  <textarea class="fb-textarea" id="fb-msg" placeholder="' + (isBug ? 'What went wrong?' : 'What would you like to see?') + '">' + escHtml(state.message) + '</textarea>' +
      '  <input class="fb-input" id="fb-email" type="email" placeholder="Your email (optional)" value="' + escHtml(state.reporter) + '">' +
      thumb +
      '  <div class="fb-row">' +
      '    <button class="fb-btn fb-btn-ghost" id="fb-snip">' + (state.screenshot ? 'Re-snip' : '&#9986; Snip area') + '</button>' +
      '    <div style="flex:1"></div>' +
      '    <button class="fb-btn fb-btn-primary" id="fb-send">Send</button>' +
      '  </div>' +
      '</div>';
  }

  function bind() {
    var $ = function (id) { return root.querySelector('#' + id); };
    var launcher = $('fb-launcher');
    if (launcher) launcher.onclick = function () { state.open = !state.open; state.view = 'menu'; render(); };
    var close = $('fb-close'); if (close) close.onclick = function () { state.open = false; render(); };
    var back = $('fb-back'); if (back) back.onclick = function () { state.view = 'menu'; state.kind = null; state.screenshot = null; render(); };
    root.querySelectorAll('.fb-option').forEach(function (el) {
      el.onclick = function () { state.kind = el.dataset.kind; state.view = 'form'; render(); };
    });
    var msg = $('fb-msg'); if (msg) msg.oninput = function () { state.message = msg.value; };
    var email = $('fb-email'); if (email) email.oninput = function () { state.reporter = email.value; };
    var snip = $('fb-snip'); if (snip) snip.onclick = startSnip;
    var clear = $('fb-shot-clear'); if (clear) clear.onclick = function () { state.screenshot = null; render(); };
    var send = $('fb-send'); if (send) send.onclick = submit;
  }

  // ---- snipping: snapshot page with html-to-image (supports oklch / modern CSS) ----
  var htmlToImagePromise = null;
  function loadHtmlToImage() {
    if (window.htmlToImage) return Promise.resolve(window.htmlToImage);
    if (htmlToImagePromise) return htmlToImagePromise;
    htmlToImagePromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = cfg.vendor + '/html-to-image.js';
      s.onload = function () { resolve(window.htmlToImage); };
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return htmlToImagePromise;
  }

  function startSnip() {
    saveFields();
    var panel = root.querySelector('.fb-panel');
    if (panel) panel.style.display = 'none';
    var hint = document.createElement('div');
    hint.className = 'fb-snip-hint';
    hint.textContent = 'Capturing page…';
    document.body.appendChild(hint);

    loadHtmlToImage().then(function (hti) {
      var scale = Math.min(window.devicePixelRatio || 1, 2);
      return hti.toCanvas(document.body, { pixelRatio: scale });
    }).then(function (canvas) {
      hint.textContent = 'Drag to select area — Esc to cancel';
      runCrop(canvas, function (dataUrl) {
        hint.remove();
        if (panel) panel.style.display = '';
        if (dataUrl) state.screenshot = dataUrl;
        render();
      });
    }).catch(function (err) {
      hint.remove();
      if (panel) panel.style.display = '';
      toast('Could not capture screen');
      console.error(err);
    });
  }

  function runCrop(canvas, done) {
    var overlay = document.createElement('div');
    overlay.className = 'fb-snip-overlay';
    var img = document.createElement('img');
    img.className = 'fb-snip-img';
    img.src = canvas.toDataURL('image/png');
    var bg = document.createElement('div'); bg.className = 'fb-snip-bg';
    var rect = document.createElement('div'); rect.className = 'fb-snip-rect'; rect.style.display = 'none';
    overlay.appendChild(img);
    overlay.appendChild(bg);
    overlay.appendChild(rect);
    document.body.appendChild(overlay);

    // adjust img to actually fill viewport with current scroll position
    img.style.position = 'fixed';
    img.style.top = (-window.scrollY * (window.innerHeight / document.documentElement.clientHeight) * 0) + 'px';
    // simpler: show full page image scaled to viewport using object-fit
    img.style.objectFit = 'cover';
    img.style.objectPosition = '-' + window.scrollX + 'px -' + window.scrollY + 'px';
    img.style.width = document.documentElement.scrollWidth + 'px';
    img.style.height = document.documentElement.scrollHeight + 'px';
    img.style.left = (-window.scrollX) + 'px';
    img.style.top = (-window.scrollY) + 'px';

    var startX, startY, dragging = false;
    function onDown(e) {
      dragging = true;
      var p = pt(e);
      startX = p.x; startY = p.y;
      rect.style.left = startX + 'px';
      rect.style.top = startY + 'px';
      rect.style.width = '0px';
      rect.style.height = '0px';
      rect.style.display = 'block';
    }
    function onMove(e) {
      if (!dragging) return;
      var p = pt(e);
      var x = Math.min(p.x, startX), y = Math.min(p.y, startY);
      var w = Math.abs(p.x - startX), h = Math.abs(p.y - startY);
      rect.style.left = x + 'px'; rect.style.top = y + 'px';
      rect.style.width = w + 'px'; rect.style.height = h + 'px';
    }
    function onUp(e) {
      if (!dragging) return;
      dragging = false;
      var r = rect.getBoundingClientRect();
      cleanup();
      if (r.width < 8 || r.height < 8) { done(null); return; }
      // map viewport-rect → page coords → canvas coords
      var pageX = r.left + window.scrollX;
      var pageY = r.top + window.scrollY;
      var sx = pageX * (canvas.width / document.documentElement.scrollWidth);
      var sy = pageY * (canvas.height / document.documentElement.scrollHeight);
      var sw = r.width * (canvas.width / document.documentElement.scrollWidth);
      var sh = r.height * (canvas.height / document.documentElement.scrollHeight);
      var out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(sw));
      out.height = Math.max(1, Math.round(sh));
      out.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
      done(out.toDataURL('image/png'));
    }
    function onKey(e) { if (e.key === 'Escape') { cleanup(); done(null); } }
    function pt(e) {
      var t = e.touches ? e.touches[0] : e;
      return { x: t.clientX, y: t.clientY };
    }
    function cleanup() {
      overlay.remove();
      window.removeEventListener('keydown', onKey);
    }
    overlay.addEventListener('mousedown', onDown);
    overlay.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey);
  }

  // ---- submit ----
  function submit() {
    var msg = root.querySelector('#fb-msg').value.trim();
    var email = root.querySelector('#fb-email').value.trim();
    var btn = root.querySelector('#fb-send');
    if (!msg) { toast('Please enter a message'); return; }
    btn.disabled = true;
    btn.innerHTML = '<span class="fb-spinner"></span>Sending…';
    var payload = {
      kind: state.kind,
      message: msg,
      reporter: email || null,
      project: cfg.project,
      url: location.href,
      userAgent: navigator.userAgent,
      viewport: window.innerWidth + 'x' + window.innerHeight,
      screenshot: state.screenshot,
    };
    fetch(cfg.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (r) {
      if (r.ok) return r.json();
      return r.json().catch(function () { return {}; }).then(function (j) {
        throw new Error(j.error || ('http ' + r.status));
      });
    }).then(function () {
      state.open = false; state.view = 'menu'; state.kind = null; state.screenshot = null; state.message = ''; state.reporter = '';
      render();
      toast('Thanks — feedback sent');
    }).catch(function (err) {
      console.error('feedback widget:', err);
      btn.disabled = false; btn.textContent = 'Send';
      toast('Could not send: ' + (err.message || 'unknown error'));
    });
  }

  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'fb-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 250); }, 2400);
  }

  render();
})();
