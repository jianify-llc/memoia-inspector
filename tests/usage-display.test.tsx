// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import messages from "@/messages/en.json";

const api = vi.hoisted(() => ({ usage: vi.fn(), push: vi.fn(), error: vi.fn() }));
vi.mock("@/api/models/memobase", () => ({ getProjectUsage: api.usage }));
vi.mock("next/navigation", () => { const router = { push: api.push }; return { useRouter: () => router }; });
vi.mock("sonner", () => ({ toast: { error: api.error } }));
vi.mock("recharts", () => ({ BarChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Bar: () => null, CartesianGrid: () => null, XAxis: () => null }));
vi.mock("@/components/ui/chart", () => ({ ChartContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChartTooltip: () => null, ChartTooltipContent: () => null }));
import Usage from "@/components/project/tabs/usage";

const project = { endpoint_url: "https://memoia.invalid", endpoint_token: "fixture", config_yaml: "" };
const day = (usage_complete = true) => ({ date: "2026-10-09", total_insert: 0, total_success_insert: 0,
  total_input_token: 0, total_output_token: 0, usage_complete });
const response = (usages = [day()]) => ({ code: 0, data: { usages } });
const view = (token = project.endpoint_token) => <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
  <Usage project={{ ...project, endpoint_token: token }} />
</NextIntlClientProvider>;
beforeEach(() => { vi.resetAllMocks(); });
afterEach(cleanup);

it("shows zero only for successfully loaded empty statistics", async () => {
  api.usage.mockResolvedValue(response());
  render(view());
  await screen.findByRole("button", { name: /Token Usage 7d 0/ });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
});

it.each(["rejected", "transport"])("shows unavailable, not zero, on %s failure and permits retry", async (failure) => {
  if (failure === "rejected") api.usage.mockResolvedValue({ code: 503, message: "unavailable" });
  else api.usage.mockRejectedValue(new Error("offline"));
  render(view());
  expect((await screen.findByRole("alert")).textContent).toBe(messages.project.usage.unavailable);
  expect(screen.queryByRole("button", { name: /Token Usage/ })).toBeNull();
  api.usage.mockResolvedValue(response());
  fireEvent.click(screen.getByRole("button", { name: messages.project.retry }));
  await screen.findByRole("button", { name: /Token Usage 7d 0/ });
});

it("labels unknown calls without presenting the subtotal as complete usage", async () => {
  api.usage.mockResolvedValue(response([{ ...day(false), total_input_token: 10, total_output_token: 5 }]));
  render(view());
  expect((await screen.findByRole("status")).textContent).toBe(messages.project.usage.incomplete);
  expect(screen.getByRole("button", { name: /Token Usage 7d 15/ })).toBeTruthy();
});

it("aborts and ignores late statistics from the previously selected project", async () => {
  let finish!: (value: ReturnType<typeof response>) => void;
  api.usage.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  api.usage.mockResolvedValue(response([{ ...day(), total_input_token: 20 }]));
  const mounted = render(view());
  await waitFor(() => expect(api.usage).toHaveBeenCalledTimes(1));
  const signal = api.usage.mock.calls[0][1] as AbortSignal;
  mounted.rerender(view("second-fixture"));
  await screen.findByRole("button", { name: /Token Usage 7d 20/ });
  expect(signal.aborted).toBe(true);
  await act(async () => finish(response([{ ...day(false), total_input_token: 999 }])));
  expect(screen.queryByText("999")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
  expect(api.error).not.toHaveBeenCalled();
});
