// PDF-верстка звіту для донорів (@react-pdf/renderer). Дані — лише з DonorReportModel (model.ts),
// тож усе приватне відсічене ще до верстки.
import { Document, Page, View, Text, Image, Svg, Polygon, StyleSheet, Font } from '@react-pdf/renderer';
import type { ReactNode } from 'react';
import type { DonorReportModel } from './model';
import { money, moneyShort, plural } from './model';
import { BRAND } from './brand';

// ---------- шрифти ----------
export const REPORT_FONT_FILES = {
  regular: 'Inter-Regular.ttf', semibold: 'Inter-SemiBold.ttf', bold: 'Inter-Bold.ttf', display: 'Unbounded-SemiBold.ttf',
} as const;
let fontsKey: string | null = null;
/** `src(file)` повертає шлях/URL/data URI до файлу з public/base/fonts. */
export function registerReportFonts(src: (file: string) => string) {
  const key = src(REPORT_FONT_FILES.regular);
  if (fontsKey === key) return;
  Font.register({ family: 'Inter', fonts: [
    { src: src(REPORT_FONT_FILES.regular), fontWeight: 400 },
    { src: src(REPORT_FONT_FILES.semibold), fontWeight: 600 },
    { src: src(REPORT_FONT_FILES.bold), fontWeight: 700 },
  ] });
  Font.register({ family: 'Unbounded', fonts: [{ src: src(REPORT_FONT_FILES.display), fontWeight: 600 }] });
  // українські слова не переносимо (стандартні правила переносу — англійські)
  Font.registerHyphenationCallback(word => [word]);
  fontsKey = key;
}

// ---------- токени ----------
// Оливковий — «польовий» колір техніки; кут смуг 22,5° — з айдентики фонду.
const C = {
  ink: '#17202b', muted: '#5b6573', faint: '#8b94a1', line: '#dde1e6',
  olive: '#4d5a2c', oliveDeep: '#323b1b', oliveSoft: '#8c9a5b', khaki: '#ecefdf', sand: '#f6f5ef',
  amber: '#8f5400', amberBg: '#fbefd9', green: '#2b6a47', greenBg: '#e4f1e8', white: '#ffffff',
};
const TAN = Math.tan((22.5 * Math.PI) / 180); // нахил смуг
const W = 595.28 - 2 * 40; // ширина набору

const s = StyleSheet.create({
  // lineHeight на Page не ставити: у react-pdf 4.9 він ламає абсолютні fixed-колонтитули (перевірено)
  page: { paddingTop: 44, paddingBottom: 60, paddingHorizontal: 40, fontFamily: 'Inter', fontSize: 10, color: C.ink },
  runHead: { position: 'absolute', top: 20, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7.5, color: C.faint },
  foot: { position: 'absolute', bottom: 24, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderTopWidth: 0.5, borderTopColor: C.line, paddingTop: 7, fontSize: 7.5, color: C.faint },
  kicker: { fontSize: 7.5, fontWeight: 600, letterSpacing: 1.2, textTransform: 'uppercase', color: C.muted },
  draftPill: { fontSize: 7.5, fontWeight: 700, letterSpacing: 1, color: C.amber, backgroundColor: C.amberBg, paddingVertical: 3, paddingHorizontal: 7, borderRadius: 3 },
  h1: { fontFamily: 'Unbounded', fontWeight: 600, fontSize: 30, lineHeight: 1.15, color: C.ink },
  h2: { fontFamily: 'Unbounded', fontWeight: 600, fontSize: 14, color: C.ink },
  lede: { fontSize: 11.5, lineHeight: 1.55, color: C.ink },
  p: { fontSize: 10.5, lineHeight: 1.6, marginBottom: 8 },
  small: { fontSize: 8.5, color: C.muted },
  pill: { alignSelf: 'flex-start', fontSize: 9, fontWeight: 600, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 10 },
  th: { fontSize: 7.5, fontWeight: 600, letterSpacing: 0.8, textTransform: 'uppercase', color: C.muted },
  num: { textAlign: 'right' },
});

// ---------- дрібні елементи ----------
function Stripes({ width, height, gap = 9, bar = 4, color = C.olive, opacity = 1 }: { width: number; height: number; gap?: number; bar?: number; color?: string; opacity?: number }) {
  const dx = height * TAN;
  const n = Math.ceil((width + dx) / gap);
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {Array.from({ length: n }, (_, i) => {
        const x = i * gap - dx;
        return <Polygon key={i} points={`${x},${height} ${x + dx},0 ${x + dx + bar},0 ${x + bar},${height}`} fill={color} fillOpacity={opacity} />;
      })}
    </Svg>
  );
}
function Marker() {
  const h = 11, dx = h * TAN;
  return <Svg width={9} height={h} viewBox={`0 0 9 ${h}`}><Polygon points={`0,${h} ${dx},0 ${dx + 4.4},0 4.4,${h}`} fill={C.olive} /></Svg>;
}
function Section({ title, children, breakBefore, keepWithNext = 80 }: { title: string; children: ReactNode; breakBefore?: boolean; keepWithNext?: number }) {
  return (
    <View break={breakBefore} style={{ marginBottom: 18 }}>
      {/* заголовок не лишається сам унизу сторінки */}
      <View wrap={false} minPresenceAhead={keepWithNext} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
        <Marker /><Text style={[s.h2, { marginLeft: 7 }]}>{title}</Text>
      </View>
      {children}
    </View>
  );
}
function Figure({ value, label, big }: { value: string; label: string; big?: boolean }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ fontFamily: 'Unbounded', fontWeight: 600, fontSize: big ? 24 : 17, color: C.ink, lineHeight: 1.1 }}>{value}</Text>
      <Text style={[s.small, { marginTop: 4 }]}>{label}</Text>
    </View>
  );
}
const statusPill = (m: DonorReportModel) =>
  m.handedOverOn
    ? { text: m.unit ? `Передано: ${m.unit} · ${m.handedOverOn}` : `Передано військовим · ${m.handedOverOn}`, fg: C.green, bg: C.greenBg }
    : m.status === 'Готовий' ? { text: m.unit ? `Ремонт завершено · передаємо: ${m.unit}` : 'Ремонт завершено · чекає на передачу', fg: C.green, bg: C.greenBg }
    : { text: m.status, fg: C.amber, bg: C.amberBg };

// ---------- сторінки ----------
function Cover({ m }: { m: DonorReportModel }) {
  const f = m.figures;
  const pill = statusPill(m);
  const hero = m.images.find(i => i.kind === 'після') ?? m.images[0] ?? null;
  const figures = [
    { value: moneyShort(f.total), label: 'вкладено в машину' },
    { value: f.days != null ? String(f.days) : '—', label: f.days != null ? `${plural(f.days, ['день', 'дні', 'днів'])} на СТО` : 'днів на СТО' },
    { value: String(f.jobsDone), label: `${plural(f.jobsDone, ['робота', 'роботи', 'робіт'])} виконано` },
    { value: String(f.partsInstalled), label: `${plural(f.partsInstalled, ['запчастина', 'запчастини', 'запчастин'])} встановлено` },
  ];
  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={s.kicker}>{BRAND.fund} · {BRAND.project}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {m.draft && <Text style={[s.draftPill, { marginRight: 8 }]}>ЧЕРНЕТКА</Text>}
          <Text style={s.kicker}>Звіт № {m.reportNo} · {m.generatedOn}</Text>
        </View>
      </View>
      <View style={{ marginTop: 14, marginBottom: 26 }}><Stripes width={W} height={8} /></View>
      <Text style={[s.kicker, { color: C.olive, fontSize: 9, marginBottom: 8 }]}>Звіт про ремонт</Text>
      <Text style={s.h1}>{m.vehicle.name}</Text>
      {(m.vehicle.type || m.vehicle.purpose) && (
        <Text style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>
          {[m.vehicle.type, m.vehicle.purpose ? `завдання: ${m.vehicle.purpose}` : null].filter(Boolean).join(' · ')}
        </Text>
      )}
      <Text style={[s.pill, { color: pill.fg, backgroundColor: pill.bg, marginTop: 14 }]}>{pill.text}</Text>

      {hero ? (
        <View style={{ marginTop: 22 }}>
          <Image src={hero.src} style={{ width: W, height: 250, objectFit: 'cover', borderRadius: 6 }} />
          <View style={{ flexDirection: 'row', marginTop: 18 }}>{figures.map(x => <Figure key={x.label} {...x} />)}</View>
        </View>
      ) : (
        <View style={{ marginTop: 22, backgroundColor: C.khaki, borderRadius: 6, padding: 22, position: 'relative' }}>
          <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 120, overflow: 'hidden', borderTopRightRadius: 6, borderBottomRightRadius: 6 }}>
            <Stripes width={120} height={232} gap={13} bar={5} color={C.oliveSoft} opacity={0.35} />
          </View>
          <Text style={[s.kicker, { color: C.olive, marginBottom: 14 }]}>Ремонт у цифрах</Text>
          <View style={{ flexDirection: 'row', marginBottom: 20, paddingRight: 110 }}>
            <Figure big {...figures[0]} /><Figure big {...figures[1]} />
          </View>
          <View style={{ flexDirection: 'row', paddingRight: 110 }}>
            <Figure big {...figures[2]} /><Figure big {...figures[3]} />
          </View>
        </View>
      )}
      <View style={{ height: 26 }} />
    </View>
  );
}

function Timeline({ m }: { m: DonorReportModel }) {
  const t = m.timeline;
  if (t.length < 2) return null;
  return (
    <View wrap={false} style={{ marginTop: 6, marginBottom: 4 }}>
      <View style={{ position: 'relative', height: 14 }}>
        <View style={{ position: 'absolute', left: 6, right: 6, top: 6, height: 1.5, backgroundColor: C.oliveSoft }} />
        <View style={{ flexDirection: 'row' }}>
          {t.map((e, i) => (
            <View key={i} style={{ flex: 1, alignItems: i === 0 ? 'flex-start' : i === t.length - 1 ? 'flex-end' : 'center' }}>
              <View style={{ width: 13, height: 13, borderRadius: 7, backgroundColor: i === t.length - 1 ? C.olive : C.white, borderWidth: 2, borderColor: C.olive }} />
            </View>
          ))}
        </View>
      </View>
      <View style={{ flexDirection: 'row', marginTop: 6 }}>
        {t.map((e, i) => {
          const align = i === 0 ? 'left' : i === t.length - 1 ? 'right' : 'center';
          return (
            <View key={i} style={{ flex: 1, paddingHorizontal: 2 }}>
              <Text style={{ fontSize: 9.5, fontWeight: 600, textAlign: align }}>{e.date}</Text>
              <Text style={{ fontSize: 8.5, color: C.muted, textAlign: align }}>{e.label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function Works({ m }: { m: DonorReportModel }) {
  if (!m.works.length) return <Text style={s.small}>Робіт не записано.</Text>;
  return (
    <View>
      <View style={{ flexDirection: 'row', paddingBottom: 5, borderBottomWidth: 0.75, borderBottomColor: C.ink }}>
        <Text style={[s.th, { width: 22 }]}>№</Text><Text style={[s.th, { flex: 1 }]}>Робота</Text>
        <Text style={[s.th, { width: 120 }]}>Коли</Text><Text style={[s.th, s.num, { width: 40 }]}>Днів</Text>
      </View>
      {m.works.map((w, i) => (
        <View key={i} wrap={false} style={{ flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: C.line }}>
          <Text style={{ width: 22, color: C.faint }}>{i + 1}</Text>
          <Text style={{ flex: 1, paddingRight: 8 }}>{w.title}{w.done ? '' : '  (ще триває)'}</Text>
          <Text style={{ width: 120, color: C.muted }}>{w.period ?? '—'}</Text>
          <Text style={[s.num, { width: 40 }]}>{w.days ?? '—'}</Text>
        </View>
      ))}
    </View>
  );
}

function Parts({ m }: { m: DonorReportModel }) {
  const rows = m.parts;
  if (!rows.length) return <Text style={s.small}>Запчастин не записано.</Text>;
  const half = Math.ceil(rows.length / 2);
  const col = (xs: typeof rows) => (
    <View style={{ flex: 1 }}>
      {xs.map((p, i) => (
        <View key={i} wrap={false} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: 0.5, borderBottomColor: C.line }}>
          <Text style={{ flex: 1, paddingRight: 6 }}>{p.name}</Text>
          <Text style={{ color: C.muted }}>× {p.qty}</Text>
        </View>
      ))}
    </View>
  );
  return <View style={{ flexDirection: 'row' }}>{col(rows.slice(0, half))}<View style={{ width: 22 }} />{col(rows.slice(half))}</View>;
}

function Money({ m }: { m: DonorReportModel }) {
  const f = m.figures;
  if (!f.total) return <Text style={s.small}>Витрат по цьому авто не записано.</Text>;
  const maxShare = Math.max(...m.spend.map(x => x.share));
  const inv = m.invoices;
  return (
    <View>
      <View wrap={false}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginBottom: 24 }}>
        <View style={{ flex: 1 }}>
          <Text style={s.kicker}>Усього на це авто</Text>
          <Text style={{ fontFamily: 'Unbounded', fontWeight: 600, fontSize: 26, lineHeight: 1.2, marginTop: 4 }}>{money(f.total)}</Text>
        </View>
        <View style={{ width: 190 }}>
          <Text style={{ fontSize: 9.5, color: C.green, textAlign: 'right' }}>оплачено {money(f.paid)}</Text>
          {f.pending > 0 && <Text style={{ fontSize: 9.5, color: C.amber, textAlign: 'right', marginTop: 2 }}>в процесі оплати {money(f.pending)}</Text>}
        </View>
      </View>

      <Text style={[s.kicker, { marginBottom: 8 }]}>На що витрачено</Text>
      {m.spend.map(x => (
        <View key={x.category} wrap={false} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 7 }}>
          <Text style={{ width: 92, fontSize: 9.5 }}>{x.category}</Text>
          <View style={{ flex: 1, height: 11, backgroundColor: C.sand, borderRadius: 2 }}>
            <View style={{ width: `${Math.max(1.5, (x.share / maxShare) * 100)}%`, height: 11, backgroundColor: C.olive, borderRadius: 2 }} />
          </View>
          <Text style={{ width: 92, textAlign: 'right', fontSize: 9.5, fontWeight: 600 }}>{money(x.amount)}</Text>
          <Text style={{ width: 34, textAlign: 'right', fontSize: 8.5, color: C.muted }}>{Math.round(x.share * 100)}%</Text>
        </View>
      ))}

      {m.sources.length > 0 && (
        <Text style={[s.small, { marginTop: 10 }]}>
          Джерела коштів: <Text style={{ color: C.ink }}>{m.sources.map(x => `${x.source} — ${money(x.amount)}`).join('  ·  ')}</Text>
        </Text>
      )}
      </View>

      {inv && (
        // коротка таблиця переноситься на нову сторінку цілою; довга — рядками
        <View wrap={inv.length > 18} style={{ marginTop: 22 }}>
          <Text minPresenceAhead={60} style={[s.kicker, { marginBottom: 6 }]}>Кожна витрата окремо</Text>
          <View style={{ flexDirection: 'row', paddingBottom: 5, borderBottomWidth: 0.75, borderBottomColor: C.ink }}>
            <Text style={[s.th, { width: 58 }]}>Дата</Text><Text style={[s.th, { flex: 1 }]}>На що</Text>
            <Text style={[s.th, { width: 74 }]}>Стаття</Text><Text style={[s.th, s.num, { width: 84 }]}>Сума</Text>
            <Text style={[s.th, s.num, { width: 70 }]}>Оплата</Text>
          </View>
          {inv.map((r, i) => (
            <View key={r.id} wrap={false} style={{ flexDirection: 'row', paddingVertical: 5.5, paddingHorizontal: 0, backgroundColor: i % 2 ? C.white : C.sand, borderBottomWidth: 0.5, borderBottomColor: C.line }}>
              <Text style={{ width: 58, fontSize: 9, color: C.muted, paddingLeft: 3 }}>{r.date ?? '—'}</Text>
              <Text style={{ flex: 1, fontSize: 9.5, paddingRight: 6 }}>{r.label}</Text>
              <Text style={{ width: 74, fontSize: 9, color: C.muted }}>{r.category}</Text>
              <Text style={[s.num, { width: 84, fontSize: 9.5 }]}>{money(r.amount)}</Text>
              <Text style={[s.num, { width: 70, fontSize: 8.5, color: r.paid ? C.green : C.amber, paddingRight: 3 }]}>{r.paid ? 'оплачено' : 'в процесі'}</Text>
            </View>
          ))}
          <View wrap={false} style={{ flexDirection: 'row', paddingTop: 7 }}>
            <Text style={{ flex: 1, fontWeight: 700, paddingLeft: 3 }}>Разом</Text>
            <Text style={[s.num, { width: 84, fontWeight: 700 }]}>{money(f.total)}</Text>
            <View style={{ width: 70 }} />
          </View>
        </View>
      )}
      <Text style={[s.small, { marginTop: 12 }]}>
        У звіті — усі витрати, віднесені саме на цю машину. Загальні витрати фонду (оренда, обладнання станції) сюди не входять.
      </Text>
    </View>
  );
}

function Photos({ m }: { m: DonorReportModel }) {
  const xs = m.images.slice(0, 6);
  if (!xs.length) return null;
  const w = (W - 14) / 2;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
      {xs.map((im, i) => (
        <View key={i} wrap={false} style={{ width: w, marginBottom: 14 }}>
          <Image src={im.src} style={{ width: w, height: w * 0.66, objectFit: 'cover', borderRadius: 4 }} />
          <Text style={[s.small, { marginTop: 4 }]}>
            {im.kind ? <Text style={{ fontWeight: 700, color: C.olive }}>{im.kind === 'до' ? 'ДО  ' : 'ПІСЛЯ  '}</Text> : null}{im.caption ?? ''}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Thanks({ m }: { m: DonorReportModel }) {
  // Закриваючий блок не розриваємо між сторінками.
  return (
    <View wrap={false} style={{ marginTop: 6 }}>
      <View style={{ backgroundColor: C.khaki, borderRadius: 6, padding: 18, flexDirection: 'row' }}>
        <View style={{ width: 30, marginRight: 14, overflow: 'hidden' }}><Stripes width={30} height={96} gap={10} bar={4} color={C.olive} /></View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: 'Unbounded', fontWeight: 600, fontSize: 16, marginBottom: 6 }}>Дякуємо</Text>
          <Text style={{ fontSize: 10.5, lineHeight: 1.5 }}>{m.thanks}</Text>
          <Text style={{ marginTop: 8, fontSize: 8.5, color: C.olive }}>{BRAND.site} · {BRAND.socials}</Text>
        </View>
      </View>
      <Text style={{ marginTop: 10, fontSize: 9, lineHeight: 1.5, color: C.muted }}>{m.about}</Text>
    </View>
  );
}

export function DonorReportDocument({ m }: { m: DonorReportModel }) {
  return (
    <Document title={`Звіт про ремонт — ${m.vehicle.name}`} author={BRAND.fundFull} subject={`${BRAND.project}: звіт для донорів`} language="uk" creator="СТО «База»" producer="СТО «База»">
      <Page size="A4" style={s.page}>
        {/* колонтитули — першими: fixed-елементи повторюються з тієї сторінки, де з'явились */}
        <Text fixed style={s.runHead} render={({ pageNumber }) => (pageNumber > 1 ? `${m.vehicle.name} · звіт про ремонт` : '')} />
        <View fixed style={s.foot}>
          <Text>{BRAND.fund} · {BRAND.project} · {BRAND.site}</Text>
          {m.draft && <Text style={{ color: C.amber, fontWeight: 600 }}>ЧЕРНЕТКА — перевірте перед відправленням</Text>}
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
        <Cover m={m} />
        <Section title="Історія ремонту">
          {m.story.paragraphs.map((p, i) => <Text key={i} style={s.p}>{p}</Text>)}
          <Timeline m={m} />
        </Section>
        <Section title="Що зроблено" breakBefore><Works m={m} /></Section>
        <Section title="Запчастини"><Parts m={m} /></Section>
        <Section title="Кошти: на що витрачено" keepWithNext={220}><Money m={m} /></Section>
        {m.images.length > 0 && <Section title="Фото" breakBefore><Photos m={m} /></Section>}
        <Thanks m={m} />
      </Page>
    </Document>
  );
}
