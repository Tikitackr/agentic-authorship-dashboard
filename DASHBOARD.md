# Dashboard-Referenz – openclaw-buch.de

> **LIES MICH ZUERST** wenn du am Dashboard arbeitest. Diese Datei ist die dauerhafte Referenz.
> Der Umbau-Plan (`docs/DASHBOARD-UMBAU-PLAN.md`) ist temporal – diese Datei hier bleibt.
> **Letzte Aktualisierung:** Session 169, 31. Maerz 2026 – Buch-Integration (Leitprinzip, Hint-Boxen, Cowan frueh)

---

## Philosophie

**Der Leser tippt nichts. Er kopiert.**

Der Leser ist kein Entwickler. Er hat null Ahnung von Terminal, SSH oder Docker-Befehlen. Er liest unser Buch und will nachbauen. Das Dashboard ist sein interaktiver Begleiter:

1. Er traegt EINMAL seine Daten ein (API-Key, Server-IP etc.)
2. Das Dashboard generiert ALLE Befehle mit seinen echten Werten
3. Er kopiert per Klick und fuehrt aus – kein Tippen, kein Raten
4. Cowan (der Chat-Bot auf dem Handy) kann ihn zum richtigen Schritt fuehren

**Nicht vergessen:** Das alte React-Dashboard (https://tikitackr.github.io/OpenClaw-Dashboard/) hatte das schon – Variable-Interpolation, farbcodierte Snippets (blau=sicher, rot=sensitiv), Copy-Buttons. Beim Umbau zum neuen modularen Dashboard ging diese Bruecke verloren. Jeder Neubau eines Moduls MUSS pruefen ob personalisierter Code reingehoert.

---

## Modul-Map: Wer macht was?

### Gruppe 1: "Dein Buch" (5 Module)

| Modul | Ordner | Leser-Frage | Metapher |
|-------|--------|-------------|----------|
| **Dein Fahrplan** | `fahrplan/` | "Wo bin ich? Was kommt als naechstes?" | KARTE |
| **Meine Daten** | `meine-daten/` | "Welche Daten brauche ich?" | SCHLUESSEL |
| **Setup-Guide** | `setup-guide/` | "Gib mir den Code fuer Schritt X" | WERKZEUG |
| **Buch-Dashboard** | `buch-dashboard/` | "Ich will mein eigenes Buch planen" | WERKSTATT |
| **Publishing / KDP** | `publishing/` | "Wie lade ich auf Amazon hoch?" | ZIELLINIE |

> **Leser-Reise:** Orientieren (Fahrplan) → Einrichten (Meine Daten) → Nachbauen (Setup-Guide) → Produzieren (Buch-Dashboard) → Veroeffentlichen (Publishing)

### Gruppe 2: "OpenClaw-Werkzeuge" (8 Module)

| Modul | Ordner | Beschreibung |
|-------|--------|--------------|
| Workspace Wizard | `workspace-wizard/` | 8 Fragen → alle Workspace-Dateien generiert |
| Config Builder | `config-builder/` | openclaw.json visuell zusammenbauen |
| Cost Calculator | `cost-calculator/` | Kosten pro Provider, Heartbeat, Optimierungen |
| SOUL.md Gallery | `soul-gallery/` | 20+ Templates nach Kategorie |
| CLI-Referenz | `cli-referenz/` | 52 Commands, 4 Tabs, Code-Snippets |
| System Status | `system-status/` | 8 Widgets, Demo+Live-Modus, Budget-Meter |
| Skill Explorer | `skill-explorer/` | Skills browsen, installieren, eigene bauen |
| Template Packs | `template-packs/` | Fertige Starter-Bundles zum Runterladen |

### Entfernt / Archiviert

| Alt | Grund | Archiv |
|-----|-------|--------|
| M04 Content-Pipeline | Redundant zu Buch-Dashboard (M06). Daten hardcoded auf unser Projekt. | `_archive/m04/` |

### Datenfluss

```
M03 (Meine Daten)
 ├── → Setup-Guide: Variablen in Code-Snippets (${SERVER_IP}, ${API_KEY} etc.)
 ├── → Fahrplan: Tech-Stack Status-Badges ("API-Key eingerichtet ✓")
 └── → System Status: Verbindungsdaten fuer Live-Modus

Fahrplan (M01)
 └── → Setup-Guide: Deep-Links pro Buchkapitel (Kap 2 → Server-Setup)

Cowan (extern)
 └── → Setup-Guide: "Schau mal unter Server-Setup, Schritt 4"
```

---

## Namenskonventionen

### Komplette Umbenennungsliste

| Alt (M-Nummern) | Neuer Ordner | UI-Name (Kachel-Text) | Gruppe | Status |
|-----------------|-------------|----------------------|--------|--------|
| `m01/` | `fahrplan/` | Dein Fahrplan | Dein Buch | Neubau geplant |
| `m03/` | `meine-daten/` | Meine Daten | Dein Buch | Umbenennung |
| `m02/` | `setup-guide/` | Setup-Guide | Dein Buch | Neubau geplant |
| `m06/` | `buch-dashboard/` | Dein Buch-Dashboard | Dein Buch | Umbenennung |
| `m05/` | `publishing/` | Publishing / KDP | Dein Buch | Umbenennung |
| `m07/` | `workspace-wizard/` | Workspace Wizard | OpenClaw-Werkzeuge | Umbenennung |
| `m08/` | `config-builder/` | Config Builder | OpenClaw-Werkzeuge | Umbenennung |
| `m09/` | `cost-calculator/` | Cost Calculator | OpenClaw-Werkzeuge | Umbenennung |
| `m10/` | `soul-gallery/` | SOUL.md Gallery | OpenClaw-Werkzeuge | Umbenennung |
| `m11/` | `cli-referenz/` | CLI-Referenz | OpenClaw-Werkzeuge | Umbenennung |
| `m12/` | `system-status/` | System Status | OpenClaw-Werkzeuge | Umbenennung |
| — (NEU) | `skill-explorer/` | Skill Explorer | OpenClaw-Werkzeuge | Neu bauen |
| — (NEU) | `template-packs/` | Template Packs | OpenClaw-Werkzeuge | Neu bauen |
| `m04/` | `_archive/m04/` | — (entfernt) | — | Archivieren |

**Reihenfolge in der Shell (oben nach unten):**

Dein Buch (5 Kacheln):
1. Dein Fahrplan
2. Meine Daten
3. Setup-Guide
4. Dein Buch-Dashboard
5. Publishing / KDP

OpenClaw-Werkzeuge (8 Kacheln):
1. Workspace Wizard
2. Config Builder
3. Cost Calculator
4. SOUL.md Gallery
5. CLI-Referenz
6. System Status
7. Skill Explorer
8. Template Packs

**Regel:** In der UI erscheinen KEINE M-Nummern mehr. Nur sprechende Namen.

### localStorage Namespace

Alle Module nutzen den Prefix `aa-` (Agentic Authorship):
- `aa-settings.*` – Meine Daten (M03): API-Key, Server-IP, Tailscale-IP, Sync-Token, Name, Browser
- `aa-progress.*` – Fahrplan (M01): Kapitel-Checkboxen
- `aa-setup.*` – Setup-Guide (M02): Schritt-Checkboxen
- `aa-book.*` – Buch-Dashboard (M06): Wizard-Daten, Kapitel, Prompts
- `shell:lastModule` – Shell: letztes geoeffnetes Modul

---

## Variablen-System

Der Leser traegt seine Daten einmal in "Meine Daten" (M03) ein. Andere Module lesen diese Werte aus localStorage:

| Variable | localStorage-Key | Beispielwert | Wo gebraucht |
|----------|-----------------|--------------|--------------|
| Server-IP | `aa-settings.serverIp` | `168.119.123.45` | Setup-Guide (SSH, curl) |
| Tailscale-IP | `aa-settings.tailscaleIp` | `100.99.167.112` | Setup-Guide (rsync, ping) |
| Tailscale-Hostname | `aa-settings.tailscaleHostname` | `mein-vps` | Setup-Guide (URLs) |
| API-Key | `aa-settings.apiKey` | `sk-ant-...` | Setup-Guide (Deploy), Fahrplan (Status) |
| Gateway-Token | `aa-settings.gatewayToken` | `mein-token-123` | Setup-Guide (Deploy) |
| Sync-URL | `aa-settings.syncUrl` | `http://100.99.167.112:3456` | Setup-Guide, System Status |
| Sync-Token | `aa-settings.syncToken` | `abc123` | Setup-Guide, System Status |
| Telegram-Bot-Token | `aa-settings.telegramToken` | `7123456:ABC...` | Setup-Guide (Bot-Setup) |
| Telegram-ID | `aa-settings.telegramId` | `123456789` | Setup-Guide (allowFrom) |
| Container-Name | `aa-settings.containerName` | `openclaw-k4od` | Setup-Guide (docker exec) |
| Leser-Name | `aa-settings.name` | `Thomas` | Buch-Dashboard, Fahrplan |

### Farbcodierung in Code-Snippets

- **Blau** (`--color-safe`): Sichere Werte (IP, Hostname, Container-Name)
- **Rot** (`--color-sensitive`): Sensitive Werte (API-Key, Token, Passwoerter)
- **Orange** (`--color-missing`): Wert fehlt noch → Warnung + Link zu Meine Daten

### Interpolation

```javascript
// Beispiel: So wird ein Snippet personalisiert
function interpolate(template) {
  return template
    .replace(/\$\{SERVER_IP\}/g, getSetting('serverIp') || '<span class="missing">Bitte in Meine Daten eintragen</span>')
    .replace(/\$\{API_KEY\}/g, getSetting('apiKey') || '<span class="missing">Bitte in Meine Daten eintragen</span>');
}
```

---

## Lektionen aus dem alten Dashboard

### Was gut war (BEIBEHALTEN)
- Variable-Interpolation: Einmal Daten eingeben → ueberall personalisierter Code
- Copy-Button auf jedem Code-Block
- Farbcodierung fuer sensitiv/sicher/fehlend
- Sprint-basierte Struktur (Schritt fuer Schritt)
- Fortschritts-Tracking mit Checkboxen

### Was verloren ging (ZURUECKHOLEN)
- Personalisierte Code-Snippets – M02 wurde zu reinen Checkboxen ohne Code
- Die Bruecke zwischen "Meine Daten" und Code-Bloecken
- Leser-Perspektive – M01 zeigt unsere Statistik statt den Leser-Fahrplan

### Was neu ist (NUTZEN)
- Modulare Architektur: Jedes Modul ist eine eigene HTML-Datei
- Custom Domain: openclaw-buch.de (SEO, professioneller Auftritt)
- Buch-Dashboard (M06): Wizard + Prompt-Generator fuer eigene Buecher
- Cowan-Integration: Chat-Bot fuehrt zum richtigen Dashboard-Schritt

---

## Technische Konventionen

- **Stack:** Vanilla HTML/CSS/JS. Kein React, kein Build-System, kein Bundler.
- **Hosting:** GitHub Pages via Custom Domain `openclaw-buch.de`
- **Repo:** `Tikitackr/agentic-authorship-dashboard` (GitHub). Name bleibt so – der Leser sieht nur die Domain, nicht das Repo. Umbenennung wuerde Links/Pages-Setup riskieren, ohne Mehrwert.
- **Lokaler Ordner:** `agentic-authorship-dashboard/` im Projektverzeichnis. Name bleibt konsistent mit Repo.
- **Module laden:** Shell (`index.html`) laedt Module per `fetch()` in einen Content-Container
- **Persistenz:** localStorage (kein Server-Backend). Daten bleiben im Browser des Lesers.
- **Design:** Dark Theme (CSS Custom Properties), responsive, glassmorphism-Elemente
- **CORS:** `openclaw-buch.de` ist in allen 3 VPS-Servern als erlaubter Origin eingetragen (Sync 3456, TTS 3457, Realtime 3458)
- **HTTPS:** Aktiv seit S164. Enforce HTTPS aktiviert.
- **Domains:** `openclaw-buch.de` (Haupt) + `buch-mit-ki.de` (SEO-Landingpage, noch nicht gebaut)

### SEO-Standalone-Pattern (ab S168)

Jedes Modul ist eine **vollstaendige HTML-Seite** die auch ohne Shell funktioniert. Damit indexiert Google jedes Modul einzeln – der Kostenrechner taucht bei "OpenClaw Kosten berechnen" auf, die SOUL.md Gallery bei "SOUL.md Vorlage" etc.

**Dual-Use-Prinzip:**
1. **Google/Direkt-Zugriff:** Besucher landet auf `openclaw-buch.de/cost-calculator/` → sieht vollstaendige Seite mit Meta-Tags → JS leitet zur Shell weiter (`/?module=cost-calculator`) → fluessige Navigation
2. **Shell-Navigation:** Shell laedt Modul per `fetch()` + `innerHTML` wie bisher → kein Page-Reload

**Pflicht-Elemente pro Modul (`index.html`):**
- Vollstaendiger `<head>` mit `<title>`, `<meta name="description">`, OG-Tags, Twitter Card, Canonical-URL
- CSS-Fallback-Block (`:root`-Variablen) fuer Standalone-Darstellung
- Standalone-Redirect-Script: `if (!window.__shellLoaded) { window.location.href = '/?module=...'; }`
- OG-Image: `og-image.png` (global, 1200x630, Dark Theme)

**SEO-Texte:** Definiert in `docs/DASHBOARD-UMBAU-PLAN.md` Abschnitt 1a (Title + Description pro Modul).

**Canonical-URLs:** `https://openclaw-buch.de/{ordner-name}/` – trailing slash, HTTPS.

---

## Referenzen

### Buch-Integration (ab S169)

**Leitprinzip: "Buch erzaehlt → Dashboard zeigt."** Das Buch erklaert Konzepte, das Dashboard liefert Werkzeuge zum Umsetzen. Hint-Boxen am Kapitelende sind die Bruecke.

**Hint-Box-Typen:**
- **Einzel-Tipp:** 1 Modul pro Kapitel mit kontextbezogenem Text
- **Sammel-Tipp:** Mehrere Module mit Modulname + Einzeiler (was bringt es fuer DIESES Kapitel)

**Kap 2 = Oekosystem-Einfuehrung:** Gateway-UI (eingebaut), Dashboard (openclaw-buch.de), Cowan (mobiler Begleiter) – alle drei schlank vorgestellt. Cowan mit ehrlicher Ansage zu Voraussetzungen (Server, Tailscale, Voice-Server noetig fuer vollen Umfang, Verweis auf Kap 13.2).

**Details:** `docs/DASHBOARD-KAPITEL-MAPPING.md` (Hint-Box-Format, Kapitel-Status, QR-Codes)

---

## Referenzen

| Dokument | Pfad | Zweck |
|----------|------|-------|
| Kapitel-Mapping | `docs/DASHBOARD-KAPITEL-MAPPING.md` | Welches Kapitel braucht welches Modul, Hint-Box-Format, QR-Codes |
| Umbau-Plan | `docs/DASHBOARD-UMBAU-PLAN.md` | Temporal: Phasen, Entscheidungen, offene Fragen |
| Offene Punkte | `docs/OFFENE-PUNKTE.md` → B54 | Dashboard-Umbau Backlog-Eintrag |
| VPS-Server-Doku | `docs/ANLEITUNG-VPS-SERVER.md` | Server-Konfiguration, CORS, systemd |
| Style Guide | `docs/buchdesign-style-guide.md` | Design-Referenz (Buchdesign, aber Farben/Fonts teils relevant) |
| Kapitel-Mapping | `docs/DASHBOARD-KAPITEL-MAPPING.md` | Welches Modul gehoert zu welchem Buchkapitel – Datenquelle fuer Fahrplan (M01) |
| Altes Dashboard | https://tikitackr.github.io/OpenClaw-Dashboard/ | Referenz fuer Variable-Interpolation und Sprint-Flow |

### Dateien die beim Umbau aktualisiert werden muessen (Phase 4)

- `agentic-authorship-dashboard/README.md` – noch "M01 Projektuebersicht"
- `agentic-authorship-dashboard/MIGRATION.md` – noch alte M-Nummern
- `docs/DASHBOARD-KAPITEL-MAPPING.md` – noch alte M-Nummern und Modulnamen
- `docs/INDEX.md` – referenziert `m01/index.html` etc.
- `docs/OFFENE-PUNKTE.md` Zeile ~214 – sagt "M01 Projektuebersicht ist FERTIG", wird durch Neubau obsolet
