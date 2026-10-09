// Profile endpoints: avatar upload/remove/serve and password change.

import { hashPassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, verifyPassword } from './password'
import { destroyOtherSessions, type SessionUser } from './session'

// The browser sends a cropped 400x400 JPEG (~50 KB). This cap is a backstop that
// also keeps us under D1's 2,000,000-byte limit per value.
const MAX_AVATAR_BYTES = 1_000_000

export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp'

/** Detects the image type from its first bytes, so we never trust the Content-Type header alone. */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  const startsWith = (sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b)
  if (startsWith([0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp' // RIFF....WEBP
  return null
}

export async function uploadAvatar(db: D1Database, request: Request, user: SessionUser): Promise<Response> {
  const declaredLength = Number(request.headers.get('Content-Length') ?? 0)
  if (declaredLength > MAX_AVATAR_BYTES) {
    return Response.json({ error: 'Image is too large' }, { status: 413 })
  }

  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.byteLength === 0) {
    return Response.json({ error: 'No image received' }, { status: 400 })
  }
  if (bytes.byteLength > MAX_AVATAR_BYTES) {
    return Response.json({ error: 'Image is too large' }, { status: 413 })
  }

  const contentType = sniffImageType(bytes)
  if (!contentType) {
    return Response.json({ error: 'Only JPG, PNG or WebP images are allowed' }, { status: 415 })
  }

  await db
    .prepare(
      `INSERT INTO user_avatars (user_id, content_type, data) VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         content_type = excluded.content_type, data = excluded.data, updated_at = datetime('now')`,
    )
    .bind(user.id, contentType, bytes)
    .run()

  return Response.json({ ok: true })
}

export async function deleteAvatar(db: D1Database, user: SessionUser): Promise<Response> {
  await db.prepare('DELETE FROM user_avatars WHERE user_id = ?').bind(user.id).run()
  return Response.json({ ok: true })
}

/** Serves a user's avatar. Only users of the same store can see it. */
export async function serveAvatar(db: D1Database, userId: number, viewer: SessionUser): Promise<Response> {
  const row = await db
    .prepare(
      `SELECT a.content_type, a.data FROM user_avatars a JOIN users u ON u.id = a.user_id
       WHERE a.user_id = ? AND u.store_id = ?`,
    )
    .bind(userId, viewer.store_id)
    .first<{ content_type: string; data: ArrayBuffer | number[] }>()
  if (!row) return Response.json({ error: 'Not found' }, { status: 404 })

  return new Response(new Uint8Array(row.data), {
    headers: {
      'Content-Type': row.content_type,
      'X-Content-Type-Options': 'nosniff',
      // URLs carry ?v=<updated_at>, so a new upload gets a new URL
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  })
}

export async function changePassword(db: D1Database, request: Request, user: SessionUser): Promise<Response> {
  const body = await request
    .json<{ currentPassword?: string; newPassword?: string }>()
    .catch(() => null)
  if (typeof body?.newPassword !== 'string' || !body.newPassword) {
    return Response.json({ error: 'New password is required' }, { status: 400 })
  }
  if (body.newPassword.length < MIN_PASSWORD_LENGTH || body.newPassword.length > MAX_PASSWORD_LENGTH) {
    return Response.json(
      { error: `New password must be ${MIN_PASSWORD_LENGTH}–${MAX_PASSWORD_LENGTH} characters` },
      { status: 400 },
    )
  }

  const row = await db
    .prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(user.id)
    .first<{ password_hash: string }>()
  if (!row) return Response.json({ error: 'Not logged in' }, { status: 401 })
  // Users who signed up with Google have no password yet, so there's no current one to check
  const hasPassword = row.password_hash !== ''
  if (hasPassword && !(await verifyPassword(body.currentPassword ?? '', row.password_hash))) {
    return Response.json({ error: 'Current password is incorrect' }, { status: 400 })
  }
  if (hasPassword && body.currentPassword === body.newPassword) {
    return Response.json({ error: 'New password must be different from the current one' }, { status: 400 })
  }

  await db
    .prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(await hashPassword(body.newPassword), user.id)
    .run()

  // Anyone else signed in with the old password gets logged out
  await destroyOtherSessions(db, request, user.id)

  return Response.json({ ok: true })
}
