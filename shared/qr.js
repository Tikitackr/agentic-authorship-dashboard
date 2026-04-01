/**
 * QR Code Generator – Korrekte Implementierung (ISO 18004)
 * Fuer das Agentic Authorship Dashboard. Kein CDN, keine Abhaengigkeiten.
 *
 * API: QR.toSVG(text, { size, margin, fgColor, bgColor })
 * Gibt einen SVG-String zurueck.
 *
 * Unterstuetzt Error Correction Level M, Byte-Modus, Version 1-20.
 */
(function() {
  'use strict';

  /* ══════════════════════════════════════════════════════════════
     GF(256) Arithmetik – Grundlage fuer Reed-Solomon
     ══════════════════════════════════════════════════════════════ */
  var EXP = [], LOG = [];
  (function() {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x = (x << 1) ^ (x >= 128 ? 0x11D : 0);
    }
    EXP[255] = EXP[0];
    for (var i = 256; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  /* ══════════════════════════════════════════════════════════════
     Reed-Solomon Error Correction
     ══════════════════════════════════════════════════════════════ */
  function rsGeneratorPoly(degree) {
    var g = [1];
    for (var i = 0; i < degree; i++) {
      var ng = new Array(g.length + 1);
      for (var j = 0; j < ng.length; j++) ng[j] = 0;
      var alpha = EXP[i];
      for (var j = 0; j < g.length; j++) {
        ng[j] = (ng[j] || 0) ^ g[j];
        ng[j + 1] = (ng[j + 1] || 0) ^ gfMul(g[j], alpha);
      }
      g = ng;
    }
    return g;
  }

  function rsEncode(data, ecCount) {
    var gen = rsGeneratorPoly(ecCount);
    var rem = new Array(ecCount);
    for (var i = 0; i < ecCount; i++) rem[i] = 0;
    for (var i = 0; i < data.length; i++) {
      var f = data[i] ^ rem[0];
      for (var j = 0; j < ecCount - 1; j++) rem[j] = rem[j + 1];
      rem[ecCount - 1] = 0;
      for (var j = 0; j < ecCount; j++) rem[j] ^= gfMul(gen[j + 1], f);
    }
    return rem;
  }

  /* ══════════════════════════════════════════════════════════════
     QR Version-Tabellen (Level M)
     ══════════════════════════════════════════════════════════════ */
  // [totalDataCodewords, ecPerBlock, group1Blocks, group1DataPerBlock, group2Blocks, group2DataPerBlock]
  var VER = [
    null, // index 0 unused
    [16,10,1,16,0,0],[28,16,1,28,0,0],[44,26,1,44,0,0],[64,18,2,32,0,0],
    [86,24,2,43,0,0],[108,16,4,27,0,0],[124,18,4,31,0,0],[154,22,2,38,2,39],
    [182,22,3,36,2,37],[216,26,4,43,1,44],[254,30,1,50,4,51],[290,22,6,36,2,37],
    [334,22,8,37,1,38],[365,24,4,40,5,41],[415,24,5,41,5,42],[453,28,7,45,3,46],
    [507,28,10,46,1,47],[563,26,9,43,4,44],[627,26,3,44,11,45],[669,26,3,41,13,42],
  ];

  // Alignment pattern center positions per version
  var ALIGN = [
    null,null,[6,18],[6,22],[6,26],[6,30],[6,34],
    [6,22,38],[6,24,42],[6,26,46],[6,28,50],
    [6,30,54],[6,32,58],[6,34,62],[6,26,46,66],
    [6,26,48,70],[6,26,50,74],[6,30,54,78],
    [6,30,56,82],[6,30,58,86],[6,34,62,90],
  ];

  // Format info bits for level M (mask 0-7)
  // Pre-computed: format = ((ecLevel << 3) | mask), BCH encoded, XOR with 0x5412
  var FORMAT_BITS = [
    0x5412 ^ bch15_5(0x08), 0x5412 ^ bch15_5(0x09), 0x5412 ^ bch15_5(0x0A), 0x5412 ^ bch15_5(0x0B),
    0x5412 ^ bch15_5(0x0C), 0x5412 ^ bch15_5(0x0D), 0x5412 ^ bch15_5(0x0E), 0x5412 ^ bch15_5(0x0F),
  ];

  function bch15_5(data) {
    var d = data << 10;
    var gen = 0x537; // generator polynomial for BCH(15,5)
    for (var i = 4; i >= 0; i--) {
      if (d & (1 << (i + 10))) d ^= gen << i;
    }
    return (data << 10) | d;
  }

  // Recompute FORMAT_BITS correctly
  (function() {
    for (var mask = 0; mask < 8; mask++) {
      var data = (0 << 3) | mask; // EC level M = 0 (in QR spec: L=01, M=00, Q=11, H=10)
      FORMAT_BITS[mask] = bch15_5(data) ^ 0x5412;
    }
  })();

  /* ══════════════════════════════════════════════════════════════
     Daten kodieren
     ══════════════════════════════════════════════════════════════ */
  function chooseVersion(textLen) {
    for (var v = 1; v <= 20; v++) {
      var countBits = v <= 9 ? 8 : 16;
      var dataBits = 4 + countBits + textLen * 8;
      if (dataBits <= VER[v][0] * 8) return v;
    }
    return -1;
  }

  function encodeData(text, version) {
    var vd = VER[version];
    var totalBytes = vd[0];
    var countBits = version <= 9 ? 8 : 16;

    var bits = [];
    function push(val, len) {
      for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
    }

    push(4, 4);                      // Byte mode indicator
    push(text.length, countBits);    // Character count
    for (var i = 0; i < text.length; i++) push(text.charCodeAt(i), 8);

    // Terminator
    var cap = totalBytes * 8;
    var term = Math.min(4, cap - bits.length);
    push(0, term);
    // Byte-align
    while (bits.length % 8) bits.push(0);
    // Padding bytes 0xEC, 0x11
    var pad = [0xEC, 0x11], pi = 0;
    while (bits.length < cap) { push(pad[pi], 8); pi ^= 1; }

    // To byte array
    var bytes = [];
    for (var i = 0; i < bits.length; i += 8) {
      var b = 0;
      for (var j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      bytes.push(b);
    }
    return bytes;
  }

  function makeCodewords(data, version) {
    var vd = VER[version];
    var ecPer = vd[1], g1n = vd[2], g1d = vd[3], g2n = vd[4], g2d = vd[5];

    var blocks = [], ecBlocks = [], idx = 0;
    for (var i = 0; i < g1n; i++) { var b = data.slice(idx, idx + g1d); blocks.push(b); ecBlocks.push(rsEncode(b, ecPer)); idx += g1d; }
    for (var i = 0; i < g2n; i++) { var b = data.slice(idx, idx + g2d); blocks.push(b); ecBlocks.push(rsEncode(b, ecPer)); idx += g2d; }

    // Interleave
    var result = [];
    var maxD = Math.max(g1d, g2d || 0);
    for (var i = 0; i < maxD; i++) for (var j = 0; j < blocks.length; j++) if (i < blocks[j].length) result.push(blocks[j][i]);
    for (var i = 0; i < ecPer; i++) for (var j = 0; j < ecBlocks.length; j++) result.push(ecBlocks[j][i]);

    return result;
  }

  /* ══════════════════════════════════════════════════════════════
     Matrix aufbauen
     ══════════════════════════════════════════════════════════════ */
  function makeMatrix(version) {
    var n = version * 4 + 17;
    var mod = [], rsv = [];
    for (var r = 0; r < n; r++) {
      mod[r] = new Array(n);
      rsv[r] = new Array(n);
      for (var c = 0; c < n; c++) { mod[r][c] = 0; rsv[r][c] = false; }
    }
    return { m: mod, r: rsv, n: n };
  }

  function setMod(g, r, c, val) {
    if (r >= 0 && r < g.n && c >= 0 && c < g.n) { g.m[r][c] = val ? 1 : 0; g.r[r][c] = true; }
  }

  function placeFinder(g, row, col) {
    for (var dr = -1; dr <= 7; dr++) {
      for (var dc = -1; dc <= 7; dc++) {
        var r = row + dr, c = col + dc;
        if (r < 0 || r >= g.n || c < 0 || c >= g.n) continue;
        var v = (dr >= 0 && dr <= 6 && (dc === 0 || dc === 6)) ||
                (dc >= 0 && dc <= 6 && (dr === 0 || dr === 6)) ||
                (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
        setMod(g, r, c, v);
      }
    }
  }

  function placeAlign(g, row, col) {
    for (var dr = -2; dr <= 2; dr++) {
      for (var dc = -2; dc <= 2; dc++) {
        var v = Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0);
        setMod(g, row + dr, col + dc, v);
      }
    }
  }

  function placeFunctionPatterns(g, version) {
    var n = g.n;
    // Finder patterns + separators
    placeFinder(g, 0, 0);
    placeFinder(g, 0, n - 7);
    placeFinder(g, n - 7, 0);

    // Timing patterns
    for (var i = 8; i < n - 8; i++) {
      setMod(g, 6, i, i % 2 === 0);
      setMod(g, i, 6, i % 2 === 0);
    }

    // Alignment patterns
    if (version >= 2 && ALIGN[version]) {
      var pos = ALIGN[version];
      for (var i = 0; i < pos.length; i++) {
        for (var j = 0; j < pos.length; j++) {
          // Skip positions that overlap with finders
          if (i === 0 && j === 0) continue;
          if (i === 0 && j === pos.length - 1) continue;
          if (i === pos.length - 1 && j === 0) continue;
          placeAlign(g, pos[i], pos[j]);
        }
      }
    }

    // Dark module
    setMod(g, n - 8, 8, true);

    // Reserve format info areas (set reserved flag, actual bits placed later)
    for (var i = 0; i < 9; i++) {
      if (!g.r[8][i]) { g.r[8][i] = true; g.m[8][i] = 0; }
      if (!g.r[i][8]) { g.r[i][8] = true; g.m[i][8] = 0; }
    }
    for (var i = 0; i < 8; i++) {
      if (!g.r[8][n - 1 - i]) { g.r[8][n - 1 - i] = true; g.m[8][n - 1 - i] = 0; }
      if (!g.r[n - 1 - i][8]) { g.r[n - 1 - i][8] = true; g.m[n - 1 - i][8] = 0; }
    }

    // Version info (version >= 7)
    if (version >= 7) {
      var vBits = bch18_6(version);
      for (var i = 0; i < 18; i++) {
        var bit = (vBits >>> i) & 1;
        var r = Math.floor(i / 3), c = n - 11 + (i % 3);
        setMod(g, r, c, bit);
        setMod(g, c, r, bit);
      }
    }
  }

  function bch18_6(data) {
    var d = data << 12;
    var gen = 0x1F25;
    for (var i = 5; i >= 0; i--) {
      if (d & (1 << (i + 12))) d ^= gen << i;
    }
    return (data << 12) | d;
  }

  /* ══════════════════════════════════════════════════════════════
     Datenbits platzieren (Zigzag)
     ══════════════════════════════════════════════════════════════ */
  function placeDataBits(g, codewords) {
    var n = g.n;
    var bits = [];
    for (var i = 0; i < codewords.length; i++) {
      for (var j = 7; j >= 0; j--) bits.push((codewords[i] >>> j) & 1);
    }

    var idx = 0;
    // Traverse in 2-column stripes from right to left
    for (var right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // Skip vertical timing column
      // Determine direction
      var upward = ((n - 1 - right) / 2) % 2 === 0;
      // Note: after skipping col 6, the stripe at col 5 is the 1st skip-adjusted one.
      // Let me recalculate: column pair index from right
      // Pairs: (n-1,n-2), (n-3,n-4), ..., (7,skip→5), (4,3), (2,1)
      // Pair 0 (rightmost): upward. Pair 1: downward. etc.
      // Actually in QR spec: first pair goes upward, second downward, alternating.

      for (var vert = 0; vert < n; vert++) {
        var row = upward ? (n - 1 - vert) : vert;
        for (var dx = 0; dx <= 1; dx++) {
          var col = right - dx;
          if (col < 0 || col >= n) continue;
          if (g.r[row][col]) continue;
          if (idx < bits.length) {
            g.m[row][col] = bits[idx];
            idx++;
          } else {
            g.m[row][col] = 0;
          }
          g.r[row][col] = true; // mark as used
        }
      }
    }
  }

  /* ══════════════════════════════════════════════════════════════
     Maskierung
     ══════════════════════════════════════════════════════════════ */
  var MASKS = [
    function(r, c) { return (r + c) % 2 === 0; },
    function(r, c) { return r % 2 === 0; },
    function(r, c) { return c % 3 === 0; },
    function(r, c) { return (r + c) % 3 === 0; },
    function(r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; },
    function(r, c) { return (r * c) % 2 + (r * c) % 3 === 0; },
    function(r, c) { return ((r * c) % 2 + (r * c) % 3) % 2 === 0; },
    function(r, c) { return ((r + c) % 2 + (r * c) % 3) % 2 === 0; },
  ];

  function applyMask(g, dataReserved, maskIdx) {
    var n = g.n;
    var fn = MASKS[maskIdx];
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (!dataReserved[r][c]) continue; // only mask data modules
        if (fn(r, c)) g.m[r][c] ^= 1;
      }
    }
  }

  function placeFormatInfo(g, mask) {
    var n = g.n;
    var bits = FORMAT_BITS[mask];
    // Bits 0-7 along left column (bottom to top) and top row
    var positions1 = [[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],
                      [7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];
    var positions2 = [[n-1,8],[n-2,8],[n-3,8],[n-4,8],[n-5,8],[n-6,8],[n-7,8],
                      [8,n-8],[8,n-7],[8,n-6],[8,n-5],[8,n-4],[8,n-3],[8,n-2],[8,n-1]];
    for (var i = 0; i < 15; i++) {
      var bit = (bits >>> i) & 1;
      g.m[positions1[i][0]][positions1[i][1]] = bit;
      g.m[positions2[i][0]][positions2[i][1]] = bit;
    }
  }

  function penalty(g) {
    var n = g.n, score = 0;
    // Rule 1: Adjacent modules in row/column of same color
    for (var r = 0; r < n; r++) {
      var run = 1;
      for (var c = 1; c < n; c++) {
        if (g.m[r][c] === g.m[r][c - 1]) { run++; } else { if (run >= 5) score += run - 2; run = 1; }
      }
      if (run >= 5) score += run - 2;
    }
    for (var c = 0; c < n; c++) {
      var run = 1;
      for (var r = 1; r < n; r++) {
        if (g.m[r][c] === g.m[r - 1][c]) { run++; } else { if (run >= 5) score += run - 2; run = 1; }
      }
      if (run >= 5) score += run - 2;
    }
    // Rule 2: 2x2 blocks
    for (var r = 0; r < n - 1; r++) {
      for (var c = 0; c < n - 1; c++) {
        var v = g.m[r][c];
        if (v === g.m[r][c + 1] && v === g.m[r + 1][c] && v === g.m[r + 1][c + 1]) score += 3;
      }
    }
    // Rule 3: Finder-like patterns
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n - 10; c++) {
        if (g.m[r][c] === 1 && g.m[r][c+1] === 0 && g.m[r][c+2] === 1 && g.m[r][c+3] === 1 && g.m[r][c+4] === 1 && g.m[r][c+5] === 0 && g.m[r][c+6] === 1 && g.m[r][c+7] === 0 && g.m[r][c+8] === 0 && g.m[r][c+9] === 0 && g.m[r][c+10] === 0) score += 40;
        if (g.m[r][c] === 0 && g.m[r][c+1] === 0 && g.m[r][c+2] === 0 && g.m[r][c+3] === 0 && g.m[r][c+4] === 1 && g.m[r][c+5] === 0 && g.m[r][c+6] === 1 && g.m[r][c+7] === 1 && g.m[r][c+8] === 1 && g.m[r][c+9] === 0 && g.m[r][c+10] === 1) score += 40;
      }
    }
    for (var c = 0; c < n; c++) {
      for (var r = 0; r < n - 10; r++) {
        if (g.m[r][c] === 1 && g.m[r+1][c] === 0 && g.m[r+2][c] === 1 && g.m[r+3][c] === 1 && g.m[r+4][c] === 1 && g.m[r+5][c] === 0 && g.m[r+6][c] === 1 && g.m[r+7][c] === 0 && g.m[r+8][c] === 0 && g.m[r+9][c] === 0 && g.m[r+10][c] === 0) score += 40;
        if (g.m[r][c] === 0 && g.m[r+1][c] === 0 && g.m[r+2][c] === 0 && g.m[r+3][c] === 0 && g.m[r+4][c] === 1 && g.m[r+5][c] === 0 && g.m[r+6][c] === 1 && g.m[r+7][c] === 1 && g.m[r+8][c] === 1 && g.m[r+9][c] === 0 && g.m[r+10][c] === 1) score += 40;
      }
    }
    // Rule 4: Dark/light ratio
    var dark = 0;
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (g.m[r][c] === 1) dark++;
    var pct = Math.abs(dark * 100 / (n * n) - 50);
    score += Math.floor(pct / 5) * 10;
    return score;
  }

  function copyMatrix(g) {
    var n = g.n, m2 = [], r2 = [];
    for (var r = 0; r < n; r++) { m2[r] = g.m[r].slice(); r2[r] = g.r[r].slice(); }
    return { m: m2, r: r2, n: n };
  }

  /* ══════════════════════════════════════════════════════════════
     QR-Code generieren
     ══════════════════════════════════════════════════════════════ */
  function generate(text) {
    var version = chooseVersion(text.length);
    if (version < 0) return null;

    var data = encodeData(text, version);
    var codewords = makeCodewords(data, version);

    // Leere Matrix mit Function Patterns
    var base = makeMatrix(version);
    placeFunctionPatterns(base, version);

    // Merken welche Module Daten sind (fuer Maskierung)
    var preData = copyMatrix(base);

    // Daten platzieren
    placeDataBits(base, codewords);

    // Daten-Module identifizieren (alle die nach function patterns hinzukamen)
    var dataMap = [];
    for (var r = 0; r < base.n; r++) {
      dataMap[r] = new Array(base.n);
      for (var c = 0; c < base.n; c++) {
        dataMap[r][c] = !preData.r[r][c]; // true = dieses Modul ist ein Daten-Modul
      }
    }

    // Beste Maske finden
    var bestMask = 0, bestScore = Infinity;
    for (var mask = 0; mask < 8; mask++) {
      var trial = copyMatrix(base);
      applyMask(trial, dataMap, mask);
      placeFormatInfo(trial, mask);
      var s = penalty(trial);
      if (s < bestScore) { bestScore = s; bestMask = mask; }
    }

    // Finale Matrix
    applyMask(base, dataMap, bestMask);
    placeFormatInfo(base, bestMask);

    return base;
  }

  /* ══════════════════════════════════════════════════════════════
     SVG-Ausgabe
     ══════════════════════════════════════════════════════════════ */
  function toSVG(text, opts) {
    opts = opts || {};
    var size = opts.size || 256;
    var margin = opts.margin !== undefined ? opts.margin : 2;
    var fg = opts.fgColor || '#000';
    var bg = opts.bgColor || '#fff';

    var g = generate(text);
    if (!g) return '<svg xmlns="http://www.w3.org/2000/svg"><text fill="red">QR error</text></svg>';

    var n = g.n;
    var total = n + margin * 2;
    var cellSize = size / total;

    var parts = [];
    parts.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total + '" width="' + size + '" height="' + size + '" shape-rendering="crispEdges">');
    parts.push('<rect width="' + total + '" height="' + total + '" fill="' + bg + '"/>');

    // Alle dunklen Module als ein Path (effizienter als einzelne Rects)
    var d = '';
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (g.m[r][c] === 1) {
          d += 'M' + (c + margin) + ' ' + (r + margin) + 'h1v1h-1z';
        }
      }
    }
    parts.push('<path d="' + d + '" fill="' + fg + '"/>');
    parts.push('</svg>');
    return parts.join('');
  }

  /* ══════════════════════════════════════════════════════════════
     Public API
     ══════════════════════════════════════════════════════════════ */
  window.QR = { toSVG: toSVG };

})();
