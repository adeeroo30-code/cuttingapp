#!/bin/bash
# Builds the two personal apps (celine/ and leen/) from the shared code in src/.
# Edit files in src/, then run:  ./build.sh
set -e
cd "$(dirname "$0")"
for who in celine leen sarah; do
  out="$who"
  mkdir -p "$out/icons"
  cfg="src/config.$who.js"
  appname=$(grep "appName:" "$cfg" | sed -E "s/.*'(.*)'.*/\1/")
  name=$(grep " name:" "$cfg" | head -1 | sed -E "s/.*'(.*)'.*/\1/")
  c1=$(grep "colors:" "$cfg" | sed -E "s/.*\['(#[0-9a-fA-F]+)', '(#[0-9a-fA-F]+)'\].*/\1/")
  c2=$(grep "colors:" "$cfg" | sed -E "s/.*\['(#[0-9a-fA-F]+)', '(#[0-9a-fA-F]+)'\].*/\2/")
  initial=${name:0:1}
  cp src/app.js src/data.js src/styles.css "$out/"
  cp "$cfg" "$out/config.js"
  sed "s/__APP_NAME__/$appname/g" src/index.html > "$out/index.html"
  sed -e "s/__APP_NAME__/$appname/g" -e "s/__NAME__/$name/g" src/manifest.template.json > "$out/manifest.webmanifest"
  # bump cache version on every build so phones pick up updates
  sed -e "s/__ID__/$who/g" -e "s/-v1'/-$(date +%s)'/" src/sw.js > "$out/sw.js"
  # icons: render an SVG with Quick Look (macOS)
  tmp=$(mktemp -d)
  cat > "$tmp/icon.svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="$c1"/><stop offset="1" stop-color="$c2"/></linearGradient>
    <radialGradient id="s" cx=".3" cy=".25" r=".7"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1024" height="1024" fill="#0a0912"/>
  <rect width="1024" height="1024" fill="url(#g)"/>
  <rect width="1024" height="1024" fill="url(#s)"/>
  <circle cx="512" cy="512" r="300" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="56"/>
  <path d="M512 212 A300 300 0 1 1 252 662" fill="none" stroke="#fff" stroke-width="56" stroke-linecap="round"/>
  <text x="512" y="600" text-anchor="middle" font-family="Helvetica Neue, Arial, sans-serif" font-weight="700" font-size="260" fill="#fff">$initial</text>
  <text x="760" y="300" font-size="120" fill="#fff">✦</text>
</svg>
SVG
  qlmanage -t -s 1024 -o "$tmp" "$tmp/icon.svg" >/dev/null 2>&1
  sips -z 512 512 "$tmp/icon.svg.png" --out "$out/icons/icon-512.png" >/dev/null
  sips -z 192 192 "$tmp/icon.svg.png" --out "$out/icons/icon-192.png" >/dev/null
  sips -z 180 180 "$tmp/icon.svg.png" --out "$out/icons/apple-touch-icon.png" >/dev/null
  rm -rf "$tmp"
  echo "✓ built $out/"
done
