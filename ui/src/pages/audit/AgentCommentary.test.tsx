// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/context/ThemeContext";
import { AgentCommentary } from "./AgentCommentary";

const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), vote: vi.fn(), removeVote: vi.fn() }));
vi.mock("@/api/agentCommentary", () => ({ agentCommentaryApi: mocks }));
vi.mock("@/api/agents", () => ({ agentsApi: { list: async () => [] } }));
vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompany: { issuePrefix: "TES" } }),
  useOptionalCompany: () => null,
}));

const entry = {
  id: "20000000-0000-4000-8000-000000000001",
  agent: { id: "10000000-0000-4000-8000-000000000001", name: "Writer", icon: null },
  runId: "30000000-0000-4000-8000-000000000001",
  kind: "suggestion", preview: "Preserve context", body: "Preserve context across retries.",
  createdAt: "2026-10-19T12:00:00Z", task: null, voteCount: 2, votedByMe: false,
};

describe("Commentary links and pagination", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let client: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, "", "/TES/activity/commentary");
    mocks.list.mockImplementation(async (_companyId, filters) => ({
      items: [entry], total: 51, limit: 50, offset: filters.offset,
    }));
    mocks.get.mockResolvedValue(entry);
    mocks.vote.mockResolvedValue({ id: entry.id, voteCount: 3, votedByMe: true });
    mocks.removeVote.mockResolvedValue({ id: entry.id, voteCount: 2, votedByMe: false });
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    flushSync(() => root.unmount());
    client.clear();
    container.remove();
  });
  function render() {
    flushSync(() => root.render(
      <QueryClientProvider client={client}><ThemeProvider><BrowserRouter>
        <AgentCommentary companyId="company-1" />
      </BrowserRouter></ThemeProvider></QueryClientProvider>,
    ));
  }

  it("loads pages of 50 and preserves the page in a shareable message URL", async () => {
    render();
    await vi.waitFor(() => expect(container.querySelector('[aria-label="Read suggestion from Writer"]')).not.toBeNull());
    expect(mocks.list).toHaveBeenLastCalledWith("company-1", expect.objectContaining({ limit: 50, offset: 0 }), expect.anything());
    flushSync(() => container.querySelector<HTMLButtonElement>('[aria-label="Next page"]')!.click());
    await vi.waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith("company-1", expect.objectContaining({ limit: 50, offset: 50 }), expect.anything()));
    await vi.waitFor(() => expect(container.querySelector('[aria-label="Read suggestion from Writer"]')).not.toBeNull());
    flushSync(() => container.querySelector<HTMLButtonElement>('[aria-label="Read suggestion from Writer"]')!.click());
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')?.textContent).toContain(entry.body));
    expect(new URLSearchParams(window.location.search).get("entry")).toBe(entry.id);
    expect(new URLSearchParams(window.location.search).get("offset")).toBe("50");
    flushSync(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent === "Close")!.click());
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    expect(new URLSearchParams(window.location.search).has("entry")).toBe(false);
    expect(new URLSearchParams(window.location.search).get("offset")).toBe("50");
  });

  it("opens the full message directly from a copied URL", async () => {
    window.history.replaceState(null, "", `/TES/activity/commentary?kind=suggestion&entry=${entry.id}`);
    render();
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')?.textContent).toContain(entry.body));
    expect(mocks.get).toHaveBeenCalledWith("company-1", entry.id, expect.anything());
    expect(mocks.list).toHaveBeenCalledWith("company-1", expect.objectContaining({ kind: "suggestion", limit: 50 }), expect.anything());
  });

  it("upvotes a message, removes the vote and keeps the vote sort in the URL", async () => {
    render();
    const upvote = () => container.querySelector<HTMLButtonElement>('li button[aria-pressed]');
    await vi.waitFor(() => expect(upvote()?.textContent).toBe("2"));
    expect(upvote()?.getAttribute("aria-pressed")).toBe("false");
    flushSync(() => upvote()!.click());
    await vi.waitFor(() => expect(upvote()?.getAttribute("aria-pressed")).toBe("true"));
    expect(upvote()?.textContent).toBe("3");
    expect(mocks.vote).toHaveBeenCalledWith("company-1", entry.id);
    expect(window.location.search).toBe("");
    flushSync(() => upvote()!.click());
    await vi.waitFor(() => expect(upvote()?.getAttribute("aria-pressed")).toBe("false"));
    expect(upvote()?.textContent).toBe("2");
    expect(mocks.removeVote).toHaveBeenCalledWith("company-1", entry.id);

    flushSync(() => root.unmount());
    window.history.replaceState(null, "", "/TES/activity/commentary?sort=votes&kind=complaint");
    root = createRoot(container);
    render();
    await vi.waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith("company-1", expect.objectContaining({ sort: "votes", kind: "complaint", offset: 0 }), expect.anything()));
    expect(container.querySelector('[aria-label="Sort messages"]')?.textContent).toContain("Most votes");
  });
});
