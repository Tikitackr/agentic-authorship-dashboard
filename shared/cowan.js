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

    /* FAB Button */
    var fab = $('#cw-fab');
    if (fab) fab.style.display = isOpen ? 'none' : 'flex';

    if (!isOpen) return;

    renderHeader();
    renderMessages();
    renderInput();
    renderChunkBrowser();
    scrollChat();
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
    if (currentModuleLabel) subText = currentModuleLabel + ' · ' + subText;

    header.innerHTML = '';
    header.appendChild(el('div', { className: 'cw-header-left' }, [
      el('div', { className: 'cw-header-icon', html: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>' }),
      el('div', { className: 'cw-header-info' }, [
        el('span', { className: 'cw-header-title', html: 'Cowan' + syncDot }),
        el('span', { className: 'cw-header-sub' }, subText),
      ]),
    ]));
    header.appendChild(el('div', { className: 'cw-header-right' }, [
      el('button', { className: 'cw-btn-icon', title: 'Wissen durchstoebern', html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>', onClick: function() { showChunkBrowser = !showChunkBrowser; render(); } }),
      el('button', { className: 'cw-btn-icon', title: 'Export', html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>', onClick: exportAsText }),
      el('button', { className: 'cw-btn-icon', title: 'Neu starten', html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>', onClick: function() { if (msgCount > 0 || confirm('Chat zuruecksetzen?')) resetConversation(); } }),
      el('button', { className: 'cw-btn-icon cw-btn-close', title: 'Schliessen', onClick: function() { isOpen = false; render(); } }, '\u2715'),
    ]));
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
        }, '\u25C0 Zurueck'),
        el('button', {
          className: 'cw-chunk-nav',
          onClick: function() {
            if (chunkBrowserIndex < chunks.length - 1) { chunkBrowserIndex++; renderChunkBrowser(); }
            else { showChunkBrowser = false; render(); }
          },
        }, chunkBrowserIndex < chunks.length - 1 ? 'Weiter \u25B6' : 'Schliessen'),
      ]),
    ]);
    overlay.appendChild(card);
  }

  /* ── Widget ins DOM einbauen ── */
  function mount() {
    /* CSS */
    var style = document.createElement('style');
    style.textContent = getCss();
    document.head.appendChild(style);

    /* FAB (Floating Action Button) – OpenClaw Hummer mit Glow */
    var fab = el('button', { id: 'cw-fab', className: 'cw-fab', title: 'Cowan oeffnen', onClick: function() { isOpen = true; render(); setTimeout(scrollChat, 100); } });
    fab.innerHTML = '<img src="' + (document.querySelector('script[src*="cowan"]') ? document.querySelector('script[src*="cowan"]').src.replace('cowan.js','') : 'shared/') + 'hummer.svg" alt="Cowan" width="38" height="38" style="pointer-events:none">';
    document.body.appendChild(fab);

    /* Panel */
    var panel = el('div', { id: 'cw-panel', className: 'cw-panel', style: { display: 'none' } }, [
      el('div', { id: 'cw-header', className: 'cw-header' }),
      el('div', { id: 'cw-messages', className: 'cw-messages' }),
      el('div', { id: 'cw-chunk-overlay', className: 'cw-chunk-overlay', style: { display: 'none' } }),
      el('div', { id: 'cw-input-area', className: 'cw-input-area' }),
    ]);
    document.body.appendChild(panel);

    loadState();
    loadChunks();
    updateModuleContext();
    startSyncPolling();

    /* ?cowan=open URL-Parameter: Widget sofort oeffnen (fuer QR-Code AA-COWAN) */
    try {
      var urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('cowan') === 'open') {
        isOpen = true;
      }
    } catch(e) {}

    render();
  }

  /* ── CSS ── */
  function getCss() {
    return [
      /* FAB – OpenClaw Hummer mit Glow */
      '.cw-fab { position:fixed; bottom:24px; right:24px; width:70px; height:70px; border-radius:50%; background:var(--bg-card,#0f172a); border:2.5px solid var(--amber,#f59e0b); cursor:pointer; display:flex; align-items:center; justify-content:center; z-index:9999; transition:transform .2s; animation:cw-glow 3.5s ease-in-out infinite; }',
      '.cw-fab:hover { transform:scale(1.1); }',
      '@keyframes cw-glow { 0%,100% { box-shadow:0 0 8px rgba(245,158,11,0.1),0 0 20px rgba(245,158,11,0.05); } 50% { box-shadow:0 0 24px rgba(245,158,11,0.6),0 0 48px rgba(245,158,11,0.3),0 0 72px rgba(245,158,11,0.1); } }',

      /* Panel */
      '.cw-panel { position:fixed; bottom:24px; right:24px; width:400px; max-width:calc(100vw - 32px); height:600px; max-height:calc(100vh - 48px); background:#0f172a; border:1px solid rgba(245,158,11,0.25); border-radius:16px; display:flex; flex-direction:column; overflow:hidden; z-index:9999; box-shadow:0 12px 48px rgba(0,0,0,0.5); }',

      /* Header */
      '.cw-header { display:flex; align-items:center; justify-content:space-between; padding:12px 14px; border-bottom:1px solid rgba(245,158,11,0.15); background:#0f172a; flex-shrink:0; }',
      '.cw-header-left { display:flex; align-items:center; gap:10px; }',
      '.cw-header-icon { font-size:22px; }',
      '.cw-header-info { display:flex; flex-direction:column; }',
      '.cw-header-title { font-weight:700; color:#f1f5f9; font-size:15px; }',
      '.cw-header-sub { font-size:11px; color:#888; }',
      '.cw-header-right { display:flex; gap:4px; }',
      '.cw-btn-icon { background:none; border:none; color:#888; cursor:pointer; font-size:16px; padding:4px 6px; border-radius:6px; transition:background .15s,color .15s; }',
      '.cw-btn-icon:hover { background:rgba(245,158,11,0.12); color:#f59e0b; }',
      '.cw-btn-close { font-size:14px; }',
      '.cw-sync-dot { display:inline-block; width:7px; height:7px; border-radius:50%; margin-left:6px; vertical-align:middle; }',

      /* Messages */
      '.cw-messages { flex:1; overflow-y:auto; padding:14px; display:flex; flex-direction:column; gap:10px; }',
      '.cw-messages::-webkit-scrollbar { width:4px; }',
      '.cw-messages::-webkit-scrollbar-thumb { background:rgba(245,158,11,0.3); border-radius:2px; }',

      /* Bubbles */
      '.cw-bubble { max-width:88%; padding:10px 14px; border-radius:14px; font-size:14px; line-height:1.55; word-break:break-word; }',
      '.cw-user { align-self:flex-end; background:#334155; color:#f1f5f9; border-bottom-right-radius:4px; }',
      '.cw-assistant { align-self:flex-start; background:#1e293b; color:#e2e8f0; border-bottom-left-radius:4px; }',
      '.cw-error { border:1px solid rgba(239,68,68,0.4); }',
      '.cw-msg-img { max-width:180px; border-radius:8px; margin-bottom:6px; display:block; }',
      '.cw-loading { display:flex; align-items:center; }',

      /* Sources */
      '.cw-sources { margin-top:8px; padding-top:6px; border-top:1px solid rgba(255,255,255,0.08); display:flex; flex-wrap:wrap; gap:4px; align-items:center; }',
      '.cw-sources-label { font-size:10px; color:#888; margin-right:4px; }',
      '.cw-source-tag { font-size:10px; background:rgba(245,158,11,0.12); color:#f59e0b; padding:2px 8px; border-radius:10px; }',

      /* Typing dots */
      '.cw-typing-dot { color:#f59e0b; animation:cwBlink 1s infinite; }',
      '@keyframes cwBlink { 0%,100%{opacity:1} 50%{opacity:0.3} }',
      '.cw-dots span { animation:cwDots 1.4s infinite; font-size:24px; color:#f59e0b; }',
      '.cw-dots span:nth-child(2) { animation-delay:0.2s; }',
      '.cw-dots span:nth-child(3) { animation-delay:0.4s; }',
      '@keyframes cwDots { 0%,80%,100%{opacity:0.2} 40%{opacity:1} }',

      /* Code */
      '.cw-code { background:#1a1a2e; color:#86efac; padding:10px 12px; border-radius:8px; overflow-x:auto; font-size:12.5px; margin:6px 0; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }',
      '.cw-inline-code { background:rgba(148,163,184,0.15); color:#fbbf24; padding:1px 5px; border-radius:4px; font-size:12.5px; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }',
      '.cw-link { color:#f59e0b; text-decoration:underline; }',

      /* Input Area */
      '.cw-input-area { border-top:1px solid rgba(245,158,11,0.15); padding:10px 14px; background:#0f172a; flex-shrink:0; }',
      '.cw-input-row { display:flex; align-items:flex-end; gap:6px; }',
      '.cw-input { flex:1; background:#1e293b; color:#f1f5f9; border:1px solid #334155; border-radius:12px; padding:10px 12px; font-size:14px; font-family:inherit; resize:none; outline:none; min-height:40px; max-height:120px; line-height:1.4; transition:border-color .2s; }',
      '.cw-input:focus { border-color:rgba(245,158,11,0.5); }',
      '.cw-input::placeholder { color:#666; }',
      '.cw-send-btn { background:var(--amber,#f59e0b); color:#000; border:none; border-radius:50%; width:38px; height:38px; font-size:16px; cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0; transition:opacity .2s; }',
      '.cw-send-btn:disabled { opacity:0.4; cursor:not-allowed; }',
      '.cw-img-btn { font-size:18px; flex-shrink:0; }',

      /* Image Preview */
      '.cw-img-preview { display:flex; align-items:center; gap:8px; padding:6px 8px; margin-bottom:8px; background:rgba(245,158,11,0.08); border-radius:8px; font-size:12px; color:#888; }',
      '.cw-preview-thumb { width:40px; height:40px; object-fit:cover; border-radius:6px; }',
      '.cw-remove-img { font-size:12px; margin-left:auto; }',

      /* Key Input */
      '.cw-key-row { display:flex; gap:6px; }',
      '.cw-key-input { flex:1; background:#1e293b; color:#f1f5f9; border:1px solid #334155; border-radius:10px; padding:10px 12px; font-size:13px; font-family:inherit; outline:none; }',
      '.cw-key-input:focus { border-color:rgba(245,158,11,0.5); }',
      '.cw-key-btn { background:var(--amber,#f59e0b); color:#000; border:none; border-radius:10px; padding:10px 16px; font-weight:600; font-size:13px; cursor:pointer; flex-shrink:0; }',
      '.cw-key-error { color:#ef4444; font-size:12px; margin-top:6px; }',
      '.cw-key-checking { color:#f59e0b; font-size:12px; margin-top:6px; }',

      /* Examples */
      '.cw-examples { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; }',
      '.cw-example-btn { background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.2); color:#f59e0b; border-radius:20px; padding:5px 12px; font-size:12px; cursor:pointer; transition:background .15s; font-family:inherit; }',
      '.cw-example-btn:hover { background:rgba(245,158,11,0.18); }',

      /* Model Selection */
      '.cw-model-row { display:flex; gap:4px; margin-top:8px; }',
      '.cw-model-btn { background:none; border:1px solid #334155; color:#888; border-radius:8px; padding:3px 10px; font-size:11px; cursor:pointer; font-family:inherit; transition:all .15s; }',
      '.cw-model-btn.active { border-color:var(--amber,#f59e0b); color:var(--amber,#f59e0b); background:rgba(245,158,11,0.08); }',
      '.cw-model-btn:hover { border-color:rgba(245,158,11,0.4); }',

      /* Chunk Browser */
      '.cw-chunk-overlay { position:absolute; inset:0; background:rgba(10,10,15,0.95); z-index:10; display:flex; align-items:center; justify-content:center; padding:16px; }',
      '.cw-chunk-card { background:#12121a; border:1px solid rgba(245,158,11,0.2); border-radius:14px; padding:20px; max-height:100%; overflow-y:auto; width:100%; }',
      '.cw-chunk-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; }',
      '.cw-chunk-badge { background:rgba(245,158,11,0.12); color:#f59e0b; padding:2px 10px; border-radius:10px; font-size:11px; font-weight:600; text-transform:uppercase; }',
      '.cw-chunk-counter { color:#888; font-size:12px; }',
      '.cw-chunk-title { color:#f1f5f9; font-size:16px; margin-bottom:6px; }',
      '.cw-chunk-summary { color:#888; font-size:13px; margin-bottom:12px; }',
      '.cw-chunk-content { color:#cbd5e1; font-size:13px; line-height:1.6; max-height:300px; overflow-y:auto; }',
      '.cw-chunk-footer { display:flex; justify-content:space-between; margin-top:14px; }',
      '.cw-chunk-nav { background:rgba(245,158,11,0.1); border:1px solid rgba(245,158,11,0.2); color:#f59e0b; border-radius:8px; padding:6px 16px; font-size:13px; cursor:pointer; font-family:inherit; }',
      '.cw-chunk-nav:disabled { opacity:0.3; cursor:not-allowed; }',
      '.cw-chunk-nav:hover:not(:disabled) { background:rgba(245,158,11,0.2); }',

      /* Mobile */
      '@media (max-width:480px) {',
      '  .cw-panel { bottom:0; right:0; width:100vw; height:100vh; max-width:100vw; max-height:100vh; border-radius:0; }',
      '  .cw-fab { bottom:16px; right:16px; width:50px; height:50px; font-size:24px; }',
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
  };

})();
