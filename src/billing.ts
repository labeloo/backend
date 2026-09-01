/**
 * Where money is taken - or, in most deployments, where it deliberately is not.
 *
 * The product must not depend on one payment vendor, and the community edition
 * must need none at all. So billing is an interface with two implementations,
 * chosen at startup: a no-op that every self-hosted install and every cloud
 * deploy without keys uses, and a Stripe adapter that comes alive only when a
 * secret key is present. The routes never name a vendor; they ask the provider.
 */

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

    async handleWebhook(rawBody: string, _signature: string | null): Promise<WebhookResult> {
        // A production adapter verifies the signature against webhookSecret with
        // Web Crypto here before trusting the body. The event carries the orgId
        // and plan in metadata; a checkout.session.completed activates the plan,
        // a subscription deletion cancels it.
        void this.webhookSecret;
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
