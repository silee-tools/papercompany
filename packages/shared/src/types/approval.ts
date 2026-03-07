import type { ApprovalStatus, ApprovalStepStatus, ApprovalType } from "../constants.js";

export interface Approval {
  id: string;
  companyId: string;
  type: ApprovalType;
  requestedByAgentId: string | null;
  requestedByUserId: string | null;
  status: ApprovalStatus;
  payload: Record<string, unknown>;
  decisionNote: string | null;
  decidedByUserId: string | null;
  decidedAt: Date | null;
  currentStep: number;
  totalSteps: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApprovalStep {
  id: string;
  approvalId: string;
  stepNumber: number;
  approverUserId: string | null;
  approverAgentId: string | null;
  approverRole: string | null;
  status: ApprovalStepStatus;
  decidedByUserId: string | null;
  decidedByAgentId: string | null;
  decisionNote: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

export interface ApprovalComment {
  id: string;
  companyId: string;
  approvalId: string;
  authorAgentId: string | null;
  authorUserId: string | null;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}
