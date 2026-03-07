import { pgTable, uuid, text, timestamp, index, integer } from "drizzle-orm/pg-core";
import { approvals } from "./approvals.js";
import { agents } from "./agents.js";

export const approvalSteps = pgTable(
  "approval_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    approvalId: uuid("approval_id").notNull().references(() => approvals.id),
    stepNumber: integer("step_number").notNull(),
    approverUserId: text("approver_user_id"),
    approverAgentId: uuid("approver_agent_id").references(() => agents.id),
    approverRole: text("approver_role"),
    status: text("status").notNull().default("pending"),
    decidedByUserId: text("decided_by_user_id"),
    decidedByAgentId: uuid("decided_by_agent_id").references(() => agents.id),
    decisionNote: text("decision_note"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    approvalIdx: index("approval_steps_approval_idx").on(table.approvalId),
    approvalStepIdx: index("approval_steps_approval_step_idx").on(
      table.approvalId,
      table.stepNumber,
    ),
  }),
);
