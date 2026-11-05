// Cálculo de valor de pagamento via tabela de preços
// (categoria + quadras × dia da semana × faixa horária).
//
// Quando duas faixas se sobrepõem em algum minuto, o preço APLICADO nesse
// minuto é o da faixa MAIS ESPECÍFICA entre as que cobrem aquele minuto —
// não importa se é mais cara ou mais barata que a faixa mais larga por
// baixo. Isso permite cadastrar uma faixa ampla (ex.: 06h-22h, todas as
// quadras) e sobrepor faixas mais estreitas por cima (uma quadra específica
// ou uma categoria específica) sem precisar redigitar o restante do
// dia/quadras. Especificidade é decidida nesta ordem: menos quadras
// cobertas > menos categorias cobertas > faixa PROMOCIONAL (com
// starts_on/ends_on ativos na data) vence faixa PERMANENTE > menor duração
// de horário > (empate) menor preço.
//
// A promoção vence a permanente independente da duração cadastrada (ex.:
// uma promoção larga, 06h-22h, ainda deve substituir duas faixas
// permanentes mais estreitas, tipo 06h-13h e 13h-19h, no mesmo escopo de
// quadras/categorias) — do contrário a promoção "desaparece" sempre que for
// mais larga que o que já existia, que é justamente o caso mais comum
// (promoção geral por período, cobrindo o dia todo). O total final é a
// soma dos preços-minuto convertidos para horas.
//
// IMPORTANTE: faixa promocional só entra no cálculo quando `includePromo`
// é true. O preço promocional vale SÓ para a compra online paga no Checkout
// do Mercado Pago (fluxo de pagamento em src/lib/payments.functions.ts) —
// nunca para lançamento manual da recepção (avulso ou mensalista, qualquer
// categoria) nem para horário fixo/mensalista. Por isso o default é false:
// é preciso passar includePromo:true explicitamente no único lugar que
// deve enxergar a promoção.
//
// Faixa promocional por PERCENTUAL (discount_percent preenchido): em vez de
// um valor fixo, ela vale "preço normal − X%". O preço normal, minuto a
// minuto, é o da faixa PERMANENTE que venceria naquele minuto pelas mesmas
// regras de especificidade acima. Se nenhuma faixa permanente cobre o
// minuto, não há do que descontar e a faixa percentual é ignorada ali.

export interface PriceBand {
  id: string;
  categories: string[] | null;
  courts: number[] | null;
  weekday: number; // 0 (domingo) … 6 (sábado)
  start_time: string; // "HH:MM" ou "HH:MM:SS"
  end_time: string;
  price_per_hour: number;
  // Promoção: intervalo de datas em que a faixa vale. Se ambos null,
  // a faixa é permanente. Se algum for informado, só vale para bookingDate
  // dentro do intervalo (inclusivo).
  starts_on?: string | null;
  ends_on?: string | null;
  // Só em faixa promocional: desconto (1–99) sobre o preço da faixa
  // permanente. Quando preenchido, price_per_hour é ignorado.
  discount_percent?: number | null;
}

// Escopos de quadra na tabela de preços (ver court-map.ts).
export const COURTS_TENIS = [1];
export const COURTS_PICKLEBALL = [2, 3, 4];

export const WEEKDAY_LABELS = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
];

export const timeToMin = (t: string | null | undefined): number | null => {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (Number.isNaN(h) || Number.isNaN(mm)) return null;
  return h * 60 + mm;
};

export const weekdayFromYmd = (ymd: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCDay();
};

export interface PriceCalc {
  total: number;
  durationMin: number;
  coveredMin: number;
  uncoveredMin: number;
  matched: boolean;
}

interface CalcArgs {
  bands: PriceBand[];
  weekday: number;
  startTime: string;
  endTime: string;
  categoryId?: string | null;
  court?: number | null;
  // Data da locação/pagamento "YYYY-MM-DD" — usada para filtrar promoções
  // com intervalo de datas. Só tem efeito quando includePromo:true.
  date?: string | null;
  // Ver nota "IMPORTANTE" acima. Default false — só o cálculo do pagamento
  // online (Mercado Pago) deve passar true.
  includePromo?: boolean;
}

interface RelevantBand {
  bs: number;
  be: number;
  price: number;
  discountPercent: number | null;
  courtsCount: number;
  categoriesCount: number;
  isPromo: boolean;
}

interface Candidate {
  price: number;
  courtsCount: number;
  categoriesCount: number;
  isPromo: boolean;
  width: number;
}

const isMoreSpecific = (b: Candidate, best: Candidate): boolean =>
  b.courtsCount < best.courtsCount ||
  (b.courtsCount === best.courtsCount &&
    (b.categoriesCount < best.categoriesCount ||
      (b.categoriesCount === best.categoriesCount &&
        ((b.isPromo && !best.isPromo) ||
          (b.isPromo === best.isPromo &&
            (b.width < best.width || (b.width === best.width && b.price < best.price)))))));

export function calcPrice({
  bands,
  weekday,
  startTime,
  endTime,
  categoryId = null,
  court = null,
  date = null,
  includePromo = false,
}: CalcArgs): PriceCalc | null {
  const start = timeToMin(startTime);
  const end = timeToMin(endTime);
  if (start == null || end == null || end <= start) return null;

  // Pré-filtra faixas relevantes
  const relevant = bands
    .filter((b) => b.weekday === weekday)
    .filter((b) => {
      // Faixa promocional: só entra quando includePromo:true, exige data e
      // que ela esteja no intervalo.
      const hasPromo = !!(b.starts_on || b.ends_on);
      if (!hasPromo) return true;
      if (!includePromo) return false;
      if (!date) return false;
      if (b.starts_on && date < b.starts_on) return false;
      if (b.ends_on && date > b.ends_on) return false;
      return true;
    })
    .filter((b) => b.categories == null || b.categories.length === 0 || (categoryId != null && b.categories.includes(categoryId)))
    .filter((b) => {
      if (b.courts == null || b.courts.length === 0) return true;
      if (court == null) return false;
      return b.courts.includes(court);
    })
    .map((b) => {
      const bs = timeToMin(b.start_time);
      const be = timeToMin(b.end_time);
      if (bs == null || be == null || be <= bs) return null;
      // NULL/vazio = sem restrição = menos específico (tratado como "infinitas" quadras/categorias).
      const courtsCount = b.courts == null || b.courts.length === 0 ? Infinity : b.courts.length;
      const categoriesCount =
        b.categories == null || b.categories.length === 0 ? Infinity : b.categories.length;
      const isPromo = !!(b.starts_on || b.ends_on);
      const pct = isPromo && b.discount_percent != null ? Number(b.discount_percent) : null;
      return {
        bs,
        be,
        price: Number(b.price_per_hour),
        discountPercent: pct != null && pct > 0 ? pct : null,
        courtsCount,
        categoriesCount,
        isPromo,
      };
    })
    .filter((x): x is RelevantBand => x !== null);

  if (relevant.length === 0) {
    return {
      total: 0,
      durationMin: end - start,
      coveredMin: 0,
      uncoveredMin: end - start,
      matched: false,
    };
  }

  // Soma per-minuto, escolhendo a faixa MAIS ESPECÍFICA entre as que cobrem
  // o minuto: menos quadras cobertas > menos categorias cobertas > promo
  // vence permanente > menor duração de horário > (empate) menor preço.
  // Faixa percentual: preço = preço da melhor faixa permanente do minuto
  // com o desconto aplicado (sem permanente por baixo, ela não concorre).
  const pickBest = (m: number, permanentOnly: boolean, basePrice: number | null): Candidate | null => {
    let best: Candidate | null = null;
    for (const b of relevant) {
      if (m < b.bs || m >= b.be) continue;
      if (permanentOnly && b.isPromo) continue;
      let price = b.price;
      if (b.discountPercent != null) {
        if (basePrice == null) continue;
        price = basePrice * (1 - b.discountPercent / 100);
      }
      const cand: Candidate = {
        price,
        courtsCount: b.courtsCount,
        categoriesCount: b.categoriesCount,
        isPromo: b.isPromo,
        width: b.be - b.bs,
      };
      if (best == null || isMoreSpecific(cand, best)) best = cand;
    }
    return best;
  };

  let totalHourPriceMin = 0; // soma de (price/h × 1min)
  let covered = 0;
  for (let m = start; m < end; m++) {
    const base = pickBest(m, true, null);
    const best = pickBest(m, false, base?.price ?? null);
    if (best != null) {
      totalHourPriceMin += best.price;
      covered++;
    }
  }
  const total = totalHourPriceMin / 60;

  return {
    total: Math.round(total * 100) / 100,
    durationMin: end - start,
    coveredMin: covered,
    uncoveredMin: end - start - covered,
    matched: covered > 0,
  };
}

export const fmtHours = (min: number) => {
  const h = min / 60;
  return h % 1 === 0 ? `${h}h` : `${h.toFixed(2).replace(".", ",")}h`;
};

// Preço da compra ONLINE (Checkout do Mercado Pago e o que o portal mostra
// no mapa). A faixa promocional é cadastrada só para a categoria "Avulso";
// cliente ainda SEM categoria (cadastro novo pelo site, ou vinculado a quem
// não tem categoria) também tem direito a ela. Para esse cliente, se a
// promoção do avulso baixa o preço naquele horário, vale o preço
// promocional do avulso; senão, segue o cálculo de sempre (sem categoria).
// Cliente com categoria (mensalista etc.) não muda nada.
export function calcOnlinePrice(
  args: Omit<CalcArgs, "includePromo"> & { avulsoCategoryId?: string | null },
): PriceCalc | null {
  const { avulsoCategoryId = null, ...rest } = args;
  const base = calcPrice({ ...rest, includePromo: true });
  if (rest.categoryId != null || !avulsoCategoryId) return base;
  const avulsoNormal = calcPrice({ ...rest, categoryId: avulsoCategoryId, includePromo: false });
  const avulsoPromo = calcPrice({ ...rest, categoryId: avulsoCategoryId, includePromo: true });
  if (
    avulsoNormal?.matched &&
    avulsoPromo?.matched &&
    avulsoPromo.total > 0 &&
    avulsoPromo.total < avulsoNormal.total - 0.005
  ) {
    return avulsoPromo;
  }
  return base;
}
