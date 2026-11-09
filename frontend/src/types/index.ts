export interface User {
  id: string;
  username: string;
  workspaceId: string;
  roles: string[];
}

export interface Resource {
  id: string;
  name: string;
  workspaceId: string;
  expiryDate: string;
  amountMinor: string;
  currency: string;
}

export type RequestStatus =
  | 'PENDING'
  | 'REJECTED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'NEEDS_ATTENTION';

export interface RenewalRequest {
  id: string;
  resourceId: string;
  workspaceId: string;
  createdById: string;
  status: RequestStatus;
  oldDate: string;
  newDate: string;
  amountMinor: string;
  currency: string;
  idempotencyKey: string;
  approvedById: string | null;
  rejectedById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RequestHistory {
  id: string;
  requestId: string;
  actorId: string | null;
  actorUsername: string | null;
  fromStatus: string | null;
  toStatus: string;
  comment: string | null;
  createdAt: string;
}
