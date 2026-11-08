import { isTeamView, lacksSecondFactor, TEAM_VIEWS, teamCounts, teamRows, teamViewsFor } from "./team-list";
import type { TeamInvitation, TeamPerson } from "./team-types";
import { describe, expect, it } from "vitest";

const person = (patch: Partial<TeamPerson> & { userId: string; name: string }): TeamPerson => ({
  email: `${patch.userId}@one-teste.invalid`,
  avatarUrl: null,
  role: "member",
  firmFunction: "advogado",
  joinedAt: "2026-11-01T10:00:00+00:00",
  oab: [],
  hasSecondFactor: null,
  ...patch,
});

const people: TeamPerson[] = [
  person({
    userId: "ana",
    name: "Ana Teste de Oliveira",
    role: "owner",
    firmFunction: "socio",
    hasSecondFactor: true,
    oab: [{ id: "o1", uf: "GO", number: "12345", kind: "principal" }],
  }),
  person({ userId: "bruno", name: "Bruno Teste", role: "admin", firmFunction: "advogado", hasSecondFactor: false }),
  person({ userId: "carla", name: "Cárla Teste", firmFunction: "atendimento" }),
  person({ userId: "davi", name: "Davi Teste", firmFunction: "controladoria" }),
];

const invitations: TeamInvitation[] = [
  {
    id: "i1",
    email: "elisa@one-teste.invalid",
    role: "member",
    firmFunction: "advogado",
    expiresAt: "2026-11-10T10:00:00+00:00",
  },
];

describe("the team's list", () => {
  it("offers the views of who manages the firm only to them", () => {
    expect(TEAM_VIEWS.every(isTeamView)).toBe(true);
    expect(teamViewsFor(true)).toContain("convites");
    expect(teamViewsFor(false)).not.toContain("convites");
    expect(teamViewsFor(false)).not.toContain("sem-fator");
  });

  it("says who still owes the second factor only of who manages the account", () => {
    expect(lacksSecondFactor(people[1])).toBe(true);
    expect(lacksSecondFactor(people[0])).toBe(false);
    // A member's second factor is not read here: nothing is said of it.
    expect(lacksSecondFactor({ role: "member", hasSecondFactor: false })).toBe(false);
  });

  it("counts each view as the list shows it", () => {
    const counts = teamCounts(people, invitations, "");
    expect(counts).toEqual({
      todos: 4,
      socio: 1,
      advogado: 1,
      controladoria: 1,
      atendimento: 1,
      "sem-fator": 1,
      convites: 1,
    });
    for (const view of TEAM_VIEWS) {
      const rows = teamRows(people, invitations, view, "");
      expect(rows.people.length + rows.invitations.length, view).toBe(counts[view]);
    }
  });

  it("finds a person by name without accents, by e-mail, or by a registration however typed", () => {
    expect(teamRows(people, invitations, "todos", "carla").people.map((p) => p.userId)).toEqual(["carla"]);
    expect(teamRows(people, invitations, "todos", "oliveira ana").people.map((p) => p.userId)).toEqual(["ana"]);
    expect(teamRows(people, invitations, "todos", "12.345").people.map((p) => p.userId)).toEqual(["ana"]);
    expect(teamRows(people, invitations, "todos", "12345").people.map((p) => p.userId)).toEqual(["ana"]);
    expect(teamRows(people, invitations, "convites", "elisa").invitations).toHaveLength(1);
    expect(teamCounts(people, invitations, "bruno").todos).toBe(1);
  });
});
