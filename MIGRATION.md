# Migrations-Strategie: Dashboard v6 → Agentic Authorship Dashboard

> **Erstellt:** 27. Maerz 2026 (Session 143)
> **Zweck:** Beschreibt den kompletten Umbau-Vorgang, was bleibt, was sich aendert

---

## 1. Was existiert heute (und bleibt erhalten)

### Altes Dashboard (v6)
- **Lokaler Ordner:** `dashboard/` im Projektordner → BLEIBT UNANGETASTET
- **GitHub Repo:** `tikitackr.github.io/OpenClaw-Dashboard/` → BLEIBT LIVE
- **Technik:** React 18 + Tailwind + esbuild, eine einzige JSX-Datei (170 KB)
- **Cowan Widget:** `cowan-widget.jsx` (176 KB) als Floating-Chat
- **Cowan Standalone:** `tikitackr.github.io/Cowan/` → BLEIBT LIVE
- **Build-Output:** `index.html` (393 KB) — alles in einer Datei

### Was am alten Dashboard wertvoll ist
| Element | Wo im alten Code | Uebernehmen? |
|---------|-----------------|-------------|
| Design (Dark Theme, Amber/Gold) | CSS in Dashboard_v6.jsx | ✅ Ja — Farbschema + Kartenstil |
| Cowan Widget (Floating Chat) | cowan-widget.jsx | ✅ Ja — Kern-Feature |
| 120 Tasks (Inhalte) | MASTERPROMPT-Konstanten | ✅ Ja — in neue Module verteilen |
| SOUL.md / AGENTS.md Vorlagen | M6 Generator-Code | ✅ Ja — wird M06 + M10 |
| API-Key-Verwaltung (BYOK) | Cowan + M6 | ✅ Ja — zentral in Shell |
| Settings / "Meine Daten" | M5 Settings-Panel | ✅ Ja — wird Teil der Shell |
| localStorage-Persistenz | window.storage | ✅ Ja — gleiches Prinzip |
| Kapitel-Kontext fuer Cowan | Dashboard_v6.jsx | ✅ Ja — aus storage lesen |

---

## 2. Neues Dashboard (Agentic Authorship Dashboard)

### Neues GitHub Repo
- **Name:** `agentic-authorship-dashboard`
- **URL:** `tikitackr.github.io/agentic-authorship-dashboard/`
- **Technik:** Vanilla HTML/CSS/JS — kein React, kein Build-Prozess

### Architektur-Entscheidung: Wie bleibt Cowan erhalten?

**Das Problem:** Im alten Dashboard ist Cowan ein Floating-Widget das IMMER sichtbar ist (schwebt ueber allem). Wenn das neue Dashboard aus 13 separaten HTML-Dateien besteht und der User von M01 nach M09 navigiert, ist das ein kompletter Seitenumbruch. Cowan wuerde verschwinden, der Chat-Verlauf waere weg.

**Die Loesung: Shell-in-Shell-Architektur**

```
┌──────────────────────────────────────────┐
│  Shell (index.html) — IMMER GELADEN      │
│  ┌─────────────────────────────────────┐ │
│  │  Navigation / Header / Status-Bar   │ │
│  ├─────────────────────────────────────┤ │
│  │                                     │ │
│  │  Content-Bereich                    │ │
│  │  (Module werden hier reingeladen)   │ │
│  │                                     │ │
│  ├─────────────────────────────────────┤ │
│  │  Cowan Floating Widget              │ │
│  │  (schwebt ueber allem, IMMER da)    │ │
│  └─────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

**So funktioniert es:**
1. Der User oeffnet `index.html` (die Shell) — nur einmal
2. Die Shell enthaelt Navigation, Status-Bar, Cowan-Widget und einen leeren Content-Bereich
3. Wenn der User auf "M09 Cost Calculator" klickt, wird `m09/index.html` per `fetch()` geladen und in den Content-Bereich eingefuegt
4. Die Shell bleibt stehen — Cowan bleibt offen, Chat-Verlauf bleibt erhalten
5. Die URL aendert sich ueber `history.pushState()` (z.B. `#m09`) — Browser-Zurueck funktioniert

**Warum nicht iframes?** iframes haben Sicherheits-Einschraenkungen mit localStorage und sind auf Mobile problematisch. `fetch()` + `innerHTML` ist sauberer.

**Warum nicht komplett separate Seiten?** Weil Cowan dann bei jeder Navigation neu laden muesste. Chat-Verlauf koennte zwar in localStorage gespeichert werden, aber die Verbindung zur Claude API wuerde jedes Mal unterbrochen.

---

## 3. Design-Migration

### Was bleibt gleich
- **Farbschema:** Dark Background (#0a0a0f), Amber/Gold (#f59e0b) als Akzentfarbe
- **Karten-Stil:** Abgerundete Ecken, subtle Borders, Hover-Glow
- **Schriftart:** System-Font-Stack (-apple-system, BlinkMacSystemFont, Segoe UI)
- **Grundprinzip:** "Cockpit, nicht Autopilot" — Informationen auf einen Blick

### Was sich aendert
- **Kein Tailwind CDN mehr** — eigenes CSS (kleiner, schneller, keine Abhaengigkeit)
- **Kein React** — Vanilla JS mit DOM-Manipulation
- **Responsive First** — iPhone-optimiert (altes Dashboard: "Bitte am PC oeffnen")
- **Modularer Aufbau** — jedes Modul ~200-400 Zeilen statt ein Monolith

### Design-Tokens (zentrale CSS-Variablen)

```css
:root {
  --bg:          #0a0a0f;
  --bg-card:     #12121a;
  --amber:       #f59e0b;
  --amber-dim:   rgba(245, 158, 11, 0.15);
  --text:        #e0e0e0;
  --text-dim:    #888;
  --border:      rgba(245, 158, 11, 0.2);
  --green:       #22c55e;
  --blue:        #3b82f6;
  --red:         #ef4444;
  --radius:      14px;
}
```

Diese Variablen stehen in der Shell und werden von allen Modulen geerbt (weil Module in die Shell geladen werden, nicht als eigene Seite).

---

## 4. Cowan-Migration

### Backend-Server auf dem VPS (BLEIBEN UNVERAENDERT)

Cowan ist nicht nur ein Frontend-Widget — dahinter laufen drei Server auf dem VPS:

| Server | Port | Funktion | Code |
|--------|------|----------|------|
| **Sync-Server** | 3456 | REST-API: Synchronisiert Daten zwischen Cowan (iPhone) und Dashboard. JSON-Dateien lesen/schreiben. | `OpenClaw-VPS/sync-server/server.js` |
| **TTS-Server** | 3457 | Edge TTS (Microsoft Neural Voices). Text → MP3. Standard-Stimme: `de-DE-KatjaNeural`. | `OpenClaw-VPS/openclaw-tts/server.js` |
| **Realtime-Server** | 3458 | SDP-Proxy fuer OpenAI Realtime API. Live-Sprache via WebRTC (`gpt-realtime-mini`). | `OpenClaw-VPS/openclaw-realtime/server.js` |

**Alle drei Server:**
- Nutzen denselben `SYNC_TOKEN` fuer Auth
- CORS erlaubt `tikitackr.github.io` (ganzer Origin, nicht pfadspezifisch)
- Laufen als systemd-Services auf dem VPS
- Erreichbar ueber Tailscale

**Warum sie beim Umbau NICHT angepasst werden muessen:**
Die CORS-Regeln matchen auf `https://tikitackr.github.io` als Origin — egal ob das Dashboard unter `/OpenClaw-Dashboard/` oder `/agentic-authorship-dashboard/` liegt. Solange das neue Dashboard auf GitHub Pages unter demselben Account laeuft, funktionieren alle drei Server sofort.

**Was sich im neuen Dashboard aendert:**
Die Server-URLs werden konfigurierbar statt hardcoded. Im Storage-Schema:
- `shell:syncUrl` — URL des Sync-Servers (Standard: Thomas' VPS)
- `shell:ttsUrl` — URL des TTS-Servers
- `shell:realtimeUrl` — URL des Realtime-Servers
- `shell:syncToken` — Auth-Token (verschluesselt in localStorage)

So kann ein Buchleser spaeter seinen eigenen VPS eintragen, wenn er die Server selbst hostet.

### Alter Zustand (Frontend-Widget)
- `cowan-widget.jsx` — 176 KB React-Komponente
- 1064 Zeilen JSX
- Floating-Button unten rechts, expandiert zu Chat-Fenster
- Claude API direkt (BYOK), Sonnet als Standard-Modell
- 36 Knowledge-Chunks fest im Code
- Screenshot-Upload (base64 → Vision API)
- Kapitel-Kontext (dynamische Beispielfragen)

### Neuer Zustand
- `shared/cowan.js` — Vanilla JS, in Shell eingebettet
- Gleiche Funktionalitaet, aber:
  - Knowledge-Chunks aus separater JSON-Datei (nicht hardcoded)
  - API-Key in Shell-Storage (`shell:apiKey`)
  - Kapitel-Kontext aus Module-Storage (`content:currentChapter`)
  - Leichtgewichtiger (kein React-Overhead)

### Migration Schritt fuer Schritt
1. Cowan-Widget als Vanilla JS neu schreiben (gleiches UI, gleiche Funktionen)
2. Knowledge-Chunks in `shared/chunks.json` auslagern
3. In Shell einbetten (schwebt ueber Content-Bereich)
4. API-Key-Flow testen (Eingabe → Validierung → Storage)
5. Chat-Verlauf in localStorage (`shell:cowanHistory`)
6. Screenshot-Upload portieren (FileReader → base64 → API)

---

## 5. Modul-Migration (M1-M6)

Fuer jedes der 6 bestehenden Module:

### Vorgang pro Modul
```
1. Altes Modul in Dashboard_v6.jsx identifizieren (JSX-Abschnitt)
2. Inhalte extrahieren (Tasks, Texte, Logik)
3. Neues Modul als HTML/CSS/JS schreiben
4. localStorage-Keys nach storage-schema.json
5. In Shell testen (fetch-Load)
6. Auf GitHub Pages deployen
7. ✅ Naechstes Modul
```

### Modul-Mapping (alt → neu)

| Alt (v6) | Neu | Aenderungen |
|----------|-----|-------------|
| Home | M01 Projektuebersicht | Gleicher Inhalt, neues Layout |
| M1 Server + M2 Agents | M02 Tasks | Zusammengefasst zu einem Task-Tracker |
| M3 Multi-Agent | M03 Sprint | Sprint-Fokus statt Pipeline-Fokus |
| M5 Buch & Code (Pipeline) | M04 Content | Kapitel-Pipeline isoliert |
| M4 Publishing | M05 Publishing | Gleicher Inhalt |
| M6 Dein Projekt | M06 Wundertuete | Generator + Konfigurator bleiben |

### Was NICHT migriert wird
- esbuild Build-System (nicht noetig bei Vanilla HTML)
- React-spezifischer State (useState, useEffect → localStorage + DOM)
- Tailwind-Klassen (eigenes CSS)
- lucide-react Icons (durch Unicode-Emojis oder SVG ersetzt)

---

## 6. Globales Link-System (links.json)

### Das Problem
URLs stehen heute hardcoded an drei Stellen:
1. **Im Buch-Markdown** (6 eigene URLs in Kap 2 + Kap 13.2)
2. **Im alten Dashboard** (fest im JSX-Code)
3. **In QR-Codes** (zeigen auf Dashboard-Module)

Bei einem Domain-Umzug (z.B. eigene Domain statt GitHub Pages) muesste man ueberall suchen und ersetzen. Das ist fehleranfaellig.

### Die Loesung: Eine Datei regiert alle
`shared/links.json` ist die **Single Source of Truth** fuer alle URLs im gesamten Projekt.

**Wie es funktioniert:**

```
links.json (EINE Datei)
    │
    ├──→ Dashboard (Shell laedt links.json beim Start)
    │    Ersetzt {{DASHBOARD_URL}}, {{COWAN_URL}} etc. im HTML
    │
    ├──→ Buch-PDF-Pipeline (kapitel-zu-pdf.py liest links.json)
    │    Ersetzt {{DASHBOARD_URL}} im Markdown VOR Konvertierung
    │
    └──→ QR-Code-Generator (liest Ziel-URLs aus links.json)
         Generiert QR-Codes mit aufgeloesten URLs
```

**Domain-Umzug:** NUR `links.json` aendern, dann:
- Dashboard neu deployen (liest neue URLs)
- PDFs neu bauen (`kapitel-zu-pdf.py` liest neue URLs)
- QR-Codes neu generieren

Kein HTML, kein Markdown, kein Code anfassen.

### Inhalt von links.json

| Sektion | Beispiel-Keys | Zweck |
|---------|--------------|-------|
| `eigene_projekte` | DASHBOARD_URL, COWAN_URL, WEBSITE_URL | Alles was bei Domain-Umzug aendert |
| `openclaw` | OPENCLAW_DOCS, CLAWHUB_URL | OpenClaw-Projekt-URLs |
| `externe_tools` | TAILSCALE_INSTALL, DOCKER_INSTALL | Drittanbieter (aendern sich selten) |
| `api_provider` | ANTHROPIC_CONSOLE, OPENAI_PLATFORM | API-Konsolen |
| `dashboard_module` | M01_URL bis M12_URL | Modul-Deep-Links (nutzen {{DASHBOARD_URL}}) |
| `qr_codes` | 22 QR-Code-Definitionen | Kapitel → Modul → Aktion |

### QR-Code-Mapping (Kapitel → Modul)

Jeder QR-Code im Buch zeigt auf ein spezifisches Dashboard-Modul mit Kontext:

| Kapitel | QR-Code ID | Ziel-Modul | Aktion |
|---------|-----------|------------|--------|
| Vorwort | ECOSYSTEM-TOUR | Shell | Oekosystem-Tour starten |
| Kap 2 | INSTALL-START | M02 Tasks | Installations-Checkliste |
| Kap 2 | VPS-SETUP | M08 Config | VPS-Entscheidungshilfe |
| Kap 2 | FIRST-START | M12 Status | Automatischer Systemcheck |
| Kap 2 | INSTALL-TROUBLE | M11 CLI | Troubleshooter |
| Kap 3 | DOCKER-COMPOSE | M08 Config | Docker-Config validieren |
| Kap 3 | DOCKER-TROUBLE | M11 CLI | Docker-Diagnose |
| Kap 4 | SOUL-EDITOR | M10 Gallery | SOUL.md interaktiv bearbeiten |
| Kap 4 | AGENTS-EDITOR | M06 Wundertuete | AGENTS.md Generator |
| Kap 5 | TELEGRAM-SETUP | M08 Config | Telegram-Config |
| Kap 5 | WHATSAPP-SETUP | M08 Config | WhatsApp-Config |
| Kap 5 | CHANNEL-CHECK | M12 Status | Kanal-Status live |
| Kap 6 | SECURITY-CHECK | M12 Status | Security-Audit |
| Kap 7 | DOCTOR | M11 CLI | openclaw doctor Referenz |
| Kap 8 | COST-CALC | M09 Calculator | Kosten kalkulieren |
| Kap 9 | WORKSPACE-WIZARD | M07 Wizard | Workspace generieren |
| Kap 10 | PIPELINE-STATUS | M04 Content | Pipeline verfolgen |
| Kap 11 | COST-OVERVIEW | M09 Calculator | Kosten-Aufschluesselung |
| Kap 12 | GALLERY-BROWSE | M10 Gallery | Templates browsen |
| Kap 13 | BLUEPRINT-START | M02 Tasks | Blueprint-Checkliste |
| Kap 13 | BLUEPRINT-DONE | M12 Status | Erfolgs-Check |
| Kap 14 | PLAN-BUILDER | M03 Sprint | Sprint planen |
| Kap 15 | PUBLISH-CHECKLIST | M05 Publishing | KDP-Checkliste |

**Das loest auch B39** (QR-Plan fuer Kap 8-15 ergaenzen) und **fuehrt B40 zusammen** (Variablen-System) in einem einheitlichen System.

---

## 7. Zeitplan

| Phase | Was | Sessions |
|-------|-----|----------|
| Phase 1 ✅ | Geruest (Ordner, Schema, Shell, Platzhalter) | 1 (S143) |
| Phase 1b | Cowan-Widget in Shell einbauen | 1 |
| Phase 2 | Migration M1-M6 (je 1 Session) | 6 |
| Phase 3 | Neue Module M7-M12 (je 1 Session) | 6 |
| Phase 4 | Feinschliff + Buch-Abgleich | 2 |
| **Gesamt** | | **~16 Sessions** |

---

## 8. Design-Regeln (PFLICHT bei jedem Modul)

### Icons: Lucide Inline-SVGs — KEINE Emojis

**ABSOLUTES VERBOT:** Keine Emoji-Zeichen (📚🔍🦞 etc.) im gesamten Dashboard verwenden.
Stattdessen: **Lucide inline SVGs** im iOS-18-Stil mit farbigen Hintergrund-Pills.

**So sieht ein Icon aus:**
```html
<div class="mXX-icon" style="background: rgba(245,158,11,0.15); color: #f59e0b;">
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" stroke-width="2"
       stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <path d="M12 16v-4"/>
    <path d="M12 8h.01"/>
  </svg>
</div>
```

**Icon-Mapping (verbindlich):**

| Modul | Icon (Lucide) | Farbe |
|-------|--------------|-------|
| M01 | target | #f59e0b (Amber) |
| M02 | check-circle | #22c55e (Gruen) |
| M03 | zap | #f59e0b (Amber) |
| M04 | book | #3b82f6 (Blau) |
| M05 | package | #a855f7 (Lila) |
| M06 | sparkles | #f59e0b (Amber) |
| M07 | wand | #f59e0b (Amber) |
| M08 | settings | #6b7280 (Grau) |
| M09 | dollar-sign | #22c55e (Gruen) |
| M10 | brain | #ec4899 (Pink) |
| M11 | terminal | #22c55e (Gruen) |
| M12 | bar-chart | #3b82f6 (Blau) |

**Innerhalb von Modulen** (z.B. Kategorie-Icons, Template-Avatare, Tab-Icons):
Gleiche Regel — immer Lucide SVGs, nie Emojis. Den passenden Lucide-Icon-Namen
aus https://lucide.dev waehlen. SVG inline einbetten (kein CDN, kein Icon-Font).

### Kein CDN, keine externen Abhaengigkeiten

Thomas oeffnet das Dashboard lokal via `file:///`. Alles muss inline oder lokal sein:
- **Kein** `<link>` oder `<script>` zu CDNs (kein Tailwind, kein Font Awesome, kein Google Fonts)
- **Kein** `fetch()` zu externen APIs (ausser Cowan → Claude API mit User-eigenem Key)
- Schriftart: System-Font-Stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`)

### CSS-Variablen aus der Shell verwenden

Module werden per `fetch()` + `innerHTML` in die Shell geladen. Dadurch erben sie
automatisch die CSS-Variablen der Shell. **Immer Shell-Variablen verwenden:**

```css
color: var(--amber);          /* NICHT: color: #f59e0b; */
background: var(--bg-card);   /* NICHT: background: #12121a; */
border-color: var(--border);  /* NICHT: border-color: rgba(245,158,11,0.2); */
```

### Module sind HTML-Fragmente, KEINE vollstaendigen Seiten

```html
<!-- RICHTIG: Fragment -->
<style>.mXX-wrapper { ... }</style>
<div class="mXX-wrapper">...</div>
<script>...</script>

<!-- FALSCH: Vollstaendige Seite -->
<!DOCTYPE html>
<html><head>...</head><body>...</body></html>
```

### CSS-Scoping mit Modul-Prefix

Alle CSS-Klassen mit `.mXX-` prefixen (z.B. `.m10-card`, `.m11-tab`).
Verhindert Kollisionen wenn die Shell mehrere Module nacheinander laedt.

---

## 9. Regeln waehrend der Migration

1. **Altes Dashboard NIEMALS aendern.** Es bleibt als Referenz und Fallback.
2. **Altes GitHub-Repo NICHT loeschen.** Optional spaeter archivieren.
3. **Jedes Modul einzeln testen** bevor das naechste begonnen wird.
4. **Design-Tokens einhalten** — alle Module nutzen die gleichen CSS-Variablen.
5. **Cowan muss in der Shell funktionieren** BEVOR Module migriert werden.
6. **Mobile-First** — jedes Modul muss auf dem iPhone funktionieren.
