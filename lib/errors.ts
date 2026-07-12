// Typed errors so routes map to HTTP statuses by instanceof, never by message text.
export class ValidationError extends Error {}
export class NotFoundError extends Error {}
