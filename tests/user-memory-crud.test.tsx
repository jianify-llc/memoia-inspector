// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import { UserMemory } from "@/components/user-memory";
import type { UserEvent } from "@/api/models/memobase";
import messages from "@/messages/en.json";

afterEach(() => cleanup());

it("adds an Event through the selected user's handler", async () => {
  const manage = vi.fn().mockResolvedValue({ code: 0 });
  render(<NextIntlClientProvider locale="en" messages={messages}>
    <UserMemory isLoading={false} setIsLoading={() => {}} profiles={[]} events={[]} canAdd manage={manage} />
  </NextIntlClientProvider>);
  fireEvent.mouseDown(screen.getByRole("tab", { name: messages.memories.events }), { button: 0, ctrlKey: false });
  fireEvent.click(screen.getByRole("button", { name: messages.memories.addEvent }));
  const dialog = screen.getByRole("alertdialog");
  fireEvent.change(within(dialog).getByLabelText(messages.memories.eventTitle), { target: { value: "A walk" } });
  fireEvent.change(within(dialog).getByLabelText(messages.memories.content), { target: { value: "At the lake" } });
  fireEvent.click(within(dialog).getByRole("button", { name: messages.memories.submit }));
  await waitFor(() => expect(manage).toHaveBeenCalledWith({ action: "addEvent", title: "A walk", content: "At the lake" }));
});

it("sends only the edited Event field", async () => {
  const manage = vi.fn().mockResolvedValue({ code: 0 });
  const event = { id: "event", event_data: { title: "A walk", content: "Old body", summary: "Keep this" }, created_at: "2026-01-01T00:00:00Z" } as UserEvent;
  render(<NextIntlClientProvider locale="en" messages={messages}>
    <UserMemory isLoading={false} setIsLoading={() => {}} profiles={[]} events={[event]} canEdit manage={manage} />
  </NextIntlClientProvider>);
  fireEvent.mouseDown(screen.getByRole("tab", { name: messages.memories.events }), { button: 0, ctrlKey: false });
  fireEvent.click(screen.getByRole("button", { name: messages.memories.editEvent }));
  const dialog = screen.getByRole("alertdialog");
  fireEvent.change(within(dialog).getByLabelText(messages.memories.content), { target: { value: "New body" } });
  fireEvent.click(within(dialog).getByRole("button", { name: messages.memories.submit }));
  await waitFor(() => expect(manage).toHaveBeenCalledWith({ action: "updateEvent", id: "event", content: "New body" }));
});
