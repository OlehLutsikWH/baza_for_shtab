// Демо-фото для демо-режиму: намальовані заглушки з написом «ДЕМО-ФОТО», а не справжні світлини.
import type { DrivePhoto, VehiclePhotos } from './types';

// 1×1 PNG — коли малювати ніде (тести, сервер)
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const cache = new Map<string, string>();

function draw(label: string, w: number): string {
  const key = `${label}|${w}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let url = PIXEL;
  try {
    if (typeof document !== 'undefined' && !/jsdom/i.test(navigator.userAgent)) {
      const h = Math.round(w * 0.66);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      if (g) {
        g.fillStyle = '#344E41'; g.fillRect(0, 0, w, h);
        g.fillStyle = 'rgba(88,129,87,0.55)';
        const dx = h * Math.tan((22.5 * Math.PI) / 180), gap = w / 9, bar = gap / 2.4;
        for (let x = -dx; x < w + dx; x += gap) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + dx, 0); g.lineTo(x + dx + bar, 0); g.lineTo(x + bar, h); g.closePath(); g.fill(); }
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillStyle = '#ffffff'; g.font = `700 ${Math.round(w / 9)}px sans-serif`; g.fillText('ДЕМО-ФОТО', w / 2, h * 0.44);
        g.fillStyle = '#DDE3D3'; g.font = `600 ${Math.round(w / 22)}px sans-serif`; g.fillText(label, w / 2, h * 0.64);
        url = c.toDataURL('image/png');
      }
    }
  } catch { url = PIXEL; }
  cache.set(key, url);
  return url;
}

const SETS: Record<string, { name: string; group: string | null; label: string }[]> = {
  'АВТО-003': [
    { name: 'pryiom-1.jpg', group: 'До ремонту', label: 'до ремонту · 1' },
    { name: 'pryiom-2.jpg', group: 'До ремонту', label: 'до ремонту · 2' },
    { name: 'gotovyi-1.jpg', group: 'Після ремонту', label: 'після ремонту · 1' },
    { name: 'gotovyi-2.jpg', group: 'Після ремонту', label: 'після ремонту · 2' },
  ],
  'АВТО-001': [{ name: 'diagnostyka.jpg', group: null, label: 'діагностика' }],
};

export function demoVehiclePhotos(vehicleId: string, vehicleName: string): VehiclePhotos {
  const set = SETS[vehicleId];
  if (!set) return { folder: null, photos: [] };
  const photos: DrivePhoto[] = set.map((p, i) => ({
    id: `demo${vehicleId.replace(/\D/g, '')}photo${i + 1}`, name: p.name, mimeType: 'image/png', takenAt: null, group: p.group,
    thumb: draw(p.label, 480), full: draw(p.label, 1600),
  }));
  return { folder: { id: 'demo-folder', name: `${vehicleId} ${vehicleName} (демо)`, url: null }, photos };
}
