// Regras centralizadas de horário de funcionamento **online**.
//
// Estes horários definem quando clientes/professores podem visualizar quadras
// como "Disponível" e solicitar reserva pelo portal. Reservas manuais criadas
// por recepcionistas/diretoria/administradores podem ficar fora destes limites
// — mas nunca aparecem como horário livre online.
//
// Segunda a quinta: 05:00 – 23:00
// Sexta-feira:      05:00 – 22:00
// Sábado:           07:00 – 19:00
// Domingo:          07:00 – 19:00

export interface OperatingWindow {
  start: number; // hora inteira (inclusive)
  end: number;   // hora inteira (exclusive — o slot precisa terminar até esta hora)
}

/**
 * Janela oficial de funcionamento online para uma data no formato "YYYY-MM-DD".
 */
export function getOperatingHours(dateISO: string): OperatingWindow {
  const [y, m, d] = dateISO.split("-").map(Number);
  const wd = new Date(y, (m ?? 1) - 1, d ?? 1).getDay(); // 0=dom .. 6=sáb
  if (wd === 0 || wd === 6) return { start: 7, end: 19 }; // sáb/dom
  if (wd === 5) return { start: 5, end: 22 }; // sexta
  return { start: 5, end: 23 }; // seg–qui
}

/**
 * Regra oficial: um intervalo `[startHour, endHour)` (horas fracionárias
 * aceitas) só é elegível para disponibilidade online se caber inteiro dentro
 * da janela de funcionamento — o fim precisa estar dentro do horário oficial.
 */
export function isWithinOnlineOperatingHours(
  dateISO: string,
  startHour: number,
  endHour: number,
): boolean {
  const { start, end } = getOperatingHours(dateISO);
  return startHour >= start && endHour <= end;
}

/**
 * Atalho para o caso mais comum: slot de 1h cheia começando em `hour`.
 */
export function isFullHourOnline(dateISO: string, hour: number): boolean {
  return isWithinOnlineOperatingHours(dateISO, hour, hour + 1);
}

/**
 * Um horário que já passou (dia anterior, ou hoje antes da hora atual) não
 * deve aparecer como "Disponível" nas telas online (portal do cliente,
 * agenda do professor) — ninguém reserva um horário que já aconteceu. O
 * mapa interno da secretaria/admin não usa esta checagem (não passa
 * enforceOnlineHours), então continua mostrando o dia inteiro normalmente
 * para consulta/histórico.
 */
export function isPastSlot(dateISO: string, hour: number, now: Date = new Date()): boolean {
  const [y, m, d] = dateISO.split("-").map(Number);
  const slotDate = new Date(y, (m ?? 1) - 1, d ?? 1);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (slotDate.getTime() < today.getTime()) return true;
  if (slotDate.getTime() > today.getTime()) return false;
  const nowHour = now.getHours() + now.getMinutes() / 60;
  return hour <= nowHour;
}
