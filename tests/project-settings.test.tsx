// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import ProjectSettingsForm from "@/app/settings/project-settings-form";
import messages from "@/messages/en.json";
import { setLocale } from "@/utils/memoia/client";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/utils/memoia/client", () => ({ setLocale: vi.fn().mockResolvedValue(undefined) }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it.each([
  { managed: false, hasWorker: false, defaultUrl: undefined },
  { managed: false, hasWorker: false, defaultUrl: "https://access.example" },
  { managed: true, hasWorker: true, defaultUrl: undefined },
  { managed: true, hasWorker: true, defaultUrl: "https://access.example" },
  { managed: true, hasWorker: false, defaultUrl: "https://access.example" },
])("saves the endpoint and existing project Key with settings %j", async ({ managed, hasWorker, defaultUrl }) => {
  render(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
      <ProjectSettingsForm managed={managed} hasWorker={hasWorker} defaultUrl={defaultUrl} />
    </NextIntlClientProvider>,
  );
  if (managed) {
    expect(screen.queryByRole("textbox", { name: "URL" })).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    if (hasWorker && defaultUrl) {
      const worker = screen.getByRole<HTMLInputElement>("radio", { name: "Memoia Worker" });
      expect(worker.checked).toBe(true);
      fireEvent.click(screen.getByRole("radio", { name: "URL · access.example" }));
      expect(worker.checked).toBe(false);
    } else {
      expect(screen.queryAllByRole("radio")).toHaveLength(0);
      expect(screen.getByText(hasWorker ? "Memoia Worker" : "URL · access.example")).toBeTruthy();
    }
  } else {
    const url = screen.getByRole<HTMLInputElement>("textbox", { name: "URL" });
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(url.value).toBe(defaultUrl ?? "");
    fireEvent.change(url, { target: { value: "https://self-hosted.example" } });
  }
  fireEvent.change(screen.getByLabelText("KEY"), { target: { value: "fixture-project-key" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  const endpoint = managed ? defaultUrl ?? "worker" : "https://self-hosted.example";
  await waitFor(() => expect(setLocale).toHaveBeenCalledWith(endpoint, "fixture-project-key"));
});

it("disables Save when a managed deployment has no configured connection", () => {
  render(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
      <ProjectSettingsForm managed hasWorker={false} />
    </NextIntlClientProvider>,
  );
  expect(screen.getByText("No Memoia connection is configured.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("KEY"), { target: { value: "fixture-project-key" } });
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled).toBe(true);
  expect(setLocale).not.toHaveBeenCalled();
});
