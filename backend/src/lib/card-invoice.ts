// Ciclo de fatura do cartão de crédito (Fase 4).

function capDay(year: number, month: number, day: number): Date {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, lastDay), 0, 0, 0, 0);
}

/**
 * Período da fatura vigente em `ref`:
 * [fechamento anterior (inclusive), próximo fechamento (exclusive)).
 * Retorna também o vencimento correspondente (dueDay >= fim do ciclo).
 */
export function invoicePeriod(
  closingDay: number,
  dueDay: number,
  ref: Date = new Date(),
): { start: Date; end: Date; dueDate: Date } {
  const thisClosing = capDay(ref.getFullYear(), ref.getMonth(), closingDay);
  const start =
    ref >= thisClosing
      ? thisClosing
      : capDay(
          ref.getMonth() === 0 ? ref.getFullYear() - 1 : ref.getFullYear(),
          ref.getMonth() === 0 ? 11 : ref.getMonth() - 1,
          closingDay,
        );
  const end = capDay(
    start.getMonth() === 11 ? start.getFullYear() + 1 : start.getFullYear(),
    start.getMonth() === 11 ? 0 : start.getMonth() + 1,
    closingDay,
  );

  // Vencimento: primeiro `dueDay` em ou após o fim do ciclo.
  let dueYear = end.getFullYear();
  let dueMonth = end.getMonth();
  if (end.getDate() > dueDay) {
    dueMonth += 1;
    if (dueMonth > 11) {
      dueMonth = 0;
      dueYear += 1;
    }
  }
  const dueDate = capDay(dueYear, dueMonth, dueDay);
  return { start, end, dueDate };
}
