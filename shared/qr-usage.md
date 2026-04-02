# QR Code Generator Usage

Simple, zero-dependency QR code generation for the dashboard.

## Basic Usage

```javascript
// Generate a simple QR code
var svg = QR.toSVG("https://example.com");
document.body.innerHTML = svg;
```

## With Options

```javascript
var svg = QR.toSVG(
    "https://openclaw-buch.de/?cowan=open&companion=true&apikey=abc123",
    {
        size: 256,        // SVG viewport size in pixels (default: 256)
        margin: 2,        // Quiet zone in modules (default: 2)
        fgColor: '#000',  // Foreground/black color (default: '#000')
        bgColor: '#fff'   // Background/white color (default: '#fff')
    }
);
```

## Features

- ✓ Pure JavaScript, no dependencies
- ✓ Works in `file://` protocol
- ✓ Works on GitHub Pages
- ✓ No ES6+ syntax (compatible with older browsers)
- ✓ QR codes scannable by iPhone camera
- ✓ Error correction level M
- ✓ Supports URLs up to ~200 characters
- ✓ Returns SVG string (not DOM element)
- ✓ QR versions 1-10 automatically selected

## Integration Example

```html
<div id="qr-container"></div>

<script src="qr.js"></script>
<script>
  var url = "https://openclaw-buch.de/?cowan=open";
  var svg = QR.toSVG(url, { size: 256, margin: 2 });
  document.getElementById('qr-container').innerHTML = svg;
</script>
```

## Technical Details

- **Encoding**: Byte mode (ISO-8859-1)
- **Error Correction**: Level M (15% recovery capability)
- **Masking**: Automatic (all 8 patterns tested)
- **Data Capacity**: 16-216 bytes depending on version
- **Module Size**: Calculated based on SVG size and margin

## Performance

- File size: ~15 KB minified
- Generation time: < 10ms for typical URLs
- SVG output size: 10-120 KB depending on data length

## Browser Compatibility

Works in all browsers that support:
- JavaScript (ES5)
- SVG rendering
- No polyfills required
