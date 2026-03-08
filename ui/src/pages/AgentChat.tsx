import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import type { Issue, IssueComment, Agent, HeartbeatRun } from "@paperclipai/shared";
import { agentsApi } from "@/api/agents";
import { issuesApi } from "@/api/issues";
import { heartbeatsApi } from "@/api/heartbeats";
import { useCompany } from "@/context/CompanyContext";
import { queryKeys } from "@/lib/queryKeys";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { MarkdownBody } from "@/components/MarkdownBody";
import { MarkdownEditor, type MarkdownEditorRef } from "@/components/MarkdownEditor";
import { AgentIcon } from "@/components/AgentIconPicker";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDateTime } from "@/lib/utils";
import { ArrowLeft, MessageSquare, Loader2, Zap, Clock } from "lucide-react";

const CHAT_LABEL_NAME = "chat";

interface ChatThread {
  issue: Issue;
  comments: IssueComment[];
}

function useChatLabel(companyId: string) {
  const queryClient = useQueryClient();
  const labelsQuery = useQuery({
    queryKey: queryKeys.issues.labels(companyId),
    queryFn: () => issuesApi.listLabels(companyId),
    enabled: !!companyId,
  });

  const chatLabel = labelsQuery.data?.find(
    (l) => l.name.toLowerCase() === CHAT_LABEL_NAME,
  );

  const ensureChatLabel = useCallback(async () => {
    if (chatLabel) return chatLabel.id;
    const created = await issuesApi.createLabel(companyId, {
      name: CHAT_LABEL_NAME,
      color: "#6366f1",
    });
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.labels(companyId) });
    return created.id;
  }, [chatLabel, companyId, queryClient]);

  return { chatLabel, ensureChatLabel, isLoading: labelsQuery.isLoading };
}

function RunStatusIndicator({ run }: { run: HeartbeatRun }) {
  const isRunning = run.status === "running";
  return (
    <div
      className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
        isRunning
          ? "bg-green-500/10 text-green-600 dark:text-green-400"
          : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
      }`}
    >
      {isRunning ? (
        <Zap className="h-3 w-3 animate-pulse" />
      ) : (
        <Clock className="h-3 w-3" />
      )}
      {isRunning ? "Running" : "Queued"}
    </div>
  );
}

function ChatBubble({
  comment,
  agent,
  isBoard,
}: {
  comment: IssueComment;
  agent?: Agent;
  isBoard: boolean;
}) {
  return (
    <div className={`flex ${isBoard ? "justify-end" : "justify-start"} mb-3`}>
      <div
        className={`max-w-[75%] rounded-lg px-3 py-2 ${
          isBoard
            ? "bg-primary text-primary-foreground"
            : "bg-muted"
        }`}
      >
        <div className="flex items-center gap-1.5 mb-1">
          {!isBoard && agent && (
            <AgentIcon icon={agent.icon} className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="text-xs font-medium opacity-80">
            {isBoard ? "You" : agent?.name ?? "Agent"}
          </span>
          <span className="text-[10px] opacity-50">
            {formatDateTime(comment.createdAt)}
          </span>
        </div>
        <MarkdownBody className={`text-sm ${isBoard ? "[&_*]:text-primary-foreground" : ""}`}>
          {comment.body}
        </MarkdownBody>
      </div>
    </div>
  );
}

function IssueHeader({
  issue,
}: {
  issue: Issue;
}) {
  return (
    <div className="flex items-center gap-2 py-2 px-3 bg-muted/30 rounded-md text-xs text-muted-foreground">
      <MessageSquare className="h-3.5 w-3.5" />
      <Link to={`/issues/${issue.identifier ?? issue.id}`} className="hover:underline font-medium">
        {issue.identifier}
      </Link>
      <span className="truncate">{issue.title}</span>
      <StatusBadge status={issue.status} />
    </div>
  );
}

function ThreadView({
  thread,
  agent,
}: {
  thread: ChatThread;
  agent?: Agent;
}) {
  return (
    <div className="mb-6">
      <IssueHeader issue={thread.issue} />
      <div className="mt-2 space-y-0.5">
        {thread.comments.map((comment) => {
          const isBoard = !comment.authorAgentId;
          return (
            <ChatBubble
              key={comment.id}
              comment={comment}
              agent={agent}
              isBoard={isBoard}
            />
          );
        })}
      </div>
    </div>
  );
}

export function AgentChat() {
  const { agentId } = useParams<{ agentId: string }>();
  const { selectedCompany } = useCompany();
  const companyId = selectedCompany?.id ?? "";
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MarkdownEditorRef>(null);
  const prevCommentCountRef = useRef(0);

  const { chatLabel, ensureChatLabel } = useChatLabel(companyId);

  // Agent info (auto-refreshed by LiveUpdatesProvider on agent.status events)
  const agentQuery = useQuery({
    queryKey: queryKeys.agents.detail(agentId!),
    queryFn: () => agentsApi.get(agentId!, companyId),
    enabled: !!agentId && !!companyId,
  });
  const agent = agentQuery.data;

  // Agent heartbeat runs (auto-refreshed by LiveUpdatesProvider on heartbeat.run.status events)
  const heartbeatsQuery = useQuery({
    queryKey: queryKeys.heartbeats(companyId, agentId),
    queryFn: () => heartbeatsApi.list(companyId, agentId, 5),
    enabled: !!companyId && !!agentId,
  });
  const activeRun = useMemo(
    () =>
      (heartbeatsQuery.data ?? []).find(
        (r) => r.status === "running" || r.status === "queued",
      ) ?? null,
    [heartbeatsQuery.data],
  );

  // Chat issues (no polling - LiveUpdatesProvider invalidates on activity.logged)
  const chatIssuesQuery = useQuery({
    queryKey: [...queryKeys.issues.list(companyId), "chat", agentId],
    queryFn: () =>
      issuesApi.list(companyId, {
        assigneeAgentId: agentId,
        labelId: chatLabel?.id,
      }),
    enabled: !!companyId && !!agentId && !!chatLabel,
  });
  const chatIssues = chatIssuesQuery.data ?? [];

  // Comments per issue via useQueries (auto-refreshed by LiveUpdatesProvider)
  const commentsResults = useQueries({
    queries: chatIssues.map((issue) => ({
      queryKey: queryKeys.issues.comments(issue.id),
      queryFn: () => issuesApi.listComments(issue.id),
      enabled: true,
    })),
  });

  const threads: ChatThread[] = useMemo(() => {
    return chatIssues
      .map((issue, idx) => ({
        issue,
        comments: commentsResults[idx]?.data ?? [],
      }))
      .sort(
        (a, b) =>
          new Date(b.issue.updatedAt).getTime() -
          new Date(a.issue.updatedAt).getTime(),
      );
  }, [chatIssues, commentsResults]);

  // Total comment count for smart auto-scroll
  const totalCommentCount = useMemo(
    () => threads.reduce((sum, t) => sum + t.comments.length, 0),
    [threads],
  );

  // Auto-scroll only when new messages arrive (not on initial load)
  useEffect(() => {
    if (totalCommentCount > prevCommentCountRef.current && prevCommentCountRef.current > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevCommentCountRef.current = totalCommentCount;
  }, [totalCommentCount]);

  // Scroll to bottom on first meaningful load
  const initialScrollDone = useRef(false);
  useEffect(() => {
    if (!initialScrollDone.current && totalCommentCount > 0) {
      initialScrollDone.current = true;
      messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
    }
  }, [totalCommentCount]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || !agentId || !companyId) return;

      setSubmitting(true);
      try {
        if (activeThreadId) {
          await issuesApi.addComment(activeThreadId, text);
          queryClient.invalidateQueries({
            queryKey: queryKeys.issues.comments(activeThreadId),
          });
        } else {
          const labelId = await ensureChatLabel();
          const firstLine = text.split("\n")[0]!.slice(0, 100);
          const issue = await issuesApi.create(companyId, {
            title: firstLine,
            description: text,
            assigneeAgentId: agentId,
            status: "todo",
            labelIds: [labelId],
          });
          await issuesApi.addComment(issue.id, text);
          queryClient.invalidateQueries({
            queryKey: [...queryKeys.issues.list(companyId), "chat", agentId],
          });
          setActiveThreadId(issue.id);
        }
        setBody("");
      } finally {
        setSubmitting(false);
      }
    },
    [activeThreadId, agentId, companyId, ensureChatLabel, queryClient],
  );

  async function handleSubmit() {
    await sendMessage(body);
  }

  const canSubmit = !submitting && !!body.trim();

  if (!agentId) return null;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Link to={`/agents/${agentId}`}>
          <ArrowLeft className="h-4 w-4 text-muted-foreground hover:text-foreground" />
        </Link>
        {agent && (
          <>
            <AgentIcon icon={agent.icon} className="h-6 w-6" />
            <div>
              <h1 className="text-sm font-semibold">{agent.name} Chat</h1>
              <p className="text-xs text-muted-foreground">{agent.role}</p>
            </div>
          </>
        )}
        {agent?.status && (
          <StatusBadge status={agent.status} />
        )}
        {activeRun && <RunStatusIndicator run={activeRun} />}
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {chatIssuesQuery.isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : threads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <MessageSquare className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">
              No messages yet. Send a message to start a conversation.
            </p>
          </div>
        ) : (
          <>
            {threads.map((thread) => (
              <ThreadView
                key={thread.issue.id}
                thread={thread}
                agent={agent ?? undefined}
              />
            ))}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Active thread selector */}
      {threads.length > 0 && (
        <div className="border-t border-border px-4 py-2 flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Thread:</span>
          <button
            type="button"
            className={`px-2 py-1 rounded ${
              !activeThreadId
                ? "bg-primary text-primary-foreground"
                : "bg-muted hover:bg-muted/80"
            }`}
            onClick={() => setActiveThreadId(null)}
          >
            New
          </button>
          {threads.slice(0, 5).map((thread) => (
            <button
              key={thread.issue.id}
              type="button"
              className={`px-2 py-1 rounded truncate max-w-[150px] ${
                activeThreadId === thread.issue.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted hover:bg-muted/80"
              }`}
              onClick={() => setActiveThreadId(thread.issue.id)}
              title={thread.issue.title}
            >
              {thread.issue.identifier ?? thread.issue.title.slice(0, 20)}
            </button>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="border-t border-border px-4 py-3">
        <div className="flex gap-2">
          <div className="flex-1">
            <MarkdownEditor
              ref={editorRef}
              value={body}
              onChange={setBody}
              placeholder="Send a message..."
              onSubmit={handleSubmit}
              contentClassName="min-h-[40px] max-h-[120px] text-sm"
            />
          </div>
          <Button
            size="sm"
            disabled={!canSubmit}
            onClick={handleSubmit}
            className="self-end"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Send"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
