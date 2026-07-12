const pad = (value: number) => String(value).padStart(2, '0');

export function formatInboxTimestamp(value: string, now = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const sameYear = date.getFullYear() === now.getFullYear();
  const sameDay = sameYear
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();

  if (sameDay) return time;

  const monthDay = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return sameYear ? `${monthDay} ${time}` : `${date.getFullYear()}-${monthDay} ${time}`;
}

export function formatInboxDetailTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
