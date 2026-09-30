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
  /** Largest output: the short side in pixels (720, 1080, 1440, 2160). */
  renderMaxShortSide: number;
  /** Longest single render, in seconds. */
  renderMaxSeconds: number;
  /** Total bytes of media one render job may upload. */
  renderMaxUploadBytes: number;
}

const MB = 1024 * 1024;

export const PLANS: Record<string, Plan> = {
  free: {
    requestsPerMinute: 120, maxProjects: 50, maxTemplates: 20, maxApiKeys: 3,
    renderMinutesPerMonth: 0, renderMaxShortSide: 0, renderMaxSeconds: 0, renderMaxUploadBytes: 0,
  },
  /** Paid tier: cloud rendering enabled. Assigned by setting profile.plan until billing exists. */
  creator: {
    requestsPerMinute: 600, maxProjects: 500, maxTemplates: 200, maxApiKeys: 10,
    renderMinutesPerMonth: 120, renderMaxShortSide: 2160, renderMaxSeconds: 15 * 60, renderMaxUploadBytes: 1024 * MB,
  },
};

export const planFor = (name: string | null | undefined): Plan => PLANS[name ?? 'free'] ?? PLANS.free;
