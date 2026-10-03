// Only explicit customer acquisition/date fields are promoted. Ambiguous or invalid
// values stay in the retained source snapshot for the merchant to review.
export function migrationProfileFields(profile = {}) {
  const sourceValues = [...new Set(['获客来源', '来源渠道'].map(k => String(profile[k] ?? '').trim()).filter(Boolean))]
  const dateValues = [...new Set(['原建档日期', '建档日期', '入会日期'].map(k => String(profile[k] ?? '').trim()).filter(Boolean))]
  const fields = {}
  if (sourceValues.length === 1 && sourceValues[0].length <= 120) fields.acquisitionSource = sourceValues[0]
  if (dateValues.length === 1) {
    const match = dateValues[0].match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
    if (match) {
      const date = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
      const parsed = Date.parse(date + 'T00:00:00Z')
      if (Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0,10) === date) fields.originalJoinedDate = date
    }
  }
  return fields
}
