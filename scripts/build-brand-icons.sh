#!/usr/bin/env bash
# Generate the Dokan app icons from the source artwork in assets/brand/.
#
#   bash scripts/build-brand-icons.sh
#
# Source of truth is assets/brand/dokan-mark.svg (the three overlapping shapes:
# violet #7047EB → purple #A244FF, coral #FF9B53 → pink #FF698F, overlap #E23B7B).
# The mark is PORTRAIT — 52 wide x 63 tall — and fills its viewBox edge to edge,
# so every icon has to place it on a square canvas by hand. There is no padding in
# the artwork to lean on; the percentages below ARE the padding.
#
# Backgrounds are opaque white on purpose. A launcher draws 'any' icons on
# whatever it likes and a transparent mark over a dark wallpaper loses the
# violet; white also matches what iOS does to apple-touch-icon anyway (it fills
# transparency with black, which would kill this mark).
set -euo pipefail
cd "$(dirname "$0")/.."

MARK=assets/brand/dokan-mark.svg
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
command -v rsvg-convert >/dev/null || { echo "need rsvg-convert (librsvg)"; exit 1; }
command -v magick >/dev/null || { echo "need imagemagick (magick)"; exit 1; }

# place <out> <canvas> <mark-height-as-fraction-of-canvas>
place() {
  local out="$1" canvas="$2" frac="$3"
  local h w
  h=$(awk "BEGIN{printf \"%d\", $canvas*$frac}")
  w=$(awk "BEGIN{printf \"%d\", $h*52/63}")
  rsvg-convert -w "$w" "$MARK" -o "$TMP/mark-$canvas.png"
  magick -size "${canvas}x${canvas}" xc:'#FFFFFF' "$TMP/mark-$canvas.png" \
    -gravity center -composite -strip -define png:compression-level=9 "$out"
  printf '  %-34s %sx%s  mark %sx%s\n' "$out" "$canvas" "$canvas" "$w" "$h"
}

echo 'icons (purpose any — mark at 72% of the canvas):'
place public/icons/icon-192.png 192 0.72
place public/icons/icon-512.png 512 0.72

# Maskable: Android crops to a circle of diameter 80% of the canvas, so the whole
# RECTANGLE has to fit inside that circle, not just its height. For a 52:63 box
# centred in a square that means the height may not exceed ~61.7% — 56% leaves a
# real margin instead of relying on the exact edge.
echo 'maskable (Android safe zone — mark at 56%):'
place public/icons/icon-maskable-512.png 512 0.56
place public/icons/icon-maskable-192.png 192 0.56

echo 'apple-touch (iOS rounds the corners itself — opaque, mark at 68%):'
place public/apple-touch-icon.png 180 0.68

echo 'favicon.ico (16/32/48 in one file, rendered from a 256px master):'
rsvg-convert -w 152 "$MARK" -o "$TMP/fav-mark.png"
magick -size 256x256 xc:'#FFFFFF' "$TMP/fav-mark.png" -gravity center -composite \
  -define icon:auto-resize=48,32,16 "$TMP/fav.ico"
cp "$TMP/fav.ico" public/favicon.ico
magick identify public/favicon.ico | sed 's/^/  /'

# SVG favicon: the same mark, but with breathing room. The raw artwork touches its
# own edges, so scaled straight into a tab it looks clipped; wrapping it in a
# square viewBox with the mark centred supplies the padding at any size.
echo 'icon.svg (padded square wrapper):'
python3 - "$MARK" <<'PY'
import re, sys, pathlib
src = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')
m = re.search(r'<svg[^>]*viewBox="0 0 52 63"[^>]*>(.*)</svg>', src, re.S)
if not m:
    sys.exit('could not find the 52x63 viewBox in ' + sys.argv[1])
inner = m.group(1).strip()
out = (
    '<!-- Dokan mark. Scaled from the 52x63 master into a padded 81x81 square so it reads\n'
    '     correctly as a browser tab icon; regenerate with scripts/build-brand-icons.sh -->\n'
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 81 81">\n'
    '  <g transform="translate(14.5 9)">\n'
    + inner + '\n'
    '  </g>\n</svg>\n'
)
pathlib.Path('public/icon.svg').write_text(out, encoding='utf-8')
print('  public/icon.svg written (%d bytes of artwork)' % len(inner))
PY

echo
echo 'done — verify with: magick identify public/icons/*.png public/apple-touch-icon.png public/favicon.ico'