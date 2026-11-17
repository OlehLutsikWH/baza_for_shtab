// Знак «База» і смуга під 22,5° — та сама айдентика, що в інструкції на кермі
// (claude/instruktsiya-na-kermi-kod.md у проєкті «Тихо»).
import { Svg, Path, Polygon } from '@react-pdf/renderer';

/** Палітра «Бази» (з інструкції на кермі). */
export const BAZA = {
  olive: '#344E41',     // шапка, заголовки, основний колір
  green: '#588157',     // смуги, акценти
  sage: '#A3B18A',      // другорядний текст на темному, лінії
  sageLight: '#DDE3D3', // світлий текст на темному
  border: '#C3CCB4',    // рамки
  tint: '#F2F4EE',      // світлі плашки
  tint2: '#F7F8F4',     // зебра в таблицях
  ink: '#2B2B2B',       // основний текст
  label: '#4A5A45',     // підписи
} as const;

// Логотип «База»; вектор з офіційного файлу Logo_Neutral_White.png (2000×1429), який надав Олег.
export const LOGO_W = 2000, LOGO_H = 1429;
export const LOGO_D =
  'M0 0 0 148 2000 148 2000 0ZM0 222.4 0 1030 308.6 1157.6 444.4 1021.6 444.4 617.4 185 510.4 ' +
  '185 657.4 296 704 296.4 985 148.6 925 148 371.4 443.6 370 444.4 223ZM721.6 222.4 666 222.4 ' +
  '518.6 284.4 518.6 1244.4 665 1305.6 666.6 858 722 879 722 732.6 666.6 708.6 666.6 371 722 ' +
  '369.4ZM759.6 222.4 759.4 369.6 815 371.4 815 769.4 759.4 748 759.4 895 815 919.4 815 1367.6 ' +
  '963 1429 963 284 815.4 222.4ZM1000.4 1207.4 1167.4 1374.6 1296 1321.6 1295.6 1155.4 1180.4 ' +
  '1202.6 1092.4 1115ZM1295.6 222.4 1133.4 222.4 1015 340.6 1116.4 442 1189.4 370 1295.6 370Z' +
  'M1333.6 223 1333.4 633 1182 785.6 1333.4 937 1333.4 1305.4 1481.4 1244.4 1481.4 882 1385.6 ' +
  '785.6 1481.4 688.6 1481.4 284.4ZM1758.4 222 1703 222.4 1555.6 284.4 1556 1213.6 1703.6 ' +
  '1152.6 1703.6 801.6 1759 777.4 1759 630.6 1703.6 651.6 1703.6 371.4 1759 369.4ZM1796.6 222.4 ' +
  '1796.4 369.6 1852 371.4 1852 591 1796.4 615 1796.4 762 1852 740.6 1852.6 1091 2000 1030 2000 ' +
  '283.4 1851.6 222Z';

export function BazaLogo({ height, color = '#ffffff' }: { height: number; color?: string }) {
  const width = Math.round((height * LOGO_W) / LOGO_H * 10) / 10;
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${LOGO_W} ${LOGO_H}`}>
      <Path d={LOGO_D} fill={color} />
    </Svg>
  );
}

const TAN = Math.tan((22.5 * Math.PI) / 180);

/** Смуга з нахиленими штрихами (кут 22,5°), як під шапкою інструкції. */
export function Stripes({ width, height, gap = 20, bar = 10, color = BAZA.green, background, opacity = 1 }:
  { width: number; height: number; gap?: number; bar?: number; color?: string; background?: string; opacity?: number }) {
  const dx = height * TAN;
  const n = Math.ceil((width + dx) / gap) + 1;
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={background ? { backgroundColor: background } : undefined}>
      {Array.from({ length: n }, (_, i) => {
        const x = i * gap - dx;
        return <Polygon key={i} points={`${x + dx},0 ${x + dx + bar},0 ${x + bar},${height} ${x},${height}`} fill={color} fillOpacity={opacity} />;
      })}
    </Svg>
  );
}
