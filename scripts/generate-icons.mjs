/**
 * Tạo icon PWA 192x192 và 512x512 bằng Node.js Canvas
 * Dùng @napi-rs/canvas (fast, không cần cairo native)
 * Hoặc fallback dùng sharp nếu có sẵn.
 *
 * Nếu không có canvas lib, tạo icon bằng SVG → PNG qua built-in
 */

import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicDir = join(__dirname, '..', 'public')

// SVG template – nền tròn #007AFF, icon cửa hàng màu trắng
function makeSVG(size) {
  const pad = size * 0.12
  const iconSize = size - pad * 2
  const cx = size / 2
  const cy = size / 2
  const r = size / 2
  // Scale factor for icon paths (designed at 100px)
  const s = iconSize / 100

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <clipPath id="circle">
      <circle cx="${cx}" cy="${cy}" r="${r}"/>
    </clipPath>
  </defs>
  <!-- Background -->
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="#007AFF"/>
  <!-- Shop icon (simplified storefront) -->
  <g clip-path="url(#circle)" transform="translate(${pad},${pad}) scale(${s})">
    <!-- Building body -->
    <rect x="15" y="45" width="70" height="45" rx="4" fill="white" opacity="0.95"/>
    <!-- Door -->
    <rect x="38" y="65" width="24" height="25" rx="3" fill="#007AFF"/>
    <!-- Awning/roof -->
    <path d="M8 45 L50 20 L92 45 Z" fill="white"/>
    <!-- Windows -->
    <rect x="20" y="52" width="18" height="14" rx="2" fill="#007AFF"/>
    <rect x="62" y="52" width="18" height="14" rx="2" fill="#007AFF"/>
    <!-- Sign bar -->
    <rect x="15" y="40" width="70" height="8" rx="2" fill="white" opacity="0.7"/>
  </g>
</svg>`
}

// Convert SVG to PNG using resvg-js if available, otherwise save as SVG renamed
async function svgToPng(svgStr, size) {
  try {
    // Try @resvg/resvg-js
    const { Resvg } = await import('@resvg/resvg-js').catch(() => null) || {}
    if (Resvg) {
      const resvg = new Resvg(svgStr, { fitTo: { mode: 'width', value: size } })
      return resvg.render().asPng()
    }
  } catch {}

  try {
    // Try sharp
    const sharp = (await import('sharp').catch(() => null))?.default
    if (sharp) {
      return await sharp(Buffer.from(svgStr)).resize(size, size).png().toBuffer()
    }
  } catch {}

  // Fallback: write SVG content (browser can still read it)
  console.warn(`⚠️  No PNG converter found. Writing SVG as .png fallback for size ${size}.`)
  console.warn('   Install @resvg/resvg-js or sharp for proper PNG output.')
  return Buffer.from(svgStr)
}

async function main() {
  mkdirSync(publicDir, { recursive: true })

  for (const size of [192, 512]) {
    const svg = makeSVG(size)
    const png = await svgToPng(svg, size)
    const outPath = join(publicDir, `icon-${size}.png`)
    writeFileSync(outPath, png)
    console.log(`✅ Created ${outPath} (${png.length} bytes)`)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
