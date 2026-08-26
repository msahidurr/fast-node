// Plain constants, not server-only -- app/routes/app.disputes.tsx renders
// these into <select> options in client-bundled component code, so this
// can't live in service.server.ts (a .server module imported from rendered
// JSX, not just loader/action, breaks the client build).
export const DISPUTE_TYPES = ["DAMAGED", "MISPRINT", "LOST"] as const;
export const DISPUTE_STATUSES = ["OPEN", "IN_REVIEW", "RESOLVED", "REJECTED"] as const;
