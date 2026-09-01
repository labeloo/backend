/**
 * What a given deployment - and a given organization within it - is allowed to do.
 *
 * Labeloo ships as one codebase that runs two ways: a self-hosted community
 * edition where everything is unlimited and free, and a hosted cloud edition
 * that meters compute and sells plans. The difference must never be a fork, so
 * every "may this org do X?" question in the product routes through here. The
 * community edition answers "yes, unlimited" without touching the database,
 * which keeps the one-click self-host path zero-config and fast.
 *
 * This subsystem establishes the interface and the enforcement points. The real
 * per-plan numbers arrive with the SaaS subsystem; until then cloud gets a
 * single generous default so nothing is blocked before billing exists.
 */

import { eq } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql/driver-core';
import { orgSubscriptions } from './db/schema';
import plans from './config/plans.json';

export type Edition = 'community' | 'cloud';

export type Entitlements = {
    edition: Edition;
    plan: string;
    /** Feature switches, e.g. 'assist', 'training'. */
    features: Set<string>;
    /** Ceilings by key; -1 means unlimited. */
    limits: Record<string, number>;
};

/** Thrown when a feature is off or a quota is spent; routes map it to a status. */
export class EntitlementError extends Error {
    constructor(
        message: string,
        /** 402 for "your plan does not include this", 429 for "quota spent". */
        readonly status: 402 | 429,
        readonly code: string
    ) {
        super(message);
        this.name = 'EntitlementError';
    }
}

const UNLIMITED = -1;

/**
 * Read at call time, not at module load. On a Worker the environment is bound to
 * the runtime rather than to Node's `process.env` at import, so a module-scope
 * read can miss it; asking per call is cheap and always correct.
 */
export const currentEdition = (): Edition =>
    (process.env.EDITION || '').toLowerCase() === 'cloud' ? 'cloud' : 'community';

const COMMUNITY: Entitlements = {
    edition: 'community',
    plan: 'self-hosted',
    features: new Set(['assist', 'training']),
    limits: {
        'assist.callsPerDay': UNLIMITED,
        'training.gpuSecondsPerMonth': UNLIMITED,
        'training.concurrentJobs': UNLIMITED,
    },
};

type Plan = {
    key: string;
    name: string;
    priceMonthly: number;
    features: string[];
    limits: Record<string, number>;
};

/** The plan an org falls back to with no active subscription. */
const FREE_PLAN: Plan = (plans as Plan[]).find((p) => p.key === 'free')!;

const planToEntitlements = (plan: Plan): Entitlements => ({
    edition: 'cloud',
    plan: plan.key,
    features: new Set(plan.features),
    limits: plan.limits,
});

/**
 * Resolve what an organization may do. In the community edition this is a
 * constant and never touches the database. In the cloud edition it reads the
 * org's subscription, resolves the plan, and returns that plan's features and
 * limits; a missing, canceled or unknown-plan subscription resolves to Free.
 */
export const getEntitlements = async (
    db: LibSQLDatabase,
    orgId: number
): Promise<Entitlements> => {
    if (currentEdition() !== 'cloud') return COMMUNITY;

    const sub = await db
        .select()
        .from(orgSubscriptions)
        .where(eq(orgSubscriptions.organizationId, orgId))
        .get();

    if (!sub || sub.status !== 'active') return planToEntitlements(FREE_PLAN);
    const plan = (plans as Plan[]).find((p) => p.key === sub.plan) || FREE_PLAN;
    return planToEntitlements(plan);
};

/** The plan catalogue, for the billing screen and the admin panel. */
export const planCatalogue = (): Plan[] => plans as Plan[];

export const assertFeature = (ent: Entitlements, feature: string): void => {
    if (!ent.features.has(feature)) {
        throw new EntitlementError(
            `Your plan does not include "${feature}".`,
            402,
            'feature-not-in-plan'
        );
    }
};

/**
 * Enforce a numeric ceiling. `used` is what the caller has already consumed in
 * the relevant window; the caller owns that measurement (a ledger count, a live
 * job tally) because what "used" means differs per limit.
 */
export const assertWithinQuota = (
    ent: Entitlements,
    key: string,
    used: number
): void => {
    const limit = ent.limits[key];
    if (limit === undefined || limit === UNLIMITED) return;
    if (used >= limit) {
        throw new EntitlementError(
            `You have reached your plan limit for "${key}".`,
            429,
            'quota-exceeded'
        );
    }
};
