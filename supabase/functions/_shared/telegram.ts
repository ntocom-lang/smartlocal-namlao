// Shared Telegram send helper (retry + backoff) used by notify-telegram
// and fleet-doc-expiry-notify. Single source of truth so both functions
// see identical retry/rate-limit behaviour — do not duplicate this logic.

export type TelegramSendResult =
  | { ok: true; attempts: number; messageId: unknown }
  | { ok: false; attempts: number; error: string }

export function cleanText(value: unknown, maxLength = 500) {
  return String(value ?? '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

export function escapeHtml(value: unknown, maxLength = 500) {
  return cleanText(value, maxLength)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function formatThaiDate(dateValue: unknown) {
  const value = cleanText(dateValue, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return ''
  const date = new Date(`${value}T00:00:00+07:00`)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('th-TH', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok',
  })
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  botToken: string,
): Promise<TelegramSendResult> {
  let lastError = 'Telegram request failed'
  let attempts = 0

  for (let index = 0; index < 3; index += 1) {
    attempts += 1
    try {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
      })
      const result = await response.json().catch(() => ({})) as Record<string, unknown>
      if (response.ok && result.ok === true) {
        const telegramResult = result.result as Record<string, unknown> | undefined
        return { ok: true, attempts, messageId: telegramResult?.message_id ?? null }
      }

      lastError = cleanText(result.description ?? `Telegram HTTP ${response.status}`, 500)
      const retryAfter = Number((result.parameters as Record<string, unknown> | undefined)?.retry_after ?? 0)
      const transient = response.status === 429 || response.status >= 500
      if (!transient || index === 2) break
      const delayMs = retryAfter > 0 ? Math.min(retryAfter, 5) * 1000 : 500 * (2 ** index)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    } catch (error) {
      lastError = cleanText(error instanceof Error ? error.message : error, 500)
      if (index < 2) await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** index)))
    }
  }

  return { ok: false, attempts, error: lastError }
}
