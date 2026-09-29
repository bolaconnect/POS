import fs from 'fs'
import path from 'path'
import { Resvg } from '@resvg/resvg-js'

function generateIconSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
    <!-- Nền sạch sẽ bo góc phong cách Apple iOS -->
    <rect width="512" height="512" rx="115" fill="#F8FAFC" />
    
    <!-- Nhóm vẽ máy POS vector siêu nét -->
    <g transform="translate(116, 56) scale(2.8)" stroke="#0E1D38" stroke-width="4.8" stroke-linecap="round" stroke-linejoin="round" fill="none">
      <!-- Thân máy POS -->
      <rect x="14" y="8" width="72" height="98" rx="15" fill="#FFFFFF" stroke="#0E1D38" stroke-width="5" />
      
      <!-- Màn hình máy POS -->
      <rect x="25" y="19" width="50" height="21" rx="4" stroke="#0E1D38" stroke-width="4.5" fill="#F8FAFC" />
      
      <!-- Bàn phím số 3x3 -->
      <!-- Hàng 1 -->
      <rect x="23" y="48" width="13" height="8" rx="4" stroke="#0E1D38" stroke-width="4" fill="#FFFFFF" />
      <rect x="43.5" y="48" width="13" height="8" rx="4" stroke="#0E1D38" stroke-width="4" fill="#FFFFFF" />
      <rect x="64" y="48" width="13" height="8" rx="4" stroke="#0E1D38" stroke-width="4" fill="#FFFFFF" />
      
      <!-- Hàng 2 -->
      <rect x="23" y="61" width="13" height="8" rx="4" stroke="#0E1D38" stroke-width="4" fill="#FFFFFF" />
      <rect x="43.5" y="61" width="13" height="8" rx="4" stroke="#0E1D38" stroke-width="4" fill="#FFFFFF" />
      <rect x="64" y="61" width="13" height="8" rx="4" stroke="#0E1D38" stroke-width="4" fill="#FFFFFF" />
      
      <!-- Hàng 3 -->
      <rect x="23" y="74" width="13" height="8" rx="4" stroke="#0E1D38" stroke-width="4" fill="#FFFFFF" />
      <rect x="43.5" y="74" width="13" height="8" rx="4" stroke="#0E1D38" stroke-width="4" fill="#FFFFFF" />
      <rect x="64" y="74" width="13" height="8" rx="4" stroke="#0E1D38" stroke-width="4" fill="#FFFFFF" />
      
      <!-- Thẻ ngân hàng cắm phía dưới -->
      <path d="M 23 96 L 23 128 C 23 133, 27 137, 32 137 L 68 137 C 73 137, 77 133, 77 128 L 77 96" fill="#FFFFFF" stroke="#0E1D38" stroke-width="5" />
      
      <!-- Vạch chip/dải thẻ trên thẻ -->
      <line x1="64" y1="108" x2="64" y2="126" stroke="#0E1D38" stroke-width="4.5" />
    </g>
  </svg>`
}

async function renderIcons() {
  const publicDir = path.resolve('public')
  
  // Render 512x512
  const svg512 = generateIconSvg(512)
  const resvg512 = new Resvg(svg512, { fitTo: { mode: 'width', value: 512 } })
  const png512 = resvg512.render().asPng()
  fs.writeFileSync(path.join(publicDir, 'icon-512.png'), png512)

  // Render 192x192
  const svg192 = generateIconSvg(192)
  const resvg192 = new Resvg(svg192, { fitTo: { mode: 'width', value: 192 } })
  const png192 = resvg192.render().asPng()
  fs.writeFileSync(path.join(publicDir, 'icon-192.png'), png192)

  // Favicon.ico
  fs.writeFileSync(path.join(publicDir, 'favicon.ico'), png192)

  console.log('✅ Icons updated cleanly!')
}

renderIcons().catch(console.error)
