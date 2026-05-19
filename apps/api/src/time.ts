export const SLOT_MINUTES = 30

export function minutesFromTime(time: string) {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

export function timeFromMinutes(total: number) {
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function localDateTime(date: string, time: string) {
  return new Date(`${date}T${time}:00`)
}

export function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000)
}

export function buildSlotStarts(start: Date, durationMin: number) {
  const slots: Date[] = []
  for (let offset = 0; offset < durationMin; offset += SLOT_MINUTES) {
    slots.push(addMinutes(start, offset))
  }
  return slots
}

export function weekdayFromDate(date: string) {
  return new Date(`${date}T12:00:00`).getDay()
}

export function centsToMoney(cents: number) {
  return Number((cents / 100).toFixed(2))
}
