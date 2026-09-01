/**
 * Where money is taken - or, in most deployments, where it deliberately is not.
 *
 * The product must not depend on one payment vendor, and the community edition
 * must need none at all. So billing is an interface with two implementations,
 * chosen at startup: a no-op that every self-hosted install and every cloud
 * deploy without keys uses, and a Stripe adapter that comes alive only when a
 * secret key is present. The routes never name a vendor; they ask the provider.
 */


/**
 * Verify a Stripe webhook signature (t=,v1= scheme) with Web Crypto, so it runs
 * on both Node and a Worker. Without this the webhook is an open door: it carries
 * no user auth, so a forged body would let anyone grant their org any plan. An
 * event older than the tolerance is rejected too, to stop a captured one being
 * replayed. Empty secret => cannot verify => reject.
 */
const TOLERANCE_SECONDS = 5 * 60;

const timingSafeEqualHex = (a: string, b: string): boolean => {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
};

export const verifyStripeSignature = async (
    rawBody: string,
    header: string | null,
    secret: string
): Promise<boolean> => {
    if (!secret || !header) return false;

    const parts = Object.fromEntries(
        header.split(',').map((kv) => {
            const i = kv.indexOf('=');
            return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
        })
    );
    const timestamp = parts['t'];
    const given = parts['v1'];
    if (!timestamp || !given) return false;

    const age = Math.floor(Date.now() / 1000) - Number(timestamp);
    if (!Number.isFinite(age) || Math.abs(age) > TOLERANCE_SECONDS) return false;

    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw',
        enc.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const mac = new Uint8Array(
        await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${rawBody}`))
    );
    const expected = Array.from(mac)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    return timingSafeEqualHex(expected, given);
};

export type CheckoutResult = { url?: string; message?: string };
export type WebhookResult = { orgId: number; plan: string; status: 'active' | 'past_due' | 'canceled' } | null;

export interface BillingProvider {
    readonly name: 'none' | 'stripe';
    /** Begin an upgrade. May return a hosted URL to redirect to, or a message. */
    createCheckout(orgId: number, plan: string): Promise<CheckoutResult>;
    /** Interpret a provider callback. Returns the change to apply, or null. */
    handleWebhook(rawBody: string, signature: string | null): Promise<WebhookResult>;
}

/**
 * The default. Upgrades are not self-serve; an operator sets the plan in the
 * admin panel. This is the right path for self-host and for sales-assisted cloud
 * onboarding, and it means the whole SaaS structure ships without a Stripe account.
 */
class NoopBilling implements BillingProvider {
    readonly name = 'none' as const;
    async createCheckout(): Promise<CheckoutResult> {
        return {
            message:
                'Self-serve billing is not configured on this deployment. An administrator can set your plan directly.',
        };
    }
    async handleWebhook(): Promise<WebhookResult> {
        return null;
    }
}

/**
 * Stripe. Written now, inert until STRIPE_SECRET_KEY is set, so no account is
 * needed to ship the structure. Talks to Stripe over its REST API with `fetch`
 * rather than the SDK, so it adds no dependency and runs on a Worker unchanged.
 * Checkout price ids come from env (one per plan), keeping this vendor-specific
 * detail out of the plan catalogue.
 */
class StripeBilling implements BillingProvider {
    readonly name = 'stripe' as const;
    constructor(
        private secretKey: string,
        private webhookSecret: string,
        private priceIds: Record<string, string>,
        private successUrl: string,
        private cancelUrl: string
    ) {}

    async createCheckout(orgId: number, plan: string): Promise<CheckoutResult> {
        const price = this.priceIds[plan];
        if (!price) return { message: `No Stripe price is configured for the "${plan}" plan.` };

        const body = new URLSearchParams({
            mode: 'subscription',
            'line_items[0][price]': price,
            'line_items[0][quantity]': '1',
            success_url: this.successUrl,
            cancel_url: this.cancelUrl,
            'metadata[orgId]': String(orgId),
            'metadata[plan]': plan,
        });
        const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.secretKey}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body,
        });
        if (!response.ok) return { message: `Stripe rejected the checkout: HTTP ${response.status}` };
        const session = (await response.json()) as any;
        return { url: session.url };
    }

    async handleWebhook(rawBody: string, signature: string | null): Promise<WebhookResult> {
        // The webhook route has no user auth, so the signature IS the auth. A
        // forged body that skipped this check could upgrade any org to any plan
        // for free, so an unverifiable event is dropped, full stop.
        if (!(await verifyStripeSignature(rawBody, signature, this.webhookSecret))) return null;

        let event: any;
        try {
            event = JSON.parse(rawBody);
        } catch {
            return null;
        }
        const meta = event?.data?.object?.metadata || {};
        const orgId = Number(meta.orgId);
        if (!Number.isInteger(orgId)) return null;

        if (event.type === 'checkout.session.completed') {
            return { orgId, plan: meta.plan || 'starter', status: 'active' };
        }
        if (event.type === 'customer.subscription.deleted') {
            return { orgId, plan: 'free', status: 'canceled' };
        }
        return null;
    }
}

/** Chosen once at startup from the environment. */
export const billingProvider: BillingProvider = process.env.STRIPE_SECRET_KEY
    ? new StripeBilling(
          process.env.STRIPE_SECRET_KEY,
          process.env.STRIPE_WEBHOOK_SECRET || '',
          {
              starter: process.env.STRIPE_PRICE_STARTER || '',
              pro: process.env.STRIPE_PRICE_PRO || '',
          },
          process.env.BILLING_SUCCESS_URL || 'https://app.labeloo.app/organizations',
          process.env.BILLING_CANCEL_URL || 'https://app.labeloo.app/organizations'
      )
    : new NoopBilling();
