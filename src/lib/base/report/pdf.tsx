// PDF-верстка звіту для донорів (@react-pdf/renderer) в айдентиці «Бази»: білий знак у темно-оливковій
// шапці, смуга під 22,5°, палітра й IBM Plex Mono — як в інструкції на кермі.
// Дані — лише з DonorReportModel (model.ts), тож усе приватне відсічене ще до верстки.
import { Document, Page, View, Text, Image, Svg, Polygon, StyleSheet, Font } from '@react-pdf/renderer';
import type { ReactNode } from 'react';
import type { DonorReportModel } from './model';
import { money, moneyShort, plural } from './model';
import { BRAND } from './brand';
import { BAZA, BazaLogo, Stripes } from './brandmark';

// ---------- шрифти ----------
export const REPORT_FONT_FILES = {
  regular: 'Inter-Regular.ttf', semibold: 'Inter-SemiBold.ttf', bold: 'Inter-Bold.ttf',
  monoSemibold: 'IBMPlexMono-SemiBold.ttf', monoBold: 'IBMPlexMono-Bold.ttf',
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
  Font.register({ family: 'Plex', fonts: [
    { src: src(REPORT_FONT_FILES.monoSemibold), fontWeight: 600 },
    { src: src(REPORT_FONT_FILES.monoBold), fontWeight: 700 },
  ] });
  // українські слова не переносимо (стандартні правила переносу — англійські)
  Font.registerHyphenationCallback(word => [word]);
  fontsKey = key;
}

// ---------- токени ----------
const C = {
  ...BAZA,
  muted: '#5d6a58', faint: '#8a9485', line: '#dfe4d8', white: '#ffffff',
  ok: '#3f6b3a', okBg: '#e3eedf', warn: '#8a5a00', warnBg: '#f7ecd2', warnOnDark: '#ead9a8',
};
const TAN = Math.tan((22.5 * Math.PI) / 180);
const PAGE_W = 595.28, PAD_X = 40, PAD_TOP = 44;
const W = PAGE_W - 2 * PAD_X; // ширина набору

const s = StyleSheet.create({
  // lineHeight на Page не ставити: у react-pdf 4.9 він ламає абсолютні fixed-колонтитули (перевірено)
  page: { paddingTop: PAD_TOP, paddingBottom: 56, paddingHorizontal: PAD_X, fontFamily: 'Inter', fontSize: 10, color: C.ink },
  runHead: { position: 'absolute', top: 20, left: PAD_X, right: PAD_X, fontFamily: 'Plex', fontWeight: 600, fontSize: 7.5, letterSpacing: 0.6, color: C.faint },
  foot: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 26, backgroundColor: C.olive, paddingHorizontal: PAD_X,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', fontSize: 7.5, color: C.white },
  mono: { fontFamily: 'Plex', fontWeight: 600 },
  kicker: { fontFamily: 'Plex', fontWeight: 600, fontSize: 7.5, letterSpacing: 0.9, textTransform: 'uppercase', color: C.label },
  h1: { fontFamily: 'Plex', fontWeight: 700, fontSize: 26, lineHeight: 1.15, color: C.ink },
  h2: { fontFamily: 'Plex', fontWeight: 700, fontSize: 11, letterSpacing: 0.9, textTransform: 'uppercase', color: C.olive },
  p: { fontSize: 10.5, lineHeight: 1.6, marginBottom: 8 },
  small: { fontSize: 8.5, color: C.muted },
  pill: { alignSelf: 'flex-start', fontSize: 9, fontWeight: 600, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 2 },
  th: { fontFamily: 'Plex', fontWeight: 600, fontSize: 7, letterSpacing: 0.7, textTransform: 'uppercase', color: C.label },
  num: { textAlign: 'right' },
});

// ---------- дрібні елементи ----------
function Marker() {
  const h = 11, dx = h * TAN;
  return <Svg width={9} height={h} viewBox={`0 0 9 ${h}`}><Polygon points={`0,${h} ${dx},0 ${dx + 4.4},0 4.4,${h}`} fill={C.olive} /></Svg>;
}
function SectionTitle({ title }: { title: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
      <Marker />
      <Text style={[s.h2, { marginLeft: 7 }]}>{title}</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: C.sage, marginLeft: 10 }} />
    </View>
  );
}
/** Заголовок розділу не розривається з початком розділу (lead): самотнього заголовка внизу сторінки не буває. */
function Section({ title, lead, children }: { title: string; lead: ReactNode; children?: ReactNode }) {
  return (
    <View style={{ marginBottom: 18 }}>
      <View wrap={false}><SectionTitle title={title} />{lead}</View>
      {children}
    </View>
  );
}
function Figure({ value, label, size = 22, grow = 1 }: { value: string; label: string; size?: number; grow?: number }) {
  return (
    <View style={{ flex: grow }}>
      <Text style={{ fontFamily: 'Plex', fontWeight: 700, fontSize: size, color: C.olive, lineHeight: 1.1 }}>{value}</Text>
      <Text style={[s.small, { marginTop: 4, color: C.label }]}>{label}</Text>
    </View>
  );
}
const statusPill = (m: DonorReportModel) =>
  m.handedOverOn
    ? { text: m.unit ? `Передано: ${m.unit} · ${m.handedOverOn}` : `Передано військовим · ${m.handedOverOn}`, fg: C.ok, bg: C.okBg }
    : m.status === 'Готовий' ? { text: m.unit ? `Ремонт завершено · передаємо: ${m.unit}` : 'Ремонт завершено · чекає на передачу', fg: C.ok, bg: C.okBg }
    : { text: m.status, fg: C.warn, bg: C.warnBg };
const avtoNumber = (id: string) => /(\d+)\s*$/.exec(id)?.[1] ?? id;

// ---------- обкладинка ----------
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
      {/* шапка на всю ширину аркуша — як в інструкції на кермі */}
      <View style={{ marginTop: -PAD_TOP, marginHorizontal: -PAD_X, backgroundColor: C.olive, paddingVertical: 20, paddingHorizontal: PAD_X, flexDirection: 'row', alignItems: 'center' }}>
        <BazaLogo height={50} />
        <View style={{ width: 1, height: 50, backgroundColor: C.green, marginHorizontal: 16 }} />
        <View>
          <Text style={{ fontFamily: 'Plex', fontWeight: 700, fontSize: 19, lineHeight: 1.1, color: C.white }}>ЗВІТ</Text>
          <Text style={{ fontFamily: 'Plex', fontWeight: 700, fontSize: 19, lineHeight: 1.1, color: C.sage }}>ПРО РЕМОНТ</Text>
          <Text style={{ fontFamily: 'Plex', fontWeight: 600, fontSize: 7.5, letterSpacing: 0.6, color: C.sageLight, marginTop: 4 }}>МЕРЕЖА СТО «БАЗА» · БФ «ТИХО»</Text>
        </View>
        <View style={{ marginLeft: 'auto', borderWidth: 1.5, borderColor: C.sage, paddingVertical: 5, paddingHorizontal: 10, alignItems: 'center' }}>
          <Text style={{ fontFamily: 'Plex', fontWeight: 600, fontSize: 8, letterSpacing: 1, color: C.sage }}>АВТО</Text>
          <Text style={{ fontFamily: 'Plex', fontWeight: 700, fontSize: 22, color: C.white, lineHeight: 1.1 }}>{avtoNumber(m.reportNo)}</Text>
        </View>
      </View>
      <View style={{ marginHorizontal: -PAD_X }}><Stripes width={PAGE_W} height={6} background={C.olive} /></View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
        <Text style={s.kicker}>Звіт № {m.reportNo} · {m.generatedOn}</Text>
        {m.draft && <Text style={{ fontFamily: 'Plex', fontWeight: 700, fontSize: 7.5, letterSpacing: 1, color: C.warn, backgroundColor: C.warnBg, paddingVertical: 3, paddingHorizontal: 7 }}>ЧЕРНЕТКА</Text>}
      </View>
      <Text style={[s.h1, { marginTop: 16 }]}>{m.vehicle.name}</Text>
      {(m.vehicle.type || m.vehicle.purpose) && (
        <Text style={{ fontSize: 11, color: C.label, marginTop: 6 }}>
          {[m.vehicle.type, m.vehicle.purpose ? `завдання: ${m.vehicle.purpose}` : null].filter(Boolean).join(' · ')}
        </Text>
      )}
      <Text style={[s.pill, { color: pill.fg, backgroundColor: pill.bg, marginTop: 12 }]}>{pill.text}</Text>

      {hero ? (
        <View style={{ marginTop: 20 }}>
          <Image src={hero.src} style={{ width: W, height: 190, objectFit: 'cover' }} />
          {/* у ряд з чотирьох — менший кегль, а сумі більше місця, щоб «72 100 грн» не переносилось */}
          <View style={{ flexDirection: 'row', marginTop: 14 }}>{figures.map((x, i) => <Figure key={x.label} {...x} size={17} grow={i === 0 ? 1.5 : 1} />)}</View>
        </View>
      ) : (
        <View style={{ marginTop: 20, backgroundColor: C.tint, borderWidth: 1, borderColor: C.border, padding: 20, position: 'relative' }}>
          <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 110, overflow: 'hidden' }}>
            <Stripes width={110} height={220} gap={18} bar={7} color={C.sage} opacity={0.45} />
          </View>
          <Text style={[s.kicker, { color: C.olive, marginBottom: 14 }]}>Ремонт у цифрах</Text>
          <View style={{ flexDirection: 'row', marginBottom: 18, paddingRight: 100 }}><Figure {...figures[0]} /><Figure {...figures[1]} /></View>
          <View style={{ flexDirection: 'row', paddingRight: 100 }}><Figure {...figures[2]} /><Figure {...figures[3]} /></View>
        </View>
      )}
      <View style={{ height: 24 }} />
    </View>
  );
}

// ---------- розділи ----------
function Timeline({ m }: { m: DonorReportModel }) {
  const t = m.timeline;
  if (t.length < 2) return null;
  return (
    <View wrap={false} style={{ marginTop: 6, marginBottom: 4 }}>
      <View style={{ position: 'relative', height: 14 }}>
        <View style={{ position: 'absolute', left: 6, right: 6, top: 6, height: 1.5, backgroundColor: C.sage }} />
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
              <Text style={{ fontFamily: 'Plex', fontWeight: 600, fontSize: 9, textAlign: align }}>{e.date}</Text>
              <Text style={{ fontSize: 8.5, color: C.label, textAlign: align }}>{e.label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function WorksHeader() {
  return (
    <View style={{ flexDirection: 'row', paddingBottom: 5, borderBottomWidth: 1, borderBottomColor: C.olive }}>
      <Text style={[s.th, { width: 22 }]}>№</Text><Text style={[s.th, { flex: 1 }]}>Робота</Text>
      <Text style={[s.th, { width: 122 }]}>Коли</Text><Text style={[s.th, s.num, { width: 40 }]}>Днів</Text>
    </View>
  );
}
function WorkRow({ w, i }: { w: DonorReportModel['works'][number]; i: number }) {
  return (
    <View wrap={false} style={{ flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: C.line }}>
      <Text style={[s.mono, { width: 22, color: C.faint, fontSize: 9 }]}>{String(i + 1).padStart(2, '0')}</Text>
      <Text style={{ flex: 1, paddingRight: 8 }}>{w.title}{w.done ? '' : '  (ще триває)'}</Text>
      <Text style={{ width: 122, color: C.muted, fontSize: 9.5 }}>{w.period ?? '—'}</Text>
      <Text style={[s.num, s.mono, { width: 40, fontSize: 9.5 }]}>{w.days ?? '—'}</Text>
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
        <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: 0.5, borderBottomColor: C.line }}>
          <Text style={{ flex: 1, paddingRight: 6 }}>{p.name}</Text>
          <Text style={[s.mono, { color: C.label, fontSize: 9 }]}>× {p.qty}</Text>
        </View>
      ))}
    </View>
  );
  return <View style={{ flexDirection: 'row' }}>{col(rows.slice(0, half))}<View style={{ width: 22 }} />{col(rows.slice(half))}</View>;
}

function MoneySummary({ m }: { m: DonorReportModel }) {
  const f = m.figures;
  if (!f.total) return <Text style={s.small}>Витрат по цьому авто не записано.</Text>;
  const maxShare = Math.max(...m.spend.map(x => x.share));
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginBottom: 22 }}>
        <View style={{ flex: 1 }}>
          <Text style={s.kicker}>Усього на це авто</Text>
          <Text style={{ fontFamily: 'Plex', fontWeight: 700, fontSize: 24, lineHeight: 1.2, marginTop: 4, color: C.ink }}>{money(f.total)}</Text>
        </View>
        <View style={{ width: 200 }}>
          <Text style={{ fontSize: 9.5, color: C.ok, textAlign: 'right' }}>оплачено {money(f.paid)}</Text>
          {f.pending > 0 && <Text style={{ fontSize: 9.5, color: C.warn, textAlign: 'right', marginTop: 2 }}>в процесі оплати {money(f.pending)}</Text>}
        </View>
      </View>
      <Text style={[s.kicker, { marginBottom: 8 }]}>На що витрачено</Text>
      {m.spend.map(x => (
        <View key={x.category} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 7 }}>
          <Text style={{ width: 92, fontSize: 9.5 }}>{x.category}</Text>
          <View style={{ flex: 1, height: 11, backgroundColor: C.tint2 }}>
            <View style={{ width: `${Math.max(1.5, (x.share / maxShare) * 100)}%`, height: 11, backgroundColor: C.olive }} />
          </View>
          <Text style={{ width: 94, textAlign: 'right', fontSize: 9.5, fontWeight: 600 }}>{money(x.amount)}</Text>
          <Text style={[s.mono, { width: 34, textAlign: 'right', fontSize: 8.5, color: C.label }]}>{Math.round(x.share * 100)}%</Text>
        </View>
      ))}
      {m.sources.length > 0 && (
        <Text style={[s.small, { marginTop: 10 }]}>
          Джерела коштів: <Text style={{ color: C.ink }}>{m.sources.map(x => `${x.source} — ${money(x.amount)}`).join('  ·  ')}</Text>
        </Text>
      )}
    </View>
  );
}

function MoneyInvoices({ m }: { m: DonorReportModel }) {
  const f = m.figures, inv = m.invoices;
  if (!f.total) return null;
  return (
    <View>
      {inv && (
        // коротка таблиця переноситься на нову сторінку цілою; довга — рядками
        <View wrap={inv.length > 18} style={{ marginTop: 22 }}>
          <View wrap={false}>
            <Text style={[s.kicker, { marginBottom: 6 }]}>Кожна витрата окремо</Text>
            <View style={{ flexDirection: 'row', paddingBottom: 5, borderBottomWidth: 1, borderBottomColor: C.olive }}>
              <Text style={[s.th, { width: 60 }]}>Дата</Text><Text style={[s.th, { flex: 1 }]}>На що</Text>
              <Text style={[s.th, { width: 74 }]}>Стаття</Text><Text style={[s.th, s.num, { width: 84 }]}>Сума</Text>
              <Text style={[s.th, s.num, { width: 66 }]}>Оплата</Text>
            </View>
          </View>
          {inv.map((r, i) => (
            <View key={r.id} wrap={false} style={{ flexDirection: 'row', paddingVertical: 5.5, backgroundColor: i % 2 ? C.white : C.tint2, borderBottomWidth: 0.5, borderBottomColor: C.line }}>
              <Text style={[s.mono, { width: 60, fontSize: 8.5, color: C.label, paddingLeft: 3 }]}>{r.date ?? '—'}</Text>
              <Text style={{ flex: 1, fontSize: 9.5, paddingRight: 6 }}>{r.label}</Text>
              <Text style={{ width: 74, fontSize: 9, color: C.muted }}>{r.category}</Text>
              <Text style={[s.num, { width: 84, fontSize: 9.5 }]}>{money(r.amount)}</Text>
              <Text style={[s.num, { width: 66, fontSize: 8.5, color: r.paid ? C.ok : C.warn, paddingRight: 3 }]}>{r.paid ? 'оплачено' : 'в процесі'}</Text>
            </View>
          ))}
          <View wrap={false} style={{ flexDirection: 'row', paddingTop: 7 }}>
            <Text style={{ flex: 1, fontWeight: 700, paddingLeft: 3 }}>Разом</Text>
            <Text style={[s.num, { width: 84, fontWeight: 700 }]}>{money(f.total)}</Text>
            <View style={{ width: 66 }} />
          </View>
        </View>
      )}
      <Text style={[s.small, { marginTop: 12 }]}>
        У звіті — усі витрати, віднесені саме на цю машину. Загальні витрати фонду (оренда, обладнання станції) сюди не входять.
      </Text>
    </View>
  );
}

function PhotoRow({ images }: { images: DonorReportModel['images'] }) {
  const w = (W - 14) / 2;
  return (
    <View wrap={false} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 }}>
      {images.map((im, i) => (
        <View key={i} style={{ width: w }}>
          <Image src={im.src} style={{ width: w, height: w * 0.66, objectFit: 'cover' }} />
          <Text style={[s.small, { marginTop: 4 }]}>
            {im.kind ? <Text style={{ fontFamily: 'Plex', fontWeight: 700, color: C.olive }}>{im.kind === 'до' ? 'ДО  ' : 'ПІСЛЯ  '}</Text> : null}{im.caption ?? ''}
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
      <View style={{ backgroundColor: C.tint, borderLeftWidth: 4, borderLeftColor: C.green, padding: 18, flexDirection: 'row' }}>
        <View style={{ marginRight: 16, paddingTop: 2 }}><BazaLogo height={34} color={C.olive} /></View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: 'Plex', fontWeight: 700, fontSize: 14, letterSpacing: 0.5, color: C.olive, marginBottom: 6 }}>ДЯКУЄМО</Text>
          <Text style={{ fontSize: 10.5, lineHeight: 1.5 }}>{m.thanks}</Text>
          <Text style={{ marginTop: 8, fontSize: 8.5, color: C.label }}>{BRAND.site} · {BRAND.socials}</Text>
        </View>
      </View>
      <Text style={{ marginTop: 10, fontSize: 9, lineHeight: 1.5, color: C.muted }}>{m.about}</Text>
    </View>
  );
}

export function DonorReportDocument({ m }: { m: DonorReportModel }) {
  const LEAD_ROWS = 3; // скільки рядків таблиці робіт тримається разом із заголовком
  const photos = m.images.slice(0, 6);
  const photoRows: DonorReportModel['images'][] = [];
  for (let i = 0; i < photos.length; i += 2) photoRows.push(photos.slice(i, i + 2));
  return (
    <Document title={`Звіт про ремонт — ${m.vehicle.name}`} author={BRAND.fundFull} subject={`${BRAND.project}: звіт для донорів`} language="uk" creator="СТО «База»" producer="СТО «База»">
      <Page size="A4" style={s.page}>
        {/* колонтитули — першими: fixed-елементи повторюються з тієї сторінки, де з'явились */}
        <Text fixed style={s.runHead} render={({ pageNumber }) => (pageNumber > 1 ? `${m.vehicle.name.toUpperCase()} · ЗВІТ ПРО РЕМОНТ · АВТО-${avtoNumber(m.reportNo)}` : '')} />
        <View fixed style={s.foot}>
          <Text>Мережа СТО «База» · БФ «Тихо»</Text>
          {m.draft && <Text style={{ color: C.warnOnDark, fontWeight: 600 }}>ЧЕРНЕТКА — перевірте перед відправленням</Text>}
          <Text style={{ color: C.sage }} render={({ pageNumber, totalPages }) => `${BRAND.site} · ${pageNumber} / ${totalPages}`} />
        </View>
        <Cover m={m} />
        <Section title="Історія ремонту" lead={<Text style={s.p}>{m.story.paragraphs[0] ?? ''}</Text>}>
          {m.story.paragraphs.slice(1).map((p, i) => <Text key={i} style={s.p}>{p}</Text>)}
          <Timeline m={m} />
        </Section>
        <Section title="Що зроблено" lead={m.works.length
          ? <View><WorksHeader />{m.works.slice(0, LEAD_ROWS).map((w, i) => <WorkRow key={i} w={w} i={i} />)}</View>
          : <Text style={s.small}>Робіт не записано.</Text>}>
          {m.works.slice(LEAD_ROWS).map((w, i) => <WorkRow key={i + LEAD_ROWS} w={w} i={i + LEAD_ROWS} />)}
        </Section>
        <Section title="Запчастини" lead={<Parts m={m} />} />
        <Section title="Кошти: на що витрачено" lead={<MoneySummary m={m} />}><MoneyInvoices m={m} /></Section>
        {photoRows.length > 0 && (
          <Section title="Фото" lead={<PhotoRow images={photoRows[0]} />}>
            {photoRows.slice(1).map((row, i) => <PhotoRow key={i} images={row} />)}
          </Section>
        )}
        <Thanks m={m} />
      </Page>
    </Document>
  );
}
