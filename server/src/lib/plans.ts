/**
 * Plan limits. Only `free` exists for now; paid plans are a row in this table
 * plus a billing integration that sets profile.plan.
 */
export interface Plan {
  /** Requests per minute, per API key or per signed-in session. */
  requestsPerMinute: number;
  maxProjects: number;
  maxTemplates: number;
  maxApiKeys: number;
  /** Minutes of cloud-rendered video per calendar month. 0 disables rendering. */
  renderMinutesPerMonth: number;
}

export const PLANS: Record<string, Plan> = {
  free: { requestsPerMinute: 120, maxProjects: 50, maxTemplates: 20, maxApiKeys: 3, renderMinutesPerMonth: 0 },
};

export const planFor = (name: string | null | undefined): Plan => PLANS[name ?? 'free'] ?? PLANS.free;
