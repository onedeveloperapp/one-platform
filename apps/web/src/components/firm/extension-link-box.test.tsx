import { ExtensionLinkBox } from "./filing-way-form";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "@flyee/content/messages/pt-BR.json";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// The lawyer's extension and their account (2026-11-27): the owner reinstalled the extension, which lost its link,
// while ONE still showed the old one as linked with only "Desligar", and found no way to a code. Every name is invented.

const begin = vi.fn(async () => ({ ok: true as const, code: "begun", value: "ABCD-2345" }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/filing-ways/actions", () => ({
  beginExtensionLink: () => begin(),
  endExtensionLink: vi.fn(async () => ({ ok: true, code: "ended" })),
  giveCourtLogin: vi.fn(),
  setFirmFilingWay: vi.fn(),
  setLawyerFilingWay: vi.fn(),
}));

afterEach(() => {
  cleanup();
  begin.mockClear();
});

const show = (link: { id: string; label: string | null; linkedAt: string | null; lastSeenAt: string | null } | null) =>
  render(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <ExtensionLinkBox link={link} onChanged={() => undefined} />
    </NextIntlClientProvider>,
  );

describe("the extension's link, where the way is chosen", () => {
  it("offers a new code beside a linked extension, which the extension that types it replaces", async () => {
    show({ id: "l1", label: "Chrome do escritório", linkedAt: "2026-11-26T12:00:00Z", lastSeenAt: null });
    expect(screen.getByText("Extensão ligada à sua conta · Chrome do escritório")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Desligar" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ligar de novo" }));
    await waitFor(() => expect(screen.getByText("ABCD-2345")).toBeTruthy());
    expect(begin).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Extensão ligada à sua conta · Chrome do escritório")).toBeNull();
  });

  it("asks a code where no extension is linked, as before", () => {
    show(null);
    expect(screen.getByRole("button", { name: "Ligar a extensão" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ligar de novo" })).toBeNull();
  });
});
