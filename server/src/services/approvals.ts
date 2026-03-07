import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { approvalComments, approvals, approvalSteps, agents } from "@paperclipai/db";
import { notFound, unprocessable, forbidden } from "../errors.js";
import { agentService } from "./agents.js";
import { notifyHireApproved } from "./hire-hook.js";

export function approvalService(db: Db) {
  const agentsSvc = agentService(db);
  const canResolveStatuses = new Set(["pending", "revision_requested"]);

  async function getExistingApproval(id: string) {
    const existing = await db
      .select()
      .from(approvals)
      .where(eq(approvals.id, id))
      .then((rows) => rows[0] ?? null);
    if (!existing) throw notFound("Approval not found");
    return existing;
  }

  async function getCurrentStep(approvalId: string, stepNumber: number) {
    return db
      .select()
      .from(approvalSteps)
      .where(
        and(eq(approvalSteps.approvalId, approvalId), eq(approvalSteps.stepNumber, stepNumber)),
      )
      .then((rows) => rows[0] ?? null);
  }

  async function runHireAgentHook(updated: typeof approvals.$inferSelect, approvalId: string) {
    const payload = updated.payload as Record<string, unknown>;
    const payloadAgentId = typeof payload.agentId === "string" ? payload.agentId : null;
    let hireApprovedAgentId: string | null = null;

    if (payloadAgentId) {
      await agentsSvc.activatePendingApproval(payloadAgentId);
      hireApprovedAgentId = payloadAgentId;
    } else {
      const created = await agentsSvc.create(updated.companyId, {
        name: String(payload.name ?? "New Agent"),
        role: String(payload.role ?? "general"),
        title: typeof payload.title === "string" ? payload.title : null,
        reportsTo: typeof payload.reportsTo === "string" ? payload.reportsTo : null,
        capabilities: typeof payload.capabilities === "string" ? payload.capabilities : null,
        adapterType: String(payload.adapterType ?? "process"),
        adapterConfig:
          typeof payload.adapterConfig === "object" && payload.adapterConfig !== null
            ? (payload.adapterConfig as Record<string, unknown>)
            : {},
        budgetMonthlyCents:
          typeof payload.budgetMonthlyCents === "number" ? payload.budgetMonthlyCents : 0,
        metadata:
          typeof payload.metadata === "object" && payload.metadata !== null
            ? (payload.metadata as Record<string, unknown>)
            : null,
        status: "idle",
        spentMonthlyCents: 0,
        permissions: undefined,
        lastHeartbeatAt: null,
      });
      hireApprovedAgentId = created?.id ?? null;
    }

    if (hireApprovedAgentId) {
      void notifyHireApproved(db, {
        companyId: updated.companyId,
        agentId: hireApprovedAgentId,
        source: "approval",
        sourceId: approvalId,
        approvedAt: new Date(),
      }).catch(() => {});
    }
  }

  return {
    list: (companyId: string, status?: string) => {
      const conditions = [eq(approvals.companyId, companyId)];
      if (status) conditions.push(eq(approvals.status, status));
      return db.select().from(approvals).where(and(...conditions));
    },

    getById: (id: string) =>
      db
        .select()
        .from(approvals)
        .where(eq(approvals.id, id))
        .then((rows) => rows[0] ?? null),

    create: (companyId: string, data: Omit<typeof approvals.$inferInsert, "companyId">) =>
      db
        .insert(approvals)
        .values({ ...data, companyId })
        .returning()
        .then((rows) => rows[0]),

    listSteps: (approvalId: string) =>
      db
        .select()
        .from(approvalSteps)
        .where(eq(approvalSteps.approvalId, approvalId))
        .orderBy(asc(approvalSteps.stepNumber)),

    createSteps: (
      approvalId: string,
      steps: Array<{
        stepNumber: number;
        approverUserId?: string | null;
        approverAgentId?: string | null;
        approverRole?: string | null;
      }>,
    ) =>
      db
        .insert(approvalSteps)
        .values(
          steps.map((s) => ({
            approvalId,
            stepNumber: s.stepNumber,
            approverUserId: s.approverUserId ?? null,
            approverAgentId: s.approverAgentId ?? null,
            approverRole: s.approverRole ?? null,
          })),
        )
        .returning(),

    createDeliverableReviewSteps: async (
      approvalId: string,
      requestedByAgentId: string,
    ) => {
      const agent = await db
        .select({ reportsTo: agents.reportsTo })
        .from(agents)
        .where(eq(agents.id, requestedByAgentId))
        .then((rows) => rows[0] ?? null);

      const steps: Array<{
        approvalId: string;
        stepNumber: number;
        approverAgentId: string | null;
        approverRole: string | null;
      }> = [];

      if (agent?.reportsTo) {
        steps.push({
          approvalId,
          stepNumber: 1,
          approverAgentId: agent.reportsTo,
          approverRole: null,
        });
        steps.push({
          approvalId,
          stepNumber: 2,
          approverAgentId: null,
          approverRole: "board",
        });
      } else {
        steps.push({
          approvalId,
          stepNumber: 1,
          approverAgentId: null,
          approverRole: "board",
        });
      }

      const totalSteps = steps.length;
      const created = await db.insert(approvalSteps).values(steps).returning();

      await db
        .update(approvals)
        .set({ totalSteps, currentStep: 1, updatedAt: new Date() })
        .where(eq(approvals.id, approvalId));

      return created;
    },

    assertApprover: async (
      approvalId: string,
      stepNumber: number,
      actor: { userId?: string; agentId?: string; isBoard?: boolean },
    ) => {
      const step = await getCurrentStep(approvalId, stepNumber);
      if (!step) throw notFound("Approval step not found");
      if (step.status !== "pending") {
        throw unprocessable("This step has already been decided");
      }

      if (step.approverRole === "board") {
        if (!actor.isBoard) throw forbidden("Only board members can approve this step");
        return step;
      }
      if (step.approverAgentId) {
        if (actor.agentId !== step.approverAgentId) {
          throw forbidden("Only the designated agent can approve this step");
        }
        return step;
      }
      if (step.approverUserId) {
        if (actor.userId !== step.approverUserId) {
          throw forbidden("Only the designated user can approve this step");
        }
        return step;
      }

      return step;
    },

    approve: async (
      id: string,
      decidedByUserId: string,
      decisionNote?: string | null,
      actor?: { userId?: string; agentId?: string; isBoard?: boolean },
    ) => {
      const existing = await getExistingApproval(id);
      if (!canResolveStatuses.has(existing.status)) {
        throw unprocessable("Only pending or revision requested approvals can be approved");
      }

      const now = new Date();
      const isMultiStep = existing.totalSteps > 1;

      if (isMultiStep) {
        const step = await getCurrentStep(id, existing.currentStep);
        if (step) {
          await db
            .update(approvalSteps)
            .set({
              status: "approved",
              decidedByUserId: actor?.userId ?? decidedByUserId,
              decidedByAgentId: actor?.agentId ?? null,
              decisionNote: decisionNote ?? null,
              decidedAt: now,
            })
            .where(eq(approvalSteps.id, step.id));
        }

        const isFinalStep = existing.currentStep >= existing.totalSteps;

        if (!isFinalStep) {
          const updated = await db
            .update(approvals)
            .set({
              currentStep: existing.currentStep + 1,
              updatedAt: now,
            })
            .where(eq(approvals.id, id))
            .returning()
            .then((rows) => rows[0]);
          return updated;
        }
      }

      const updated = await db
        .update(approvals)
        .set({
          status: "approved",
          decidedByUserId,
          decisionNote: decisionNote ?? null,
          decidedAt: now,
          updatedAt: now,
        })
        .where(eq(approvals.id, id))
        .returning()
        .then((rows) => rows[0]);

      if (updated.type === "hire_agent") {
        await runHireAgentHook(updated, id);
      }

      return updated;
    },

    reject: async (
      id: string,
      decidedByUserId: string,
      decisionNote?: string | null,
      actor?: { userId?: string; agentId?: string },
    ) => {
      const existing = await getExistingApproval(id);
      if (!canResolveStatuses.has(existing.status)) {
        throw unprocessable("Only pending or revision requested approvals can be rejected");
      }

      const now = new Date();

      if (existing.totalSteps > 1) {
        const step = await getCurrentStep(id, existing.currentStep);
        if (step) {
          await db
            .update(approvalSteps)
            .set({
              status: "rejected",
              decidedByUserId: actor?.userId ?? decidedByUserId,
              decidedByAgentId: actor?.agentId ?? null,
              decisionNote: decisionNote ?? null,
              decidedAt: now,
            })
            .where(eq(approvalSteps.id, step.id));
        }
      }

      const updated = await db
        .update(approvals)
        .set({
          status: "rejected",
          decidedByUserId,
          decisionNote: decisionNote ?? null,
          decidedAt: now,
          updatedAt: now,
        })
        .where(eq(approvals.id, id))
        .returning()
        .then((rows) => rows[0]);

      if (updated.type === "hire_agent") {
        const payload = updated.payload as Record<string, unknown>;
        const payloadAgentId = typeof payload.agentId === "string" ? payload.agentId : null;
        if (payloadAgentId) {
          await agentsSvc.terminate(payloadAgentId);
        }
      }

      return updated;
    },

    requestRevision: async (id: string, decidedByUserId: string, decisionNote?: string | null) => {
      const existing = await getExistingApproval(id);
      if (existing.status !== "pending") {
        throw unprocessable("Only pending approvals can request revision");
      }

      const now = new Date();
      return db
        .update(approvals)
        .set({
          status: "revision_requested",
          decidedByUserId,
          decisionNote: decisionNote ?? null,
          decidedAt: now,
          updatedAt: now,
        })
        .where(eq(approvals.id, id))
        .returning()
        .then((rows) => rows[0]);
    },

    resubmit: async (id: string, payload?: Record<string, unknown>) => {
      const existing = await getExistingApproval(id);
      if (existing.status !== "revision_requested") {
        throw unprocessable("Only revision requested approvals can be resubmitted");
      }

      const now = new Date();

      if (existing.totalSteps > 1) {
        await db
          .update(approvalSteps)
          .set({ status: "pending", decidedByUserId: null, decidedByAgentId: null, decisionNote: null, decidedAt: null })
          .where(eq(approvalSteps.approvalId, id));
      }

      return db
        .update(approvals)
        .set({
          status: "pending",
          currentStep: 1,
          payload: payload ?? existing.payload,
          decisionNote: null,
          decidedByUserId: null,
          decidedAt: null,
          updatedAt: now,
        })
        .where(eq(approvals.id, id))
        .returning()
        .then((rows) => rows[0]);
    },

    listComments: async (approvalId: string) => {
      const existing = await getExistingApproval(approvalId);
      return db
        .select()
        .from(approvalComments)
        .where(
          and(
            eq(approvalComments.approvalId, approvalId),
            eq(approvalComments.companyId, existing.companyId),
          ),
        )
        .orderBy(asc(approvalComments.createdAt));
    },

    addComment: async (
      approvalId: string,
      body: string,
      actor: { agentId?: string; userId?: string },
    ) => {
      const existing = await getExistingApproval(approvalId);
      return db
        .insert(approvalComments)
        .values({
          companyId: existing.companyId,
          approvalId,
          authorAgentId: actor.agentId ?? null,
          authorUserId: actor.userId ?? null,
          body,
        })
        .returning()
        .then((rows) => rows[0]);
    },
  };
}
