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
    const connection = screen.getByRole<HTMLSelectElement>("combobox", { name: "Connection" });
    expect(connection.value).toBe(hasWorker ? "worker" : defaultUrl);
    expect(screen.queryByRole("textbox", { name: "URL" })).toBeNull();
    if (defaultUrl) fireEvent.change(connection, { target: { value: defaultUrl } });
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
