/** Reads an API response, throwing its error message on failure. */
export async function readJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`)
  return data as T
}

/** Sends a JSON body and reads the JSON response. */
export async function sendJson<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return readJson<T>(res)
}

/** Parses a D1 "YYYY-MM-DD HH:MM:SS" (UTC) timestamp. */
export function parseDbDate(value: string): Date {
  return new Date(value.replace(' ', 'T') + 'Z')
}
