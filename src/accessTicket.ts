/**
 * Short-lived signed tickets for serving files to `<img>` tags.
 *
 * The bucket routes were mounted before the JWT middleware, so every uploaded
 * image and every extracted video frame was readable by anyone who knew - or
 * guessed - a path. Moving them behind the JWT is not enough on its own: a
 * browser sends no Authorization header with an `<img src>`, and the cookie the
 * app stores belongs to the frontend's origin, not the API's, so it never
 * reaches a cross-origin API either.
 *
 * A ticket in the query string is what an `<img>` can actually carry. It is
 * signed with the same secret as the JWT, expires quickly, and names the
 * projects its holder may read, so verifying one costs no database round trip
 * on a path that serves a hundred thumbnails at a time.
 *
 * Web Crypto rather than node:crypto: the same code has to run on Node and on a
 * Worker.
 */

export type TicketPayload = {
    /** Who the ticket was issued to. */
    u: number;
    /** Projects this holder may read files from. */
    p: number[];
    /** Unix seconds. */
    e: number;
};

/** An hour is long enough for a working session and short enough that a leaked
 *  URL in a log or a referrer stops working the same day. */
export const TICKET_TTL_SECONDS = 60 * 60;

/**
 * Ticket size is bounded on purpose. Someone who belongs to a thousand projects
 * would otherwise get a URL too long for some proxies; past the cap the ticket
 * carries the newest projects, which are the ones being worked on.
 */
const MAX_PROJECTS_IN_TICKET = 200;

const encoder = new TextEncoder();

const b64url = (bytes: Uint8Array) => {
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const unb64url = (text: string) => {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
};

const keyFor = (secret: string) =>
    crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
        'sign',
        'verify',
    ]);

/** Constant-time-ish comparison; never compare signatures with ===. */
const sameBytes = (a: Uint8Array, b: Uint8Array) => {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
    return diff === 0;
};

export const issueTicket = async (
    secret: string,
    userId: number,
    projectIds: number[],
    nowSeconds: number
): Promise<{ ticket: string; expiresAt: number }> => {
    const expiresAt = nowSeconds + TICKET_TTL_SECONDS;
    const payload: TicketPayload = {
        u: userId,
        p: [...new Set(projectIds)].sort((a, b) => b - a).slice(0, MAX_PROJECTS_IN_TICKET),
        e: expiresAt,
    };
    const body = b64url(encoder.encode(JSON.stringify(payload)));
    const signature = await crypto.subtle.sign('HMAC', await keyFor(secret), encoder.encode(body));
    return { ticket: `${body}.${b64url(new Uint8Array(signature))}`, expiresAt };
};

/** Returns the payload, or null for anything malformed, unsigned or expired. */
export const verifyTicket = async (
    secret: string,
    ticket: string | undefined | null,
    nowSeconds: number
): Promise<TicketPayload | null> => {
    if (!ticket) return null;
    const dot = ticket.indexOf('.');
    if (dot <= 0) return null;

    const body = ticket.slice(0, dot);
    let given: Uint8Array;
    try {
        given = unb64url(ticket.slice(dot + 1));
    } catch {
        return null;
    }

    const expected = new Uint8Array(
        await crypto.subtle.sign('HMAC', await keyFor(secret), encoder.encode(body))
    );
    if (!sameBytes(given, expected)) return null;

    let payload: TicketPayload;
    try {
        payload = JSON.parse(new TextDecoder().decode(unb64url(body)));
    } catch {
        return null;
    }

    if (typeof payload?.e !== 'number' || payload.e <= nowSeconds) return null;
    if (typeof payload?.u !== 'number' || !Array.isArray(payload?.p)) return null;
    return payload;
};

export const ticketAllowsProject = (payload: TicketPayload, projectId: number) =>
    Number.isFinite(projectId) && payload.p.includes(projectId);
