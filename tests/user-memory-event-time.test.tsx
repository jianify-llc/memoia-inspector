// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import type { UserEvent } from "@/api/models/memobase";
import { UserMemory } from "@/components/user-memory";
import messages from "@/messages/en.json";

afterEach(cleanup);

describe("Event story occurrence time", () => {
  it.each(["Saturday afternoon", null])("renders event_time=%s without using storage time", (event_time) => {
    const event: UserEvent = {
      id: "11111111-1111-4111-8111-111111111111",
      created_at: "2026-10-23T00:00:00Z",
      updated_at: "2026-10-23T00:00:00Z",
      event_data: { title: "Hiking plan", content: "The trip was cancelled.", event_time },
    };
    render(<NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
      <UserMemory isLoading={false} setIsLoading={() => {}} profiles={[]} events={[event]} />
    </NextIntlClientProvider>);
    fireEvent.mouseDown(screen.getByRole("tab", { name: messages.memories.events }), { button: 0, ctrlKey: false });
    expect(screen.getByText("Hiking plan")).toBeTruthy();
    if (event_time) {
      expect(screen.getByText(`${messages.memories.storyTime}: ${event_time}`)).toBeTruthy();
    } else {
      expect(screen.queryByText(new RegExp(`^${messages.memories.storyTime}:`))).toBeNull();
    }
  });
});
