/* ==========================================================
   Cowan Widget – Vanilla JS (OpenClaw Buch Dashboard)
   KI-Wissensassistent fuer das OpenClaw Buch
   Floating-Widget, laeuft in der Shell (index.html)

   v2.0.0 (01.04.2026 – Session 174):
   - Sync-Grundfunktion: Cowan ↔ VPS Sync-Server (optional)
   - Kapitel-Kontext: zeigt aktives Modul im Header
   - ?cowan=open URL-Parameter (fuer QR-Code AA-COWAN)
   - Sync-Status im Header (gruener/grauer Punkt)
   - Public API erweitert (setContext, syncStatus)

   v2.1.0 (01.04.2026 – Session 175):
   - Fix: Sync-URL aus tailscaleIp + syncPort gebaut (statt nicht-existierendem aa-settings.syncUrl)
   - Sync-Read: Modul-Kontext aus Server-Response uebernehmen (Cross-Device)
   - Shell: pushDashboardState bei Modul-Wechsel + showHome (bidirektionaler Sync)

   v3.0.0 (01.04.2026 – Session 176):
   - Home-Screen mit 4 Kacheln (Verbunden, Wissen, Handy, Frage stellen)
   - QR-Code Overlay: Handy verbinden per QR-Scan (API-Key base64 in URL)
   - Companion-Mode: ?companion=true URL-Parameter, reduzierte UI, Vollbild auf Handy
   - View-System: home | chat | qr (statt nur chat)
   - Zurueck-Button im Header (Chat/QR → Home)
   - Benoetigt shared/qr.js (QR-Code-Generator, kein CDN)

   v3.1.0 (01.04.2026 – Session 177):
   - Design-Upgrade: iOS 18 Glassmorphism (portiert von alter React-App v5.34.0)
   - Panel, Header, Input: backdrop-filter blur(20px) saturate(180%)
   - Chat-Bubbles: Glass-Effekt, Amber User-Bubbles, fadeInUp Animation
   - Home-Kacheln: Glass Cards, Amber-Farbwelt, translateY Hover, scale Touch
   - Chunk-Browser: Glass-Modal, Gradient-Progress-Bar, SVG-Pfeil-Navigation
   - QR-Overlay: Dark-Glass statt Light-Theme (konsistent)
   - Buttons: Amber-Gradient, Glow-Shadows, Spring-Animationen
   - Geraete-neutral: "iPhone" → "Handy" ueberall

   v3.1.1 (02.04.2026 – Session 178):
   - Design-Fixes nach Thomas-Review:
   - Tile-Borders: Amber → subtiles Weiss (rgba(255,255,255,0.18) hover)
   - Farbkonsistenz: Gruen (#22c55e) → Amber (#f59e0b) bei allen Tile-Icons
   - Kachelhoehen: min-height:160px fuer gleichmaessiges Grid
   - Quick-Action Chips: Amber-Border → Glass-Look (weiss/grau statt orange)
   - cw-tile-label-ok von Gruen auf Amber umgestellt
   ========================================================== */

(function() {
  'use strict';

  /* ── Globaler State ── */
  var chunks = [];
  var messages = [];
  var isLoading = false;
  var isTyping = false;
  var typingWords = [];
  var typingSources = [];
  var typingIndex = 0;
  var typingTimer = null;
  var apiKey = '';
  var apiKeyStatus = 'none'; // none | checking | valid | invalid | uncertain
  var selectedModel = 'claude-haiku-4-5-20251001';
  var totalTokens = { input: 0, output: 0 };
  var totalCost = 0;
  var pendingImage = null;
  var isOpen = false;
  var showChunkBrowser = false;
  var chunkBrowserIndex = 0;

  /* ── Sync & Kontext State ── */
  var syncConnected = false;
  var syncError = null;
  var syncUrl = '';
  var syncToken = '';
  var syncPollTimer = null;
  var currentModuleId = '';  // z.B. 'fahrplan', 'setup-guide'
  var currentModuleLabel = '';  // z.B. 'Dein Fahrplan', 'Setup-Guide'

  /* ── Companion-Mode & Views ── */
  var currentView = 'home';  // home | chat | qr
  var isCompanionMode = false;
  var companionParams = null;

  var MODULE_LABELS = {
    'fahrplan': 'Dein Fahrplan',
    'setup-guide': 'Setup-Guide',
    'meine-daten': 'Meine Daten',
    'buch-dashboard': 'Buch-Dashboard',
    'publishing': 'Publishing',
    'workspace-wizard': 'Workspace Wizard',
    'config-builder': 'Config Builder',
    'cost-calculator': 'Kostenrechner',
    'soul-gallery': 'SOUL Gallery',
    'cli-referenz': 'CLI-Referenz',
    'system-status': 'System-Status',
    'skill-explorer': 'Skill Explorer',
    'template-packs': 'Template Packs',
  };

  var PRICING = {
    'claude-haiku-4-5-20251001': { input: 1.0 / 1e6, output: 5.0 / 1e6, label: 'Haiku 4.5' },
    'claude-sonnet-4-5-20250929': { input: 3.0 / 1e6, output: 15.0 / 1e6, label: 'Sonnet 4.5' },
  };

  var WELCOME_MSG = {
    role: 'assistant',
    content: 'Hallo! Ich bin **Cowan**, dein Buch-Assistent. Stelle mir eine Frage zum Buch, zu OpenClaw oder Claude \u2013 ich helfe dir gerne weiter!',
    isWelcome: true,
    sourceIds: [],
  };

  /* ── Hilfsfunktionen ── */
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function(k) {
      if (k === 'style' && typeof attrs[k] === 'object') {
        Object.assign(e.style, attrs[k]);
      } else if (k.indexOf('on') === 0) {
        e.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      } else if (k === 'html') {
        e.innerHTML = attrs[k];
      } else if (k === 'className') {
        e.className = attrs[k];
      } else {
        e.setAttribute(k, attrs[k]);
      }
    });
    if (children) {
      if (typeof children === 'string') e.textContent = children;
      else if (Array.isArray(children)) children.forEach(function(c) {
        if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
      else e.appendChild(children);
    }
    return e;
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderMarkdown(text) {
    if (!text) return '';
    var parts = [];
    var codeRe = /```(\w*)\n?([\s\S]*?)```/g;
    var last = 0, m;
    while ((m = codeRe.exec(text)) !== null) {
      if (m.index > last) parts.push({ type: 'text', val: text.slice(last, m.index) });
      parts.push({ type: 'code', val: m[2] });
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push({ type: 'text', val: text.slice(last) });
    return parts.map(function(p) {
      if (p.type === 'code') {
        return '<pre class="cw-code"><code>' + escapeHtml(p.val) + '</code></pre>';
      }
      return renderInline(p.val);
    }).join('');
  }

  function renderInline(text) {
    var h = escapeHtml(text);
    h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="cw-link">$1</a>');
    h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    h = h.replace(/`([^`]+)`/g, '<code class="cw-inline-code">$1</code>');
    h = h.replace(/\n/g, '<br/>');
    return h;
  }

  function parseSourcesFromResponse(text) {
    var match = text.match(/---QUELLEN---\s*([\s\S]*?)\s*---QUELLEN-ENDE---/);
    if (!match) return { cleanText: text, sourceIds: [] };
    var ids = match[1].trim().split('\n').map(function(s) { return s.trim(); }).filter(Boolean);
    return { cleanText: text.replace(/---QUELLEN---[\s\S]*?---QUELLEN-ENDE---/, '').trim(), sourceIds: ids };
  }

  function trimHistory(msgs, maxTokens) {
    maxTokens = maxTokens || 150000;
    var copy = msgs.slice();
    while (copy.length > 2) {
      var sum = 0;
      for (var i = 0; i < copy.length; i++) {
        var c = copy[i].content;
        sum += (typeof c === 'string' ? c.length : JSON.stringify(c).length) / 3;
      }
      if (sum <= maxTokens) break;
      copy.splice(0, 1);
    }
    return copy;
  }

  function buildSystemPrompt(chapterCtx) {
    var chunkSection = chunks.map(function(c) {
      return '### ' + c.title + ' [' + c.id + ']\nKategorie: ' + c.category + ' | Schwierigkeit: ' + c.difficulty + '\n' + c.content;
    }).join('\n\n');

    var chapterSection = '';
    if (chapterCtx && chapterCtx.chapter && chapterCtx.progress) {
      var ch = chapterCtx.chapter;
      var pr = chapterCtx.progress;
      var done = [], open = [];
      var names = { outline: 'Outline', draft: 'Draft', check: 'Check', review: 'Review', final: 'Final' };
      ['outline','draft','check','review','final'].forEach(function(s) {
        (pr.tasks && pr.tasks[s] ? done : open).push(names[s]);
      });
      chapterSection = '\n\n## Aktueller Kontext des Lesers\nDer Leser arbeitet an Kapitel ' + ch.number + ': ' + ch.title + ' (Teil ' + ch.part + ').\nFortschritt: ' + pr.done + '/' + pr.total + (done.length ? ' (' + done.join(', ') + ' erledigt)' : '') + '.' + (open.length ? '\nNaechster Schritt: ' + open[0] + '.' : '');
    }

    /* Modul-Kontext: wo ist der Leser gerade im Dashboard? */
    var moduleSection = '';
    if (currentModuleId) {
      moduleSection = '\n\n## Dashboard-Kontext\nDer Leser hat gerade das Modul "' + (currentModuleLabel || currentModuleId) + '" geoeffnet. Wenn sich die Frage auf dieses Modul bezieht, gehe darauf ein.';
    }

    return 'Du bist Cowan - Die Buch-Instanz, der KI-Wissensassistent fuer das OpenClaw Buch (KI-gestuetzte Buchproduktion mit Claude und OpenClaw).\n\n## Deine Aufgabe\nDu hilfst Lesern, Fragen zum Buch, zu OpenClaw, zur Multi-Agent-Pipeline, zur Claude-API und zur KI-gestuetzten Bucherstellung zu beantworten.\nDu basierst deine Antworten ausschliesslich auf der bereitgestellten Wissensbasis.\n\n## Wissensbasis\n\n' + chunkSection + chapterSection + moduleSection + '\n\n## Antwortregeln\n1. Beantworte Fragen NUR basierend auf den Wissensbausteinen\n2. Zitiere verwendete Quellen am Ende deiner Antwort in exakt diesem Format:\n   ---QUELLEN---\n   chunk-id-hier\n   ---QUELLEN-ENDE---\n3. Wenn die Wissensbasis keine Antwort enthaelt, sage das ehrlich\n4. Antworte immer auf Deutsch\n5. Halte Antworten praxisnah und konkret\n6. Gib IMMER den ---QUELLEN--- Block am Ende an';
  }

  function formatCost(cost) {
    if (cost < 0.001) return '< 0.001';
    return cost.toFixed(3);
  }

  /* ── Storage-Integration ── */
  function loadState() {
    try {
      apiKey = localStorage.getItem('shell:apiKey') || '';
      if (apiKey) apiKeyStatus = 'valid';
      var hist = localStorage.getItem('shell:cowanHistory');
      if (hist) {
        messages = JSON.parse(hist);
      } else {
        messages = [Object.assign({}, WELCOME_MSG)];
      }
      var savedModel = localStorage.getItem('shell:cowanModel');
      if (savedModel && PRICING[savedModel]) selectedModel = savedModel;
    } catch(e) {
      messages = [Object.assign({}, WELCOME_MSG)];
    }
  }

  function saveHistory() {
    try {
      var toSave = messages.filter(function(m) { return !m.isTyping; });
      localStorage.setItem('shell:cowanHistory', JSON.stringify(toSave));
    } catch(e) { /* quota */ }
  }

  function saveApiKey(key) {
    apiKey = key;
    try { localStorage.setItem('shell:apiKey', key); } catch(e) {}
  }

  /* ── Chunks laden ── */
  function loadChunks() {
    var basePath = document.querySelector('script[src*="cowan.js"]');
    var dir = basePath ? basePath.src.replace(/cowan\.js.*$/, '') : 'shared/';
    fetch(dir + 'chunks.json').then(function(r) { return r.json(); }).then(function(data) {
      chunks = data;
      renderStatusLine();
    }).catch(function(err) {
      console.warn('Cowan: chunks.json nicht geladen', err);
    });
  }

  /* ── Kontext: Aktives Modul erkennen ── */
  function updateModuleContext() {
    try {
      var mod = localStorage.getItem('shell:lastModule') || '';
      if (mod !== currentModuleId) {
        currentModuleId = mod;
        currentModuleLabel = MODULE_LABELS[mod] || mod || '';
      }
    } catch(e) {}
  }

  /* ── Sync: Verbindungsdaten aus Meine-Daten laden ── */
  function loadSyncSettings() {
    try {
      syncToken = localStorage.getItem('aa-settings.syncToken') || '';
      /* URL aus tailscaleIp + syncPort zusammenbauen (wie Meine-Daten sie speichert) */
      var ip = localStorage.getItem('aa-settings.tailscaleIp') || '';
      var port = localStorage.getItem('aa-settings.syncPort') || '3456';
      syncUrl = ip ? ('http://' + ip.replace(/\/+$/, '') + ':' + port) : '';
    } catch(e) {}
  }

  /* ── Sync: Event an Server schreiben ── */
  function syncWriteEvent(event) {
    if (!syncUrl || !syncToken) return;
    var payload = {
      lastUpdate: new Date().toISOString(),
      device: 'dashboard-cowan',
      event: event,
      context: {
        module: currentModuleId,
        questionsAsked: messages.filter(function(m) { return m.role === 'user'; }).length,
      },
    };
    fetch(syncUrl + '/cowan-events.json', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + syncToken },
      body: JSON.stringify(payload),
    }).then(function(res) {
      if (res.ok) { syncConnected = true; syncError = null; }
      else if (res.status === 401) { syncError = 'Token falsch'; syncConnected = false; }
      else { syncError = 'Server ' + res.status; }
      renderHeader();
    }).catch(function() {
      syncError = 'Offline'; syncConnected = false;
      renderHeader();
    });
  }

  /* ── Sync: Dashboard-State vom Server lesen ── */
  function syncReadState() {
    if (!syncUrl || !syncToken) return;
    fetch(syncUrl + '/dashboard-state.json', {
      headers: { 'Authorization': 'Bearer ' + syncToken },
    }).then(function(res) {
      if (res.ok) return res.json();
      if (res.status === 404) return null;
      throw new Error('Status ' + res.status);
    }).then(function(data) {
      if (!data) return;
      syncConnected = true; syncError = null;
      /* Modul-Kontext aus Sync uebernehmen (Cross-Device) */
      if (data.module && data.module !== currentModuleId) {
        currentModuleId = data.module;
        currentModuleLabel = data.moduleLabel || MODULE_LABELS[data.module] || data.module;
      }
      /* Kapitel-Fortschritt uebernehmen wenn vorhanden */
      if (data.progress) {
        try {
          localStorage.setItem('content:currentChapter', JSON.stringify(data.progress.currentChapter || null));
          localStorage.setItem('content:chapterProgress', JSON.stringify(data.progress || null));
        } catch(e) {}
      }
      renderHeader();
    }).catch(function() {
      /* Stiller Fehler – Sync ist optional */
    });
  }

  /* ── Sync: Polling starten (alle 10s) ── */
  function startSyncPolling() {
    loadSyncSettings();
    if (!syncUrl || !syncToken) return;
    /* Sofort einmal lesen */
    syncReadState();
    /* Dann alle 10 Sekunden */
    if (syncPollTimer) clearInterval(syncPollTimer);
    syncPollTimer = setInterval(function() {
      syncReadState();
    }, 10000);
  }

  /* ── Sync: Polling stoppen ── */
  function stopSyncPolling() {
    if (syncPollTimer) { clearInterval(syncPollTimer); syncPollTimer = null; }
  }

  /* ── API-Key Validierung ── */
  function validateApiKey(key) {
    if (!key) { apiKeyStatus = 'none'; render(); return; }
    if (key.length < 10 || key.indexOf('sk-ant-') !== 0) {
      apiKeyStatus = 'invalid'; render(); return;
    }
    apiKeyStatus = 'checking'; render();
    var ctrl = new AbortController();
    var t = setTimeout(function() { ctrl.abort(); }, 15000);
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 10, messages: [{ role: 'user', content: 'Hi' }] }),
      signal: ctrl.signal,
    }).then(function(res) {
      clearTimeout(t);
      if (res.ok) { apiKeyStatus = 'valid'; saveApiKey(key); }
      else if (res.status === 401) { apiKeyStatus = 'invalid'; }
      else { apiKeyStatus = 'uncertain'; saveApiKey(key); }
      render();
    }).catch(function() {
      clearTimeout(t);
      apiKeyStatus = 'uncertain'; saveApiKey(key);
      render();
    });
  }

  /* ── Nachricht senden ── */
  function sendMessage() {
    var inputEl = $('#cw-input');
    var text = inputEl ? inputEl.value.trim() : '';
    if ((!text && !pendingImage) || isLoading || !apiKey) return;
    if (inputEl) inputEl.value = '';

    var imgForSend = pendingImage;
    pendingImage = null;

    /* API content aufbauen */
    var apiContent;
    if (imgForSend) {
      apiContent = [
        { type: 'image', source: { type: 'base64', media_type: imgForSend.mimeType, data: imgForSend.base64 } },
        { type: 'text', text: text || 'Was siehst du auf diesem Bild? Beantworte auf Deutsch.' },
      ];
    } else {
      apiContent = text;
    }

    messages.push({ role: 'user', content: text || '(Bild gesendet)', sourceIds: [], imageData: imgForSend });
    isLoading = true;
    render();

    /* API-Messages bauen */
    var apiMessages = messages.filter(function(m) { return !m.isWelcome; }).map(function(m, idx, arr) {
      if (idx === arr.length - 1) return { role: m.role, content: apiContent };
      if (m.imageData) return { role: m.role, content: (m.content || '') + ' [Bild wurde gesendet]' };
      return { role: m.role, content: m.content };
    });
    var trimmed = trimHistory(apiMessages);

    /* Kapitel-Kontext */
    var chapterCtx = null;
    try {
      var ch = JSON.parse(localStorage.getItem('content:currentChapter') || 'null');
      var pr = JSON.parse(localStorage.getItem('content:chapterProgress') || 'null');
      if (ch && pr) chapterCtx = { chapter: ch, progress: pr };
    } catch(e) {}

    var ctrl = new AbortController();
    var timeout = setTimeout(function() { ctrl.abort(); }, imgForSend ? 30000 : 15000);

    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: selectedModel,
        max_tokens: 2048,
        system: buildSystemPrompt(chapterCtx),
        messages: trimmed,
      }),
      signal: ctrl.signal,
    }).then(function(res) {
      clearTimeout(timeout);
      if (!res.ok) {
        return res.json().catch(function() { return {}; }).then(function() {
          var s = res.status;
          var err = s === 401 ? 'API-Key ungueltig.' : s === 429 ? 'Zu viele Anfragen – kurz warten.' : s >= 500 ? 'Claude-Server nicht erreichbar.' : 'Fehler (' + s + ')';
          messages.push({ role: 'assistant', content: err, isError: true, sourceIds: [] });
          isLoading = false; render(); saveHistory();
        });
      }
      return res.json().then(function(data) {
        var answerText = (data.content && data.content[0] && data.content[0].text) || '';
        var inp = (data.usage && data.usage.input_tokens) || 0;
        var out = (data.usage && data.usage.output_tokens) || 0;
        var pricing = PRICING[selectedModel];
        totalTokens.input += inp;
        totalTokens.output += out;
        totalCost += inp * pricing.input + out * pricing.output;

        var parsed = parseSourcesFromResponse(answerText);
        typingWords = parsed.cleanText.split(' ');
        typingSources = parsed.sourceIds;
        typingIndex = 0;
        isTyping = true;
        isLoading = false;

        messages.push({ role: 'assistant', content: typingWords[0] || '', sourceIds: [], isTyping: true });
        render();
        startTyping();

        /* Sync: Frage-Event an Server melden */
        syncWriteEvent({ type: 'question', module: currentModuleId, sources: parsed.sourceIds });
      });
    }).catch(function(err) {
      clearTimeout(timeout);
      var msg = (err && err.name === 'AbortError') ? 'Zeitueberschreitung – bitte erneut versuchen.' : 'Keine Internetverbindung.';
      messages.push({ role: 'assistant', content: msg, isError: true, sourceIds: [] });
      isLoading = false; render(); saveHistory();
    });
  }

  /* ── Typing-Animation ── */
  function startTyping() {
    if (typingTimer) clearInterval(typingTimer);
    typingTimer = setInterval(function() {
      typingIndex++;
      if (typingIndex >= typingWords.length) {
        clearInterval(typingTimer);
        typingTimer = null;
        isTyping = false;
        var last = messages[messages.length - 1];
        if (last) {
          last.content = typingWords.join(' ');
          last.sourceIds = typingSources;
          last.isTyping = false;
        }
        saveHistory();
        render();
        return;
      }
      var last = messages[messages.length - 1];
      if (last) last.content = typingWords.slice(0, typingIndex + 1).join(' ');
      renderMessages();
      scrollChat();
    }, 30);
  }

  /* ── Bild-Upload ── */
  function handleImageSelect(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { alert('Bild zu gross (max. 5 MB)'); return; }
    if (file.type.indexOf('image/') !== 0) { alert('Nur Bilddateien erlaubt'); return; }
    var reader = new FileReader();
    reader.onload = function(ev) {
      var dataUrl = ev.target.result;
      var base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      pendingImage = { base64: base64, mimeType: file.type || 'image/jpeg', fileName: file.name };
      render();
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  /* ── Reset ── */
  function resetConversation() {
    if (typingTimer) clearInterval(typingTimer);
    isTyping = false; isLoading = false;
    typingWords = []; typingSources = []; typingIndex = 0;
    messages = [Object.assign({}, WELCOME_MSG)];
    totalTokens = { input: 0, output: 0 };
    totalCost = 0;
    pendingImage = null;
    saveHistory();
    render();
  }

  /* ── Export ── */
  function exportAsText() {
    var lines = ['Cowan Chat-Export – ' + new Date().toLocaleDateString('de-DE'), ''];
    messages.filter(function(m) { return !m.isWelcome; }).forEach(function(m) {
      lines.push((m.role === 'user' ? 'Du' : 'Cowan') + ':');
      lines.push(m.content);
      if (m.sourceIds && m.sourceIds.length) {
        var names = m.sourceIds.map(function(id) {
          var c = chunks.find(function(ch) { return ch.id === id; });
          return c ? c.title : id;
        });
        lines.push('Quellen: ' + names.join(', '));
      }
      lines.push('');
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'cowan-chat-' + new Date().toISOString().slice(0, 10) + '.txt';
    a.click();
  }

  /* ── Scrolling ── */
  function scrollChat() {
    var container = $('#cw-messages');
    if (container) container.scrollTop = container.scrollHeight;
  }

  /* ── Render ── */
  function render() {
    var panel = $('#cw-panel');
    if (!panel) return;

    panel.style.display = isOpen ? 'flex' : 'none';

    /* FAB Button – im Companion-Mode kein FAB (Vollbild) */
    var fab = $('#cw-fab');
    if (fab) fab.style.display = (isOpen || isCompanionMode) ? 'none' : 'flex';

    if (!isOpen) return;

    renderHeader();

    /* View-basiertes Rendering */
    var homeEl = $('#cw-home');
    var msgsEl = $('#cw-messages');
    var inputEl = $('#cw-input-area');
    var qrEl = $('#cw-qr-overlay');
    var chunkEl = $('#cw-chunk-overlay');

    if (currentView === 'home') {
      if (homeEl) homeEl.style.display = 'flex';
      if (msgsEl) msgsEl.style.display = 'none';
      if (inputEl) inputEl.style.display = 'block';
      if (qrEl) qrEl.style.display = 'none';
      if (chunkEl) chunkEl.style.display = 'none';
      renderHome();
      renderInput();
    } else if (currentView === 'chat') {
      if (homeEl) homeEl.style.display = 'none';
      if (msgsEl) msgsEl.style.display = 'flex';
      if (inputEl) inputEl.style.display = 'block';
      if (qrEl) qrEl.style.display = 'none';
      renderMessages();
      renderInput();
      renderChunkBrowser();
      scrollChat();
    } else if (currentView === 'qr') {
      if (homeEl) homeEl.style.display = 'none';
      if (msgsEl) msgsEl.style.display = 'none';
      if (inputEl) inputEl.style.display = 'none';
      if (qrEl) qrEl.style.display = 'flex';
      if (chunkEl) chunkEl.style.display = 'none';
      renderQR();
    }
  }

  function renderHeader() {
    var header = $('#cw-header');
    if (!header) return;
    var modelLabel = PRICING[selectedModel] ? PRICING[selectedModel].label : selectedModel;
    var costStr = totalCost > 0 ? ' · $' + formatCost(totalCost) : '';
    var msgCount = messages.filter(function(m) { return !m.isWelcome; }).length;

    /* Modul-Kontext aktualisieren */
    updateModuleContext();

    /* Sync-Status-Punkt: gruen = verbunden, grau = nicht verbunden, rot = Fehler */
    var syncDot = '';
    if (syncUrl) {
      var dotColor = syncError ? '#ef4444' : (syncConnected ? '#22c55e' : '#666');
      var dotTitle = syncError || (syncConnected ? 'Sync verbunden' : 'Sync getrennt');
      syncDot = '<span class="cw-sync-dot" style="background:' + dotColor + '" title="' + dotTitle + '"></span>';
    }

    /* Sub-Zeile: Modell + Chunks + optional Modul-Kontext */
    var subText = modelLabel + ' · ' + chunks.length + ' Chunks' + costStr;
    if (isCompanionMode) {
      subText = 'Companion' + (currentModuleLabel ? ' · ' + currentModuleLabel : '') + ' · ' + modelLabel + costStr;
    } else if (currentModuleLabel) {
      subText = currentModuleLabel + ' · ' + subText;
    }

    /* Titel mit Sync-Dot */
    var titleText = isCompanionMode ? 'Cowan · Verbunden' : 'Cowan';

    header.innerHTML = '';
    header.appendChild(el('div', { className: 'cw-header-left' }, [
      /* Zurueck-Button im Chat/QR-View (nicht im Home, nicht im Companion) */
      (currentView !== 'home' && !isCompanionMode) ?
        el('button', { className: 'cw-btn-icon cw-btn-back', title: 'Zurueck', onClick: function() { showChunkBrowser = false; currentView = 'home'; render(); }, html: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>' }) :
        el('div', { className: 'cw-header-icon', html: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>' }),
      el('div', { className: 'cw-header-info' }, [
        el('span', { className: 'cw-header-title', html: titleText + syncDot }),
        el('span', { className: 'cw-header-sub' }, subText),
      ]),
    ]));

    /* Header-Buttons: Im Companion-Mode reduziert */
    var rightButtons = [];
    if (!isCompanionMode && currentView === 'chat') {
      rightButtons.push(el('button', { className: 'cw-btn-icon', title: 'Wissen durchstoebern', html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>', onClick: function() { showChunkBrowser = !showChunkBrowser; render(); } }));
    }
    if (currentView === 'chat') {
      rightButtons.push(el('button', { className: 'cw-btn-icon', title: 'Export', html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>', onClick: exportAsText }));
      rightButtons.push(el('button', { className: 'cw-btn-icon', title: 'Neu starten', html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>', onClick: function() { if (msgCount > 0 || confirm('Chat zuruecksetzen?')) resetConversation(); } }));
    }
    if (!isCompanionMode) {
      rightButtons.push(el('button', { className: 'cw-btn-icon cw-btn-close', title: 'Schliessen', onClick: function() { isOpen = false; render(); } }, '\u2715'));
    }
    header.appendChild(el('div', { className: 'cw-header-right' }, rightButtons));
  }

  function renderStatusLine() {
    var sub = $('.cw-header-sub');
    if (sub) {
      var modelLabel = PRICING[selectedModel] ? PRICING[selectedModel].label : selectedModel;
      var costStr = totalCost > 0 ? ' · $' + formatCost(totalCost) : '';
      sub.textContent = modelLabel + ' · ' + chunks.length + ' Chunks' + costStr;
    }
  }

  function renderMessages() {
    var container = $('#cw-messages');
    if (!container) return;
    container.innerHTML = '';

    messages.forEach(function(msg) {
      var isUser = msg.role === 'user';
      var bubble = el('div', { className: 'cw-bubble ' + (isUser ? 'cw-user' : 'cw-assistant') + (msg.isError ? ' cw-error' : '') });

      /* Bild-Vorschau bei User-Nachrichten */
      if (isUser && msg.imageData) {
        var img = el('img', { className: 'cw-msg-img', src: 'data:' + msg.imageData.mimeType + ';base64,' + msg.imageData.base64 });
        bubble.appendChild(img);
      }

      /* Nachricht */
      var contentEl = el('div', { html: renderMarkdown(msg.content) });
      bubble.appendChild(contentEl);

      /* Quellen */
      if (msg.sourceIds && msg.sourceIds.length && !msg.isTyping) {
        var srcDiv = el('div', { className: 'cw-sources' });
        srcDiv.appendChild(el('span', { className: 'cw-sources-label' }, 'Quellen:'));
        msg.sourceIds.forEach(function(id) {
          var chunk = chunks.find(function(c) { return c.id === id; });
          srcDiv.appendChild(el('span', { className: 'cw-source-tag' }, chunk ? chunk.title : id));
        });
        bubble.appendChild(srcDiv);
      }

      /* Typing-Indikator */
      if (msg.isTyping) {
        bubble.appendChild(el('span', { className: 'cw-typing-dot' }, ' ...'));
      }

      container.appendChild(bubble);
    });

    /* Loading */
    if (isLoading) {
      container.appendChild(el('div', { className: 'cw-bubble cw-assistant cw-loading' }, [
        el('span', { className: 'cw-dots', html: '<span>.</span><span>.</span><span>.</span>' }),
      ]));
    }
  }

  function renderInput() {
    var area = $('#cw-input-area');
    if (!area) return;
    area.innerHTML = '';

    /* API-Key Eingabe wenn nicht gesetzt */
    if (!apiKey || apiKeyStatus === 'none' || apiKeyStatus === 'invalid') {
      var keyInput = el('input', {
        type: 'password',
        className: 'cw-key-input',
        placeholder: 'Claude API-Key eingeben (sk-ant-...)',
      });
      var keyBtn = el('button', { className: 'cw-key-btn', onClick: function() { validateApiKey(keyInput.value.trim()); } }, 'Verbinden');
      var keyRow = el('div', { className: 'cw-key-row' }, [keyInput, keyBtn]);
      area.appendChild(keyRow);
      if (apiKeyStatus === 'invalid') {
        area.appendChild(el('div', { className: 'cw-key-error' }, 'Ungueltiger API-Key. Bitte pruefen.'));
      }
      if (apiKeyStatus === 'checking') {
        area.appendChild(el('div', { className: 'cw-key-checking' }, 'Pruefe Key...'));
      }

      /* Beispielfragen */
      var examples = el('div', { className: 'cw-examples' });
      ['Was ist OpenClaw?', 'Wie starte ich?', 'Was ist SOUL.md?'].forEach(function(q) {
        examples.appendChild(el('button', { className: 'cw-example-btn', onClick: function() {
          var inp = $('#cw-input');
          if (inp) inp.value = q;
        }}, q));
      });
      area.appendChild(examples);
      return;
    }

    /* Bild-Vorschau */
    if (pendingImage) {
      var preview = el('div', { className: 'cw-img-preview' }, [
        el('img', { src: 'data:' + pendingImage.mimeType + ';base64,' + pendingImage.base64, className: 'cw-preview-thumb' }),
        el('span', null, pendingImage.fileName),
        el('button', { className: 'cw-btn-icon cw-remove-img', onClick: function() { pendingImage = null; render(); } }, '\u2715'),
      ]);
      area.appendChild(preview);
    }

    /* Input-Row */
    var fileInput = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' }, id: 'cw-file-input', onChange: handleImageSelect });
    var imgBtn = el('button', { className: 'cw-btn-icon cw-img-btn', title: 'Bild senden', html: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>', onClick: function() { $('#cw-file-input').click(); } });
    var input = el('textarea', {
      id: 'cw-input',
      className: 'cw-input',
      placeholder: 'Frage stellen...',
      rows: '1',
    });
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    input.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });
    var sendBtn = el('button', {
      className: 'cw-send-btn',
      onClick: sendMessage,
      disabled: isLoading ? 'disabled' : null,
    }, '\u27A4');

    var row = el('div', { className: 'cw-input-row' }, [fileInput, imgBtn, input, sendBtn]);
    area.appendChild(row);

    /* Modell-Auswahl */
    var modelRow = el('div', { className: 'cw-model-row' });
    Object.keys(PRICING).forEach(function(modelId) {
      var btn = el('button', {
        className: 'cw-model-btn' + (selectedModel === modelId ? ' active' : ''),
        onClick: function() {
          selectedModel = modelId;
          try { localStorage.setItem('shell:cowanModel', modelId); } catch(e) {}
          render();
        },
      }, PRICING[modelId].label);
      modelRow.appendChild(btn);
    });
    area.appendChild(modelRow);
  }

  /* ── Home-Screen: 4 Kacheln (Verbunden, Wissen, Handy, Frage stellen) ── */
  function renderHome() {
    var home = $('#cw-home');
    if (!home) return;
    home.innerHTML = '';

    var hasKey = apiKey && (apiKeyStatus === 'valid' || apiKeyStatus === 'uncertain');
    var hasSync = !!(syncUrl && syncToken);
    var chunkCount = chunks.length;

    /* Titel */
    home.appendChild(el('div', { className: 'cw-home-title' }, 'Dein Buch-Begleiter'));

    /* 2x2 Grid */
    var grid = el('div', { className: 'cw-home-grid' });

    /* ── Kachel 1: API-Key (mit Inline-Eingabe) ── */
    var keyTile = el('div', { className: 'cw-tile' + (hasKey ? ' cw-tile-active' : '') });
    /* Icon: Schloss (offen wenn Key da, zu wenn nicht) */
    var lockIcon = hasKey
      ? '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'
      : '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>';
    keyTile.appendChild(el('div', { className: 'cw-tile-icon' + (hasKey ? ' cw-tile-icon-ok' : ''), html: lockIcon }));
    keyTile.appendChild(el('div', { className: 'cw-tile-label' + (hasKey ? ' cw-tile-label-ok' : '') }, hasKey ? 'Verbunden' : 'API-Key'));

    if (hasKey) {
      /* Verbunden-State: "Key aendern" Link + Modell-Dropdown (gestapelt) */
      keyTile.appendChild(el('div', {
        className: 'cw-tile-link',
        onClick: function(e) {
          e.stopPropagation();
          apiKey = ''; apiKeyStatus = 'none';
          try { localStorage.removeItem('shell:apiKey'); } catch(ex) {}
          render();
        },
      }, 'Key aendern'));
      var modelSelect = el('select', { className: 'cw-tile-select', onClick: function(e) { e.stopPropagation(); }, onChange: function(e) {
        selectedModel = e.target.value;
        try { localStorage.setItem('shell:cowanModel', selectedModel); } catch(ex) {}
        render();
      }});
      Object.keys(PRICING).forEach(function(mid) {
        var opt = el('option', { value: mid }, PRICING[mid].label);
        if (mid === selectedModel) opt.selected = true;
        modelSelect.appendChild(opt);
      });
      keyTile.appendChild(modelSelect);
    } else {
      /* Eingabe-State: Input + OK-Button direkt in der Kachel */
      var keyRow = el('div', { className: 'cw-tile-key-row' });
      var keyInput = el('input', {
        type: 'password',
        className: 'cw-tile-key-input',
        placeholder: 'sk-ant-...',
      });
      keyInput.addEventListener('click', function(e) { e.stopPropagation(); });
      keyInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); validateApiKey(keyInput.value.trim()); }
      });
      var keyBtn = el('button', {
        className: 'cw-tile-key-btn',
        onClick: function(e) { e.stopPropagation(); validateApiKey(keyInput.value.trim()); },
      }, 'OK');
      keyRow.appendChild(keyInput);
      keyRow.appendChild(keyBtn);
      keyTile.appendChild(keyRow);

      /* Status-Text */
      if (apiKeyStatus === 'checking') {
        keyTile.appendChild(el('div', { className: 'cw-tile-sub cw-tile-sub-checking' }, 'Pruefe...'));
      } else if (apiKeyStatus === 'invalid') {
        keyTile.appendChild(el('div', { className: 'cw-tile-sub cw-tile-sub-error' }, 'Key ungueltig'));
      } else {
        keyTile.appendChild(el('div', { className: 'cw-tile-sub' }, 'Bleibt lokal'));
      }
      /* Modell-Dropdown */
      var modelSelect2 = el('select', { className: 'cw-tile-select', onClick: function(e) { e.stopPropagation(); }, onChange: function(e) {
        selectedModel = e.target.value;
        try { localStorage.setItem('shell:cowanModel', selectedModel); } catch(ex) {}
      }});
      Object.keys(PRICING).forEach(function(mid) {
        var opt = el('option', { value: mid }, PRICING[mid].label);
        if (mid === selectedModel) opt.selected = true;
        modelSelect2.appendChild(opt);
      });
      keyTile.appendChild(modelSelect2);
    }
    grid.appendChild(keyTile);

    /* ── Kachel 2: Wissen / Chunks ── */
    var wissOk = chunkCount > 0;
    var wissIcon = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="' + (wissOk ? '#22c55e' : '#888') + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"></rect><line x1="8" y1="6" x2="16" y2="6"></line><line x1="8" y1="10" x2="16" y2="10"></line><line x1="8" y1="14" x2="12" y2="14"></line></svg>';
    grid.appendChild(el('div', {
      className: 'cw-tile' + (wissOk ? ' cw-tile-active' : ''),
      onClick: function() { if (chunkCount > 0) { currentView = 'chat'; showChunkBrowser = true; render(); } },
    }, [
      el('div', { className: 'cw-tile-icon' + (wissOk ? ' cw-tile-icon-ok' : ''), html: wissIcon }),
      el('div', { className: 'cw-tile-label' + (wissOk ? ' cw-tile-label-ok' : '') }, 'Wissen'),
      el('div', { className: 'cw-tile-sub' }, chunkCount > 0 ? chunkCount + ' Chunks' : 'Laden...'),
    ]));

    /* ── Kachel 3: Handy / QR-Code ── */
    var handyReady = hasKey && hasSync;
    var handyIcon = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="' + (handyReady ? '#f59e0b' : '#888') + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>';
    var handySub = handyReady ? 'QR-Code scannen' : (!hasKey ? 'Erst API-Key' : 'Sync noetig');
    grid.appendChild(el('div', {
      className: 'cw-tile' + (handyReady ? '' : ' cw-tile-disabled'),
      onClick: function() {
        if (!hasKey) return;
        if (!hasSync) { alert('Bitte zuerst Sync in Meine Daten einrichten (Tailscale-IP + Sync-Token).'); return; }
        currentView = 'qr'; render();
      },
    }, [
      el('div', { className: 'cw-tile-icon', html: handyIcon }),
      el('div', { className: 'cw-tile-label' }, 'Handy'),
      el('div', { className: 'cw-tile-sub' }, handySub),
    ]));

    /* ── Kachel 4: Frage stellen ── */
    var frageReady = hasKey && chunkCount > 0;
    var frageIcon = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="' + (frageReady ? '#22c55e' : '#888') + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
    grid.appendChild(el('div', {
      className: 'cw-tile' + (frageReady ? ' cw-tile-active' : ' cw-tile-disabled'),
      onClick: function() { if (frageReady) { currentView = 'chat'; render(); } },
    }, [
      el('div', { className: 'cw-tile-icon' + (frageReady ? ' cw-tile-icon-ok' : ''), html: frageIcon }),
      el('div', { className: 'cw-tile-label' + (frageReady ? ' cw-tile-label-ok' : '') }, 'Frage stellen'),
      el('div', { className: 'cw-tile-sub' }, frageReady ? 'Bereit' : 'Erst API-Key'),
    ]));

    home.appendChild(grid);

    /* ── Footer-Link: Key erstellen ── */
    if (!hasKey) {
      var footer = el('div', { className: 'cw-home-footer' });
      var link = el('a', {
        href: 'https://console.anthropic.com/settings/keys',
        target: '_blank',
        rel: 'noopener',
        className: 'cw-home-link',
      }, 'Key erstellen bei Anthropic');
      footer.appendChild(link);
      footer.appendChild(document.createTextNode(' \u2013 bleibt lokal gespeichert'));
      home.appendChild(footer);
    }
  }

  /* ── QR-Code Overlay: Handy verbinden ── */
  function renderQR() {
    var overlay = $('#cw-qr-overlay');
    if (!overlay) return;
    overlay.innerHTML = '';

    /* QR-URL zusammenbauen */
    var encodedKey = '';
    try { encodedKey = btoa(apiKey); } catch(e) {}

    var qrUrl = 'https://openclaw-buch.de/?cowan=open&companion=true';
    if (encodedKey) qrUrl += '&apikey=' + encodeURIComponent(encodedKey);
    if (syncUrl) {
      /* syncUrl ist z.B. "http://100.99.167.112:3456" – wir brauchen nur ip:port */
      var syncPart = syncUrl.replace(/^https?:\/\//, '');
      qrUrl += '&sync=' + encodeURIComponent(syncPart);
    }
    if (syncToken) qrUrl += '&synctoken=' + encodeURIComponent(syncToken);

    /* QR-Code generieren */
    var qrSvg = '';
    if (window.QR && window.QR.toSVG) {
      qrSvg = window.QR.toSVG(qrUrl, { size: 240, margin: 2, fgColor: '#1e293b', bgColor: '#ffffff' });
    } else {
      qrSvg = '<div style="padding:40px;text-align:center;color:#888">QR-Generator nicht geladen.<br>Lade qr.js vor cowan.js.</div>';
    }

    var card = el('div', { className: 'cw-qr-card' }, [
      /* Header */
      el('div', { className: 'cw-qr-header' }, [
        el('span', { className: 'cw-qr-title', html: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:6px"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>Handy verbinden' }),
        el('button', { className: 'cw-btn-icon cw-btn-close', onClick: function() { currentView = 'home'; render(); } }, '\u2715'),
      ]),
      /* QR-Code */
      el('div', { className: 'cw-qr-image', html: qrSvg }),
      /* Anleitung */
      el('div', { className: 'cw-qr-instruction' }, [
        el('strong', null, 'Scanne mit deinem Handy'),
        el('p', null, 'Kamera-App oeffnen, QR-Code scannen \u2013 Cowan startet im Companion-Modus.'),
      ]),
      /* Sync-Status */
      el('div', { className: 'cw-qr-status' }, syncConnected ? 'Sync aktiv \u2013 nach dem Scannen verbindet sich der Companion automatisch.' : 'Sync wird verbunden...'),
    ]);

    overlay.appendChild(card);
  }

  function renderChunkBrowser() {
    var overlay = $('#cw-chunk-overlay');
    if (!overlay) return;
    if (!showChunkBrowser || !chunks.length) { overlay.style.display = 'none'; return; }
    overlay.style.display = 'flex';
    overlay.innerHTML = '';

    var chunk = chunks[chunkBrowserIndex];
    var card = el('div', { className: 'cw-chunk-card' }, [
      el('div', { className: 'cw-chunk-header' }, [
        el('span', { className: 'cw-chunk-badge' }, chunk.category),
        el('span', { className: 'cw-chunk-counter' }, (chunkBrowserIndex + 1) + ' / ' + chunks.length),
        el('button', { className: 'cw-btn-icon cw-btn-close', onClick: function() { showChunkBrowser = false; render(); } }, '\u2715'),
      ]),
      el('h3', { className: 'cw-chunk-title' }, chunk.title),
      el('p', { className: 'cw-chunk-summary' }, chunk.summary),
      el('div', { className: 'cw-chunk-content', html: renderMarkdown(chunk.content) }),
      el('div', { className: 'cw-chunk-footer' }, [
        el('button', {
          className: 'cw-chunk-nav',
          onClick: function() { if (chunkBrowserIndex > 0) { chunkBrowserIndex--; renderChunkBrowser(); } },
          disabled: chunkBrowserIndex === 0 ? 'disabled' : null,
          html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>',
        }),
        el('div', { className: 'cw-chunk-progress' }, [
          el('div', { className: 'cw-chunk-progress-bar', style: { width: Math.round(((chunkBrowserIndex + 1) / chunks.length) * 100) + '%' } }),
        ]),
        el('button', {
          className: 'cw-chunk-nav',
          onClick: function() {
            if (chunkBrowserIndex < chunks.length - 1) { chunkBrowserIndex++; renderChunkBrowser(); }
            else { showChunkBrowser = false; render(); }
          },
          html: chunkBrowserIndex < chunks.length - 1 ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>' : '\u2715',
        }),
      ]),
    ]);
    overlay.appendChild(card);
  }

  /* ── Widget ins DOM einbauen ── */
  function mount() {
    /* Companion-Mode Erkennung (URL-Parameter) */
    try {
      var urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('companion') === 'true') {
        isCompanionMode = true;
        companionParams = {
          sync: urlParams.get('sync') || '',
          synctoken: urlParams.get('synctoken') || '',
          apikey: urlParams.get('apikey') || '',
        };
        /* API-Key aus QR-Code (base64) uebernehmen */
        if (companionParams.apikey) {
          try {
            var decoded = atob(decodeURIComponent(companionParams.apikey));
            if (decoded && decoded.indexOf('sk-ant-') === 0) {
              apiKey = decoded;
              apiKeyStatus = 'valid';
              try { localStorage.setItem('shell:apiKey', decoded); } catch(ex) {}
            }
          } catch(e) { /* base64 decode fehlgeschlagen */ }
        }
        /* Sync-Daten aus URL uebernehmen */
        if (companionParams.sync) {
          var sp = decodeURIComponent(companionParams.sync);
          syncUrl = 'http://' + sp;
          /* Falls Port fehlt, Standard 3456 */
          if (sp.indexOf(':') === -1) syncUrl += ':3456';
        }
        if (companionParams.synctoken) {
          syncToken = decodeURIComponent(companionParams.synctoken);
        }
        /* Companion: direkt Chat, kein Home-Screen */
        currentView = 'chat';
        isOpen = true;
      }
    } catch(e) {}

    /* CSS */
    var style = document.createElement('style');
    style.textContent = getCss();
    document.head.appendChild(style);

    /* FAB (Floating Action Button) – nicht im Companion-Mode */
    if (!isCompanionMode) {
      var fab = el('button', { id: 'cw-fab', className: 'cw-fab', title: 'Cowan oeffnen', onClick: function() { isOpen = true; render(); setTimeout(scrollChat, 100); } });
      fab.innerHTML = '<img src="' + (document.querySelector('script[src*="cowan"]') ? document.querySelector('script[src*="cowan"]').src.replace('cowan.js','') : 'shared/') + 'hummer.svg" alt="Cowan" width="38" height="38" style="pointer-events:none">';
      document.body.appendChild(fab);
    }

    /* Panel – mit Home-Screen und QR-Overlay */
    var panelClass = 'cw-panel' + (isCompanionMode ? ' cw-companion' : '');
    var panel = el('div', { id: 'cw-panel', className: panelClass, style: { display: 'none' } }, [
      el('div', { id: 'cw-header', className: 'cw-header' }),
      el('div', { id: 'cw-home', className: 'cw-home', style: { display: 'none' } }),
      el('div', { id: 'cw-messages', className: 'cw-messages' }),
      el('div', { id: 'cw-qr-overlay', className: 'cw-qr-overlay', style: { display: 'none' } }),
      el('div', { id: 'cw-chunk-overlay', className: 'cw-chunk-overlay', style: { display: 'none' } }),
      el('div', { id: 'cw-input-area', className: 'cw-input-area' }),
    ]);
    document.body.appendChild(panel);

    loadState();
    loadChunks();
    updateModuleContext();

    /* Sync: Im Companion-Mode ggf. aus URL-Params starten, sonst aus localStorage */
    if (isCompanionMode && syncUrl && syncToken) {
      /* Sync-Settings schon aus URL gesetzt, Polling direkt starten */
      startSyncPolling();
      /* Connected-Event an Server senden */
      syncWriteEvent({ type: 'companion-connected', details: 'Companion verbunden' });
    } else {
      startSyncPolling();
    }

    /* ?cowan=open URL-Parameter: Widget sofort oeffnen (fuer QR-Code AA-COWAN) */
    if (!isCompanionMode) {
      try {
        var urlP = new URLSearchParams(window.location.search);
        if (urlP.get('cowan') === 'open') {
          isOpen = true;
        }
      } catch(e) {}
    }

    render();
  }

  /* ── CSS ── */
  function getCss() {
    return [
      /* FAB – OpenClaw Hummer mit Glow */
      '.cw-fab { position:fixed; bottom:24px; right:24px; width:70px; height:70px; border-radius:50%; background:var(--bg-card,#0f172a); border:2.5px solid rgba(245,158,11,0.25); cursor:pointer; display:flex; align-items:center; justify-content:center; z-index:9999; transition:transform .2s; animation:cw-glow 3.5s ease-in-out infinite; }',
      '.cw-fab:hover { transform:scale(1.1); }',
      '@keyframes cw-glow { 0%,100% { border-color:rgba(245,158,11,0.25); box-shadow:0 0 8px rgba(245,158,11,0.08),0 0 20px rgba(245,158,11,0.04); } 50% { border-color:rgba(245,158,11,0.9); box-shadow:0 0 24px rgba(245,158,11,0.6),0 0 48px rgba(245,158,11,0.3),0 0 72px rgba(245,158,11,0.1); } }',

      /* Glassmorphism Animations */
      '@keyframes cwFadeInUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }',

      /* Panel */
      '.cw-panel { position:fixed; bottom:24px; right:24px; width:400px; max-width:calc(100vw - 32px); height:600px; max-height:calc(100vh - 48px); background:rgba(15,23,42,0.82); backdrop-filter:blur(24px) saturate(180%); -webkit-backdrop-filter:blur(24px) saturate(180%); border:1px solid rgba(245,158,11,0.2); border-radius:18px; display:flex; flex-direction:column; overflow:hidden; z-index:9999; box-shadow:0 12px 48px rgba(0,0,0,0.5),inset 0 1px 0 rgba(255,255,255,0.05); font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif; }',

      /* Header – Glass */
      '.cw-header { display:flex; align-items:center; justify-content:space-between; padding:12px 14px; border-bottom:1px solid rgba(148,163,184,0.12); background:rgba(15,23,42,0.6); backdrop-filter:blur(20px) saturate(180%); -webkit-backdrop-filter:blur(20px) saturate(180%); flex-shrink:0; }',
      '.cw-header-left { display:flex; align-items:center; gap:10px; }',
      '.cw-header-icon { font-size:22px; filter:drop-shadow(0 2px 4px rgba(217,119,6,0.3)); }',
      '.cw-header-info { display:flex; flex-direction:column; }',
      '.cw-header-title { font-weight:700; color:#f1f5f9; font-size:15px; letter-spacing:-0.3px; }',
      '.cw-header-sub { font-size:11px; color:#94a3b8; }',
      '.cw-header-right { display:flex; gap:4px; }',
      '.cw-btn-icon { background:none; border:none; color:#94a3b8; cursor:pointer; font-size:16px; padding:6px 8px; border-radius:10px; transition:background .2s,color .2s; }',
      '.cw-btn-icon:hover { background:rgba(245,158,11,0.12); color:#f59e0b; }',
      '.cw-btn-close { font-size:14px; }',
      '.cw-sync-dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-left:6px; vertical-align:middle; }',
      '.cw-sync-dot[style*=\"#22c55e\"] { box-shadow:0 0 6px rgba(34,197,94,0.5); }',

      /* Messages */
      '.cw-messages { flex:1; overflow-y:auto; padding:14px; display:flex; flex-direction:column; gap:12px; }',
      '.cw-messages::-webkit-scrollbar { width:4px; }',
      '.cw-messages::-webkit-scrollbar-thumb { background:rgba(245,158,11,0.3); border-radius:2px; }',

      /* Bubbles – Glass */
      '.cw-bubble { max-width:85%; padding:12px 16px; border-radius:18px; font-size:14px; line-height:1.6; word-break:break-word; animation:cwFadeInUp 0.25s cubic-bezier(0.4,0,0.2,1); }',
      '.cw-user { align-self:flex-end; background:rgba(217,119,6,0.12); color:#f1f5f9; border:1px solid rgba(217,119,6,0.2); border-bottom-right-radius:4px; backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px); box-shadow:0 1px 4px rgba(0,0,0,0.15); }',
      '.cw-assistant { align-self:flex-start; background:rgba(30,41,59,0.6); color:#e2e8f0; border:1px solid rgba(148,163,184,0.1); border-bottom-left-radius:4px; backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px); box-shadow:0 1px 4px rgba(0,0,0,0.2); }',
      '.cw-error { border:1px solid rgba(239,68,68,0.4); }',
      '.cw-msg-img { max-width:180px; border-radius:10px; margin-bottom:6px; display:block; }',
      '.cw-loading { display:flex; align-items:center; }',

      /* Sources */
      '.cw-sources { margin-top:8px; padding-top:6px; border-top:1px solid rgba(255,255,255,0.06); display:flex; flex-wrap:wrap; gap:4px; align-items:center; }',
      '.cw-sources-label { font-size:10px; color:#94a3b8; margin-right:4px; }',
      '.cw-source-tag { font-size:10px; background:rgba(245,158,11,0.1); color:#f59e0b; padding:2px 8px; border-radius:10px; backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); }',

      /* Typing dots */
      '.cw-typing-dot { color:#f59e0b; animation:cwBlink 1s infinite; }',
      '@keyframes cwBlink { 0%,100%{opacity:1} 50%{opacity:0.3} }',
      '.cw-dots span { animation:cwDots 1.4s infinite; font-size:24px; color:#f59e0b; }',
      '.cw-dots span:nth-child(2) { animation-delay:0.2s; }',
      '.cw-dots span:nth-child(3) { animation-delay:0.4s; }',
      '@keyframes cwDots { 0%,80%,100%{opacity:0.2} 40%{opacity:1} }',

      /* Code */
      '.cw-code { background:rgba(26,26,46,0.8); color:#86efac; padding:10px 12px; border-radius:10px; overflow-x:auto; font-size:12.5px; margin:6px 0; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; border:1px solid rgba(148,163,184,0.08); }',
      '.cw-inline-code { background:rgba(148,163,184,0.12); color:#fbbf24; padding:1px 5px; border-radius:4px; font-size:12.5px; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }',
      '.cw-link { color:#f59e0b; text-decoration:underline; }',

      /* Input Area – Glass */
      '.cw-input-area { border-top:1px solid rgba(148,163,184,0.1); padding:10px 14px; background:rgba(15,23,42,0.6); backdrop-filter:blur(20px) saturate(180%); -webkit-backdrop-filter:blur(20px) saturate(180%); flex-shrink:0; }',
      '.cw-input-row { display:flex; align-items:flex-end; gap:8px; }',
      '.cw-input { flex:1; background:rgba(30,41,59,0.55); color:#f1f5f9; border:1px solid rgba(148,163,184,0.15); border-radius:14px; padding:10px 14px; font-size:14px; font-family:inherit; resize:none; outline:none; min-height:40px; max-height:120px; line-height:1.4; transition:border-color .2s,box-shadow .2s; backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); }',
      '.cw-input:focus { border-color:rgba(217,119,6,0.5); box-shadow:0 0 0 2px rgba(217,119,6,0.1); }',
      '.cw-input::placeholder { color:#64748b; }',
      '.cw-send-btn { background:linear-gradient(135deg,#f59e0b,#d97706); color:#000; border:none; border-radius:50%; width:38px; height:38px; font-size:16px; cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0; transition:opacity .2s,transform .15s,box-shadow .2s; box-shadow:0 2px 8px rgba(217,119,6,0.3); }',
      '.cw-send-btn:hover { transform:scale(1.05); box-shadow:0 4px 12px rgba(217,119,6,0.4); }',
      '.cw-send-btn:active { transform:scale(0.95); }',
      '.cw-send-btn:disabled { opacity:0.4; cursor:not-allowed; transform:none; box-shadow:none; }',
      '.cw-img-btn { font-size:18px; flex-shrink:0; padding:8px; border-radius:12px; background:rgba(30,41,59,0.55); border:1px solid rgba(148,163,184,0.12); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); transition:background .2s,border-color .2s; cursor:pointer; color:#94a3b8; }',
      '.cw-img-btn:hover { background:rgba(217,119,6,0.1); border-color:rgba(217,119,6,0.25); color:#f59e0b; }',

      /* Image Preview */
      '.cw-img-preview { display:flex; align-items:center; gap:8px; padding:6px 8px; margin-bottom:8px; background:rgba(217,119,6,0.06); border:1px solid rgba(217,119,6,0.12); border-radius:10px; font-size:12px; color:#94a3b8; }',
      '.cw-preview-thumb { width:40px; height:40px; object-fit:cover; border-radius:8px; }',
      '.cw-remove-img { font-size:12px; margin-left:auto; }',

      /* Key Input */
      '.cw-key-row { display:flex; gap:6px; }',
      '.cw-key-input { flex:1; background:rgba(30,41,59,0.55); color:#f1f5f9; border:1px solid rgba(148,163,184,0.15); border-radius:12px; padding:10px 12px; font-size:13px; font-family:inherit; outline:none; backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); transition:border-color .2s; }',
      '.cw-key-input:focus { border-color:rgba(217,119,6,0.5); }',
      '.cw-key-btn { background:linear-gradient(135deg,#f59e0b,#d97706); color:#000; border:none; border-radius:12px; padding:10px 16px; font-weight:600; font-size:13px; cursor:pointer; flex-shrink:0; box-shadow:0 2px 8px rgba(217,119,6,0.25); transition:transform .15s; }',
      '.cw-key-btn:hover { transform:scale(1.03); }',
      '.cw-key-btn:active { transform:scale(0.97); }',
      '.cw-key-error { color:#ef4444; font-size:12px; margin-top:6px; }',
      '.cw-key-checking { color:#f59e0b; font-size:12px; margin-top:6px; }',

      /* Examples – Glass Pills */
      '.cw-examples { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; }',
      '.cw-example-btn { background:rgba(30,41,59,0.55); border:1px solid rgba(148,163,184,0.12); color:#cbd5e1; border-radius:14px; padding:6px 14px; font-size:12px; cursor:pointer; transition:all .2s cubic-bezier(0.4,0,0.2,1); font-family:inherit; backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); }',
      '.cw-example-btn:hover { background:rgba(255,255,255,0.08); border-color:rgba(255,255,255,0.18); color:#f1f5f9; transform:translateY(-1px); }',
      '.cw-example-btn:active { transform:scale(0.97); }',

      /* Model Selection */
      '.cw-model-row { display:flex; gap:4px; margin-top:8px; }',
      '.cw-model-btn { background:none; border:1px solid #334155; color:#888; border-radius:8px; padding:3px 10px; font-size:11px; cursor:pointer; font-family:inherit; transition:all .15s; }',
      '.cw-model-btn.active { border-color:var(--amber,#f59e0b); color:var(--amber,#f59e0b); background:rgba(245,158,11,0.08); }',
      '.cw-model-btn:hover { border-color:rgba(245,158,11,0.4); }',

      /* Chunk Browser – Glass Modal */
      '.cw-chunk-overlay { position:absolute; inset:0; background:rgba(10,10,15,0.85); backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px); z-index:10; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:16px; }',
      '.cw-chunk-card { background:rgba(18,18,26,0.85); backdrop-filter:blur(20px) saturate(180%); -webkit-backdrop-filter:blur(20px) saturate(180%); border:1px solid rgba(148,163,184,0.1); border-radius:16px; padding:20px; max-height:100%; overflow-y:auto; width:100%; box-shadow:0 8px 32px rgba(0,0,0,0.4),inset 0 1px 0 rgba(255,255,255,0.05); animation:cwFadeInUp 0.2s cubic-bezier(0.4,0,0.2,1); }',
      '.cw-chunk-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }',
      '.cw-chunk-badge { background:rgba(217,119,6,0.12); color:#f59e0b; padding:3px 12px; border-radius:12px; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.3px; }',
      '.cw-chunk-counter { color:#94a3b8; font-size:12px; }',
      '.cw-chunk-title { color:#f1f5f9; font-size:17px; font-weight:700; margin-bottom:6px; letter-spacing:-0.3px; line-height:1.3; }',
      '.cw-chunk-summary { color:#f59e0b; font-size:13px; font-style:italic; margin-bottom:14px; }',
      '.cw-chunk-content { color:#cbd5e1; font-size:13.5px; line-height:1.7; max-height:300px; overflow-y:auto; }',
      '.cw-chunk-footer { display:flex; justify-content:space-between; align-items:center; margin-top:16px; padding-top:12px; border-top:1px solid rgba(148,163,184,0.08); }',
      '.cw-chunk-nav { background:rgba(30,41,59,0.5); border:1px solid rgba(148,163,184,0.12); color:#f1f5f9; border-radius:12px; padding:8px 18px; font-size:13px; cursor:pointer; font-family:inherit; backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); transition:all .2s cubic-bezier(0.4,0,0.2,1); }',
      '.cw-chunk-nav:disabled { opacity:0.25; cursor:not-allowed; }',
      '.cw-chunk-nav:hover:not(:disabled) { background:rgba(217,119,6,0.12); border-color:rgba(217,119,6,0.25); color:#f59e0b; transform:translateY(-1px); }',
      '.cw-chunk-nav:active:not(:disabled) { transform:scale(0.97); }',
      '.cw-chunk-progress { flex:1; height:4px; border-radius:2px; background:rgba(148,163,184,0.1); margin:0 14px; overflow:hidden; }',
      '.cw-chunk-progress-bar { height:100%; border-radius:2px; background:linear-gradient(90deg,#d97706,#f59e0b); transition:width .3s cubic-bezier(0.4,0,0.2,1); box-shadow:0 0 8px rgba(217,119,6,0.4); }',

      /* Home-Screen */
      '.cw-home { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:20px; gap:18px; overflow-y:auto; }',
      '.cw-home-title { font-size:17px; font-weight:700; color:#94a3b8; letter-spacing:-0.3px; }',
      '.cw-home-grid { display:grid; grid-template-columns:1fr 1fr; grid-auto-rows:1fr; gap:12px; width:100%; max-width:340px; }',

      /* Tiles – Glass Cards */
      '.cw-tile { background:rgba(30,41,59,0.55); backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px); border:1px solid rgba(148,163,184,0.12); border-radius:20px; padding:22px 14px; display:flex; flex-direction:column; align-items:center; gap:8px; cursor:pointer; transition:transform .2s cubic-bezier(0.4,0,0.2,1),box-shadow .3s,border-color .2s,background-color .2s; text-align:center; box-shadow:0 2px 8px rgba(0,0,0,0.2),inset 0 1px 0 rgba(255,255,255,0.05); justify-content:center; }',
      '.cw-tile:hover { transform:translateY(-2px); box-shadow:0 8px 24px rgba(0,0,0,0.3),inset 0 1px 0 rgba(255,255,255,0.08); border-color:rgba(255,255,255,0.18); }',
      '.cw-tile:active { transform:scale(0.96); }',
      '.cw-tile-active { border-color:rgba(255,255,255,0.15); }',
      '.cw-tile-active:hover { border-color:rgba(255,255,255,0.22); }',
      '.cw-tile-disabled { opacity:0.45; cursor:default; border-color:rgba(100,116,139,0.1); }',
      '.cw-tile-disabled:hover { border-color:rgba(100,116,139,0.1); background:rgba(30,41,59,0.55); transform:none; box-shadow:0 2px 8px rgba(0,0,0,0.2),inset 0 1px 0 rgba(255,255,255,0.05); }',
      '.cw-tile-icon { width:52px; height:52px; border-radius:16px; display:flex; align-items:center; justify-content:center; background:rgba(217,119,6,0.1); }',
      '.cw-tile-icon-ok { background:rgba(34,197,94,0.1); }',
      '.cw-tile-label { font-size:15px; font-weight:700; color:#f1f5f9; letter-spacing:-0.2px; }',
      '.cw-tile-label-ok { color:#22c55e; }',
      '.cw-tile-sub { font-size:12px; color:#94a3b8; }',
      '.cw-tile-select { background:rgba(15,23,42,0.6); color:#f1f5f9; border:1px solid rgba(148,163,184,0.15); border-radius:10px; padding:4px 10px; font-size:12px; font-family:inherit; cursor:pointer; margin-top:4px; }',
      '.cw-tile-link { font-size:12px; color:#94a3b8; cursor:pointer; text-decoration:underline; transition:color .15s; }',
      '.cw-tile-link:hover { color:#f59e0b; }',
      '.cw-tile-key-row { display:flex; gap:4px; width:100%; margin-top:4px; }',
      '.cw-tile-key-input { flex:1; min-width:0; background:rgba(15,23,42,0.6); color:#f1f5f9; border:1px solid rgba(148,163,184,0.15); border-radius:10px; padding:6px 8px; font-size:12px; font-family:inherit; outline:none; transition:border-color .2s; }',
      '.cw-tile-key-input:focus { border-color:rgba(217,119,6,0.5); }',
      '.cw-tile-key-input::placeholder { color:#475569; }',
      '.cw-tile-key-btn { background:linear-gradient(135deg,#f59e0b,#d97706); color:#000; border:none; border-radius:10px; padding:6px 12px; font-size:12px; font-weight:700; cursor:pointer; flex-shrink:0; box-shadow:0 2px 6px rgba(217,119,6,0.25); transition:transform .15s; }',
      '.cw-tile-key-btn:hover { transform:scale(1.05); }',
      '.cw-tile-key-btn:active { transform:scale(0.95); }',
      '.cw-tile-sub-checking { color:#f59e0b; }',
      '.cw-tile-sub-error { color:#ef4444; }',
      '.cw-home-footer { font-size:12px; color:#94a3b8; text-align:center; margin-top:8px; }',
      '.cw-home-link { color:#f59e0b; text-decoration:underline; }',
      '.cw-home-link:hover { color:#fbbf24; }',

      /* Back button */
      '.cw-btn-back { margin-right:2px; }',

      /* QR Overlay – Dark Glass */
      '.cw-qr-overlay { position:absolute; inset:0; background:rgba(10,10,15,0.85); backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px); z-index:10; display:flex; align-items:center; justify-content:center; padding:16px; top:52px; }',
      '.cw-qr-card { background:rgba(30,41,59,0.7); backdrop-filter:blur(20px) saturate(180%); -webkit-backdrop-filter:blur(20px) saturate(180%); border:1px solid rgba(148,163,184,0.12); border-radius:20px; padding:24px; max-height:100%; overflow-y:auto; width:100%; max-width:340px; text-align:center; box-shadow:0 8px 32px rgba(0,0,0,0.4),inset 0 1px 0 rgba(255,255,255,0.05); animation:cwFadeInUp 0.2s cubic-bezier(0.4,0,0.2,1); }',
      '.cw-qr-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; }',
      '.cw-qr-title { font-size:17px; font-weight:700; color:#f1f5f9; letter-spacing:-0.3px; }',
      '.cw-qr-header .cw-btn-icon { color:#94a3b8; }',
      '.cw-qr-header .cw-btn-icon:hover { color:#f59e0b; background:rgba(217,119,6,0.1); }',
      '.cw-qr-image { margin:0 auto 16px; display:flex; justify-content:center; background:#fff; border-radius:14px; padding:12px; }',
      '.cw-qr-image svg { max-width:100%; height:auto; }',
      '.cw-qr-instruction { margin-bottom:12px; }',
      '.cw-qr-instruction strong { font-size:15px; color:#f1f5f9; display:block; margin-bottom:4px; }',
      '.cw-qr-instruction p { font-size:13px; color:#94a3b8; margin:0; line-height:1.5; }',
      '.cw-qr-status { font-size:12px; color:#22c55e; background:rgba(34,197,94,0.08); border:1px solid rgba(34,197,94,0.15); border-radius:10px; padding:8px 12px; }',

      /* Companion-Mode: Vollbild auf Mobile */
      '.cw-companion { bottom:0; right:0; width:100vw; height:100vh; max-width:100vw; max-height:100vh; border-radius:0; border:none; }',
      '.cw-companion .cw-header { border-bottom-color:rgba(34,197,94,0.25); }',
      '.cw-companion .cw-header-title { color:#22c55e; }',

      /* Mobile */
      '@media (max-width:480px) {',
      '  .cw-panel { bottom:0; right:0; width:100vw; height:100vh; max-width:100vw; max-height:100vh; border-radius:0; }',
      '  .cw-fab { bottom:16px; right:16px; width:50px; height:50px; font-size:24px; }',
      '  .cw-home-grid { max-width:100%; }',
      '  .cw-tile { padding:16px 10px; }',
      '}',
    ].join('\n');
  }

  /* ── Init ── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  /* ── Public API (fuer Shell-Integration) ── */
  window.Cowan = {
    open: function() { isOpen = true; render(); setTimeout(scrollChat, 100); },
    close: function() { isOpen = false; render(); },
    toggle: function() { isOpen = !isOpen; render(); if (isOpen) setTimeout(scrollChat, 100); },
    reset: resetConversation,
    isOpen: function() { return isOpen; },
    /* Kontext von aussen setzen (z.B. Shell oder Modul) */
    setContext: function(moduleId) {
      currentModuleId = moduleId || '';
      currentModuleLabel = MODULE_LABELS[moduleId] || moduleId || '';
      renderHeader();
    },
    /* Sync-Status abfragen */
    syncStatus: function() {
      return { connected: syncConnected, error: syncError, url: syncUrl ? true : false };
    },
    /* Sync manuell neu verbinden (z.B. nach Meine-Daten-Aenderung) */
    reconnectSync: function() {
      stopSyncPolling();
      startSyncPolling();
    },
    /* View wechseln (home, chat, qr) */
    showView: function(view) {
      currentView = view || 'home';
      render();
    },
    /* Companion-Status abfragen */
    isCompanion: function() { return isCompanionMode; },
  };

})();
