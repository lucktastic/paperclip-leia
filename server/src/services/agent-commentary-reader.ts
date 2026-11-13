import { and, count, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { agentCommentary, agentCommentaryVotes, agents, heartbeatRuns, issues, type Db } from "@paperclipai/db";
import type {
  AgentCommentaryDetail, AgentCommentaryEntry, AgentCommentaryPage, AgentCommentaryQuery, AgentCommentaryVoteState,
} from "@paperclipai/shared";

const voteCount = sql<number>`(select count(*)::int from ${agentCommentaryVotes} where ${agentCommentaryVotes.commentaryId} = ${agentCommentary.id})`;

function voteFields(viewerUserId: string | null) {
  return {
    voteCount,
    votedByMe: viewerUserId
      ? sql<boolean>`exists(select 1 from ${agentCommentaryVotes} where ${agentCommentaryVotes.commentaryId} = ${agentCommentary.id} and ${agentCommentaryVotes.userId} = ${viewerUserId})`
      : sql<boolean>`false`,
  };
}

const entryFields = {
  id: agentCommentary.id,
  kind: agentCommentary.kind,
  preview: sql<string>`left(${agentCommentary.body}, 280)`,
  createdAt: agentCommentary.createdAt,
  agent: { id: agents.id, name: agents.name, icon: agents.icon },
  runId: agentCommentary.runId,
  task: { id: issues.id, identifier: issues.identifier, title: issues.title },
};

export function agentCommentaryReader(db: Db) {
  function visible(companyId: string, readCondition: SQL) {
    return and(
      eq(agentCommentary.companyId, companyId),
      or(
        and(isNull(agentCommentary.issueId), sql`coalesce(
          ${heartbeatRuns.nativeIssueId}::text,
          ${heartbeatRuns.contextSnapshot}->>'issueId',
          ${heartbeatRuns.contextSnapshot}->>'taskId'
        ) is null`),
        and(sql`${issues.id} is not null`, readCondition),
      ),
    );
  }

  function entries(viewerUserId: string | null) {
    return db.select({ ...entryFields, ...voteFields(viewerUserId) }).from(agentCommentary)
      .innerJoin(agents, and(eq(agents.id, agentCommentary.agentId), eq(agents.companyId, agentCommentary.companyId)))
      .innerJoin(heartbeatRuns, and(eq(heartbeatRuns.id, agentCommentary.runId), eq(heartbeatRuns.companyId, agentCommentary.companyId)))
      .leftJoin(issues, and(eq(issues.id, agentCommentary.issueId), eq(issues.companyId, agentCommentary.companyId)));
  }

  return {
    async list(companyId: string, query: AgentCommentaryQuery, readCondition: SQL, viewerUserId: string | null = null): Promise<AgentCommentaryPage> {
      const where = and(
        visible(companyId, readCondition),
        query.agentId ? eq(agentCommentary.agentId, query.agentId) : undefined,
        query.kind ? eq(agentCommentary.kind, query.kind) : undefined,
        query.q ? ilike(agentCommentary.body, `%${query.q.replace(/[\\%_]/g, "\\$&")}%`) : undefined,
      );
      const [rows, totals] = await Promise.all([
        entries(viewerUserId).where(where)
          .orderBy(...(query.sort === "votes" ? [desc(voteCount)] : []), desc(agentCommentary.createdAt), desc(agentCommentary.id))
          .limit(query.limit).offset(query.offset),
        db.select({ total: count() }).from(agentCommentary)
          .innerJoin(agents, and(eq(agents.id, agentCommentary.agentId), eq(agents.companyId, agentCommentary.companyId)))
          .innerJoin(heartbeatRuns, and(eq(heartbeatRuns.id, agentCommentary.runId), eq(heartbeatRuns.companyId, agentCommentary.companyId)))
          .leftJoin(issues, and(eq(issues.id, agentCommentary.issueId), eq(issues.companyId, agentCommentary.companyId)))
          .where(where),
      ]);
      return {
        items: rows.map((row): AgentCommentaryEntry => ({ ...row, createdAt: row.createdAt.toISOString() })),
        total: totals[0]?.total ?? 0,
        limit: query.limit,
        offset: query.offset,
      };
    },

    async get(companyId: string, id: string, readCondition: SQL, viewerUserId: string | null = null): Promise<AgentCommentaryDetail | null> {
      const [row] = await db.select({ ...entryFields, ...voteFields(viewerUserId), body: agentCommentary.body }).from(agentCommentary)
        .innerJoin(agents, and(eq(agents.id, agentCommentary.agentId), eq(agents.companyId, agentCommentary.companyId)))
        .innerJoin(heartbeatRuns, and(eq(heartbeatRuns.id, agentCommentary.runId), eq(heartbeatRuns.companyId, agentCommentary.companyId)))
        .leftJoin(issues, and(eq(issues.id, agentCommentary.issueId), eq(issues.companyId, agentCommentary.companyId)))
        .where(and(visible(companyId, readCondition), eq(agentCommentary.id, id))).limit(1);
      return row ? { ...row, createdAt: row.createdAt.toISOString() } : null;
    },

    async setVote(companyId: string, id: string, readCondition: SQL, userId: string, voted: boolean): Promise<AgentCommentaryVoteState | null> {
      return db.transaction(async (tx) => {
        const [target] = await tx.select({ id: agentCommentary.id }).from(agentCommentary)
          .innerJoin(heartbeatRuns, and(eq(heartbeatRuns.id, agentCommentary.runId), eq(heartbeatRuns.companyId, agentCommentary.companyId)))
          .leftJoin(issues, and(eq(issues.id, agentCommentary.issueId), eq(issues.companyId, agentCommentary.companyId)))
          .where(and(visible(companyId, readCondition), eq(agentCommentary.id, id)))
          .limit(1).for("share", { of: agentCommentary });
        if (!target) return null;
        if (voted) {
          await tx.insert(agentCommentaryVotes).values({ commentaryId: id, companyId, userId }).onConflictDoNothing();
        } else {
          await tx.delete(agentCommentaryVotes).where(and(eq(agentCommentaryVotes.commentaryId, id), eq(agentCommentaryVotes.userId, userId)));
        }
        const [state] = await tx.select({ id: agentCommentary.id, ...voteFields(userId) }).from(agentCommentary).where(eq(agentCommentary.id, id));
        return state;
      });
    },
  };
}
