// GENERATED from packages/db/migrations by `npm run db:schema:pull`.
// Regenerate after every migration instead of editing by hand.
import { customType, pgSchema, pgTable, foreignKey, unique, pgPolicy, check, uuid, text, timestamp, boolean, uniqueIndex, index, jsonb, integer, bigint, type AnyPgColumn, date, smallint, primaryKey, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

const authSchema = pgSchema("auth");

/** Stub of the Supabase auth table: only what the foreign keys reference. */
export const users = authSchema.table("users", {
	id: uuid().primaryKey().notNull(),
});
export const usersInAuth = users;

const citext = customType<{ data: string }>({
	dataType() {
		return "citext";
	},
});

export const announcementLevel = pgEnum("announcement_level", ['info', 'warning', 'critical'])
export const billingPeriod = pgEnum("billing_period", ['weekly', 'monthly', 'yearly'])
export const billingProvider = pgEnum("billing_provider", ['stripe', 'asaas'])
export const blogCommentStatus = pgEnum("blog_comment_status", ['pending', 'approved', 'rejected'])
export const couponDuration = pgEnum("coupon_duration", ['once', 'repeating', 'forever'])
export const discountType = pgEnum("discount_type", ['percent', 'fixed'])
export const firmFunction = pgEnum("firm_function", ['socio', 'advogado', 'controladoria', 'atendimento'])
export const invoiceStatus = pgEnum("invoice_status", ['open', 'paid', 'failed', 'refunded', 'void'])
export const moduleKind = pgEnum("module_kind", ['recurring', 'one_time'])
export const orgRole = pgEnum("org_role", ['owner', 'admin', 'member'])
export const planKind = pgEnum("plan_kind", ['recurring', 'access'])
export const subscriptionCancelReason = pgEnum("subscription_cancel_reason", ['too_expensive', 'not_using', 'missing_tool', 'switched', 'technical', 'temporary', 'other'])
export const subscriptionStatus = pgEnum("subscription_status", ['incomplete', 'trialing', 'active', 'past_due', 'canceled'])


export const organizations = pgTable("organizations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	slug: text().notNull(),
	createdBy: uuid("created_by"),
	billingCpfCnpj: text("billing_cpf_cnpj"),
	billingPostalCode: text("billing_postal_code"),
	billingAddressNumber: text("billing_address_number"),
	billingPhone: text("billing_phone"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	publicationAiTriage: boolean("publication_ai_triage").default(false).notNull(),
	worksAlone: boolean("works_alone"),
	setupAnsweredAt: timestamp("setup_answered_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [profiles.id],
			name: "organizations_created_by_fkey"
		}).onDelete("set null"),
	unique("organizations_slug_key").on(table.slug),
	pgPolicy("organizations_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(id)` }),
	pgPolicy("organizations_select_superadmin", { as: "permissive", for: "select", to: ["authenticated"] }),
	check("organizations_name_length", sql`(char_length(btrim(name)) >= 2) AND (char_length(btrim(name)) <= 120)`),
	check("organizations_billing_cpf_cnpj_check", sql`(billing_cpf_cnpj IS NULL) OR (billing_cpf_cnpj ~ '^([0-9]{11}|[0-9]{14})$'::text)`),
	check("organizations_billing_postal_code_check", sql`(billing_postal_code IS NULL) OR (billing_postal_code ~ '^[0-9]{8}$'::text)`),
	check("organizations_billing_phone_check", sql`(billing_phone IS NULL) OR (billing_phone ~ '^[0-9]{10,11}$'::text)`),
]);

export const profiles = pgTable("profiles", {
	id: uuid().primaryKey().notNull(),
	displayName: text("display_name"),
	avatarUrl: text("avatar_url"),
	isSuperadmin: boolean("is_superadmin").default(false).notNull(),
	locale: text().default('pt-BR').notNull(),
	timezone: text().default('America/Sao_Paulo').notNull(),
	marketingEmailOptOut: boolean("marketing_email_opt_out").default(false).notNull(),
	emailUnsubscribeToken: uuid("email_unsubscribe_token").defaultRandom().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("profiles_email_unsubscribe_token_idx").using("btree", table.emailUnsubscribeToken.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.id],
			foreignColumns: [users.id],
			name: "profiles_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("profiles_select_own", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(id = auth.uid())` }),
	pgPolicy("profiles_select_superadmin", { as: "permissive", for: "select", to: ["authenticated"] }),
	pgPolicy("profiles_update_own", { as: "permissive", for: "update", to: ["authenticated"] }),
	check("profiles_locale_check", sql`locale = ANY (supported_locales())`),
	check("profiles_display_name_length", sql`(display_name IS NULL) OR (char_length(display_name) <= 120)`),
]);

export const memberships = pgTable("memberships", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	userId: uuid("user_id").notNull(),
	role: orgRole().default('member').notNull(),
	firmFunction: firmFunction("firm_function").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("memberships_one_firm_per_person_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("memberships_one_owner_idx").using("btree", table.orgId.asc().nullsLast().op("uuid_ops")).where(sql`(role = 'owner'::org_role)`),
	index("memberships_org_idx").using("btree", table.orgId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "memberships_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [profiles.id],
			name: "memberships_user_id_fkey"
		}).onDelete("cascade"),
	unique("memberships_org_id_user_id_key").on(table.orgId, table.userId),
	pgPolicy("memberships_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	pgPolicy("memberships_select_superadmin", { as: "permissive", for: "select", to: ["authenticated"] }),
]);

export const auditEvents = pgTable("audit_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id"),
	actorId: uuid("actor_id"),
	actorType: text("actor_type").default('system').notNull(),
	action: text().notNull(),
	entityType: text("entity_type"),
	entityId: text("entity_id"),
	metadata: jsonb().default({}).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("audit_events_action_idx").using("btree", table.action.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("audit_events_entity_idx").using("btree", table.entityType.asc().nullsLast().op("text_ops"), table.entityId.asc().nullsLast().op("text_ops")),
	index("audit_events_org_idx").using("btree", table.orgId.asc().nullsLast().op("uuid_ops"), table.createdAt.desc().nullsFirst().op("uuid_ops")),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "audit_events_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.actorId],
			foreignColumns: [profiles.id],
			name: "audit_events_actor_id_fkey"
		}).onDelete("set null"),
	pgPolicy("audit_events_insert_member", { as: "permissive", for: "insert", to: ["authenticated"], withCheck: sql`((actor_id = auth.uid()) AND (is_superadmin() OR ((org_id IS NOT NULL) AND is_org_member(org_id))))`  }),
	pgPolicy("audit_events_select_admin", { as: "permissive", for: "select", to: ["authenticated"] }),
	check("audit_events_actor_type_check", sql`actor_type = ANY (ARRAY['person'::text, 'support'::text, 'system'::text, 'ai'::text, 'client'::text])`),
]);

export const recordVersions = pgTable("record_versions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	tableName: text("table_name").notNull(),
	recordId: uuid("record_id").notNull(),
	orgId: uuid("org_id"),
	operation: text().notNull(),
	data: jsonb().notNull(),
	changedBy: uuid("changed_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("record_versions_org_idx").using("btree", table.orgId.asc().nullsLast().op("uuid_ops")).where(sql`(org_id IS NOT NULL)`),
	index("record_versions_record_idx").using("btree", table.tableName.asc().nullsLast().op("timestamptz_ops"), table.recordId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.asc().nullsLast().op("text_ops")),
	pgPolicy("record_versions_select_admin", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(is_superadmin() OR ((org_id IS NOT NULL) AND has_org_role(org_id, ARRAY['owner'::org_role, 'admin'::org_role])))` }),
	check("record_versions_operation_check", sql`operation = ANY (ARRAY['INSERT'::text, 'UPDATE'::text, 'DELETE'::text])`),
]);

export const consentTerms = pgTable("consent_terms", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	slug: text().notNull(),
	locale: text().default('pt-BR').notNull(),
	version: integer().default(1).notNull(),
	title: text().notNull(),
	bodyMd: text("body_md").notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("consent_terms_one_active_idx").using("btree", table.slug.asc().nullsLast().op("text_ops"), table.locale.asc().nullsLast().op("text_ops")).where(sql`is_active`),
	unique("consent_terms_slug_locale_version_key").on(table.slug, table.locale, table.version),
	pgPolicy("consent_terms_select_active", { as: "permissive", for: "select", to: ["anon", "authenticated"], using: sql`is_active` }),
	pgPolicy("consent_terms_select_superadmin", { as: "permissive", for: "select", to: ["authenticated"] }),
	check("consent_terms_locale_check", sql`locale = ANY (supported_locales())`),
	check("consent_terms_slug_check", sql`slug ~ '^[a-z][a-z0-9-]{1,39}$'::text`),
	check("consent_terms_version_check", sql`version >= 1`),
]);

export const consentAcceptances = pgTable("consent_acceptances", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	termId: uuid("term_id").notNull(),
	orgId: uuid("org_id"),
	userId: uuid("user_id").notNull(),
	metadata: jsonb().default({}).notNull(),
	acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	revokedAt: timestamp("revoked_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	uniqueIndex("consent_acceptances_one_current_idx").using("btree", table.termId.asc().nullsLast().op("uuid_ops"), table.userId.asc().nullsLast().op("uuid_ops")).where(sql`(revoked_at IS NULL)`),
	index("consent_acceptances_org_idx").using("btree", table.orgId.asc().nullsLast().op("uuid_ops")),
	index("consent_acceptances_user_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.acceptedAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.termId],
			foreignColumns: [consentTerms.id],
			name: "consent_acceptances_term_id_fkey"
		}),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "consent_acceptances_org_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [profiles.id],
			name: "consent_acceptances_user_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("consent_acceptances_select_own", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(user_id = auth.uid())` }),
	pgPolicy("consent_acceptances_select_superadmin", { as: "permissive", for: "select", to: ["authenticated"] }),
]);

export const accessEvents = pgTable("access_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	ip: text(),
	userAgent: text("user_agent"),
	aal: text(),
	sessionId: uuid("session_id"),
	impersonatedBy: uuid("impersonated_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("access_events_created_idx").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("access_events_session_idx").using("btree", table.sessionId.asc().nullsLast().op("uuid_ops")),
	index("access_events_user_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [profiles.id],
			name: "access_events_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.impersonatedBy],
			foreignColumns: [profiles.id],
			name: "access_events_impersonated_by_fkey"
		}).onDelete("set null"),
	pgPolicy("access_events_select_own", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(user_id = auth.uid())` }),
	pgPolicy("access_events_select_superadmin", { as: "permissive", for: "select", to: ["authenticated"] }),
]);

export const platformSettings = pgTable("platform_settings", {
	key: text().primaryKey().notNull(),
	value: jsonb().default({}).notNull(),
	isPublic: boolean("is_public").default(false).notNull(),
	updatedBy: uuid("updated_by"),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [profiles.id],
			name: "platform_settings_updated_by_fkey"
		}).onDelete("set null"),
	pgPolicy("platform_settings_select_public", { as: "permissive", for: "select", to: ["anon", "authenticated"], using: sql`is_public` }),
	pgPolicy("platform_settings_all_superadmin", { as: "permissive", for: "all", to: ["authenticated"] }),
	check("platform_settings_key_check", sql`key ~ '^[a-z][a-z0-9_]{1,39}$'::text`),
]);

export const notifications = pgTable("notifications", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	type: text().default('system').notNull(),
	title: text().notNull(),
	body: text(),
	href: text(),
	readAt: timestamp("read_at", { withTimezone: true, mode: 'string' }),
	sourceKey: text("source_key"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("notifications_source_key_unique_idx").using("btree", table.sourceKey.asc().nullsLast().op("text_ops")).where(sql`(source_key IS NOT NULL)`),
	index("notifications_user_idx").using("btree", table.userId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [profiles.id],
			name: "notifications_user_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("notifications_select_own", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(user_id = auth.uid())` }),
	pgPolicy("notifications_update_own", { as: "permissive", for: "update", to: ["authenticated"] }),
]);

export const announcements = pgTable("announcements", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	title: text().notNull(),
	body: text(),
	level: announcementLevel().default('info').notNull(),
	href: text(),
	startsAt: timestamp("starts_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	endsAt: timestamp("ends_at", { withTimezone: true, mode: 'string' }),
	isActive: boolean("is_active").default(true).notNull(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [profiles.id],
			name: "announcements_created_by_fkey"
		}).onDelete("set null"),
	pgPolicy("announcements_select_live", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(is_superadmin() OR (is_active AND (starts_at <= now()) AND ((ends_at IS NULL) OR (ends_at > now()))))` }),
	pgPolicy("announcements_all_superadmin", { as: "permissive", for: "all", to: ["authenticated"] }),
]);

export const onboardingState = pgTable("onboarding_state", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	orgId: uuid("org_id"),
	flow: text().notNull(),
	completedSteps: jsonb("completed_steps").default([]).notNull(),
	dismissed: boolean().default(false).notNull(),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("onboarding_state_user_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [profiles.id],
			name: "onboarding_state_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "onboarding_state_org_id_fkey"
		}).onDelete("cascade"),
	unique("onboarding_state_user_id_org_id_flow_key").on(table.userId, table.orgId, table.flow),
	pgPolicy("onboarding_select_own", { as: "permissive", for: "select", to: ["authenticated"], using: sql`((user_id = auth.uid()) AND ((org_id IS NULL) OR is_org_member(org_id)))` }),
	pgPolicy("onboarding_insert_own", { as: "permissive", for: "insert", to: ["authenticated"] }),
	pgPolicy("onboarding_update_own", { as: "permissive", for: "update", to: ["authenticated"] }),
]);

export const backupRuns = pgTable("backup_runs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	status: text().default('running').notNull(),
	triggeredBy: text("triggered_by").default('manual').notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	finishedAt: timestamp("finished_at", { withTimezone: true, mode: 'string' }),
	tableCount: integer("table_count").default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	rowCount: bigint("row_count", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	totalBytes: bigint("total_bytes", { mode: "number" }).default(0).notNull(),
	storagePrefix: text("storage_prefix"),
	error: text(),
}, (table) => [
	index("backup_runs_started_idx").using("btree", table.startedAt.desc().nullsFirst().op("timestamptz_ops")),
	pgPolicy("backup_runs_select_superadmin", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_superadmin()` }),
	check("backup_runs_status_check", sql`status = ANY (ARRAY['running'::text, 'success'::text, 'error'::text])`),
	check("backup_runs_triggered_by_check", sql`triggered_by = ANY (ARRAY['cron'::text, 'manual'::text])`),
]);

export const oabRegistrations = pgTable("oab_registrations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	uf: text().notNull(),
	number: text().notNull(),
	kind: text().default('principal').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("oab_registrations_one_per_state_idx").using("btree", table.userId.asc().nullsLast().op("text_ops"), table.uf.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("oab_registrations_one_principal_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")).where(sql`(kind = 'principal'::text)`),
	index("oab_registrations_user_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [profiles.id],
			name: "oab_registrations_user_id_fkey"
		}).onDelete("cascade"),
	unique("oab_registrations_uf_number_key").on(table.uf, table.number),
	pgPolicy("oab_registrations_select_own", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(user_id = auth.uid())` }),
	pgPolicy("oab_registrations_select_colleague", { as: "permissive", for: "select", to: ["authenticated"] }),
	pgPolicy("oab_registrations_select_superadmin", { as: "permissive", for: "select", to: ["authenticated"] }),
	check("oab_registrations_uf_check", sql`uf = ANY (ARRAY['AC'::text, 'AL'::text, 'AM'::text, 'AP'::text, 'BA'::text, 'CE'::text, 'DF'::text, 'ES'::text, 'GO'::text, 'MA'::text, 'MG'::text, 'MS'::text, 'MT'::text, 'PA'::text, 'PB'::text, 'PE'::text, 'PI'::text, 'PR'::text, 'RJ'::text, 'RN'::text, 'RO'::text, 'RR'::text, 'RS'::text, 'SC'::text, 'SE'::text, 'SP'::text, 'TO'::text])`),
	check("oab_registrations_number_check", sql`number ~ '^[1-9][0-9]{0,6}[A-Z]?$'::text`),
	check("oab_registrations_kind_check", sql`kind = ANY (ARRAY['principal'::text, 'suplementar'::text])`),
]);

export const firmInvitations = pgTable("firm_invitations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	// TODO: failed to parse database type 'citext'
	email: citext("email").notNull(),
	role: orgRole().default('member').notNull(),
	firmFunction: firmFunction("firm_function").notNull(),
	tokenHash: text("token_hash").notNull(),
	invitedBy: uuid("invited_by"),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: 'string' }),
	acceptedBy: uuid("accepted_by"),
	revokedAt: timestamp("revoked_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("firm_invitations_email_idx").using("btree", table.email.asc().nullsLast().op("citext_ops")).where(sql`((accepted_at IS NULL) AND (revoked_at IS NULL))`),
	uniqueIndex("firm_invitations_one_open_idx").using("btree", table.orgId.asc().nullsLast().op("uuid_ops"), table.email.asc().nullsLast().op("uuid_ops")).where(sql`((accepted_at IS NULL) AND (revoked_at IS NULL))`),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "firm_invitations_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.invitedBy],
			foreignColumns: [profiles.id],
			name: "firm_invitations_invited_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.acceptedBy],
			foreignColumns: [profiles.id],
			name: "firm_invitations_accepted_by_fkey"
		}).onDelete("set null"),
	unique("firm_invitations_token_hash_key").on(table.tokenHash),
	pgPolicy("firm_invitations_select_manager", { as: "permissive", for: "select", to: ["authenticated"], using: sql`has_org_role(org_id, ARRAY['owner'::org_role, 'admin'::org_role])` }),
	pgPolicy("firm_invitations_select_superadmin", { as: "permissive", for: "select", to: ["authenticated"] }),
	check("firm_invitations_role_check", sql`role <> 'owner'::org_role`),
	check("firm_invitations_email_check", sql`((email)::text ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'::text) AND (char_length((email)::text) <= 254)`),
	check("firm_invitations_token_hash_check", sql`token_hash ~ '^[0-9a-f]{64}$'::text`),
	check("firm_invitations_one_end", sql`(accepted_at IS NULL) OR (revoked_at IS NULL)`),
]);

export const plans = pgTable("plans", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	slug: text().notNull(),
	name: text().notNull(),
	description: text(),
	kind: planKind().default('recurring').notNull(),
	family: text().notNull(),
	tier: text(),
	period: billingPeriod(),
	priceCents: integer("price_cents").default(0).notNull(),
	currency: text().default('BRL').notNull(),
	trialDays: integer("trial_days").default(0).notNull(),
	isFree: boolean("is_free").default(false).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	isPublic: boolean("is_public").default(true).notNull(),
	isAddon: boolean("is_addon").default(false).notNull(),
	limits: jsonb().default({}).notNull(),
	providerRefs: jsonb("provider_refs").default({}).notNull(),
	sort: integer().default(0).notNull(),
	accessMonths: integer("access_months"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("plans_one_public_access_idx").using("btree", table.family.asc().nullsLast().op("text_ops"), table.currency.asc().nullsLast().op("text_ops")).where(sql`(is_public AND is_active AND (NOT is_addon) AND (period IS NULL))`),
	uniqueIndex("plans_one_public_recurring_idx").using("btree", table.family.asc().nullsLast().op("text_ops"), table.period.asc().nullsLast().op("enum_ops"), table.currency.asc().nullsLast().op("text_ops")).where(sql`(is_public AND is_active AND (NOT is_addon) AND (period IS NOT NULL))`),
	unique("plans_slug_key").on(table.slug),
	pgPolicy("plans_select", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(is_active OR is_superadmin())` }),
	pgPolicy("plans_all_superadmin", { as: "permissive", for: "all", to: ["authenticated"] }),
	check("plans_access_months_check", sql`(access_months IS NULL) OR (access_months > 0)`),
	check("plans_access_months_kind", sql`(kind = 'access'::plan_kind) OR (access_months IS NULL)`),
	check("plans_slug_check", sql`slug ~ '^[a-z0-9][a-z0-9-]{1,59}$'::text`),
	check("plans_family_check", sql`family ~ '^[a-z0-9][a-z0-9-]{1,39}$'::text`),
	check("plans_tier_check", sql`(tier IS NULL) OR (tier = ANY (ARRAY['kit'::text, 'club'::text, 'pro'::text]))`),
	check("plans_currency_check", sql`currency = ANY (ARRAY['BRL'::text, 'USD'::text])`),
	check("plans_price_check", sql`price_cents >= 0`),
	check("plans_trial_check", sql`trial_days >= 0`),
	check("plans_free_price", sql`(NOT is_free) OR (price_cents = 0)`),
	check("plans_recurring_period", sql`(kind <> 'recurring'::plan_kind) OR (period IS NOT NULL)`),
	check("plans_access_no_period", sql`(kind <> 'access'::plan_kind) OR (period IS NULL)`),
]);

export const modules = pgTable("modules", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	slug: text().notNull(),
	name: text().notNull(),
	description: text(),
	kind: moduleKind().default('recurring').notNull(),
	priceCents: integer("price_cents").default(0).notNull(),
	currency: text().default('BRL').notNull(),
	limits: jsonb().default({}).notNull(),
	providerRefs: jsonb("provider_refs").default({}).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	sort: integer().default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("modules_slug_key").on(table.slug),
	pgPolicy("modules_select", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(is_active OR is_superadmin())` }),
	pgPolicy("modules_all_superadmin", { as: "permissive", for: "all", to: ["authenticated"] }),
	check("modules_currency_check", sql`currency = ANY (ARRAY['BRL'::text, 'USD'::text])`),
]);

export const coupons = pgTable("coupons", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	code: text().notNull(),
	description: text(),
	discountType: discountType("discount_type").notNull(),
	discountValue: integer("discount_value").notNull(),
	currency: text(),
	planFamilies: text("plan_families").array(),
	duration: couponDuration().default('once').notNull(),
	durationMonths: integer("duration_months"),
	maxRedemptions: integer("max_redemptions"),
	redeemedCount: integer("redeemed_count").default(0).notNull(),
	validUntil: timestamp("valid_until", { withTimezone: true, mode: 'string' }),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("coupons_code_key").on(table.code),
	pgPolicy("coupons_all_superadmin", { as: "permissive", for: "all", to: ["authenticated"], using: sql`is_superadmin()`, withCheck: sql`is_superadmin()`  }),
	check("coupons_code_check", sql`(code = upper(code)) AND (code ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'::text)`),
	check("coupons_value_check", sql`((discount_type = 'percent'::discount_type) AND ((discount_value >= 1) AND (discount_value <= 100))) OR ((discount_type = 'fixed'::discount_type) AND (discount_value > 0))`),
	check("coupons_currency_check", sql`(currency IS NULL) OR (currency = ANY (ARRAY['BRL'::text, 'USD'::text]))`),
	check("coupons_fixed_currency", sql`(discount_type <> 'fixed'::discount_type) OR (currency IS NOT NULL)`),
	check("coupons_duration_months", sql`((duration = 'repeating'::coupon_duration) AND (duration_months IS NOT NULL) AND (duration_months > 0)) OR ((duration <> 'repeating'::coupon_duration) AND (duration_months IS NULL))`),
	check("coupons_redemptions_check", sql`(max_redemptions IS NULL) OR (max_redemptions > 0)`),
]);

export const subscriptions = pgTable("subscriptions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	planId: uuid("plan_id").notNull(),
	status: subscriptionStatus().default('incomplete').notNull(),
	adminSuspended: boolean("admin_suspended").default(false).notNull(),
	provider: billingProvider(),
	providerCustomerId: text("provider_customer_id"),
	providerSubscriptionId: text("provider_subscription_id"),
	providerPaymentId: text("provider_payment_id"),
	renews: boolean().default(true).notNull(),
	period: billingPeriod(),
	currentPeriodStart: timestamp("current_period_start", { withTimezone: true, mode: 'string' }),
	currentPeriodEnd: timestamp("current_period_end", { withTimezone: true, mode: 'string' }),
	trialEndsAt: timestamp("trial_ends_at", { withTimezone: true, mode: 'string' }),
	couponId: uuid("coupon_id"),
	priceCents: integer("price_cents"),
	currency: text(),
	couponCodeSnapshot: text("coupon_code_snapshot"),
	paymentMethod: text("payment_method"),
	cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
	cancellationRequestedAt: timestamp("cancellation_requested_at", { withTimezone: true, mode: 'string' }),
	cancelReason: subscriptionCancelReason("cancel_reason"),
	cancelNote: text("cancel_note"),
	canceledAt: timestamp("canceled_at", { withTimezone: true, mode: 'string' }),
	pastDueSince: timestamp("past_due_since", { withTimezone: true, mode: 'string' }),
	provisionalUntil: timestamp("provisional_until", { withTimezone: true, mode: 'string' }),
	billingOperationId: uuid("billing_operation_id"),
	termNoticeSentAt: timestamp("term_notice_sent_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("subscriptions_billing_operation_unique_idx").using("btree", table.billingOperationId.asc().nullsLast().op("uuid_ops")).where(sql`(billing_operation_id IS NOT NULL)`),
	index("subscriptions_cancellation_due_idx").using("btree", table.currentPeriodEnd.asc().nullsLast().op("timestamptz_ops")).where(sql`((cancel_at_period_end = true) AND (status = ANY (ARRAY['trialing'::subscription_status, 'active'::subscription_status, 'past_due'::subscription_status])))`),
	index("subscriptions_org_idx").using("btree", table.orgId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("uuid_ops")),
	uniqueIndex("subscriptions_org_live_unique").using("btree", table.orgId.asc().nullsLast().op("uuid_ops")).where(sql`(status = ANY (ARRAY['trialing'::subscription_status, 'active'::subscription_status, 'past_due'::subscription_status]))`),
	uniqueIndex("subscriptions_provider_payment_unique_idx").using("btree", table.provider.asc().nullsLast().op("enum_ops"), table.providerPaymentId.asc().nullsLast().op("text_ops")).where(sql`((provider IS NOT NULL) AND (provider_payment_id IS NOT NULL))`),
	uniqueIndex("subscriptions_provider_subscription_unique_idx").using("btree", table.provider.asc().nullsLast().op("text_ops"), table.providerSubscriptionId.asc().nullsLast().op("enum_ops")).where(sql`((provider IS NOT NULL) AND (provider_subscription_id IS NOT NULL))`),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "subscriptions_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.planId],
			foreignColumns: [plans.id],
			name: "subscriptions_plan_id_fkey"
		}),
	foreignKey({
			columns: [table.couponId],
			foreignColumns: [coupons.id],
			name: "subscriptions_coupon_id_fkey"
		}).onDelete("set null"),
	// subscriptions_billing_operation_id_fkey: declared in SQL only (a TypeScript inference cycle with billing_operations).
	pgPolicy("subscriptions_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(is_org_member(org_id) OR is_superadmin())` }),
	pgPolicy("subscriptions_all_superadmin", { as: "permissive", for: "all", to: ["authenticated"] }),
	check("subscriptions_payment_method_check", sql`(payment_method IS NULL) OR (payment_method = ANY (ARRAY['pix'::text, 'credit_card'::text]))`),
	check("subscriptions_currency_check", sql`(currency IS NULL) OR (currency = ANY (ARRAY['BRL'::text, 'USD'::text]))`),
	check("subscriptions_price_check", sql`(price_cents IS NULL) OR (price_cents >= 0)`),
	check("subscriptions_cancel_note_length", sql`(cancel_note IS NULL) OR (char_length(cancel_note) <= 500)`),
]);

export const subscriptionModules = pgTable("subscription_modules", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	subscriptionId: uuid("subscription_id").notNull(),
	moduleId: uuid("module_id").notNull(),
	status: text().default('active').notNull(),
	providerItemId: text("provider_item_id"),
	addedAt: timestamp("added_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	canceledAt: timestamp("canceled_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.subscriptionId],
			foreignColumns: [subscriptions.id],
			name: "subscription_modules_subscription_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.moduleId],
			foreignColumns: [modules.id],
			name: "subscription_modules_module_id_fkey"
		}),
	unique("subscription_modules_subscription_id_module_id_key").on(table.subscriptionId, table.moduleId),
	pgPolicy("subscription_modules_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(EXISTS ( SELECT 1
   FROM subscriptions s
  WHERE ((s.id = subscription_modules.subscription_id) AND (is_org_member(s.org_id) OR is_superadmin()))))` }),
	pgPolicy("subscription_modules_all_superadmin", { as: "permissive", for: "all", to: ["authenticated"] }),
	check("subscription_modules_status_check", sql`status = ANY (ARRAY['active'::text, 'canceled'::text])`),
]);

export const invoices = pgTable("invoices", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	subscriptionId: uuid("subscription_id"),
	planId: uuid("plan_id"),
	provider: billingProvider().notNull(),
	providerInvoiceId: text("provider_invoice_id").notNull(),
	amountCents: integer("amount_cents").notNull(),
	currency: text().default('BRL').notNull(),
	status: invoiceStatus().default('open').notNull(),
	description: text(),
	invoiceUrl: text("invoice_url"),
	fiscalDocumentUrl: text("fiscal_document_url"),
	dueAt: timestamp("due_at", { withTimezone: true, mode: 'string' }),
	paidAt: timestamp("paid_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("invoices_org_idx").using("btree", table.orgId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("uuid_ops")),
	index("invoices_paid_idx").using("btree", table.paidAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(status = 'paid'::invoice_status)`),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "invoices_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.subscriptionId],
			foreignColumns: [subscriptions.id],
			name: "invoices_subscription_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.planId],
			foreignColumns: [plans.id],
			name: "invoices_plan_id_fkey"
		}).onDelete("set null"),
	unique("invoices_provider_provider_invoice_id_key").on(table.provider, table.providerInvoiceId),
	pgPolicy("invoices_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(is_org_member(org_id) OR is_superadmin())` }),
	pgPolicy("invoices_all_superadmin", { as: "permissive", for: "all", to: ["authenticated"] }),
	check("invoices_currency_check", sql`currency = ANY (ARRAY['BRL'::text, 'USD'::text])`),
]);

export const entitlementGrants = pgTable("entitlement_grants", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	kind: text().notNull(),
	planId: uuid("plan_id"),
	limits: jsonb().default({}).notNull(),
	priceCents: integer("price_cents").default(0).notNull(),
	currency: text(),
	invoiceKey: text("invoice_key"),
	source: text().default('purchase').notNull(),
	grantedBy: uuid("granted_by"),
	note: text(),
	startsAt: timestamp("starts_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }),
	revokedAt: timestamp("revoked_at", { withTimezone: true, mode: 'string' }),
	revokeReason: text("revoke_reason"),
	endNoticeSentAt: timestamp("end_notice_sent_at", { withTimezone: true, mode: 'string' }),
	endedHandledAt: timestamp("ended_handled_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("entitlement_grants_live_idx").using("btree", table.orgId.asc().nullsLast().op("uuid_ops")).where(sql`(revoked_at IS NULL)`),
	index("entitlement_grants_org_idx").using("btree", table.orgId.asc().nullsLast().op("uuid_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "entitlement_grants_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.planId],
			foreignColumns: [plans.id],
			name: "entitlement_grants_plan_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.grantedBy],
			foreignColumns: [profiles.id],
			name: "entitlement_grants_granted_by_fkey"
		}).onDelete("set null"),
	unique("entitlement_grants_invoice_key_key").on(table.invoiceKey),
	pgPolicy("entitlement_grants_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(is_org_member(org_id) OR is_superadmin())` }),
	check("entitlement_grants_kind_check", sql`kind = ANY (ARRAY['kit'::text, 'license'::text, 'comp'::text])`),
	check("entitlement_grants_price_cents_check", sql`price_cents >= 0`),
	check("entitlement_grants_currency_check", sql`(currency IS NULL) OR (currency = ANY (ARRAY['BRL'::text, 'USD'::text]))`),
	check("entitlement_grants_source_check", sql`source = ANY (ARRAY['purchase'::text, 'admin'::text])`),
	check("entitlement_grants_purchase_key", sql`(source <> 'purchase'::text) OR (invoice_key IS NOT NULL)`),
	check("entitlement_grants_window", sql`(expires_at IS NULL) OR (expires_at > starts_at)`),
]);

export const billingOperations = pgTable("billing_operations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	actorId: uuid("actor_id").notNull(),
	kind: text().notNull(),
	idempotencyKey: uuid("idempotency_key").notNull(),
	planId: uuid("plan_id"),
	subscriptionId: uuid("subscription_id"),
	provider: text(),
	status: text().default('processing').notNull(),
	attempts: integer().default(1).notNull(),
	claimToken: uuid("claim_token"),
	result: jsonb().default({}).notNull(),
	errorCode: text("error_code"),
	leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true, mode: 'string' }),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "billing_operations_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.actorId],
			foreignColumns: [profiles.id],
			name: "billing_operations_actor_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.planId],
			foreignColumns: [plans.id],
			name: "billing_operations_plan_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.subscriptionId],
			foreignColumns: [subscriptions.id],
			name: "billing_operations_subscription_id_fkey"
		}).onDelete("set null"),
	unique("billing_operations_org_id_kind_idempotency_key_key").on(table.orgId, table.kind, table.idempotencyKey),
	pgPolicy("billing_operations_select_manager", { as: "permissive", for: "select", to: ["authenticated"], using: sql`((actor_id = auth.uid()) AND has_org_role(org_id, ARRAY['owner'::org_role, 'admin'::org_role]))` }),
	check("billing_operations_kind_check", sql`kind = ANY (ARRAY['checkout'::text, 'access_checkout'::text, 'cancel'::text, 'resume'::text])`),
	check("billing_operations_provider_check", sql`(provider IS NULL) OR (provider = ANY (ARRAY['stripe'::text, 'asaas'::text]))`),
	check("billing_operations_status_check", sql`status = ANY (ARRAY['processing'::text, 'completed'::text, 'failed'::text])`),
	check("billing_operations_attempts_check", sql`attempts > 0`),
	check("billing_operations_processing_claim_check", sql`(status <> 'processing'::text) OR ((claim_token IS NOT NULL) AND (lease_expires_at IS NOT NULL))`),
]);

export const billingWebhookEvents = pgTable("billing_webhook_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	provider: text().notNull(),
	providerEventId: text("provider_event_id").notNull(),
	eventType: text("event_type").notNull(),
	status: text().default('processing').notNull(),
	attempts: integer().default(1).notNull(),
	claimToken: uuid("claim_token"),
	leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true, mode: 'string' }),
	errorCode: text("error_code"),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("billing_webhook_events_provider_provider_event_id_event_typ_key").on(table.provider, table.providerEventId, table.eventType),
	check("billing_webhook_events_provider_check", sql`provider = ANY (ARRAY['stripe'::text, 'asaas'::text])`),
	check("billing_webhook_events_status_check", sql`status = ANY (ARRAY['processing'::text, 'completed'::text, 'failed'::text])`),
	check("billing_webhook_events_attempts_check", sql`attempts > 0`),
	check("billing_webhooks_processing_claim_check", sql`(status <> 'processing'::text) OR ((claim_token IS NOT NULL) AND (lease_expires_at IS NOT NULL))`),
]);

export const signupAttribution = pgTable("signup_attribution", {
	orgId: uuid("org_id").primaryKey().notNull(),
	origem: text(),
	onda: text(),
	utmSource: text("utm_source"),
	utmMedium: text("utm_medium"),
	utmCampaign: text("utm_campaign"),
	utmContent: text("utm_content"),
	utmTerm: text("utm_term"),
	referrer: text(),
	landingPath: text("landing_path"),
	capturedAt: timestamp("captured_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("signup_attribution_onda_idx").using("btree", table.onda.asc().nullsLast().op("timestamptz_ops"), table.capturedAt.desc().nullsFirst().op("text_ops")),
	index("signup_attribution_origem_idx").using("btree", table.origem.asc().nullsLast().op("timestamptz_ops"), table.capturedAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "signup_attribution_org_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("signup_attribution_select_superadmin", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_superadmin()` }),
	check("signup_attribution_lengths", sql`(COALESCE(length(origem), 0) <= 64) AND (COALESCE(length(onda), 0) <= 64) AND (COALESCE(length(utm_source), 0) <= 64) AND (COALESCE(length(utm_medium), 0) <= 64) AND (COALESCE(length(utm_campaign), 0) <= 64) AND (COALESCE(length(utm_content), 0) <= 64) AND (COALESCE(length(utm_term), 0) <= 64) AND (COALESCE(length(referrer), 0) <= 255) AND (COALESCE(length(landing_path), 0) <= 255)`),
]);

export const metaAttribution = pgTable("meta_attribution", {
	orgId: uuid("org_id").primaryKey().notNull(),
	fbp: text(),
	fbc: text(),
	gaClientId: text("ga_client_id"),
	email: text(),
	clientIp: text("client_ip"),
	clientUserAgent: text("client_user_agent"),
	campaignOrigem: text("campaign_origem"),
	campaignUtmSource: text("campaign_utm_source"),
	campaignUtmMedium: text("campaign_utm_medium"),
	campaignUtmCampaign: text("campaign_utm_campaign"),
	campaignUtmContent: text("campaign_utm_content"),
	campaignCapturedAt: timestamp("campaign_captured_at", { withTimezone: true, mode: 'string' }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "meta_attribution_org_id_fkey"
		}).onDelete("cascade"),
	check("meta_attribution_campaign_lengths", sql`(COALESCE(length(campaign_origem), 0) <= 64) AND (COALESCE(length(campaign_utm_source), 0) <= 64) AND (COALESCE(length(campaign_utm_medium), 0) <= 64) AND (COALESCE(length(campaign_utm_campaign), 0) <= 64) AND (COALESCE(length(campaign_utm_content), 0) <= 64)`),
]);

export const purchaseAttributions = pgTable("purchase_attributions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	invoiceKey: text("invoice_key").notNull(),
	subscriptionId: uuid("subscription_id"),
	planSlug: text("plan_slug"),
	amountCents: integer("amount_cents").notNull(),
	currency: text().notNull(),
	paidAt: timestamp("paid_at", { withTimezone: true, mode: 'string' }).notNull(),
	origem: text(),
	utmSource: text("utm_source"),
	utmMedium: text("utm_medium"),
	utmCampaign: text("utm_campaign"),
	utmContent: text("utm_content"),
	campaignCapturedAt: timestamp("campaign_captured_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("purchase_attributions_campaign_idx").using("btree", table.utmCampaign.asc().nullsLast().op("text_ops"), table.paidAt.desc().nullsFirst().op("timestamptz_ops")),
	index("purchase_attributions_org_idx").using("btree", table.orgId.asc().nullsLast().op("uuid_ops")),
	index("purchase_attributions_origem_idx").using("btree", table.origem.asc().nullsLast().op("text_ops"), table.paidAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "purchase_attributions_org_id_fkey"
		}).onDelete("cascade"),
	unique("purchase_attributions_invoice_key_key").on(table.invoiceKey),
	pgPolicy("purchase_attributions_select_superadmin", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_superadmin()` }),
	check("purchase_attributions_invoice_key_check", sql`char_length(invoice_key) <= 200`),
	check("purchase_attributions_plan_slug_check", sql`(plan_slug IS NULL) OR (char_length(plan_slug) <= 80)`),
	check("purchase_attributions_amount_cents_check", sql`amount_cents >= 0`),
	check("purchase_attributions_currency_check", sql`currency = ANY (ARRAY['BRL'::text, 'USD'::text])`),
	check("purchase_attributions_lengths", sql`(COALESCE(length(origem), 0) <= 64) AND (COALESCE(length(utm_source), 0) <= 64) AND (COALESCE(length(utm_medium), 0) <= 64) AND (COALESCE(length(utm_campaign), 0) <= 64) AND (COALESCE(length(utm_content), 0) <= 64)`),
]);

export const productEvents = pgTable("product_events", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "product_events_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	orgId: uuid("org_id"),
	actorId: uuid("actor_id"),
	eventName: text("event_name").notNull(),
	properties: jsonb().default({}).notNull(),
	occurredAt: timestamp("occurred_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("product_events_actor_idx").using("btree", table.actorId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("product_events_name_idx").using("btree", table.eventName.asc().nullsLast().op("text_ops"), table.occurredAt.desc().nullsFirst().op("text_ops")),
	index("product_events_occurred_idx").using("btree", table.occurredAt.asc().nullsLast().op("timestamptz_ops")),
	index("product_events_org_idx").using("btree", table.orgId.asc().nullsLast().op("timestamptz_ops"), table.eventName.asc().nullsLast().op("timestamptz_ops"), table.occurredAt.desc().nullsFirst().op("uuid_ops")),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "product_events_org_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.actorId],
			foreignColumns: [profiles.id],
			name: "product_events_actor_id_fkey"
		}).onDelete("set null"),
	pgPolicy("product_events_select_superadmin", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_superadmin()` }),
	check("product_events_name_check", sql`CHECK (product_event_known(event_name`),
	check("product_events_properties_size_check", sql`octet_length((properties)::text) <= 2048`),
]);

export const helpCategories = pgTable("help_categories", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	locale: text().default('pt-BR').notNull(),
	slug: text().notNull(),
	name: text().notNull(),
	description: text(),
	translationGroup: uuid("translation_group").defaultRandom().notNull(),
	sort: integer().default(0).notNull(),
	isPublished: boolean("is_published").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("help_categories_locale_slug_key").on(table.locale, table.slug),
	unique("help_categories_translation_group_locale_key").on(table.locale, table.translationGroup),
	pgPolicy("help_categories_select_published", { as: "permissive", for: "select", to: ["anon", "authenticated"], using: sql`is_published` }),
	pgPolicy("help_categories_all_superadmin", { as: "permissive", for: "all", to: ["authenticated"] }),
	check("help_categories_locale_check", sql`locale = ANY (supported_locales())`),
]);

export const helpArticles = pgTable("help_articles", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	categoryId: uuid("category_id").notNull(),
	locale: text().default('pt-BR').notNull(),
	slug: text().notNull(),
	title: text().notNull(),
	excerpt: text(),
	bodyMd: text("body_md").default('').notNull(),
	translationGroup: uuid("translation_group").defaultRandom().notNull(),
	sort: integer().default(0).notNull(),
	isPublished: boolean("is_published").default(false).notNull(),
	publishedAt: timestamp("published_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("help_articles_category_idx").using("btree", table.categoryId.asc().nullsLast().op("uuid_ops")),
	index("help_articles_locale_idx").using("btree", table.locale.asc().nullsLast().op("text_ops")).where(sql`is_published`),
	foreignKey({
			columns: [table.categoryId],
			foreignColumns: [helpCategories.id],
			name: "help_articles_category_id_fkey"
		}).onDelete("cascade"),
	unique("help_articles_locale_slug_key").on(table.locale, table.slug),
	unique("help_articles_translation_group_locale_key").on(table.locale, table.translationGroup),
	pgPolicy("help_articles_select_published", { as: "permissive", for: "select", to: ["anon", "authenticated"], using: sql`is_published` }),
	pgPolicy("help_articles_all_superadmin", { as: "permissive", for: "all", to: ["authenticated"] }),
	check("help_articles_locale_check", sql`locale = ANY (supported_locales())`),
]);

export const blogPosts = pgTable("blog_posts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	locale: text().default('pt-BR').notNull(),
	slug: text().notNull(),
	title: text().notNull(),
	excerpt: text(),
	bodyMd: text("body_md").default('').notNull(),
	coverUrl: text("cover_url"),
	authorName: text("author_name"),
	tags: text().array().default(sql`'{}'`).notNull(),
	kind: text().default('post').notNull(),
	audience: text().default('public').notNull(),
	translationGroup: uuid("translation_group").defaultRandom().notNull(),
	isPublished: boolean("is_published").default(false).notNull(),
	publishedAt: timestamp("published_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("blog_posts_kind_idx").using("btree", table.kind.asc().nullsLast().op("text_ops"), table.locale.asc().nullsLast().op("timestamptz_ops"), table.publishedAt.desc().nullsFirst().op("timestamptz_ops")).where(sql`is_published`),
	index("blog_posts_locale_idx").using("btree", table.locale.asc().nullsLast().op("timestamptz_ops"), table.publishedAt.desc().nullsFirst().op("text_ops")).where(sql`is_published`),
	unique("blog_posts_locale_slug_key").on(table.locale, table.slug),
	unique("blog_posts_translation_group_locale_key").on(table.locale, table.translationGroup),
	pgPolicy("blog_posts_select_public", { as: "permissive", for: "select", to: ["anon"], using: sql`(is_published AND (audience = 'public'::text))` }),
	pgPolicy("blog_posts_select_member", { as: "permissive", for: "select", to: ["authenticated"] }),
	pgPolicy("blog_posts_all_superadmin", { as: "permissive", for: "all", to: ["authenticated"] }),
	check("blog_posts_locale_check", sql`locale = ANY (supported_locales())`),
	check("blog_posts_kind_check", sql`kind = ANY (ARRAY['post'::text, 'news'::text])`),
	check("blog_posts_audience_check", sql`audience = ANY (ARRAY['public'::text, 'members'::text])`),
]);

export const leads = pgTable("leads", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	// TODO: failed to parse database type 'citext'
	email: citext("email").notNull(),
	name: text(),
	phone: text(),
	locale: text().default('pt-BR').notNull(),
	source: text().default('waitlist').notNull(),
	origem: text(),
	onda: text(),
	cupom: text(),
	utmSource: text("utm_source"),
	utmMedium: text("utm_medium"),
	utmCampaign: text("utm_campaign"),
	utmContent: text("utm_content"),
	utmTerm: text("utm_term"),
	referrer: text(),
	landingPath: text("landing_path"),
	consentTermId: uuid("consent_term_id"),
	consentTermVersion: integer("consent_term_version"),
	consentText: text("consent_text"),
	consentAcceptedAt: timestamp("consent_accepted_at", { withTimezone: true, mode: 'string' }),
	confirmTokenHash: text("confirm_token_hash"),
	confirmSentAt: timestamp("confirm_sent_at", { withTimezone: true, mode: 'string' }),
	confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: 'string' }),
	emailUnsubscribeToken: uuid("email_unsubscribe_token").defaultRandom().notNull(),
	optedOutAt: timestamp("opted_out_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("leads_confirmed_idx").using("btree", table.confirmedAt.asc().nullsLast().op("timestamptz_ops")).where(sql`((confirmed_at IS NOT NULL) AND (opted_out_at IS NULL))`),
	index("leads_created_idx").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("leads_origem_idx").using("btree", table.origem.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("text_ops")),
	foreignKey({
			columns: [table.consentTermId],
			foreignColumns: [consentTerms.id],
			name: "leads_consent_term_id_fkey"
		}),
	unique("leads_email_key").on(table.email),
	unique("leads_confirm_token_hash_key").on(table.confirmTokenHash),
	unique("leads_email_unsubscribe_token_key").on(table.emailUnsubscribeToken),
	pgPolicy("leads_select_superadmin", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_superadmin()` }),
	pgPolicy("leads_update_superadmin", { as: "permissive", for: "update", to: ["authenticated"] }),
	check("leads_locale_check", sql`locale = ANY (supported_locales())`),
	check("leads_source_check", sql`source = ANY (ARRAY['waitlist'::text, 'newsletter'::text, 'contact'::text])`),
	check("leads_email_check", sql`(char_length((email)::text) <= 254) AND ((email)::text ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'::text)`),
	check("leads_name_check", sql`(name IS NULL) OR ((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 120))`),
	check("leads_phone_check", sql`(phone IS NULL) OR (phone ~ '^[1-9][0-9]{7,14}$'::text)`),
	check("leads_token_hash_check", sql`(confirm_token_hash IS NULL) OR (confirm_token_hash ~ '^[0-9a-f]{64}$'::text)`),
	check("leads_lengths", sql`(COALESCE(length(origem), 0) <= 64) AND (COALESCE(length(onda), 0) <= 64) AND (COALESCE(length(cupom), 0) <= 64) AND (COALESCE(length(utm_source), 0) <= 64) AND (COALESCE(length(utm_medium), 0) <= 64) AND (COALESCE(length(utm_campaign), 0) <= 64) AND (COALESCE(length(utm_content), 0) <= 64) AND (COALESCE(length(utm_term), 0) <= 64) AND (COALESCE(length(referrer), 0) <= 255) AND (COALESCE(length(landing_path), 0) <= 255)`),
	check("leads_consent_whole", sql`((consent_term_id IS NULL) AND (consent_term_version IS NULL) AND (consent_text IS NULL) AND (consent_accepted_at IS NULL)) OR ((consent_term_id IS NOT NULL) AND (consent_term_version IS NOT NULL) AND (consent_text IS NOT NULL) AND (consent_accepted_at IS NOT NULL))`),
]);

export const blogComments = pgTable("blog_comments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	postId: uuid("post_id").notNull(),
	userId: uuid("user_id").notNull(),
	authorName: text("author_name"),
	body: text().notNull(),
	status: blogCommentStatus().default('pending').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("blog_comments_post_idx").using("btree", table.postId.asc().nullsLast().op("uuid_ops"), table.status.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.postId],
			foreignColumns: [blogPosts.id],
			name: "blog_comments_post_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [profiles.id],
			name: "blog_comments_user_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("blog_comments_select_public", { as: "permissive", for: "select", to: ["anon"], using: sql`((status = 'approved'::blog_comment_status) AND (EXISTS ( SELECT 1
   FROM blog_posts p
  WHERE ((p.id = blog_comments.post_id) AND p.is_published AND (p.audience = 'public'::text)))))` }),
	pgPolicy("blog_comments_select_member", { as: "permissive", for: "select", to: ["authenticated"] }),
	pgPolicy("blog_comments_insert_own", { as: "permissive", for: "insert", to: ["authenticated"] }),
	pgPolicy("blog_comments_delete_own", { as: "permissive", for: "delete", to: ["authenticated"] }),
	pgPolicy("blog_comments_all_superadmin", { as: "permissive", for: "all", to: ["authenticated"] }),
	check("blog_comments_body_check", sql`(char_length(body) >= 1) AND (char_length(body) <= 4000)`),
]);

export const impersonationSessions = pgTable("impersonation_sessions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	actorId: uuid("actor_id").notNull(),
	targetUserId: uuid("target_user_id").notNull(),
	targetOrgId: uuid("target_org_id"),
	reason: text().notNull(),
	sessionId: uuid("session_id").notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	endedAt: timestamp("ended_at", { withTimezone: true, mode: 'string' }),
	endedReason: text("ended_reason"),
}, (table) => [
	index("impersonation_sessions_actor_idx").using("btree", table.actorId.asc().nullsLast().op("timestamptz_ops"), table.startedAt.desc().nullsFirst().op("timestamptz_ops")),
	index("impersonation_sessions_target_idx").using("btree", table.targetUserId.asc().nullsLast().op("timestamptz_ops"), table.startedAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.actorId],
			foreignColumns: [profiles.id],
			name: "impersonation_sessions_actor_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.targetUserId],
			foreignColumns: [profiles.id],
			name: "impersonation_sessions_target_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.targetOrgId],
			foreignColumns: [organizations.id],
			name: "impersonation_sessions_target_org_id_fkey"
		}).onDelete("set null"),
	unique("impersonation_sessions_session_id_key").on(table.sessionId),
	pgPolicy("impersonation_sessions_select_own", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(target_user_id = auth.uid())` }),
	pgPolicy("impersonation_sessions_select_superadmin", { as: "permissive", for: "select", to: ["authenticated"] }),
	check("impersonation_sessions_reason_check", sql`length(btrim(reason)) >= 8`),
]);

export const leadSubmissions = pgTable("lead_submissions", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "lead_submissions_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	ipHash: text("ip_hash").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("lead_submissions_window_idx").using("btree", table.ipHash.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("text_ops")),
	check("lead_submissions_ip_hash_check", sql`ip_hash ~ '^[0-9a-f]{64}$'::text`),
]);

export const newsletterSends = pgTable("newsletter_sends", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	subject: jsonb().notNull(),
	bodyMd: jsonb("body_md").notNull(),
	source: text(),
	status: text().default('queued').notNull(),
	delivered: integer().default(0).notNull(),
	lastError: text("last_error"),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }),
	finishedAt: timestamp("finished_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [profiles.id],
			name: "newsletter_sends_created_by_fkey"
		}).onDelete("set null"),
	pgPolicy("newsletter_sends_select_superadmin", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_superadmin()` }),
	check("newsletter_sends_languages", sql`(subject <> '{}'::jsonb) AND (body_md <> '{}'::jsonb)`),
	check("newsletter_sends_subject_check", sql`CHECK (i18n_ok(subject`),
	check("newsletter_sends_body_md_check", sql`CHECK (i18n_ok(body_md`),
	check("newsletter_sends_source_check", sql`(source IS NULL) OR (source = ANY (ARRAY['waitlist'::text, 'newsletter'::text, 'contact'::text]))`),
	check("newsletter_sends_status_check", sql`status = ANY (ARRAY['queued'::text, 'sending'::text, 'sent'::text, 'failed'::text])`),
	check("newsletter_sends_delivered_check", sql`delivered >= 0`),
]);

export const aiSpend = pgTable("ai_spend", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id"),
	occurredAt: timestamp("occurred_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	feature: text().notNull(),
	provider: text().notNull(),
	model: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	tokensIn: bigint("tokens_in", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	tokensOut: bigint("tokens_out", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	costUsdMicros: bigint("cost_usd_micros", { mode: "number" }).default(0).notNull(),
	priced: boolean().default(false).notNull(),
	refId: uuid("ref_id"),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	audioTokensIn: bigint("audio_tokens_in", { mode: "number" }).default(0).notNull(),
}, (table) => [
	index("ai_spend_at_idx").using("btree", table.occurredAt.desc().nullsFirst().op("timestamptz_ops")),
	index("ai_spend_feature_idx").using("btree", table.feature.asc().nullsLast().op("text_ops"), table.occurredAt.desc().nullsFirst().op("text_ops")),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "ai_spend_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "ai_spend_created_by_fkey"
		}).onDelete("set null"),
	pgPolicy("ai_spend_select_superadmin", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_superadmin()` }),
	check("ai_spend_feature_check", sql`feature ~ '^[a-z][a-z0-9_.-]{0,63}$'::text`),
	check("ai_spend_tokens_in_check", sql`tokens_in >= 0`),
	check("ai_spend_tokens_out_check", sql`tokens_out >= 0`),
	check("ai_spend_cost_usd_micros_check", sql`cost_usd_micros >= 0`),
	check("ai_spend_audio_tokens_check", sql`audio_tokens_in >= 0`),
]);

export const aiTasks = pgTable("ai_tasks", {
	slug: text().primaryKey().notNull(),
	name: text().notNull(),
	description: text(),
	autonomy: text().default('approval').notNull(),
	samplePercent: integer("sample_percent").default(100).notNull(),
	shadow: boolean().default(false).notNull(),
	revisable: boolean().default(false).notNull(),
	approverFunctions: firmFunction("approver_functions").array().default(["RAY['socio'::firm_function", "'advogado'::firm_functio"]).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	pgPolicy("ai_tasks_select_active", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(is_active OR is_superadmin())` }),
	check("ai_tasks_slug_check", sql`slug ~ '^[a-z][a-z0-9_.-]{1,63}$'::text`),
	check("ai_tasks_name_check", sql`(char_length(btrim(name)) >= 2) AND (char_length(btrim(name)) <= 120)`),
	check("ai_tasks_autonomy_check", sql`autonomy = ANY (ARRAY['approval'::text, 'sampled'::text, 'autonomous'::text])`),
	check("ai_tasks_sample_check", sql`(sample_percent >= 1) AND (sample_percent <= 100)`),
	check("ai_tasks_approvers_check", sql`cardinality(approver_functions) > 0`),
]);

export const promptVersions = pgTable("prompt_versions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	task: text().notNull(),
	version: integer().notNull(),
	provider: text().notNull(),
	model: text().notNull(),
	effort: text(),
	systemPrompt: text("system_prompt").notNull(),
	outputSchema: jsonb("output_schema").notNull(),
	maxTokens: integer("max_tokens").default(2048).notNull(),
	isActive: boolean("is_active").default(false).notNull(),
	note: text(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("prompt_versions_one_active_idx").using("btree", table.task.asc().nullsLast().op("text_ops")).where(sql`is_active`),
	foreignKey({
			columns: [table.task],
			foreignColumns: [aiTasks.slug],
			name: "prompt_versions_task_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [profiles.id],
			name: "prompt_versions_created_by_fkey"
		}).onDelete("set null"),
	unique("prompt_versions_task_version_key").on(table.task, table.version),
	pgPolicy("prompt_versions_select_superadmin", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_superadmin()` }),
	check("prompt_versions_version_check", sql`version > 0`),
	check("prompt_versions_provider_check", sql`provider = ANY (ARRAY['anthropic'::text, 'gemini'::text, 'openai'::text, 'openrouter'::text])`),
	check("prompt_versions_effort_check", sql`(effort IS NULL) OR (effort = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'xhigh'::text, 'max'::text]))`),
	check("prompt_versions_prompt_check", sql`(char_length(btrim(system_prompt)) >= 20) AND (char_length(btrim(system_prompt)) <= 60000)`),
	check("prompt_versions_schema_check", sql`jsonb_typeof(output_schema) = 'object'::text`),
	check("prompt_versions_tokens_check", sql`(max_tokens >= 64) AND (max_tokens <= 64000)`),
]);

export const autonomyDecisions = pgTable("autonomy_decisions", {
	key: text().primaryKey().notNull(),
	task: text(),
	position: integer().default(100).notNull(),
	modes: text().array().notNull(),
	defaultMode: text("default_mode").default('auto').notNull(),
	held: boolean().default(false).notNull(),
	heldNote: text("held_note"),
	heldBy: uuid("held_by"),
	heldAt: timestamp("held_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	uniqueIndex("autonomy_decisions_task_key").using("btree", table.task.asc().nullsLast().op("text_ops")).where(sql`(task IS NOT NULL)`),
	foreignKey({
			columns: [table.task],
			foreignColumns: [aiTasks.slug],
			name: "autonomy_decisions_task_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.heldBy],
			foreignColumns: [profiles.id],
			name: "autonomy_decisions_held_by_fkey"
		}).onDelete("set null"),
	pgPolicy("autonomy_decisions_select_all", { as: "permissive", for: "select", to: ["authenticated"], using: sql`true` }),
	check("autonomy_decisions_key_check", sql`key ~ '^[a-z][a-z_]{2,40}$'::text`),
	check("autonomy_decisions_modes_check", sql`((cardinality(modes) >= 2) AND (cardinality(modes) <= 3)) AND (modes <@ ARRAY['auto'::text, 'sampled'::text, 'approval'::text]) AND ('auto'::text = ANY (modes)) AND ('approval'::text = ANY (modes))`),
	check("autonomy_decisions_default_check", sql`default_mode = ANY (modes)`),
	check("autonomy_decisions_held_check", sql`(held = (held_note IS NOT NULL)) AND ((held_note IS NULL) OR ((char_length(held_note) >= 8) AND (char_length(held_note) <= 500)))`),
]);

export const aiRuns = pgTable("ai_runs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	task: text().notNull(),
	promptVersionId: uuid("prompt_version_id").notNull(),
	provider: text().notNull(),
	model: text().notNull(),
	effort: text(),
	inputHash: text("input_hash").notNull(),
	subjectType: text("subject_type"),
	subjectId: text("subject_id"),
	idempotencyKey: text("idempotency_key"),
	requestedBy: uuid("requested_by"),
	status: text().default('running').notNull(),
	output: jsonb(),
	errorCode: text("error_code"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	tokensIn: bigint("tokens_in", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	tokensOut: bigint("tokens_out", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	costUsdMicros: bigint("cost_usd_micros", { mode: "number" }).default(0).notNull(),
	priced: boolean().default(false).notNull(),
	spendId: uuid("spend_id"),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	finishedAt: timestamp("finished_at", { withTimezone: true, mode: 'string' }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	audioTokensIn: bigint("audio_tokens_in", { mode: "number" }).default(0).notNull(),
}, (table) => [
	uniqueIndex("ai_runs_idempotency_idx").using("btree", table.orgId.asc().nullsLast().op("text_ops"), table.idempotencyKey.asc().nullsLast().op("uuid_ops")).where(sql`(idempotency_key IS NOT NULL)`),
	index("ai_runs_org_idx").using("btree", table.orgId.asc().nullsLast().op("timestamptz_ops"), table.startedAt.desc().nullsFirst().op("timestamptz_ops")),
	index("ai_runs_running_idx").using("btree", table.startedAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(status = 'running'::text)`),
	index("ai_runs_subject_idx").using("btree", table.orgId.asc().nullsLast().op("uuid_ops"), table.subjectType.asc().nullsLast().op("uuid_ops"), table.subjectId.asc().nullsLast().op("uuid_ops")).where(sql`(subject_type IS NOT NULL)`),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "ai_runs_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.task],
			foreignColumns: [aiTasks.slug],
			name: "ai_runs_task_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.promptVersionId],
			foreignColumns: [promptVersions.id],
			name: "ai_runs_prompt_version_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.requestedBy],
			foreignColumns: [profiles.id],
			name: "ai_runs_requested_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.spendId],
			foreignColumns: [aiSpend.id],
			name: "ai_runs_spend_id_fkey"
		}).onDelete("set null"),
	pgPolicy("ai_runs_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(is_org_member(org_id) AND (NOT ai_task_is_shadow(task)))` }),
	check("ai_runs_status_check", sql`status = ANY (ARRAY['running'::text, 'succeeded'::text, 'failed'::text, 'blocked'::text])`),
	check("ai_runs_input_hash_check", sql`input_hash ~ '^[0-9a-f]{64}$'::text`),
	check("ai_runs_subject_check", sql`((subject_type IS NULL) AND (subject_id IS NULL)) OR ((subject_type ~ '^[a-z][a-z0-9_]{1,39}$'::text) AND ((char_length(subject_id) >= 1) AND (char_length(subject_id) <= 80)))`),
	check("ai_runs_idempotency_check", sql`(idempotency_key IS NULL) OR ((char_length(idempotency_key) >= 8) AND (char_length(idempotency_key) <= 120))`),
	check("ai_runs_finished_check", sql`(status = 'running'::text) = (finished_at IS NULL)`),
	check("ai_runs_audio_tokens_check", sql`audio_tokens_in >= 0`),
]);

export const approvals = pgTable("approvals", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	runId: uuid("run_id").notNull(),
	task: text().notNull(),
	approverFunctions: firmFunction("approver_functions").array().notNull(),
	status: text().default('pending').notNull(),
	finalOutput: jsonb("final_output"),
	edited: boolean().default(false).notNull(),
	decidedAuto: boolean("decided_auto").default(false).notNull(),
	decidedBy: uuid("decided_by"),
	decidedAt: timestamp("decided_at", { withTimezone: true, mode: 'string' }),
	decisionNote: text("decision_note"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("approvals_org_idx").using("btree", table.orgId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("uuid_ops")),
	index("approvals_queue_idx").using("btree", table.orgId.asc().nullsLast().op("uuid_ops"), table.createdAt.asc().nullsLast().op("uuid_ops")).where(sql`(status = 'pending'::text)`),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "approvals_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.runId],
			foreignColumns: [aiRuns.id],
			name: "approvals_run_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.task],
			foreignColumns: [aiTasks.slug],
			name: "approvals_task_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.decidedBy],
			foreignColumns: [profiles.id],
			name: "approvals_decided_by_fkey"
		}).onDelete("set null"),
	unique("approvals_run_id_key").on(table.runId),
	pgPolicy("approvals_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("approvals_decided_check", sql`(status = 'pending'::text) = (decided_at IS NULL)`),
	check("approvals_output_check", sql`(status = 'approved'::text) = (final_output IS NOT NULL)`),
	check("approvals_note_check", sql`(decision_note IS NULL) OR (char_length(decision_note) <= 2000)`),
	check("approvals_status_check", sql`status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'returned'::text, 'withdrawn'::text])`),
]);

export const connections = pgTable("connections", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	provider: text().notNull(),
	externalId: text("external_id"),
	label: text().notNull(),
	status: text().default('pending').notNull(),
	metadata: jsonb().default({}).notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }),
	lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: 'string' }),
	lastError: text("last_error"),
	connectedBy: uuid("connected_by"),
	connectedAt: timestamp("connected_at", { withTimezone: true, mode: 'string' }),
	disconnectedBy: uuid("disconnected_by"),
	disconnectedAt: timestamp("disconnected_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	personId: uuid("person_id"),
}, (table) => [
	index("connections_expiring_idx").using("btree", table.expiresAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(status = ANY (ARRAY['connected'::text, 'error'::text]))`),
	index("connections_org_idx").using("btree", table.orgId.asc().nullsLast().op("uuid_ops"), table.provider.asc().nullsLast().op("text_ops")),
	index("connections_person_idx").using("btree", table.personId.asc().nullsLast().op("uuid_ops"), table.orgId.asc().nullsLast().op("uuid_ops")).where(sql`(person_id IS NOT NULL)`),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "connections_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.connectedBy],
			foreignColumns: [profiles.id],
			name: "connections_connected_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.disconnectedBy],
			foreignColumns: [profiles.id],
			name: "connections_disconnected_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.personId],
			foreignColumns: [profiles.id],
			name: "connections_person_id_fkey"
		}).onDelete("cascade"),
	unique("connections_id_org_id_key").on(table.id, table.orgId),
	unique("connections_account_key").on(table.orgId, table.provider, table.externalId),
	pgPolicy("connections_select_manager", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(has_org_role(org_id, ARRAY['owner'::org_role, 'admin'::org_role]) OR is_superadmin())` }),
	pgPolicy("connections_select_person", { as: "permissive", for: "select", to: ["authenticated"] }),
	check("connections_provider_check", sql`provider ~ '^[a-z][a-z0-9_.-]{1,39}$'::text`),
	check("connections_external_check", sql`(external_id IS NULL) OR ((char_length(external_id) >= 1) AND (char_length(external_id) <= 200))`),
	check("connections_label_check", sql`(char_length(btrim(label)) >= 1) AND (char_length(btrim(label)) <= 120)`),
	check("connections_status_check", sql`status = ANY (ARRAY['pending'::text, 'connected'::text, 'error'::text, 'expired'::text, 'disconnected'::text])`),
	check("connections_metadata_check", sql`(jsonb_typeof(metadata) = 'object'::text) AND (octet_length((metadata)::text) <= 8000) AND (NOT jsonb_has_credential_key(metadata))`),
	check("connections_error_check", sql`(last_error IS NULL) OR (last_error ~ '^[a-z][a-z0-9_]{1,63}$'::text)`),
	check("connections_person_check", sql`CHECK (
CASE
    WHEN (provider ~ '^psc[.]'::text) THEN ((person_id IS NOT NULL) AND (external_id = (person_id)::text))
    ELSE (person_id IS NULL)
END)`),
]);

export const connectionSecrets = pgTable("connection_secrets", {
	connectionId: uuid("connection_id").primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	keyVersion: integer("key_version").notNull(),
	iv: text().notNull(),
	ciphertext: text().notNull(),
	authTag: text("auth_tag").notNull(),
	sealId: uuid("seal_id").defaultRandom().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	rewrappedAt: timestamp("rewrapped_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("connection_secrets_version_idx").using("btree", table.keyVersion.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "connection_secrets_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.connectionId, table.orgId],
			foreignColumns: [connections.id, connections.orgId],
			name: "connection_secrets_connection_id_org_id_fkey"
		}).onDelete("cascade"),
	check("connection_secrets_version_check", sql`(key_version >= 1) AND (key_version <= 9999)`),
	check("connection_secrets_iv_check", sql`iv ~ '^[A-Za-z0-9+/]{16}$'::text`),
	check("connection_secrets_ciphertext_check", sql`(ciphertext ~ '^[A-Za-z0-9+/]+={0,2}$'::text) AND ((char_length(ciphertext) >= 4) AND (char_length(ciphertext) <= 24000))`),
	check("connection_secrets_tag_check", sql`auth_tag ~ '^[A-Za-z0-9+/]{22}==$'::text`),
]);

export const waNumbers = pgTable("wa_numbers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	connectionId: uuid("connection_id"),
	provider: text().notNull(),
	phoneNumberId: text("phone_number_id").notNull(),
	wabaId: text("waba_id").notNull(),
	displayPhoneNumber: text("display_phone_number").notNull(),
	verifiedName: text("verified_name"),
	mode: text().default('cloud').notNull(),
	status: text().default('active').notNull(),
	disconnectReason: text("disconnect_reason"),
	connectedAt: timestamp("connected_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	disconnectedAt: timestamp("disconnected_at", { withTimezone: true, mode: 'string' }),
	contactsSyncRequestedAt: timestamp("contacts_sync_requested_at", { withTimezone: true, mode: 'string' }),
	historySyncRequestedAt: timestamp("history_sync_requested_at", { withTimezone: true, mode: 'string' }),
	historyProgress: integer("history_progress"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("wa_numbers_active_idx").using("btree", table.provider.asc().nullsLast().op("text_ops"), table.phoneNumberId.asc().nullsLast().op("text_ops")).where(sql`(status = 'active'::text)`),
	index("wa_numbers_org_idx").using("btree", table.orgId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "wa_numbers_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId, table.connectionId],
			foreignColumns: [connections.id, connections.orgId],
			name: "wa_numbers_connection_id_org_id_fkey"
		}).onDelete("set null"),
	unique("wa_numbers_id_org_id_key").on(table.id, table.orgId),
	pgPolicy("wa_numbers_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("wa_numbers_connection_check", sql`(status = 'disconnected'::text) OR (connection_id IS NOT NULL)`),
	check("wa_numbers_ids_check", sql`(phone_number_id ~ '^[A-Za-z0-9_.-]{3,64}$'::text) AND (waba_id ~ '^[A-Za-z0-9_.-]{3,64}$'::text)`),
	check("wa_numbers_phone_check", sql`display_phone_number ~ '^[0-9]{8,15}$'::text`),
	check("wa_numbers_mode_check", sql`mode = ANY (ARRAY['cloud'::text, 'coexistence'::text])`),
	check("wa_numbers_status_check", sql`status = ANY (ARRAY['active'::text, 'disconnected'::text])`),
	check("wa_numbers_disconnected_check", sql`(status = 'disconnected'::text) = (disconnected_at IS NOT NULL)`),
	check("wa_numbers_progress_check", sql`(history_progress IS NULL) OR ((history_progress >= 0) AND (history_progress <= 100))`),
	check("wa_numbers_provider_check", sql`provider = ANY (ARRAY['meta'::text, 'simulator'::text, 'test'::text])`),
]);

export const files = pgTable("files", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	purpose: text().notNull(),
	storagePath: text("storage_path").notNull(),
	name: text().notNull(),
	declaredMime: text("declared_mime").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	declaredBytes: bigint("declared_bytes", { mode: "number" }).notNull(),
	status: text().default('reserved').notNull(),
	sha256: text(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	bytes: bigint({ mode: "number" }),
	detectedMime: text("detected_mime"),
	pages: integer(),
	rejectedReason: text("rejected_reason"),
	uploadedBy: uuid("uploaded_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: 'string' }),
	partnerId: uuid("partner_id"),
}, (table) => [
	index("files_org_idx").using("btree", table.orgId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("files_partner_idx").using("btree", table.partnerId.asc().nullsLast().op("uuid_ops")).where(sql`(partner_id IS NOT NULL)`),
	index("files_reserved_idx").using("btree", table.expiresAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(status = 'reserved'::text)`),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "files_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.uploadedBy],
			foreignColumns: [profiles.id],
			name: "files_uploaded_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.partnerId],
			foreignColumns: [partners.id],
			name: "files_partner_id_fkey"
		}).onDelete("cascade"),
	unique("files_id_org_id_key").on(table.id, table.orgId),
	unique("files_storage_path_key").on(table.storagePath),
	pgPolicy("files_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(is_org_member(org_id) AND (partner_id IS NULL))` }),
	pgPolicy("files_select_partner", { as: "permissive", for: "select", to: ["authenticated"] }),
	check("files_measured_check", sql`(status = 'reserved'::text) = (confirmed_at IS NULL)`),
	check("files_purpose_check", sql`purpose ~ '^[a-z][a-z0-9_.-]{1,39}$'::text`),
	check("files_name_check", sql`((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 200)) AND (name !~ '[[:cntrl:]]'::text)`),
	check("files_declared_check", sql`(declared_bytes > 0) AND (declared_mime ~ '^[a-z]+/[a-z0-9.+-]+$'::text)`),
	check("files_status_check", sql`status = ANY (ARRAY['reserved'::text, 'stored'::text, 'rejected'::text])`),
	check("files_sha_check", sql`(sha256 IS NULL) OR (sha256 ~ '^[0-9a-f]{64}$'::text)`),
	check("files_stored_check", sql`(status <> 'stored'::text) OR ((sha256 IS NOT NULL) AND (bytes IS NOT NULL) AND (detected_mime IS NOT NULL))`),
	check("files_rejected_check", sql`(status = 'rejected'::text) = (rejected_reason IS NOT NULL)`),
]);

export const issuedDocuments = pgTable("issued_documents", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	kind: text().notNull(),
	title: text().notNull(),
	version: integer().default(1).notNull(),
	previousId: uuid("previous_id"),
	status: text().default('draft').notNull(),
	verifyCode: text("verify_code").notNull(),
	fileId: uuid("file_id"),
	contentHash: text("content_hash"),
	idempotencyKey: text("idempotency_key").notNull(),
	requestedBy: uuid("requested_by"),
	claimToken: uuid("claim_token"),
	claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true, mode: 'string' }),
	issuedAt: timestamp("issued_at", { withTimezone: true, mode: 'string' }),
	revokedAt: timestamp("revoked_at", { withTimezone: true, mode: 'string' }),
	revokedBy: uuid("revoked_by"),
	revokeReason: text("revoke_reason"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("issued_documents_one_version_idx").using("btree", table.previousId.asc().nullsLast().op("uuid_ops")).where(sql`(previous_id IS NOT NULL)`),
	index("issued_documents_org_idx").using("btree", table.orgId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "issued_documents_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.requestedBy],
			foreignColumns: [profiles.id],
			name: "issued_documents_requested_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.revokedBy],
			foreignColumns: [profiles.id],
			name: "issued_documents_revoked_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.previousId],
			foreignColumns: [table.id, table.orgId],
			name: "issued_documents_previous_id_org_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.fileId],
			foreignColumns: [files.id, files.orgId],
			name: "issued_documents_file_id_org_id_fkey"
		}),
	unique("issued_documents_id_org_id_key").on(table.id, table.orgId),
	unique("issued_documents_org_id_idempotency_key_key").on(table.orgId, table.idempotencyKey),
	unique("issued_documents_verify_code_key").on(table.verifyCode),
	pgPolicy("issued_documents_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("issued_documents_kind_check", sql`kind ~ '^[a-z][a-z0-9_.-]{1,39}$'::text`),
	check("issued_documents_title_check", sql`(char_length(btrim(title)) >= 1) AND (char_length(btrim(title)) <= 200)`),
	check("issued_documents_version_check", sql`version > 0`),
	check("issued_documents_status_check", sql`status = ANY (ARRAY['draft'::text, 'issued'::text, 'revoked'::text])`),
	check("issued_documents_code_check", sql`verify_code ~ '^[A-HJ-KMNP-Z2-9]{12}$'::text`),
	check("issued_documents_key_check", sql`(char_length(idempotency_key) >= 8) AND (char_length(idempotency_key) <= 120)`),
	check("issued_documents_hash_check", sql`(content_hash IS NULL) OR (content_hash ~ '^[0-9a-f]{64}$'::text)`),
	check("issued_documents_issued_check", sql`((status = 'draft'::text) = (issued_at IS NULL)) AND ((status = 'draft'::text) OR ((file_id IS NOT NULL) AND (content_hash IS NOT NULL)))`),
	check("issued_documents_revoked_check", sql`(status = 'revoked'::text) = ((revoked_at IS NOT NULL) AND (revoke_reason IS NOT NULL))`),
]);

export const waTemplates = pgTable("wa_templates", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	wabaId: text("waba_id").notNull(),
	name: text().notNull(),
	language: text().default('pt_BR').notNull(),
	category: text().notNull(),
	status: text().notNull(),
	body: text().notNull(),
	headerText: text("header_text"),
	footerText: text("footer_text"),
	paramCount: integer("param_count").default(0).notNull(),
	components: jsonb().default([]).notNull(),
	syncedAt: timestamp("synced_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "wa_templates_org_id_fkey"
		}).onDelete("cascade"),
	unique("wa_templates_id_org_id_key").on(table.id, table.orgId),
	unique("wa_templates_org_id_waba_id_name_language_key").on(table.orgId, table.wabaId, table.name, table.language),
	pgPolicy("wa_templates_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("wa_templates_language_check", sql`language ~ '^[a-z]{2}(_[A-Z]{2})?$'::text`),
	check("wa_templates_name_check", sql`(name ~ '^[a-z0-9_]+$'::text) AND (char_length(name) <= 512)`),
	check("wa_templates_category_check", sql`category = ANY (ARRAY['marketing'::text, 'utility'::text, 'authentication'::text])`),
	check("wa_templates_status_check", sql`status = ANY (ARRAY['approved'::text, 'pending'::text, 'rejected'::text, 'paused'::text, 'disabled'::text])`),
	check("wa_templates_body_check", sql`(char_length(body) >= 1) AND (char_length(body) <= 1024)`),
	check("wa_templates_header_check", sql`(header_text IS NULL) OR (char_length(header_text) <= 60)`),
	check("wa_templates_footer_check", sql`(footer_text IS NULL) OR (char_length(footer_text) <= 60)`),
	check("wa_templates_params_check", sql`(param_count >= 0) AND (param_count <= 50)`),
]);

export const waConversations = pgTable("wa_conversations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	numberId: uuid("number_id").notNull(),
	contactWaId: text("contact_wa_id").notNull(),
	contactName: text("contact_name"),
	savedName: text("saved_name"),
	lastInboundAt: timestamp("last_inbound_at", { withTimezone: true, mode: 'string' }),
	lastMessageAt: timestamp("last_message_at", { withTimezone: true, mode: 'string' }),
	lastMessagePreview: text("last_message_preview"),
	lastMessageDirection: text("last_message_direction"),
	unreadCount: integer("unread_count").default(0).notNull(),
	status: text().default('open').notNull(),
	assignedTo: uuid("assigned_to"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	agent: text().default('one').notNull(),
	agentChangedBy: uuid("agent_changed_by"),
	agentChangedAt: timestamp("agent_changed_at", { withTimezone: true, mode: 'string' }),
	calledReason: text("called_reason"),
	calledAt: timestamp("called_at", { withTimezone: true, mode: 'string' }),
	oneThrough: timestamp("one_through", { withTimezone: true, mode: 'string' }),
	oneClaims: integer("one_claims").default(0).notNull(),
	oneClaimedAt: timestamp("one_claimed_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("wa_conversations_called_idx").using("btree", table.orgId.asc().nullsLast().op("uuid_ops"), table.calledAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(called_at IS NOT NULL)`),
	index("wa_conversations_org_idx").using("btree", table.orgId.asc().nullsLast().op("uuid_ops"), table.lastMessageAt.desc().nullsLast().op("uuid_ops")),
	index("wa_conversations_turns_idx").using("btree", table.lastInboundAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(agent = 'one'::text)`),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "wa_conversations_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.assignedTo],
			foreignColumns: [profiles.id],
			name: "wa_conversations_assigned_to_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.numberId],
			foreignColumns: [waNumbers.id, waNumbers.orgId],
			name: "wa_conversations_number_id_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.agentChangedBy],
			foreignColumns: [profiles.id],
			name: "wa_conversations_agent_changed_by_fkey"
		}).onDelete("set null"),
	unique("wa_conversations_id_org_id_key").on(table.id, table.orgId),
	unique("wa_conversations_number_id_contact_wa_id_key").on(table.numberId, table.contactWaId),
	pgPolicy("wa_conversations_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("wa_conversations_wa_id_check", sql`contact_wa_id ~ '^[0-9]{8,15}$'::text`),
	check("wa_conversations_status_check", sql`status = ANY (ARRAY['open'::text, 'closed'::text])`),
	check("wa_conversations_unread_check", sql`unread_count >= 0`),
	check("wa_conversations_direction_check", sql`(last_message_direction IS NULL) OR (last_message_direction = ANY (ARRAY['in'::text, 'out'::text]))`),
	check("wa_conversations_agent_check", sql`agent = ANY (ARRAY['one'::text, 'person'::text])`),
	check("wa_conversations_called_check", sql`((called_reason IS NULL) = (called_at IS NULL)) AND ((called_reason IS NULL) OR ((char_length(called_reason) >= 1) AND (char_length(called_reason) <= 500)))`),
]);

export const courts = pgTable("courts", {
	acronym: text().primaryKey().notNull(),
	name: text().notNull(),
	uf: text().notNull(),
	cnjSegment: text("cnj_segment").default('8').notNull(),
	cnjCode: text("cnj_code").notNull(),
	timeZone: text("time_zone").default('America/Sao_Paulo').notNull(),
	otherZones: text("other_zones").array().default(sql`'{}'`).notNull(),
}, (table) => [
	unique("courts_uf_key").on(table.uf),
	unique("courts_cnj_segment_cnj_code_key").on(table.cnjSegment, table.cnjCode),
	pgPolicy("courts_select_all", { as: "permissive", for: "select", to: ["anon", "authenticated"], using: sql`true` }),
	check("courts_acronym_check", sql`acronym ~ '^TJ[A-Z]{2,3}$'::text`),
	check("courts_uf_check", sql`uf ~ '^[A-Z]{2}$'::text`),
	check("courts_code_check", sql`(cnj_segment ~ '^[0-9]$'::text) AND (cnj_code ~ '^[0-9]{2}$'::text)`),
	check("courts_time_zone_check", sql`time_zone ~ '^America/[A-Za-z_]{3,40}$'::text`),
	check("courts_other_zones_check", sql`(cardinality(other_zones) <= 3) AND (array_to_string(other_zones, ','::text) ~ '^(America/[A-Za-z_]{3,40}(,America/[A-Za-z_]{3,40})*)?$'::text)`),
]);

export const airports = pgTable("airports", {
	iata: text().primaryKey().notNull(),
	icao: text(),
	name: text().notNull(),
	city: text(),
	country: text().notNull(),
	uf: text(),
	municipality: text(),
	utcOffsetMinutes: integer("utc_offset_minutes"),
}, (table) => [
	index("airports_brazil_idx").using("btree", table.uf.asc().nullsLast().op("text_ops")).where(sql`(country = 'BR'::text)`),
	pgPolicy("airports_select_all", { as: "permissive", for: "select", to: ["anon", "authenticated"], using: sql`true` }),
	check("airports_iata_check", sql`iata ~ '^[A-Z]{3}$'::text`),
	check("airports_icao_check", sql`(icao IS NULL) OR (icao ~ '^[A-Z0-9]{4}$'::text)`),
	check("airports_country_check", sql`country ~ '^[A-Z]{2}$'::text`),
	check("airports_uf_check", sql`((country = 'BR'::text) = (uf IS NOT NULL)) AND ((uf IS NULL) OR (uf ~ '^[A-Z]{2}$'::text))`),
	check("airports_municipality_check", sql`(municipality IS NULL) OR ((char_length(btrim(municipality)) >= 2) AND (char_length(btrim(municipality)) <= 120))`),
	check("airports_offset_check", sql`(utc_offset_minutes IS NULL) OR ((utc_offset_minutes >= '-720'::integer) AND (utc_offset_minutes <= 840))`),
]);

export const waMessages = pgTable("wa_messages", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	conversationId: uuid("conversation_id").notNull(),
	numberId: uuid("number_id").notNull(),
	direction: text().notNull(),
	origin: text().default('cloud').notNull(),
	waMessageId: text("wa_message_id"),
	kind: text().notNull(),
	body: text(),
	templateId: uuid("template_id"),
	templateName: text("template_name"),
	templateParams: jsonb("template_params"),
	mediaWaId: text("media_wa_id"),
	mediaMime: text("media_mime"),
	mediaFilename: text("media_filename"),
	mediaFileId: uuid("media_file_id"),
	mediaStatus: text("media_status").default('none').notNull(),
	mediaClaimedAt: timestamp("media_claimed_at", { withTimezone: true, mode: 'string' }),
	status: text().notNull(),
	errorCode: text("error_code"),
	pricingCategory: text("pricing_category"),
	pricingType: text("pricing_type"),
	replyToWaId: text("reply_to_wa_id"),
	sentBy: uuid("sent_by"),
	waTimestamp: timestamp("wa_timestamp", { withTimezone: true, mode: 'string' }),
	attempts: integer().default(0).notNull(),
	claimedAt: timestamp("claimed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	aiRunId: uuid("ai_run_id"),
	byOne: boolean("by_one").default(false).notNull(),
	caseJoin: text("case_join"),
	caseJoinAt: timestamp("case_join_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("wa_messages_conversation_idx").using("btree", table.conversationId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.asc().nullsLast().op("uuid_ops")),
	index("wa_messages_media_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(media_status = ANY (ARRAY['pending'::text, 'fetching'::text]))`),
	index("wa_messages_outbox_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(status = 'queued'::text)`),
	uniqueIndex("wa_messages_run_idx").using("btree", table.aiRunId.asc().nullsLast().op("uuid_ops")).where(sql`(ai_run_id IS NOT NULL)`),
	index("wa_messages_sending_idx").using("btree", table.claimedAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(status = 'sending'::text)`),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "wa_messages_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.sentBy],
			foreignColumns: [profiles.id],
			name: "wa_messages_sent_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.conversationId],
			foreignColumns: [waConversations.id, waConversations.orgId],
			name: "wa_messages_conversation_id_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId, table.numberId],
			foreignColumns: [waNumbers.id, waNumbers.orgId],
			name: "wa_messages_number_id_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId, table.templateId],
			foreignColumns: [waTemplates.id, waTemplates.orgId],
			name: "wa_messages_template_id_org_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.mediaFileId],
			foreignColumns: [files.id, files.orgId],
			name: "wa_messages_media_file_id_org_id_fkey"
		}),
	foreignKey({
			columns: [table.aiRunId],
			foreignColumns: [aiRuns.id],
			name: "wa_messages_ai_run_id_fkey"
		}).onDelete("set null"),
	unique("wa_messages_id_org_key").on(table.id, table.orgId),
	unique("wa_messages_number_id_wa_message_id_key").on(table.numberId, table.waMessageId),
	pgPolicy("wa_messages_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("wa_messages_direction_check", sql`direction = ANY (ARRAY['in'::text, 'out'::text])`),
	check("wa_messages_origin_check", sql`origin = ANY (ARRAY['cloud'::text, 'app'::text, 'history'::text])`),
	check("wa_messages_kind_check", sql`kind = ANY (ARRAY['text'::text, 'template'::text, 'image'::text, 'document'::text, 'audio'::text, 'video'::text, 'sticker'::text, 'location'::text, 'contacts'::text, 'reaction'::text, 'interactive'::text, 'button'::text, 'system'::text, 'unsupported'::text])`),
	check("wa_messages_status_check", sql`((direction = 'in'::text) AND (status = 'received'::text)) OR ((direction = 'out'::text) AND (status = ANY (ARRAY['queued'::text, 'sending'::text, 'sent'::text, 'delivered'::text, 'read'::text, 'failed'::text])))`),
	check("wa_messages_media_check", sql`media_status = ANY (ARRAY['none'::text, 'pending'::text, 'fetching'::text, 'stored'::text, 'failed'::text])`),
	check("wa_messages_body_check", sql`(body IS NULL) OR (char_length(body) <= 4096)`),
	check("wa_messages_error_check", sql`(error_code IS NULL) OR (error_code ~ '^[a-z0-9_]{1,63}$'::text)`),
	check("wa_messages_case_join_check", sql`((case_join IS NULL) = (case_join_at IS NULL)) AND ((case_join IS NULL) OR (case_join = ANY (ARRAY['document'::text, 'statement'::text, 'no_case'::text, 'left'::text])))`),
]);

export const airlines = pgTable("airlines", {
	iata: text().primaryKey().notNull(),
	name: text().notNull(),
	country: text(),
	legalName: text("legal_name"),
	cnpj: text(),
	active: boolean().default(true).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	vraDesignators: text("vra_designators").array().default(sql`'{}'`).notNull(),
	courtNames: text("court_names").array().default(sql`'{}'`).notNull(),
}, (table) => [
	pgPolicy("airlines_select_all", { as: "permissive", for: "select", to: ["anon", "authenticated"], using: sql`true` }),
	check("airlines_iata_check", sql`(iata ~ '^[A-Z0-9]{2}$'::text) AND (iata !~ '^[0-9]{2}$'::text)`),
	check("airlines_country_check", sql`(country IS NULL) OR (country ~ '^[A-Z]{2}$'::text)`),
	check("airlines_cnpj_check", sql`(cnpj IS NULL) OR (cnpj ~ '^[0-9]{14}$'::text)`),
	check("airlines_name_check", sql`(char_length(btrim(name)) >= 2) AND (char_length(btrim(name)) <= 120)`),
	check("airlines_vra_designators_check", sql`CHECK (icao_designators_ok(vra_designators`),
	check("airlines_court_names_check", sql`CHECK (court_names_ok(court_names`),
]);

export const people = pgTable("people", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	fullName: text("full_name").notNull(),
	cpf: text(),
	birthDate: date("birth_date"),
	nationality: text(),
	maritalStatus: text("marital_status"),
	profession: text(),
	email: text(),
	phone: text(),
	postalCode: text("postal_code"),
	street: text(),
	addressNumber: text("address_number"),
	complement: text(),
	district: text(),
	city: text(),
	uf: text(),
	cpfRegistryResult: text("cpf_registry_result"),
	cpfCheckedAt: timestamp("cpf_checked_at", { withTimezone: true, mode: 'string' }),
	cpfRegistryName: text("cpf_registry_name"),
	cpfRegistryBirthDate: date("cpf_registry_birth_date"),
	cpfRegistrySituation: text("cpf_registry_situation"),
	cpfRegistryRegular: boolean("cpf_registry_regular"),
	cpfNameMatches: boolean("cpf_name_matches"),
	updatedVia: text("updated_via").default('firm').notNull(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	readFields: jsonb("read_fields").default({}).notNull(),
}, (table) => [
	uniqueIndex("people_cpf_idx").using("btree", table.orgId.asc().nullsLast().op("text_ops"), table.cpf.asc().nullsLast().op("uuid_ops")).where(sql`(cpf IS NOT NULL)`),
	index("people_org_idx").using("btree", table.orgId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("people_phone_idx").using("btree", table.orgId.asc().nullsLast().op("text_ops"), table.phone.asc().nullsLast().op("uuid_ops")).where(sql`(phone IS NOT NULL)`),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "people_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [profiles.id],
			name: "people_created_by_fkey"
		}).onDelete("set null"),
	unique("people_id_org_id_key").on(table.id, table.orgId),
	pgPolicy("people_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("people_name_check", sql`((char_length(full_name) >= 3) AND (char_length(full_name) <= 200)) AND (full_name !~ '[[:cntrl:]]'::text)`),
	check("people_cpf_check", sql`(cpf IS NULL) OR cpf_is_valid(cpf)`),
	check("people_marital_check", sql`(marital_status IS NULL) OR (marital_status = ANY (ARRAY['solteiro'::text, 'casado'::text, 'uniao_estavel'::text, 'divorciado'::text, 'separado'::text, 'viuvo'::text]))`),
	check("people_email_check", sql`(email IS NULL) OR ((char_length(email) <= 254) AND (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'::text))`),
	check("people_phone_check", sql`(phone IS NULL) OR (phone ~ '^[0-9]{12,15}$'::text)`),
	check("people_postal_check", sql`(postal_code IS NULL) OR (postal_code ~ '^[0-9]{8}$'::text)`),
	check("people_uf_check", sql`(uf IS NULL) OR (uf = ANY (ARRAY['AC'::text, 'AL'::text, 'AM'::text, 'AP'::text, 'BA'::text, 'CE'::text, 'DF'::text, 'ES'::text, 'GO'::text, 'MA'::text, 'MG'::text, 'MS'::text, 'MT'::text, 'PA'::text, 'PB'::text, 'PE'::text, 'PI'::text, 'PR'::text, 'RJ'::text, 'RN'::text, 'RO'::text, 'RR'::text, 'RS'::text, 'SC'::text, 'SE'::text, 'SP'::text, 'TO'::text]))`),
	check("people_text_check", sql`(COALESCE(char_length(nationality), 0) <= 60) AND (COALESCE(char_length(profession), 0) <= 120) AND (COALESCE(char_length(street), 0) <= 200) AND (COALESCE(char_length(address_number), 0) <= 20) AND (COALESCE(char_length(complement), 0) <= 120) AND (COALESCE(char_length(district), 0) <= 120) AND (COALESCE(char_length(city), 0) <= 120)`),
	check("people_birth_check", sql`(birth_date IS NULL) OR ((birth_date >= '1900-01-01'::date) AND (birth_date <= '2100-01-01'::date))`),
	check("people_registry_check", sql`(cpf_registry_result IS NULL) OR (cpf_registry_result = ANY (ARRAY['found'::text, 'not_found'::text, 'birth_date_mismatch'::text, 'minor'::text]))`),
	check("people_read_fields_check", sql`(jsonb_typeof(read_fields) = 'object'::text) AND (octet_length((read_fields)::text) <= 4000)`),
	check("people_via_check", sql`updated_via = ANY (ARRAY['firm'::text, 'client'::text, 'document'::text, 'partner'::text])`),
]);

export const caseParties = pgTable("case_parties", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	caseId: uuid("case_id").notNull(),
	personId: uuid("person_id").notNull(),
	role: text().notNull(),
	guardianId: uuid("guardian_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	claimCents: bigint("claim_cents", { mode: "number" }),
}, (table) => [
	index("case_parties_case_idx").using("btree", table.caseId.asc().nullsLast().op("uuid_ops")),
	index("case_parties_person_idx").using("btree", table.personId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "case_parties_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId, table.caseId],
			foreignColumns: [cases.id, cases.orgId],
			name: "case_parties_case_id_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId, table.personId],
			foreignColumns: [people.id, people.orgId],
			name: "case_parties_person_id_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId, table.guardianId],
			foreignColumns: [table.id, table.orgId],
			name: "case_parties_guardian_id_org_id_fkey"
		}).onDelete("set null"),
	unique("case_parties_id_org_id_key").on(table.id, table.orgId),
	unique("case_parties_case_id_person_id_role_key").on(table.caseId, table.personId, table.role),
	pgPolicy("case_parties_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("case_parties_role_check", sql`role = ANY (ARRAY['claimant'::text, 'guardian'::text])`),
	check("case_parties_guardian_check", sql`(role = 'claimant'::text) OR (guardian_id IS NULL)`),
	check("case_parties_claim_check", sql`(claim_cents IS NULL) OR ((role = 'claimant'::text) AND ((claim_cents >= 1) AND (claim_cents <= '100000000000'::bigint)))`),
]);

export const flightSegments = pgTable("flight_segments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	caseId: uuid("case_id").notNull(),
	position: smallint().default(1).notNull(),
	flightNumber: text("flight_number"),
	originIata: text("origin_iata"),
	destinationIata: text("destination_iata"),
	scheduledDepartureLocal: timestamp("scheduled_departure_local", { mode: 'string' }),
	scheduledArrivalLocal: timestamp("scheduled_arrival_local", { mode: 'string' }),
	actualDepartureLocal: timestamp("actual_departure_local", { mode: 'string' }),
	actualArrivalLocal: timestamp("actual_arrival_local", { mode: 'string' }),
	bookingReference: text("booking_reference"),
	affected: boolean().default(false).notNull(),
	source: text().default('firm').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("flight_segments_case_idx").using("btree", table.caseId.asc().nullsLast().op("int2_ops"), table.position.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.originIata],
			foreignColumns: [airports.iata],
			name: "flight_segments_origin_iata_fkey"
		}),
	foreignKey({
			columns: [table.destinationIata],
			foreignColumns: [airports.iata],
			name: "flight_segments_destination_iata_fkey"
		}),
	foreignKey({
			columns: [table.orgId, table.caseId],
			foreignColumns: [cases.id, cases.orgId],
			name: "flight_segments_case_id_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "flight_segments_org_id_fkey"
		}).onDelete("cascade"),
	unique("flight_segments_id_org_id_key").on(table.id, table.orgId),
	pgPolicy("flight_segments_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("flight_segments_position_check", sql`("position" >= 1) AND ("position" <= 20)`),
	check("flight_segments_number_check", sql`(flight_number IS NULL) OR ((flight_number ~ '^[A-Z0-9]{2}[1-9][0-9]{0,3}[A-Z]?$'::text) AND (flight_number !~ '^[0-9]{2}'::text))`),
	check("flight_segments_route_check", sql`(origin_iata IS NULL) OR (destination_iata IS NULL) OR (origin_iata <> destination_iata)`),
	check("flight_segments_booking_check", sql`(booking_reference IS NULL) OR (booking_reference ~ '^[A-Z0-9]{5,8}$'::text)`),
	check("flight_segments_source_check", sql`source = ANY (ARRAY['firm'::text, 'client'::text])`),
]);

export const proceedings = pgTable("proceedings", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	caseId: uuid("case_id").notNull(),
	kind: text().notNull(),
	court: text(),
	comarca: text(),
	unit: text(),
	system: text(),
	cnj: text(),
	forumBasis: text("forum_basis"),
	forumReason: text("forum_reason"),
	forumCity: text("forum_city"),
	status: text().default('planned').notNull(),
	filedAt: date("filed_at"),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	filedMarkedAt: timestamp("filed_marked_at", { withTimezone: true, mode: 'string' }),
	systemByOne: boolean("system_by_one").default(false).notNull(),
	systemApprovedBy: uuid("system_approved_by"),
	systemApprovedAt: timestamp("system_approved_at", { withTimezone: true, mode: 'string' }),
	systemRefusedBy: uuid("system_refused_by"),
	systemRefusedAt: timestamp("system_refused_at", { withTimezone: true, mode: 'string' }),
	systemRefusedReason: text("system_refused_reason"),
	createdByOne: boolean("created_by_one").default(false).notNull(),
}, (table) => [
	index("proceedings_case_idx").using("btree", table.caseId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("proceedings_cnj_idx").using("btree", table.orgId.asc().nullsLast().op("uuid_ops"), table.cnj.asc().nullsLast().op("text_ops")).where(sql`(cnj IS NOT NULL)`),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "proceedings_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.court],
			foreignColumns: [courts.acronym],
			name: "proceedings_court_fkey"
		}),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [profiles.id],
			name: "proceedings_created_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.caseId],
			foreignColumns: [cases.id, cases.orgId],
			name: "proceedings_case_id_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.systemApprovedBy],
			foreignColumns: [profiles.id],
			name: "proceedings_system_approved_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.systemRefusedBy],
			foreignColumns: [profiles.id],
			name: "proceedings_system_refused_by_fkey"
		}).onDelete("set null"),
	unique("proceedings_id_org_id_key").on(table.id, table.orgId),
	pgPolicy("proceedings_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("proceedings_kind_check", sql`kind = ANY (ARRAY['juizado'::text, 'comum'::text])`),
	check("proceedings_system_check", sql`(system IS NULL) OR (system = ANY (ARRAY['projudi'::text, 'eproc'::text, 'pje'::text, 'esaj'::text, 'outro'::text]))`),
	check("proceedings_cnj_check", sql`(cnj IS NULL) OR cnj_is_valid(cnj)`),
	check("proceedings_basis_check", sql`(forum_basis IS NULL) OR (forum_basis = ANY (ARRAY['domicile'::text, 'event_place'::text, 'defendant_seat'::text, 'other'::text]))`),
	check("proceedings_reason_check", sql`(forum_basis IS NULL) OR (forum_basis = 'domicile'::text) OR (char_length(btrim(COALESCE(forum_reason, ''::text))) >= 8)`),
	check("proceedings_status_check", sql`status = ANY (ARRAY['planned'::text, 'filed'::text, 'closed'::text])`),
	check("proceedings_filed_check", sql`(status = 'planned'::text) OR (cnj IS NOT NULL)`),
	check("proceedings_text_check", sql`(COALESCE(char_length(comarca), 0) <= 120) AND (COALESCE(char_length(unit), 0) <= 200) AND (COALESCE(char_length(forum_reason), 0) <= 1000) AND (COALESCE(char_length(forum_city), 0) <= 120)`),
	check("proceedings_system_decision_check", sql`(NOT ((system_approved_at IS NOT NULL) AND (system_refused_at IS NOT NULL))) AND ((system_refused_at IS NULL) = (system_refused_reason IS NULL)) AND ((system_refused_reason IS NULL) OR (((char_length(system_refused_reason) >= 8) AND (char_length(system_refused_reason) <= 500)) AND (system_refused_reason !~ '[[:cntrl:]]'::text)))`),
]);

export const clientLinks = pgTable("client_links", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	caseId: uuid("case_id").notNull(),
	personId: uuid("person_id").notNull(),
	tokenHash: text("token_hash").notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	revokedAt: timestamp("revoked_at", { withTimezone: true, mode: 'string' }),
	revokedBy: uuid("revoked_by"),
	openedCount: integer("opened_count").default(0).notNull(),
	lastOpenedAt: timestamp("last_opened_at", { withTimezone: true, mode: 'string' }),
	uploadCount: integer("upload_count").default(0).notNull(),
	cpfAttempts: integer("cpf_attempts").default(0).notNull(),
	finishedAt: timestamp("finished_at", { withTimezone: true, mode: 'string' }),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	statementCount: integer("statement_count").default(0).notNull(),
}, (table) => [
	index("client_links_case_idx").using("btree", table.caseId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("uuid_ops")),
	index("client_links_finished_idx").using("btree", table.orgId.asc().nullsLast().op("uuid_ops")).where(sql`((finished_at IS NOT NULL) AND (revoked_at IS NULL))`),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "client_links_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.revokedBy],
			foreignColumns: [profiles.id],
			name: "client_links_revoked_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [profiles.id],
			name: "client_links_created_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.caseId],
			foreignColumns: [cases.id, cases.orgId],
			name: "client_links_case_id_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId, table.personId],
			foreignColumns: [people.id, people.orgId],
			name: "client_links_person_id_org_id_fkey"
		}).onDelete("cascade"),
	unique("client_links_id_org_id_key").on(table.id, table.orgId),
	unique("client_links_token_hash_key").on(table.tokenHash),
	pgPolicy("client_links_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("client_links_token_check", sql`token_hash ~ '^[0-9a-f]{64}$'::text`),
]);

export const caseEvents = pgTable("case_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	caseId: uuid("case_id").notNull(),
	at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	kind: text().notNull(),
	actorType: text("actor_type").notNull(),
	actorId: uuid("actor_id"),
	data: jsonb().default({}).notNull(),
}, (table) => [
	index("case_events_case_idx").using("btree", table.caseId.asc().nullsLast().op("timestamptz_ops"), table.at.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "case_events_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.actorId],
			foreignColumns: [profiles.id],
			name: "case_events_actor_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.caseId],
			foreignColumns: [cases.id, cases.orgId],
			name: "case_events_case_id_org_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("case_events_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("case_events_kind_check", sql`kind ~ '^[a-z][a-z0-9_.]{2,63}$'::text`),
	check("case_events_actor_check", sql`actor_type = ANY (ARRAY['person'::text, 'support'::text, 'client'::text, 'system'::text, 'ai'::text])`),
	check("case_events_data_check", sql`(jsonb_typeof(data) = 'object'::text) AND (octet_length((data)::text) <= 4000)`),
]);

export const signatureEnvelopes = pgTable("signature_envelopes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	caseId: uuid("case_id").notNull(),
	documentId: uuid("document_id").notNull(),
	method: text().notNull(),
	status: text().notNull(),
	signers: jsonb().notNull(),
	connectionId: uuid("connection_id"),
	providerId: text("provider_id"),
	enotariadoUrl: text("enotariado_url"),
	signedDocumentId: uuid("signed_document_id"),
	signedSha256: text("signed_sha256"),
	evidence: jsonb().default([]).notNull(),
	lastError: text("last_error"),
	attempts: integer().default(0).notNull(),
	claimedAt: timestamp("claimed_at", { withTimezone: true, mode: 'string' }),
	endedReason: text("ended_reason"),
	providerCancelPending: boolean("provider_cancel_pending").default(false).notNull(),
	createdBy: uuid("created_by"),
	decidedBy: uuid("decided_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("signature_envelopes_case_idx").using("btree", table.caseId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("signature_envelopes_work_idx").using("btree", table.status.asc().nullsLast().op("text_ops"), table.createdAt.asc().nullsLast().op("text_ops")).where(sql`(status = ANY (ARRAY['reserved'::text, 'opening'::text, 'pending'::text]))`),
	foreignKey({
			columns: [table.decidedBy],
			foreignColumns: [profiles.id],
			name: "signature_envelopes_decided_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.caseId],
			foreignColumns: [cases.id, cases.orgId],
			name: "signature_envelopes_case_id_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId, table.documentId],
			foreignColumns: [caseDocuments.id, caseDocuments.orgId],
			name: "signature_envelopes_document_id_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId, table.connectionId],
			foreignColumns: [connections.id, connections.orgId],
			name: "signature_envelopes_connection_id_org_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.signedDocumentId],
			foreignColumns: [caseDocuments.id, caseDocuments.orgId],
			name: "signature_envelopes_signed_document_id_org_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "signature_envelopes_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [profiles.id],
			name: "signature_envelopes_created_by_fkey"
		}).onDelete("set null"),
	unique("signature_envelopes_id_org_id_key").on(table.id, table.orgId),
	unique("signature_envelopes_provider_id_key").on(table.providerId),
	pgPolicy("signature_envelopes_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("signature_envelopes_method_check", sql`method = ANY (ARRAY['zapsign'::text, 'govbr'::text, 'enotariado'::text])`),
	check("signature_envelopes_status_check", sql`status = ANY (ARRAY['reserved'::text, 'opening'::text, 'pending'::text, 'received'::text, 'signed'::text, 'refused'::text, 'expired'::text, 'cancelled'::text, 'failed'::text, 'uncertain'::text])`),
	check("signature_envelopes_signers_check", sql`(jsonb_typeof(signers) = 'array'::text) AND ((jsonb_array_length(signers) >= 1) AND (jsonb_array_length(signers) <= 20))`),
	check("signature_envelopes_url_check", sql`(enotariado_url IS NULL) OR ((enotariado_url ~ '^https://[^[:space:]]{8,}$'::text) AND (char_length(enotariado_url) <= 500))`),
	check("signature_envelopes_sha_check", sql`(signed_sha256 IS NULL) OR (signed_sha256 ~ '^[0-9a-f]{64}$'::text)`),
	check("signature_envelopes_signed_check", sql`(status <> 'signed'::text) OR (signed_document_id IS NOT NULL)`),
	check("signature_envelopes_text_check", sql`(COALESCE(char_length(last_error), 0) <= 60) AND (COALESCE(char_length(ended_reason), 0) <= 500)`),
]);

export const minimumWages = pgTable("minimum_wages", {
	validFrom: date("valid_from").primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	cents: bigint({ mode: "number" }).notNull(),
	act: text().notNull(),
}, (table) => [
	pgPolicy("minimum_wages_select_all", { as: "permissive", for: "select", to: ["authenticated"], using: sql`true` }),
	check("minimum_wages_day_check", sql`(valid_from >= '1995-01-01'::date) AND (valid_from <= '2100-01-01'::date)`),
	check("minimum_wages_cents_check", sql`cents > 0`),
	check("minimum_wages_act_check", sql`(char_length(btrim(act)) >= 4) AND (char_length(btrim(act)) <= 200)`),
]);

export const clientConsents = pgTable("client_consents", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	caseId: uuid("case_id").notNull(),
	personId: uuid("person_id").notNull(),
	linkId: uuid("link_id"),
	termId: uuid("term_id").notNull(),
	termSlug: text("term_slug").notNull(),
	termVersion: integer("term_version").notNull(),
	termTitle: text("term_title").notNull(),
	evidence: jsonb().default({}).notNull(),
	acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	revokedAt: timestamp("revoked_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	uniqueIndex("client_consents_current_idx").using("btree", table.caseId.asc().nullsLast().op("uuid_ops"), table.personId.asc().nullsLast().op("uuid_ops"), table.termId.asc().nullsLast().op("uuid_ops")).where(sql`(revoked_at IS NULL)`),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "client_consents_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.termId],
			foreignColumns: [consentTerms.id],
			name: "client_consents_term_id_fkey"
		}),
	foreignKey({
			columns: [table.orgId, table.caseId],
			foreignColumns: [cases.id, cases.orgId],
			name: "client_consents_case_id_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId, table.personId],
			foreignColumns: [people.id, people.orgId],
			name: "client_consents_person_id_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId, table.linkId],
			foreignColumns: [clientLinks.id, clientLinks.orgId],
			name: "client_consents_link_id_org_id_fkey"
		}).onDelete("set null"),
	unique("client_consents_id_org_id_key").on(table.id, table.orgId),
	pgPolicy("client_consents_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("client_consents_evidence_check", sql`(jsonb_typeof(evidence) = 'object'::text) AND (octet_length((evidence)::text) <= 2000)`),
]);

export const caseDocuments = pgTable("case_documents", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	caseId: uuid("case_id").notNull(),
	partyId: uuid("party_id"),
	fileId: uuid("file_id").notNull(),
	kind: text().notNull(),
	source: text().notNull(),
	linkId: uuid("link_id"),
	status: text().notNull(),
	rejectedReason: text("rejected_reason"),
	decidedBy: uuid("decided_by"),
	decidedAt: timestamp("decided_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	envelopeId: uuid("envelope_id"),
	processing: text().default('skipped').notNull(),
	processingClaimedAt: timestamp("processing_claimed_at", { withTimezone: true, mode: 'string' }),
	processingAttempts: integer("processing_attempts").default(0).notNull(),
	processingError: text("processing_error"),
	normalizedFileId: uuid("normalized_file_id"),
	checkRunId: uuid("check_run_id"),
	quality: jsonb(),
}, (table) => [
	index("case_documents_case_idx").using("btree", table.caseId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("case_documents_processing_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(processing = 'pending'::text)`),
	index("case_documents_review_idx").using("btree", table.orgId.asc().nullsLast().op("uuid_ops")).where(sql`(status = 'received'::text)`),
	foreignKey({
			columns: [table.orgId, table.envelopeId],
			foreignColumns: [signatureEnvelopes.id, signatureEnvelopes.orgId],
			name: "case_documents_envelope_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "case_documents_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.decidedBy],
			foreignColumns: [profiles.id],
			name: "case_documents_decided_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.caseId],
			foreignColumns: [cases.id, cases.orgId],
			name: "case_documents_case_id_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId, table.partyId],
			foreignColumns: [caseParties.id, caseParties.orgId],
			name: "case_documents_party_id_org_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.fileId],
			foreignColumns: [files.id, files.orgId],
			name: "case_documents_file_id_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId, table.linkId],
			foreignColumns: [clientLinks.id, clientLinks.orgId],
			name: "case_documents_link_id_org_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.checkRunId],
			foreignColumns: [aiRuns.id],
			name: "case_documents_check_run_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.normalizedFileId],
			foreignColumns: [files.id, files.orgId],
			name: "case_documents_normalized_fkey"
		}).onDelete("set null"),
	unique("case_documents_id_org_id_key").on(table.id, table.orgId),
	unique("case_documents_file_id_key").on(table.fileId),
	pgPolicy("case_documents_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("case_documents_kind_check", sql`kind = ANY (ARRAY['identity'::text, 'address_proof'::text, 'ticket'::text, 'boarding_pass'::text, 'receipt'::text, 'evidence'::text, 'power_of_attorney'::text, 'contract'::text, 'petition'::text, 'other'::text])`),
	check("case_documents_status_check", sql`status = ANY (ARRAY['uploading'::text, 'received'::text, 'accepted'::text, 'rejected'::text])`),
	check("case_documents_reason_check", sql`((status = 'rejected'::text) = (rejected_reason IS NOT NULL)) AND (COALESCE(char_length(rejected_reason), 0) <= 500)`),
	check("case_documents_processing_check", sql`processing = ANY (ARRAY['pending'::text, 'working'::text, 'done'::text, 'skipped'::text, 'failed'::text])`),
	check("case_documents_processing_error_check", sql`(processing_error IS NULL) OR (processing_error ~ '^[a-z][a-z0-9_]{1,59}$'::text)`),
	check("case_documents_quality_check", sql`(quality IS NULL) OR ((jsonb_typeof(quality) = 'object'::text) AND (octet_length((quality)::text) <= 2000))`),
	check("case_documents_source_check", sql`source = ANY (ARRAY['client'::text, 'firm'::text, 'whatsapp'::text, 'signature'::text, 'partner'::text])`),
]);

export const cases = pgTable("cases", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	seq: integer().notNull(),
	incident: text(),
	airlineIata: text("airline_iata"),
	flightDate: date("flight_date"),
	cause: text().default('undetermined').notNull(),
	status: text().default('intake').notNull(),
	origin: text(),
	summary: text(),
	responsibleId: uuid("responsible_id"),
	statusChangedAt: timestamp("status_changed_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	closedAt: timestamp("closed_at", { withTimezone: true, mode: 'string' }),
	closeReason: text("close_reason"),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	airlineStatedCause: text("airline_stated_cause"),
	suspensionTriage: jsonb("suspension_triage"),
	weatherRead: jsonb("weather_read"),
	weatherRequestedAt: timestamp("weather_requested_at", { withTimezone: true, mode: 'string' }),
	suspensionDecision: text("suspension_decision").default('pending').notNull(),
	suspensionDecidedBy: uuid("suspension_decided_by"),
	suspensionDecidedAt: timestamp("suspension_decided_at", { withTimezone: true, mode: 'string' }),
	suspensionDecidedAuto: boolean("suspension_decided_auto").default(false).notNull(),
	familyChoice: text("family_choice").default('together').notNull(),
	familyChoiceReason: text("family_choice_reason"),
	familyChoiceBy: uuid("family_choice_by"),
	familyChoiceAt: timestamp("family_choice_at", { withTimezone: true, mode: 'string' }),
	isTest: boolean("is_test").default(false).notNull(),
	module: text().default('direito-do-passageiro').notNull(),
	partnershipId: uuid("partnership_id"),
}, (table) => [
	index("cases_module_idx").using("btree", table.orgId.asc().nullsLast().op("text_ops"), table.module.asc().nullsLast().op("uuid_ops")),
	index("cases_org_idx").using("btree", table.orgId.asc().nullsLast().op("uuid_ops"), table.status.asc().nullsLast().op("text_ops"), table.updatedAt.desc().nullsFirst().op("uuid_ops")),
	index("cases_partnership_idx").using("btree", table.partnershipId.asc().nullsLast().op("uuid_ops")).where(sql`(partnership_id IS NOT NULL)`),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "cases_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.airlineIata],
			foreignColumns: [airlines.iata],
			name: "cases_airline_iata_fkey"
		}).onUpdate("cascade"),
	foreignKey({
			columns: [table.responsibleId],
			foreignColumns: [profiles.id],
			name: "cases_responsible_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [profiles.id],
			name: "cases_created_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.suspensionDecidedBy],
			foreignColumns: [profiles.id],
			name: "cases_suspension_decided_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.familyChoiceBy],
			foreignColumns: [profiles.id],
			name: "cases_family_choice_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.module],
			foreignColumns: [productModules.key],
			name: "cases_module_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.partnershipId],
			foreignColumns: [partnerLinks.id],
			name: "cases_partnership_id_fkey"
		}).onDelete("set null"),
	unique("cases_id_org_id_key").on(table.id, table.orgId),
	unique("cases_org_id_seq_key").on(table.orgId, table.seq),
	pgPolicy("cases_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("cases_seq_check", sql`seq > 0`),
	check("cases_incident_check", sql`incident = ANY (ARRAY['delay'::text, 'cancellation'::text, 'overbooking'::text, 'missed_connection'::text, 'downgrade'::text, 'baggage_lost'::text, 'baggage_damaged'::text, 'baggage_delayed'::text, 'other'::text])`),
	check("cases_cause_check", sql`cause = ANY (ARRAY['internal'::text, 'external'::text, 'undetermined'::text])`),
	check("cases_status_check", sql`status = ANY (ARRAY['intake'::text, 'documents'::text, 'signature'::text, 'drafting'::text, 'ready'::text, 'filed'::text, 'closed'::text, 'declined'::text])`),
	check("cases_origin_check", sql`(origin IS NULL) OR (origin = ANY (ARRAY['agency'::text, 'referral'::text, 'ads'::text, 'organic'::text, 'returning_client'::text, 'other'::text]))`),
	check("cases_summary_check", sql`(summary IS NULL) OR (char_length(summary) <= 4000)`),
	check("cases_closed_check", sql`(status = ANY (ARRAY['closed'::text, 'declined'::text])) = (closed_at IS NOT NULL)`),
	check("cases_reason_check", sql`(close_reason IS NULL) OR (char_length(close_reason) <= 1000)`),
	check("cases_flight_date_check", sql`(flight_date IS NULL) OR ((flight_date >= '2000-01-01'::date) AND (flight_date <= '2100-01-01'::date))`),
	check("cases_suspension_triage_check", sql`(suspension_triage IS NULL) OR ((jsonb_typeof(suspension_triage) = 'object'::text) AND ((suspension_triage ->> 'risk'::text) = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text, 'out_of_scope'::text, 'unknown'::text])) AND (jsonb_typeof((suspension_triage -> 'grounds'::text)) = 'array'::text) AND (COALESCE((suspension_triage ->> 'rule'::text), ''::text) ~ '^[a-z0-9.-]{3,40}$'::text) AND (octet_length((suspension_triage)::text) <= 2000))`),
	check("cases_suspension_decision_check", sql`suspension_decision = ANY (ARRAY['pending'::text, 'file'::text, 'hold'::text])`),
	check("cases_stated_cause_check", sql`(airline_stated_cause IS NULL) OR (airline_stated_cause = ANY (ARRAY['weather'::text, 'airport_infrastructure'::text, 'authority'::text, 'pandemic'::text, 'maintenance'::text, 'crew'::text, 'network'::text, 'overbooking'::text, 'none_given'::text, 'other'::text]))`),
	check("cases_family_choice_check", sql`(family_choice = ANY (ARRAY['together'::text, 'split'::text])) AND ((family_choice = 'split'::text) = (family_choice_reason IS NOT NULL)) AND ((family_choice_reason IS NULL) OR ((char_length(family_choice_reason) >= 8) AND (char_length(family_choice_reason) <= 1000)))`),
	check("cases_module_incident_check", sql`(module = 'direito-do-passageiro'::text) = (incident IS NOT NULL)`),
]);

export const caseWeather = pgTable("case_weather", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	caseId: uuid("case_id").notNull(),
	icao: text().notNull(),
	observedAt: timestamp("observed_at", { withTimezone: true, mode: 'string' }).notNull(),
	raw: text().notNull(),
	signs: text().array().default(sql`'{}'`).notNull(),
	source: text().default('redemet').notNull(),
	readAt: timestamp("read_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("case_weather_case_idx").using("btree", table.caseId.asc().nullsLast().op("timestamptz_ops"), table.observedAt.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "case_weather_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId, table.caseId],
			foreignColumns: [cases.id, cases.orgId],
			name: "case_weather_case_id_org_id_fkey"
		}).onDelete("cascade"),
	unique("case_weather_case_id_icao_observed_at_key").on(table.caseId, table.icao, table.observedAt),
	pgPolicy("case_weather_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("case_weather_icao_check", sql`icao ~ '^[A-Z0-9]{4}$'::text`),
	check("case_weather_raw_check", sql`(char_length(raw) >= 8) AND (char_length(raw) <= 1000)`),
	check("case_weather_source_check", sql`source = 'redemet'::text`),
	check("case_weather_signs_check", sql`cardinality(signs) <= 20`),
]);

export const civilCourtAnswers = pgTable("civil_court_answers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	caseId: uuid("case_id").notNull(),
	partyId: uuid("party_id").notNull(),
	personId: uuid("person_id").notNull(),
	accepted: boolean().notNull(),
	wording: text().notNull(),
	version: integer().notNull(),
	source: text().notNull(),
	note: text(),
	linkId: uuid("link_id"),
	evidence: jsonb(),
	recordedBy: uuid("recorded_by"),
	recordedAt: timestamp("recorded_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	replacedAt: timestamp("replaced_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("civil_court_answers_case_idx").using("btree", table.caseId.asc().nullsLast().op("timestamptz_ops"), table.recordedAt.desc().nullsFirst().op("timestamptz_ops")),
	uniqueIndex("civil_court_answers_current_idx").using("btree", table.partyId.asc().nullsLast().op("uuid_ops")).where(sql`(replaced_at IS NULL)`),
	index("civil_court_answers_declined_idx").using("btree", table.orgId.asc().nullsLast().op("uuid_ops"), table.caseId.asc().nullsLast().op("uuid_ops")).where(sql`((replaced_at IS NULL) AND (NOT accepted))`),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "civil_court_answers_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.linkId],
			foreignColumns: [clientLinks.id],
			name: "civil_court_answers_link_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.recordedBy],
			foreignColumns: [profiles.id],
			name: "civil_court_answers_recorded_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.caseId],
			foreignColumns: [cases.id, cases.orgId],
			name: "civil_court_answers_case_id_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId, table.partyId],
			foreignColumns: [caseParties.id, caseParties.orgId],
			name: "civil_court_answers_party_id_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId, table.personId],
			foreignColumns: [people.id, people.orgId],
			name: "civil_court_answers_person_id_org_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("civil_court_answers_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("civil_court_answers_source_check", sql`source = ANY (ARRAY['client'::text, 'firm'::text])`),
	check("civil_court_answers_note_check", sql`((source = 'firm'::text) = (note IS NOT NULL)) AND ((note IS NULL) OR ((char_length(note) >= 8) AND (char_length(note) <= 500)))`),
	check("civil_court_answers_wording_check", sql`(char_length(wording) >= 40) AND (char_length(wording) <= 2200)`),
	check("civil_court_answers_version_check", sql`version >= 1`),
	check("civil_court_answers_evidence_check", sql`(evidence IS NULL) OR ((jsonb_typeof(evidence) = 'object'::text) AND (octet_length((evidence)::text) <= 1000))`),
]);

export const caseStatements = pgTable("case_statements", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	caseId: uuid("case_id").notNull(),
	partyId: uuid("party_id"),
	source: text().notNull(),
	linkId: uuid("link_id"),
	audioFileId: uuid("audio_file_id"),
	status: text().default('received').notNull(),
	transcript: text(),
	transcriptRunId: uuid("transcript_run_id"),
	work: text(),
	workClaimedAt: timestamp("work_claimed_at", { withTimezone: true, mode: 'string' }),
	workAttempts: integer("work_attempts").default(0).notNull(),
	workSeq: integer("work_seq").default(0).notNull(),
	workAfter: timestamp("work_after", { withTimezone: true, mode: 'string' }),
	workError: text("work_error"),
	chronology: text(),
	chronologyStatus: text("chronology_status").default('none').notNull(),
	chronologyRunId: uuid("chronology_run_id"),
	clientNote: text("client_note"),
	clientAnsweredAt: timestamp("client_answered_at", { withTimezone: true, mode: 'string' }),
	returnedNote: text("returned_note"),
	returnedRunId: uuid("returned_run_id"),
	returns: integer().default(0).notNull(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("case_statements_case_idx").using("btree", table.caseId.asc().nullsLast().op("uuid_ops"), table.createdAt.asc().nullsLast().op("uuid_ops")),
	index("case_statements_contested_idx").using("btree", table.orgId.asc().nullsLast().op("uuid_ops")).where(sql`(chronology_status = 'contested'::text)`),
	index("case_statements_work_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(work IS NOT NULL)`),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "case_statements_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.transcriptRunId],
			foreignColumns: [aiRuns.id],
			name: "case_statements_transcript_run_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.chronologyRunId],
			foreignColumns: [aiRuns.id],
			name: "case_statements_chronology_run_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.returnedRunId],
			foreignColumns: [aiRuns.id],
			name: "case_statements_returned_run_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [profiles.id],
			name: "case_statements_created_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.caseId],
			foreignColumns: [cases.id, cases.orgId],
			name: "case_statements_case_id_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId, table.partyId],
			foreignColumns: [caseParties.id, caseParties.orgId],
			name: "case_statements_party_id_org_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.linkId],
			foreignColumns: [clientLinks.id, clientLinks.orgId],
			name: "case_statements_link_id_org_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.audioFileId],
			foreignColumns: [files.id, files.orgId],
			name: "case_statements_audio_file_id_org_id_fkey"
		}).onDelete("set null"),
	unique("case_statements_id_org_id_key").on(table.id, table.orgId),
	pgPolicy("case_statements_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("case_statements_source_check", sql`source = ANY (ARRAY['client'::text, 'firm'::text, 'whatsapp'::text])`),
	check("case_statements_status_check", sql`status = ANY (ARRAY['uploading'::text, 'received'::text])`),
	check("case_statements_work_check", sql`(work IS NULL) OR (work = ANY (ARRAY['transcribe'::text, 'chronology'::text]))`),
	check("case_statements_error_check", sql`(work_error IS NULL) OR (work_error ~ '^[a-z][a-z0-9_]{1,59}$'::text)`),
	check("case_statements_chronology_check", sql`chronology_status = ANY (ARRAY['none'::text, 'proposed'::text, 'approved'::text, 'confirmed'::text, 'contested'::text, 'dismissed'::text])`),
	check("case_statements_text_check", sql`(COALESCE(char_length(transcript), 0) <= 60000) AND (COALESCE(char_length(chronology), 0) <= 20000) AND (COALESCE(char_length(client_note), 0) <= 2000) AND (COALESCE(char_length(returned_note), 0) <= 2000)`),
	check("case_statements_returns_check", sql`returns >= 0`),
]);

export const adminComplaints = pgTable("admin_complaints", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	caseId: uuid("case_id").notNull(),
	channel: text().notNull(),
	protocol: text(),
	filedOn: date("filed_on"),
	answerDueOn: date("answer_due_on"),
	answeredOn: date("answered_on"),
	outcome: text().default('pending').notNull(),
	notes: text(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("admin_complaints_case_idx").using("btree", table.caseId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.asc().nullsLast().op("uuid_ops")),
	index("admin_complaints_pending_idx").using("btree", table.orgId.asc().nullsLast().op("date_ops"), table.answerDueOn.asc().nullsLast().op("uuid_ops")).where(sql`(outcome = 'pending'::text)`),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "admin_complaints_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [profiles.id],
			name: "admin_complaints_created_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.caseId],
			foreignColumns: [cases.id, cases.orgId],
			name: "admin_complaints_case_id_org_id_fkey"
		}).onDelete("cascade"),
	unique("admin_complaints_id_org_id_key").on(table.id, table.orgId),
	pgPolicy("admin_complaints_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("admin_complaints_channel_check", sql`channel = ANY (ARRAY['anac_passageiro'::text, 'consumidor_gov'::text, 'procon'::text, 'airline'::text, 'other'::text])`),
	check("admin_complaints_outcome_check", sql`outcome = ANY (ARRAY['pending'::text, 'answered'::text, 'settled'::text, 'no_answer'::text])`),
	check("admin_complaints_protocol_check", sql`(protocol IS NULL) OR (((char_length(protocol) >= 3) AND (char_length(protocol) <= 80)) AND (protocol !~ '[[:cntrl:]]'::text))`),
	check("admin_complaints_notes_check", sql`COALESCE(char_length(notes), 0) <= 2000`),
	check("admin_complaints_dates_check", sql`((answered_on IS NULL) OR (filed_on IS NULL) OR (answered_on >= filed_on)) AND ((answer_due_on IS NULL) OR (filed_on IS NULL) OR (answer_due_on >= filed_on))`),
]);

export const certificateInventory = pgTable("certificate_inventory", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	userId: uuid("user_id").notNull(),
	system: text().notNull(),
	kind: text().notNull(),
	issuer: text(),
	validUntil: date("valid_until"),
	stationCheckedAt: timestamp("station_checked_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "certificate_inventory_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [profiles.id],
			name: "certificate_inventory_user_id_fkey"
		}).onDelete("cascade"),
	unique("certificate_inventory_org_id_user_id_system_key").on(table.orgId, table.userId, table.system),
	pgPolicy("certificate_inventory_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("certificate_inventory_system_check", sql`system = ANY (ARRAY['projudi'::text, 'eproc'::text, 'pje'::text, 'esaj'::text, 'outro'::text])`),
	check("certificate_inventory_kind_check", sql`kind = ANY (ARRAY['a1'::text, 'a3_token'::text, 'a3_card'::text, 'cloud'::text])`),
	check("certificate_inventory_issuer_check", sql`(issuer IS NULL) OR (((char_length(issuer) >= 2) AND (char_length(issuer) <= 80)) AND (issuer !~ '[[:cntrl:]]'::text))`),
]);

export const filingReceipts = pgTable("filing_receipts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	packageId: uuid("package_id").notNull(),
	proceedingId: uuid("proceeding_id").notNull(),
	fileId: uuid("file_id").notNull(),
	cnj: text().notNull(),
	filedOn: date("filed_on").notNull(),
	recordedBy: uuid("recorded_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "filing_receipts_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.recordedBy],
			foreignColumns: [profiles.id],
			name: "filing_receipts_recorded_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.packageId],
			foreignColumns: [filingPackages.id, filingPackages.orgId],
			name: "filing_receipts_package_id_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId, table.proceedingId],
			foreignColumns: [proceedings.id, proceedings.orgId],
			name: "filing_receipts_proceeding_id_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId, table.fileId],
			foreignColumns: [files.id, files.orgId],
			name: "filing_receipts_file_id_org_id_fkey"
		}),
	unique("filing_receipts_package_id_key").on(table.packageId),
	pgPolicy("filing_receipts_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("filing_receipts_cnj_check", sql`CHECK (cnj_is_valid(cnj`),
]);

export const djenCaptures = pgTable("djen_captures", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	uf: text().notNull(),
	number: text().notNull(),
	userId: uuid("user_id"),
	registrationId: uuid("registration_id"),
	active: boolean().default(true).notNull(),
	deactivatedAt: timestamp("deactivated_at", { withTimezone: true, mode: 'string' }),
	capturedThrough: date("captured_through"),
	capturedAt: timestamp("captured_at", { withTimezone: true, mode: 'string' }),
	resumeFrom: date("resume_from"),
	deepReadAt: timestamp("deep_read_at", { withTimezone: true, mode: 'string' }),
	lastNew: integer("last_new").default(0).notNull(),
	roundNew: integer("round_new").default(0).notNull(),
	lastSkipped: integer("last_skipped").default(0).notNull(),
	skippedAt: timestamp("skipped_at", { withTimezone: true, mode: 'string' }),
	roundSkipped: integer("round_skipped").default(0).notNull(),
	skippedItems: jsonb("skipped_items").default([]).notNull(),
	roundSkippedItems: jsonb("round_skipped_items").default([]).notNull(),
	requestedAt: timestamp("requested_at", { withTimezone: true, mode: 'string' }),
	claimedAt: timestamp("claimed_at", { withTimezone: true, mode: 'string' }),
	triedAt: timestamp("tried_at", { withTimezone: true, mode: 'string' }),
	attempts: integer().default(0).notNull(),
	claims: integer().default(0).notNull(),
	retryAfter: timestamp("retry_after", { withTimezone: true, mode: 'string' }),
	error: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("djen_captures_due_idx").using("btree", sql`COALESCE(tried_at, created_at)`).where(sql`((claimed_at IS NULL) AND active)`),
	index("djen_captures_registration_idx").using("btree", table.registrationId.asc().nullsLast().op("uuid_ops")).where(sql`(registration_id IS NOT NULL)`),
	index("djen_captures_stopped_idx").using("btree", table.orgId.asc().nullsLast().op("uuid_ops")).where(sql`(NOT active)`),
	index("djen_captures_user_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")).where(sql`(user_id IS NOT NULL)`),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "djen_captures_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [profiles.id],
			name: "djen_captures_user_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.registrationId],
			foreignColumns: [oabRegistrations.id],
			name: "djen_captures_registration_id_fkey"
		}).onDelete("set null"),
	unique("djen_captures_id_org_id_key").on(table.id, table.orgId),
	unique("djen_captures_org_id_uf_number_key").on(table.orgId, table.uf, table.number),
	pgPolicy("djen_captures_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("djen_captures_error_check", sql`(error IS NULL) OR (error ~ '^[a-z][a-z0-9_]{1,59}$'::text)`),
	check("djen_captures_active_check", sql`active = (deactivated_at IS NULL)`),
	check("djen_captures_skipped_items_check", sql`(jsonb_typeof(skipped_items) = 'array'::text) AND (jsonb_typeof(round_skipped_items) = 'array'::text)`),
]);

export const draftTemplates = pgTable("draft_templates", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id"),
	name: text().notNull(),
	proceedingKind: text("proceeding_kind"),
	body: text().notNull(),
	isDefault: boolean("is_default").default(false).notNull(),
	createdBy: uuid("created_by"),
	updatedBy: uuid("updated_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	provisional: boolean().default(false).notNull(),
	documentKind: text("document_kind").default('piece').notNull(),
}, (table) => [
	uniqueIndex("draft_templates_default_idx").using("btree", sql`org_id`, sql`document_kind`, sql`COALESCE(proceeding_kind, ''::text)`).where(sql`is_default`),
	uniqueIndex("draft_templates_name_idx").using("btree", sql`org_id`, sql`lower(btrim(name))`),
	uniqueIndex("draft_templates_platform_default_idx").using("btree", sql`document_kind`, sql`COALESCE(proceeding_kind, ''::text)`).where(sql`((org_id IS NULL) AND is_default)`),
	uniqueIndex("draft_templates_platform_name_idx").using("btree", sql`lower(btrim(name))`).where(sql`(org_id IS NULL)`),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "draft_templates_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [profiles.id],
			name: "draft_templates_created_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [profiles.id],
			name: "draft_templates_updated_by_fkey"
		}).onDelete("set null"),
	unique("draft_templates_id_org_id_key").on(table.id, table.orgId),
	pgPolicy("draft_templates_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	pgPolicy("draft_templates_select_platform", { as: "permissive", for: "select", to: ["authenticated"] }),
	check("draft_templates_name_check", sql`((char_length(btrim(name)) >= 2) AND (char_length(btrim(name)) <= 120)) AND (name !~ '[[:cntrl:]]'::text)`),
	check("draft_templates_kind_check", sql`(proceeding_kind IS NULL) OR (proceeding_kind = ANY (ARRAY['juizado'::text, 'comum'::text]))`),
	check("draft_templates_body_check", sql`(char_length(body) >= 20) AND (char_length(body) <= 200000)`),
	check("draft_templates_provisional_check", sql`(NOT provisional) OR (org_id IS NULL)`),
	check("draft_templates_document_kind_check", sql`document_kind = ANY (ARRAY['piece'::text, 'procuracao'::text, 'contrato'::text])`),
	check("draft_templates_paper_kind_check", sql`(document_kind = 'piece'::text) OR (proceeding_kind IS NULL)`),
	check("draft_templates_platform_contract_check", sql`(org_id IS NOT NULL) OR (document_kind <> 'contrato'::text)`),
]);

export const legalSources = pgTable("legal_sources", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id"),
	kind: text().notNull(),
	issuer: text().default('').notNull(),
	number: text().notNull(),
	article: text(),
	key: text().generatedAlwaysAs(sql`legal_source_key(kind, issuer, number, article)`),
	citation: text().generatedAlwaysAs(sql`legal_source_citation(kind, issuer, number, article)`),
	title: text().notNull(),
	quote: text(),
	sourceUrl: text("source_url").notNull(),
	note: text(),
	status: text().default('verified').notNull(),
	verifiedBy: uuid("verified_by"),
	verifiedAt: timestamp("verified_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	retiredBy: uuid("retired_by"),
	retiredAt: timestamp("retired_at", { withTimezone: true, mode: 'string' }),
	retiredReason: text("retired_reason"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("legal_sources_norm_idx").using("btree", table.orgId.asc().nullsLast().op("uuid_ops"), table.kind.asc().nullsLast().op("text_ops"), table.issuer.asc().nullsLast().op("text_ops"), table.number.asc().nullsLast().op("text_ops")).where(sql`(status = 'verified'::text)`),
	uniqueIndex("legal_sources_platform_key_idx").using("btree", table.key.asc().nullsLast().op("text_ops")).where(sql`(org_id IS NULL)`),
	index("legal_sources_platform_norm_idx").using("btree", table.kind.asc().nullsLast().op("text_ops"), table.issuer.asc().nullsLast().op("text_ops"), table.number.asc().nullsLast().op("text_ops")).where(sql`((org_id IS NULL) AND (status = 'verified'::text))`),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "legal_sources_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.verifiedBy],
			foreignColumns: [profiles.id],
			name: "legal_sources_verified_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.retiredBy],
			foreignColumns: [profiles.id],
			name: "legal_sources_retired_by_fkey"
		}).onDelete("set null"),
	unique("legal_sources_id_org_id_key").on(table.id, table.orgId),
	unique("legal_sources_org_id_key_key").on(table.orgId, table.key),
	pgPolicy("legal_sources_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	pgPolicy("legal_sources_select_platform", { as: "permissive", for: "select", to: ["authenticated"] }),
	check("legal_sources_kind_check", sql`kind = ANY (ARRAY['lei'::text, 'lei_complementar'::text, 'constituicao'::text, 'decreto'::text, 'resolucao'::text, 'sumula'::text, 'sumula_vinculante'::text, 'tema'::text, 'precedente'::text, 'processo'::text, 'enunciado'::text, 'norma'::text])`),
	check("legal_sources_number_check", sql`CHECK (legal_source_number_ok(kind, number`),
	check("legal_sources_issued_by_check", sql`CHECK (legal_source_issuer_ok(kind, issuer, number`),
	check("legal_sources_article_check", sql`(article IS NULL) OR ((article ~ '^[0-9]{1,4}[A-Z]?$'::text) AND (kind = ANY (ARRAY['lei'::text, 'lei_complementar'::text, 'constituicao'::text, 'decreto'::text, 'resolucao'::text, 'norma'::text])))`),
	check("legal_sources_title_check", sql`(char_length(btrim(title)) >= 3) AND (char_length(btrim(title)) <= 300)`),
	check("legal_sources_quote_check", sql`COALESCE(char_length(quote), 0) <= 6000`),
	check("legal_sources_url_check", sql`(source_url ~* '^https://[^[:space:]]+$'::text) AND ((char_length(source_url) >= 12) AND (char_length(source_url) <= 500))`),
	check("legal_sources_note_check", sql`COALESCE(char_length(note), 0) <= 1000`),
	check("legal_sources_status_check", sql`status = ANY (ARRAY['verified'::text, 'retired'::text])`),
	check("legal_sources_retired_check", sql`(status = 'retired'::text) = (retired_at IS NOT NULL)`),
	check("legal_sources_reason_check", sql`COALESCE(char_length(retired_reason), 0) <= 500`),
]);

export const publications = pgTable("publications", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	hash: text().notNull(),
	court: text().notNull(),
	cnj: text().notNull(),
	availableOn: date("available_on").notNull(),
	kind: text().notNull(),
	documentType: text("document_type"),
	body: text().notNull(),
	truncated: boolean().default(false).notNull(),
	head: text().default('').notNull(),
	tail: text(),
	link: text(),
	unit: text(),
	className: text("class_name"),
	active: boolean().default(true).notNull(),
	cancelReason: text("cancel_reason"),
	cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: 'string' }),
	cancelSeenAt: timestamp("cancel_seen_at", { withTimezone: true, mode: 'string' }),
	cancelSeenBy: uuid("cancel_seen_by"),
	cancelPending: boolean("cancel_pending").generatedAlwaysAs(sql`((NOT active) AND (category IS NOT NULL) AND (cancel_seen_at IS NULL))`),
	lawyerIds: uuid("lawyer_ids").array().default(sql`'{}'`).notNull(),
	proceedingId: uuid("proceeding_id"),
	caseId: uuid("case_id"),
	capturedAt: timestamp("captured_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	category: text(),
	note: text(),
	triagedBy: uuid("triaged_by"),
	triagedAt: timestamp("triaged_at", { withTimezone: true, mode: 'string' }),
	aiCategory: text("ai_category"),
	aiUrgent: boolean("ai_urgent"),
	aiRunId: uuid("ai_run_id"),
	aiClaimedAt: timestamp("ai_claimed_at", { withTimezone: true, mode: 'string' }),
	aiAttempts: integer("ai_attempts").default(0).notNull(),
	aiClaims: integer("ai_claims").default(0).notNull(),
	aiRejections: integer("ai_rejections").default(0).notNull(),
	aiRetryAfter: timestamp("ai_retry_after", { withTimezone: true, mode: 'string' }),
	aiError: text("ai_error"),
	aiApplied: boolean("ai_applied").default(false).notNull(),
	reviewDue: boolean("review_due").default(false).notNull(),
	reviewedBy: uuid("reviewed_by"),
	reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: 'string' }),
	hearingSettledAt: timestamp("hearing_settled_at", { withTimezone: true, mode: 'string' }),
	hearingSettledBy: uuid("hearing_settled_by"),
}, (table) => [
	index("publications_applied_idx").using("btree", table.capturedAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(ai_applied AND (triaged_by IS NULL) AND (NOT review_due))`),
	index("publications_cancelled_idx").using("btree", table.orgId.asc().nullsLast().op("timestamptz_ops"), table.cancelPending.desc().nullsFirst().op("uuid_ops"), table.cancelledAt.desc().nullsFirst().op("uuid_ops")).where(sql`(NOT active)`),
	index("publications_case_idx").using("btree", table.caseId.asc().nullsLast().op("uuid_ops"), table.availableOn.desc().nullsFirst().op("uuid_ops")).where(sql`(case_id IS NOT NULL)`),
	index("publications_cnj_idx").using("btree", table.orgId.asc().nullsLast().op("uuid_ops"), table.cnj.asc().nullsLast().op("uuid_ops")),
	index("publications_deadline_watch_idx").using("btree", table.orgId.asc().nullsLast().op("uuid_ops"), table.triagedAt.asc().nullsLast().op("timestamptz_ops")).where(sql`((category = 'prazo'::text) AND active)`),
	index("publications_hearing_settled_by_idx").using("btree", table.hearingSettledBy.asc().nullsLast().op("uuid_ops")).where(sql`(hearing_settled_by IS NOT NULL)`),
	index("publications_hearing_watch_idx").using("btree", table.orgId.asc().nullsLast().op("timestamptz_ops"), table.triagedAt.asc().nullsLast().op("uuid_ops")).where(sql`((category = 'audiencia'::text) AND active)`),
	index("publications_inbox_idx").using("btree", table.orgId.asc().nullsLast().op("date_ops"), table.availableOn.asc().nullsLast().op("date_ops"), table.id.asc().nullsLast().op("date_ops")).where(sql`((category IS NULL) AND active)`),
	index("publications_proceeding_idx").using("btree", table.proceedingId.asc().nullsLast().op("uuid_ops")).where(sql`(proceeding_id IS NOT NULL)`),
	index("publications_review_idx").using("btree", table.orgId.asc().nullsLast().op("timestamptz_ops"), table.triagedAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(review_due AND active)`),
	index("publications_shadow_claimed_idx").using("btree", table.aiClaimedAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(ai_claimed_at IS NOT NULL)`),
	index("publications_shadow_idx").using("btree", table.capturedAt.asc().nullsLast().op("timestamptz_ops")).where(sql`((ai_category IS NULL) AND active)`),
	index("publications_triaged_idx").using("btree", table.orgId.asc().nullsLast().op("timestamptz_ops"), table.triagedAt.desc().nullsFirst().op("timestamptz_ops")).where(sql`(category IS NOT NULL)`),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "publications_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.cancelSeenBy],
			foreignColumns: [profiles.id],
			name: "publications_cancel_seen_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.triagedBy],
			foreignColumns: [profiles.id],
			name: "publications_triaged_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.aiRunId],
			foreignColumns: [aiRuns.id],
			name: "publications_ai_run_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.proceedingId],
			foreignColumns: [proceedings.id, proceedings.orgId],
			name: "publications_proceeding_id_org_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.caseId],
			foreignColumns: [cases.id, cases.orgId],
			name: "publications_case_id_org_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.reviewedBy],
			foreignColumns: [profiles.id],
			name: "publications_reviewed_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.hearingSettledBy],
			foreignColumns: [profiles.id],
			name: "publications_hearing_settled_by_fkey"
		}).onDelete("set null"),
	unique("publications_id_org_id_key").on(table.id, table.orgId),
	unique("publications_org_id_hash_key").on(table.orgId, table.hash),
	pgPolicy("publications_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("publications_hash_check", sql`hash ~ '^[A-Za-z0-9_-]{8,80}$'::text`),
	check("publications_cnj_check", sql`cnj ~ '^[0-9]{20}$'::text`),
	check("publications_court_check", sql`court ~ '^[A-Z0-9-]{2,12}$'::text`),
	check("publications_kind_check", sql`char_length(kind) <= 80`),
	check("publications_document_type_check", sql`COALESCE(char_length(document_type), 0) <= 80`),
	check("publications_cancel_reason_check", sql`COALESCE(char_length(cancel_reason), 0) <= 1000`),
	check("publications_ends_check", sql`(char_length(head) <= 1200) AND (COALESCE(char_length(tail), 0) <= 1200)`),
	check("publications_cancel_check", sql`active = (cancelled_at IS NULL)`),
	check("publications_link_check", sql`(link IS NULL) OR (link ~* '^https?://'::text)`),
	check("publications_category_check", sql`(category IS NULL) OR (category = ANY (ARRAY['prazo'::text, 'audiencia'::text, 'decisao'::text, 'pagamento'::text, 'ciencia'::text, 'outro'::text]))`),
	check("publications_ai_category_check", sql`(ai_category IS NULL) OR (ai_category = ANY (ARRAY['prazo'::text, 'audiencia'::text, 'decisao'::text, 'pagamento'::text, 'ciencia'::text, 'outro'::text]))`),
	check("publications_note_check", sql`COALESCE(char_length(note), 0) <= 1000`),
	check("publications_ai_error_check", sql`(ai_error IS NULL) OR (ai_error ~ '^[a-z][a-z0-9_]{1,59}$'::text)`),
	check("publications_triage_check", sql`(category IS NULL) = (triaged_at IS NULL)`),
	check("publications_review_check", sql`((NOT review_due) OR (ai_applied AND (category IS NOT NULL))) AND ((reviewed_at IS NULL) OR (category IS NOT NULL))`),
]);

export const caseDrafts = pgTable("case_drafts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	caseId: uuid("case_id").notNull(),
	proceedingId: uuid("proceeding_id").notNull(),
	templateId: uuid("template_id"),
	templateName: text("template_name").notNull(),
	templateBody: text("template_body").notNull(),
	mode: text().notNull(),
	status: text().notNull(),
	work: text(),
	workClaims: integer("work_claims").default(0).notNull(),
	unusableRuns: integer("unusable_runs").default(0).notNull(),
	workClaimedAt: timestamp("work_claimed_at", { withTimezone: true, mode: 'string' }),
	workAttempts: integer("work_attempts").default(0).notNull(),
	workAfter: timestamp("work_after", { withTimezone: true, mode: 'string' }),
	workError: text("work_error"),
	runId: uuid("run_id"),
	version: integer().default(0).notNull(),
	checkedVersion: integer("checked_version"),
	revisionNote: text("revision_note"),
	revisionBy: uuid("revision_by"),
	revisionAt: timestamp("revision_at", { withTimezone: true, mode: 'string' }),
	revisionKeys: jsonb("revision_keys"),
	revisions: integer().default(0).notNull(),
	alike: jsonb().default([]).notNull(),
	approvedVersion: integer("approved_version"),
	approvedBody: text("approved_body"),
	approvedBy: uuid("approved_by"),
	approvedAt: timestamp("approved_at", { withTimezone: true, mode: 'string' }),
	approvedAuto: boolean("approved_auto").default(false).notNull(),
	autoApprovalOwed: boolean("auto_approval_owed").default(false).notNull(),
	documentId: uuid("document_id"),
	requestedBy: uuid("requested_by"),
	requestedAuto: boolean("requested_auto").default(false).notNull(),
	requestedAt: timestamp("requested_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("case_drafts_auto_approval_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops"), table.id.asc().nullsLast().op("uuid_ops")).where(sql`auto_approval_owed`),
	index("case_drafts_case_idx").using("btree", table.caseId.asc().nullsLast().op("timestamptz_ops"), table.requestedAt.desc().nullsFirst().op("uuid_ops")),
	index("case_drafts_claimed_idx").using("btree", table.workClaimedAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(work_claimed_at IS NOT NULL)`),
	index("case_drafts_firm_idx").using("btree", table.orgId.asc().nullsLast().op("uuid_ops")).where(sql`(status = ANY (ARRAY['proposed'::text, 'approved'::text, 'issued'::text, 'failed'::text]))`),
	uniqueIndex("case_drafts_in_course_idx").using("btree", table.proceedingId.asc().nullsLast().op("uuid_ops")).where(sql`(status = ANY (ARRAY['generating'::text, 'proposed'::text, 'approved'::text]))`),
	index("case_drafts_work_idx").using("btree", table.requestedAt.asc().nullsLast().op("timestamptz_ops")).where(sql`((work IS NOT NULL) AND (work_claimed_at IS NULL))`),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "case_drafts_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.runId],
			foreignColumns: [aiRuns.id],
			name: "case_drafts_run_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.revisionBy],
			foreignColumns: [profiles.id],
			name: "case_drafts_revision_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.approvedBy],
			foreignColumns: [profiles.id],
			name: "case_drafts_approved_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.requestedBy],
			foreignColumns: [profiles.id],
			name: "case_drafts_requested_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.caseId],
			foreignColumns: [cases.id, cases.orgId],
			name: "case_drafts_case_id_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId, table.proceedingId],
			foreignColumns: [proceedings.id, proceedings.orgId],
			name: "case_drafts_proceeding_id_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId, table.documentId],
			foreignColumns: [caseDocuments.id, caseDocuments.orgId],
			name: "case_drafts_document_id_org_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.templateId],
			foreignColumns: [draftTemplates.id],
			name: "case_drafts_template_id_fkey"
		}).onDelete("set null"),
	unique("case_drafts_id_org_id_key").on(table.id, table.orgId),
	pgPolicy("case_drafts_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("case_drafts_mode_check", sql`mode = ANY (ARRAY['ai'::text, 'blank'::text])`),
	check("case_drafts_status_check", sql`status = ANY (ARRAY['generating'::text, 'proposed'::text, 'approved'::text, 'issued'::text, 'rejected'::text, 'failed'::text, 'cancelled'::text])`),
	check("case_drafts_work_check", sql`(work IS NULL) OR (work = ANY (ARRAY['generate'::text, 'revise'::text, 'check'::text, 'issue'::text]))`),
	check("case_drafts_revision_check", sql`((work IS DISTINCT FROM 'revise'::text) OR ((status = 'proposed'::text) AND (revision_note IS NOT NULL))) AND ((revision_note IS NULL) OR ((status = 'proposed'::text) AND ((char_length(revision_note) >= 1) AND (char_length(revision_note) <= 2000)))) AND ((revision_keys IS NULL) OR ((revision_note IS NOT NULL) AND (jsonb_typeof(revision_keys) = 'object'::text))) AND (revisions >= 0)`),
	check("case_drafts_error_check", sql`(work_error IS NULL) OR (work_error ~ '^[a-z][a-z0-9_]{1,59}$'::text)`),
	check("case_drafts_version_check", sql`(version >= 0) AND ((checked_version IS NULL) OR (checked_version <= version))`),
	check("case_drafts_template_check", sql`(char_length(template_body) >= 20) AND (char_length(template_body) <= 200000)`),
	check("case_drafts_alike_check", sql`jsonb_typeof(alike) = 'array'::text`),
	check("case_drafts_approved_check", sql`(status = ANY (ARRAY['approved'::text, 'issued'::text])) = ((approved_version IS NOT NULL) AND (approved_body IS NOT NULL) AND (approved_at IS NOT NULL))`),
]);

export const caseDraftVersions = pgTable("case_draft_versions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	draftId: uuid("draft_id").notNull(),
	version: integer().notNull(),
	author: text().notNull(),
	authorId: uuid("author_id"),
	body: text().notNull(),
	basedOn: integer("based_on"),
	note: text(),
	askedBy: uuid("asked_by"),
	runId: uuid("run_id"),
	restored: boolean().default(false).notNull(),
	notes: text().array().default(sql`'{}'`).notNull(),
	signature: integer().array(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "case_draft_versions_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.authorId],
			foreignColumns: [profiles.id],
			name: "case_draft_versions_author_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.askedBy],
			foreignColumns: [profiles.id],
			name: "case_draft_versions_asked_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.runId],
			foreignColumns: [aiRuns.id],
			name: "case_draft_versions_run_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.draftId],
			foreignColumns: [caseDrafts.id, caseDrafts.orgId],
			name: "case_draft_versions_draft_id_org_id_fkey"
		}).onDelete("cascade"),
	unique("case_draft_versions_draft_id_version_key").on(table.draftId, table.version),
	pgPolicy("case_draft_versions_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("case_draft_versions_signature_check", sql`(signature IS NULL) OR (cardinality(signature) = ANY (ARRAY[0, 128]))`),
	check("case_draft_versions_body_check", sql`(char_length(body) >= 1) AND (char_length(body) <= 200000)`),
	check("case_draft_versions_author_check", sql`author = ANY (ARRAY['ai'::text, 'template'::text, 'person'::text])`),
	check("case_draft_versions_version_check", sql`version > 0`),
	check("case_draft_versions_based_check", sql`(based_on IS NULL) OR ((based_on > 0) AND (based_on < version))`),
	check("case_draft_versions_note_check", sql`((note IS NULL) OR ((author = 'ai'::text) AND (based_on IS NOT NULL) AND ((char_length(note) >= 1) AND (char_length(note) <= 2000)))) AND ((NOT restored) OR ((author = 'person'::text) AND (based_on IS NOT NULL))) AND (cardinality(notes) <= 40)`),
]);

export const dossiers = pgTable("dossiers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	caseId: uuid("case_id").notNull(),
	status: text().default('requested').notNull(),
	issuedDocumentId: uuid("issued_document_id"),
	summary: jsonb().default({}).notNull(),
	error: text(),
	requestedBy: uuid("requested_by"),
	requestedAt: timestamp("requested_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	issuedAt: timestamp("issued_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("dossiers_case_idx").using("btree", table.caseId.asc().nullsLast().op("timestamptz_ops"), table.requestedAt.desc().nullsFirst().op("uuid_ops")),
	foreignKey({
			columns: [table.orgId, table.issuedDocumentId],
			foreignColumns: [issuedDocuments.id, issuedDocuments.orgId],
			name: "dossiers_issued_document_id_org_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "dossiers_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.requestedBy],
			foreignColumns: [profiles.id],
			name: "dossiers_requested_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.caseId],
			foreignColumns: [cases.id, cases.orgId],
			name: "dossiers_case_id_org_id_fkey"
		}).onDelete("cascade"),
	unique("dossiers_id_org_id_key").on(table.id, table.orgId),
	pgPolicy("dossiers_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("dossiers_status_check", sql`status = ANY (ARRAY['requested'::text, 'issued'::text, 'failed'::text])`),
	check("dossiers_issued_check", sql`(status = 'issued'::text) = (issued_at IS NOT NULL)`),
	check("dossiers_summary_check", sql`jsonb_typeof(summary) = 'object'::text`),
	check("dossiers_error_check", sql`(error IS NULL) OR (error ~ '^[a-z][a-z0-9_]{1,59}$'::text)`),
]);

export const flightChecks = pgTable("flight_checks", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	caseId: uuid("case_id").notNull(),
	segmentId: uuid("segment_id").notNull(),
	source: text().notNull(),
	status: text().notNull(),
	version: text(),
	record: jsonb(),
	matchedBy: text("matched_by"),
	month: text(),
	checkedAt: timestamp("checked_at", { withTimezone: true, mode: 'string' }),
	requestedBy: uuid("requested_by"),
	requestedAt: timestamp("requested_at", { withTimezone: true, mode: 'string' }),
	workClaims: integer("work_claims").default(0).notNull(),
	workClaimedAt: timestamp("work_claimed_at", { withTimezone: true, mode: 'string' }),
	workAttempts: integer("work_attempts").default(0).notNull(),
	workAfter: timestamp("work_after", { withTimezone: true, mode: 'string' }),
	workError: text("work_error"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("flight_checks_case_idx").using("btree", table.caseId.asc().nullsLast().op("uuid_ops")),
	index("flight_checks_claimed_idx").using("btree", table.workClaimedAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(work_claimed_at IS NOT NULL)`),
	index("flight_checks_work_idx").using("btree", table.workAfter.asc().nullsFirst().op("timestamptz_ops"), table.createdAt.asc().nullsLast().op("timestamptz_ops")).where(sql`((source = 'vra'::text) AND (status = ANY (ARRAY['waiting'::text, 'not_published'::text])) AND (work_claimed_at IS NULL))`),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "flight_checks_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.requestedBy],
			foreignColumns: [profiles.id],
			name: "flight_checks_requested_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.caseId],
			foreignColumns: [cases.id, cases.orgId],
			name: "flight_checks_case_id_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId, table.segmentId],
			foreignColumns: [flightSegments.id, flightSegments.orgId],
			name: "flight_checks_segment_id_org_id_fkey"
		}).onDelete("cascade"),
	unique("flight_checks_id_org_id_key").on(table.id, table.orgId),
	unique("flight_checks_segment_id_source_key").on(table.segmentId, table.source),
	pgPolicy("flight_checks_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("flight_checks_source_check", sql`source = ANY (ARRAY['vra'::text, 'flightaware'::text])`),
	check("flight_checks_status_check", sql`status = ANY (ARRAY['waiting'::text, 'incomplete'::text, 'not_published'::text, 'found'::text, 'not_found'::text, 'failed'::text])`),
	check("flight_checks_record_check", sql`((status <> 'found'::text) OR (record IS NOT NULL)) AND ((record IS NULL) OR (status = 'found'::text) OR ((source = 'flightaware'::text) AND (status = ANY (ARRAY['waiting'::text, 'failed'::text]))))`),
	check("flight_checks_record_shape_check", sql`(record IS NULL) OR ((jsonb_typeof(record) = 'object'::text) AND (octet_length((record)::text) <= 4000))`),
	check("flight_checks_matched_check", sql`(matched_by IS NULL) OR (matched_by = ANY (ARRAY['operator'::text, 'codeshare'::text, 'route'::text]))`),
	check("flight_checks_month_check", sql`(month IS NULL) OR (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'::text)`),
	check("flight_checks_version_check", sql`(version IS NULL) OR (version ~ '^[a-z0-9-]{3,40}$'::text)`),
	check("flight_checks_error_check", sql`(work_error IS NULL) OR (work_error ~ '^[a-z][a-z0-9_]{1,59}$'::text)`),
]);

export const proceedingTracking = pgTable("proceeding_tracking", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	caseId: uuid("case_id").notNull(),
	proceedingId: uuid("proceeding_id").notNull(),
	cnj: text().notNull(),
	source: text().notNull(),
	status: text().notNull(),
	snapshot: jsonb(),
	vendor: text(),
	movementsCount: integer("movements_count").default(0).notNull(),
	lastMovementAt: timestamp("last_movement_at", { withTimezone: true, mode: 'string' }),
	readAt: timestamp("read_at", { withTimezone: true, mode: 'string' }),
	checkedAt: timestamp("checked_at", { withTimezone: true, mode: 'string' }),
	nextReadAt: timestamp("next_read_at", { withTimezone: true, mode: 'string' }),
	seenUntil: timestamp("seen_until", { withTimezone: true, mode: 'string' }),
	unseenCount: integer("unseen_count").default(0).notNull(),
	requestedBy: uuid("requested_by"),
	requestedAt: timestamp("requested_at", { withTimezone: true, mode: 'string' }),
	workClaims: integer("work_claims").default(0).notNull(),
	workClaimedAt: timestamp("work_claimed_at", { withTimezone: true, mode: 'string' }),
	workAttempts: integer("work_attempts").default(0).notNull(),
	workError: text("work_error"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("proceeding_tracking_case_idx").using("btree", table.caseId.asc().nullsLast().op("uuid_ops")),
	index("proceeding_tracking_claimed_idx").using("btree", table.workClaimedAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(work_claimed_at IS NOT NULL)`),
	index("proceeding_tracking_due_idx").using("btree", table.nextReadAt.asc().nullsLast().op("timestamptz_ops")).where(sql`((status = ANY (ARRAY['waiting'::text, 'tracked'::text, 'not_found'::text, 'secret'::text])) AND (work_claimed_at IS NULL))`),
	index("proceeding_tracking_waiting_idx").using("btree", table.orgId.asc().nullsLast().op("uuid_ops")).where(sql`((unseen_count > 0) OR (status = 'failed'::text))`),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "proceeding_tracking_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.requestedBy],
			foreignColumns: [profiles.id],
			name: "proceeding_tracking_requested_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.caseId],
			foreignColumns: [cases.id, cases.orgId],
			name: "proceeding_tracking_case_id_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId, table.proceedingId],
			foreignColumns: [proceedings.id, proceedings.orgId],
			name: "proceeding_tracking_proceeding_id_org_id_fkey"
		}).onDelete("cascade"),
	unique("proceeding_tracking_id_org_id_key").on(table.id, table.orgId),
	unique("proceeding_tracking_proceeding_id_key").on(table.proceedingId),
	pgPolicy("proceeding_tracking_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("proceeding_tracking_cnj_check", sql`cnj ~ '^[0-9]{20}$'::text`),
	check("proceeding_tracking_status_check", sql`status = ANY (ARRAY['waiting'::text, 'tracked'::text, 'not_found'::text, 'secret'::text, 'failed'::text, 'off'::text])`),
	check("proceeding_tracking_snapshot_check", sql`(snapshot IS NULL) OR ((jsonb_typeof(snapshot) = 'object'::text) AND (octet_length((snapshot)::text) <= 65536))`),
	check("proceeding_tracking_error_check", sql`(work_error IS NULL) OR (work_error ~ '^[a-z][a-z0-9_]{1,59}$'::text)`),
	check("proceeding_tracking_unseen_check", sql`unseen_count >= 0`),
	check("proceeding_tracking_vendor_check", sql`(vendor IS NULL) OR (vendor ~ '^[a-z][a-z0-9_-]{1,39}$'::text)`),
	check("proceeding_tracking_source_check", sql`source = ANY (ARRAY['projudi'::text, 'aggregator'::text, 'teste'::text])`),
]);

export const movements = pgTable("movements", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	caseId: uuid("case_id").notNull(),
	proceedingId: uuid("proceeding_id").notNull(),
	source: text().notNull(),
	sourceId: text("source_id").notNull(),
	occurredAt: timestamp("occurred_at", { withTimezone: true, mode: 'string' }).notNull(),
	title: text().notNull(),
	detail: text(),
	byName: text("by_name"),
	learnedAt: timestamp("learned_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("movements_learned_idx").using("btree", table.orgId.asc().nullsLast().op("uuid_ops"), table.learnedAt.desc().nullsFirst().op("uuid_ops")),
	index("movements_proceeding_idx").using("btree", table.proceedingId.asc().nullsLast().op("uuid_ops"), table.occurredAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "movements_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId, table.caseId],
			foreignColumns: [cases.id, cases.orgId],
			name: "movements_case_id_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId, table.proceedingId],
			foreignColumns: [proceedings.id, proceedings.orgId],
			name: "movements_proceeding_id_org_id_fkey"
		}).onDelete("cascade"),
	unique("movements_id_org_id_key").on(table.id, table.orgId),
	unique("movements_proceeding_id_source_source_id_key").on(table.proceedingId, table.source, table.sourceId),
	pgPolicy("movements_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("movements_text_check", sql`((char_length(source_id) >= 1) AND (char_length(source_id) <= 100)) AND ((char_length(title) >= 1) AND (char_length(title) <= 1000)) AND (COALESCE(char_length(detail), 0) <= 4000) AND (COALESCE(char_length(by_name), 0) <= 300)`),
	check("movements_source_check", sql`source = ANY (ARRAY['projudi'::text, 'aggregator'::text, 'teste'::text])`),
]);

export const importBatches = pgTable("import_batches", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	kind: text().default('portfolio').notNull(),
	fileName: text("file_name"),
	sourceSystem: text("source_system"),
	status: text().default('staged').notNull(),
	rowsCount: integer("rows_count").default(0).notNull(),
	counts: jsonb(),
	fileCounts: jsonb("file_counts"),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	committedAt: timestamp("committed_at", { withTimezone: true, mode: 'string' }),
	revertedAt: timestamp("reverted_at", { withTimezone: true, mode: 'string' }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("import_batches_org_idx").using("btree", table.orgId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("uuid_ops")),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "import_batches_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [profiles.id],
			name: "import_batches_created_by_fkey"
		}).onDelete("set null"),
	unique("import_batches_id_org_id_key").on(table.id, table.orgId),
	pgPolicy("import_batches_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("import_batches_kind_check", sql`kind = 'portfolio'::text`),
	check("import_batches_status_check", sql`status = ANY (ARRAY['staged'::text, 'committed'::text, 'reverted'::text])`),
	check("import_batches_text_check", sql`(COALESCE(char_length(file_name), 0) <= 200) AND (COALESCE(char_length(source_system), 0) <= 80)`),
	check("import_batches_file_counts_check", sql`(file_counts IS NULL) OR ((jsonb_typeof(file_counts) = 'object'::text) AND (octet_length((file_counts)::text) <= 400))`),
]);

export const importRows = pgTable("import_rows", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	batchId: uuid("batch_id").notNull(),
	rowNumber: integer("row_number").notNull(),
	cnj: text().notNull(),
	fields: jsonb().default({}).notNull(),
	outcome: text(),
	code: text(),
	decidedAt: timestamp("decided_at", { withTimezone: true, mode: 'string' }),
	caseId: uuid("case_id"),
	proceedingId: uuid("proceeding_id"),
	personId: uuid("person_id"),
	personCreated: boolean("person_created").default(false).notNull(),
}, (table) => [
	index("import_rows_case_idx").using("btree", table.caseId.asc().nullsLast().op("uuid_ops")).where(sql`(case_id IS NOT NULL)`),
	index("import_rows_pending_idx").using("btree", table.batchId.asc().nullsLast().op("int4_ops"), table.rowNumber.asc().nullsLast().op("int4_ops")).where(sql`(outcome IS NULL)`),
	index("import_rows_person_idx").using("btree", table.personId.asc().nullsLast().op("uuid_ops")).where(sql`(person_id IS NOT NULL)`),
	index("import_rows_proceeding_idx").using("btree", table.proceedingId.asc().nullsLast().op("uuid_ops")).where(sql`(proceeding_id IS NOT NULL)`),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "import_rows_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.caseId],
			foreignColumns: [cases.id],
			name: "import_rows_case_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.proceedingId],
			foreignColumns: [proceedings.id],
			name: "import_rows_proceeding_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.personId],
			foreignColumns: [people.id],
			name: "import_rows_person_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.batchId],
			foreignColumns: [importBatches.id, importBatches.orgId],
			name: "import_rows_batch_id_org_id_fkey"
		}).onDelete("cascade"),
	unique("import_rows_batch_id_row_number_key").on(table.batchId, table.rowNumber),
	unique("import_rows_batch_id_cnj_key").on(table.batchId, table.cnj),
	pgPolicy("import_rows_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("import_rows_row_check", sql`row_number > 0`),
	check("import_rows_cnj_check", sql`CHECK (cnj_is_valid(cnj`),
	check("import_rows_fields_check", sql`(jsonb_typeof(fields) = 'object'::text) AND (octet_length((fields)::text) <= 6000)`),
	check("import_rows_outcome_check", sql`(outcome IS NULL) OR (outcome = ANY (ARRAY['created'::text, 'exists'::text, 'refused'::text, 'reverted'::text, 'kept'::text]))`),
	check("import_rows_code_check", sql`(code IS NULL) OR (code ~ '^[a-z][a-z0-9_]{1,59}$'::text)`),
]);

export const courtCalendarDays = pgTable("court_calendar_days", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	court: text().notNull(),
	day: date().notNull(),
	kind: text().notNull(),
	label: text().notNull(),
	proceedingKinds: text("proceeding_kinds").array().default(sql`'{}'`).notNull(),
	systems: text().array().default(sql`'{}'`).notNull(),
	comarcas: text().array().default(sql`'{}'`).notNull(),
	sourceUrl: text("source_url"),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("court_calendar_days_court_idx").using("btree", table.court.asc().nullsLast().op("date_ops"), table.day.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.court],
			foreignColumns: [courts.acronym],
			name: "court_calendar_days_court_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [profiles.id],
			name: "court_calendar_days_created_by_fkey"
		}).onDelete("set null"),
	unique("court_calendar_days_court_day_kind_label_key").on(table.court, table.day, table.kind, table.label),
	pgPolicy("court_calendar_days_select_all", { as: "permissive", for: "select", to: ["authenticated"], using: sql`true` }),
	check("court_calendar_days_systems_check", sql`systems <@ ARRAY['projudi'::text, 'eproc'::text, 'pje'::text, 'esaj'::text, 'outro'::text]`),
	check("court_calendar_days_comarcas_check", sql`CHECK (calendar_names_ok(comarcas`),
	check("court_calendar_days_day_check", sql`(day >= '2019-01-01'::date) AND (day <= '2100-12-31'::date)`),
	check("court_calendar_days_kind_check", sql`kind = ANY (ARRAY['closed'::text, 'partial'::text, 'suspended'::text])`),
	check("court_calendar_days_label_check", sql`(label = btrim(label)) AND ((char_length(label) >= 2) AND (char_length(label) <= 120)) AND (label !~ '[[:cntrl:]]'::text)`),
	check("court_calendar_days_kinds_check", sql`proceeding_kinds <@ ARRAY['juizado'::text, 'comum'::text]`),
	check("court_calendar_days_source_check", sql`(source_url IS NULL) OR ((source_url ~* '^https://'::text) AND (char_length(source_url) <= 500))`),
]);

export const deadlineActs = pgTable("deadline_acts", {
	slug: text().primaryKey().notNull(),
	name: text().notNull(),
	days: integer().notNull(),
	counting: text().default('business').notNull(),
	proceedingKinds: text("proceeding_kinds").array().default(sql`'{}'`).notNull(),
	basis: text().notNull(),
	position: integer().default(100).notNull(),
	active: boolean().default(true).notNull(),
	updatedBy: uuid("updated_by"),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [profiles.id],
			name: "deadline_acts_updated_by_fkey"
		}).onDelete("set null"),
	pgPolicy("deadline_acts_select_all", { as: "permissive", for: "select", to: ["authenticated"], using: sql`true` }),
	check("deadline_acts_slug_check", sql`slug ~ '^[a-z][a-z0-9_]{1,59}$'::text`),
	check("deadline_acts_name_check", sql`(name = btrim(name)) AND ((char_length(name) >= 2) AND (char_length(name) <= 120))`),
	check("deadline_acts_days_check", sql`(days >= 1) AND (days <= 365)`),
	check("deadline_acts_counting_check", sql`counting = ANY (ARRAY['business'::text, 'calendar'::text])`),
	check("deadline_acts_kinds_check", sql`proceeding_kinds <@ ARRAY['juizado'::text, 'comum'::text]`),
	check("deadline_acts_basis_check", sql`(basis = btrim(basis)) AND ((char_length(basis) >= 2) AND (char_length(basis) <= 200))`),
]);

export const deadlines = pgTable("deadlines", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	cnj: text().notNull(),
	court: text().notNull(),
	caseId: uuid("case_id"),
	proceedingId: uuid("proceeding_id"),
	publicationId: uuid("publication_id"),
	title: text().notNull(),
	act: text(),
	trigger: text().notNull(),
	triggerOn: date("trigger_on").notNull(),
	days: integer().notNull(),
	counting: text().notNull(),
	revision: integer().default(1).notNull(),
	computedRevision: integer("computed_revision"),
	ruleVersion: text("rule_version"),
	publishedOn: date("published_on"),
	startsOn: date("starts_on"),
	computedDueOn: date("computed_due_on"),
	explanation: jsonb(),
	assumptions: text().array().default(sql`'{}'`).notNull(),
	computedAt: timestamp("computed_at", { withTimezone: true, mode: 'string' }),
	countClaimedAt: timestamp("count_claimed_at", { withTimezone: true, mode: 'string' }),
	countClaims: integer("count_claims").default(0).notNull(),
	countAttempts: integer("count_attempts").default(0).notNull(),
	countRetryAfter: timestamp("count_retry_after", { withTimezone: true, mode: 'string' }),
	countError: text("count_error"),
	status: text().default('proposed').notNull(),
	dueOn: date("due_on"),
	corrected: boolean().default(false).notNull(),
	correctionReason: text("correction_reason"),
	confirmedAgainst: date("confirmed_against"),
	confirmedRevision: integer("confirmed_revision"),
	confirmedBy: uuid("confirmed_by"),
	confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: 'string' }),
	confirmedAuto: boolean("confirmed_auto").default(false).notNull(),
	doneNote: text("done_note"),
	doneBy: uuid("done_by"),
	doneAt: timestamp("done_at", { withTimezone: true, mode: 'string' }),
	dismissReason: text("dismiss_reason"),
	dismissedBy: uuid("dismissed_by"),
	dismissedAt: timestamp("dismissed_at", { withTimezone: true, mode: 'string' }),
	createdBy: uuid("created_by"),
	proposedAuto: boolean("proposed_auto").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("deadlines_case_idx").using("btree", table.caseId.asc().nullsLast().op("date_ops"), table.dueOn.asc().nullsLast().op("uuid_ops")).where(sql`(case_id IS NOT NULL)`),
	index("deadlines_claimed_idx").using("btree", table.countClaimedAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(count_claimed_at IS NOT NULL)`),
	index("deadlines_closed_idx").using("btree", sql`org_id`, sql`COALESCE(done_at, dismissed_at)`).where(sql`(status = ANY (ARRAY['done'::text, 'dismissed'::text]))`),
	index("deadlines_count_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")).where(sql`((status = ANY (ARRAY['proposed'::text, 'confirmed'::text])) AND (computed_revision IS DISTINCT FROM revision))`),
	index("deadlines_court_idx").using("btree", table.court.asc().nullsLast().op("text_ops")).where(sql`(status = ANY (ARRAY['proposed'::text, 'confirmed'::text]))`),
	index("deadlines_open_idx").using("btree", table.orgId.asc().nullsLast().op("uuid_ops"), table.dueOn.asc().nullsLast().op("date_ops")).where(sql`(status = ANY (ARRAY['proposed'::text, 'confirmed'::text]))`),
	index("deadlines_proceeding_idx").using("btree", table.proceedingId.asc().nullsLast().op("uuid_ops")).where(sql`(proceeding_id IS NOT NULL)`),
	index("deadlines_publication_idx").using("btree", table.publicationId.asc().nullsLast().op("uuid_ops")).where(sql`(publication_id IS NOT NULL)`),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "deadlines_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.act],
			foreignColumns: [deadlineActs.slug],
			name: "deadlines_act_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.confirmedBy],
			foreignColumns: [profiles.id],
			name: "deadlines_confirmed_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.doneBy],
			foreignColumns: [profiles.id],
			name: "deadlines_done_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.dismissedBy],
			foreignColumns: [profiles.id],
			name: "deadlines_dismissed_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [profiles.id],
			name: "deadlines_created_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.caseId],
			foreignColumns: [cases.id, cases.orgId],
			name: "deadlines_case_id_org_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.proceedingId],
			foreignColumns: [proceedings.id, proceedings.orgId],
			name: "deadlines_proceeding_id_org_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.publicationId],
			foreignColumns: [publications.id, publications.orgId],
			name: "deadlines_publication_id_org_id_fkey"
		}).onDelete("set null"),
	unique("deadlines_id_org_id_key").on(table.id, table.orgId),
	pgPolicy("deadlines_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("deadlines_correction_check", sql`(corrected = (correction_reason IS NOT NULL)) AND ((correction_reason IS NULL) OR ((char_length(correction_reason) >= 8) AND (char_length(correction_reason) <= 1000)))`),
	check("deadlines_cnj_check", sql`cnj ~ '^[0-9]{20}$'::text`),
	check("deadlines_court_check", sql`court ~ '^[A-Z0-9-]{2,12}$'::text`),
	check("deadlines_title_check", sql`(title = btrim(title)) AND ((char_length(title) >= 2) AND (char_length(title) <= 200)) AND (title !~ '[[:cntrl:]]'::text)`),
	check("deadlines_trigger_check", sql`trigger = ANY (ARRAY['publication'::text, 'day'::text])`),
	check("deadlines_trigger_on_check", sql`(trigger_on >= '2019-01-01'::date) AND (trigger_on <= '2100-12-31'::date)`),
	check("deadlines_days_check", sql`(days >= 1) AND (days <= 365)`),
	check("deadlines_counting_check", sql`counting = ANY (ARRAY['business'::text, 'calendar'::text])`),
	check("deadlines_revision_check", sql`(revision >= 1) AND ((computed_revision IS NULL) OR ((computed_revision >= 1) AND (computed_revision <= revision)))`),
	check("deadlines_rule_check", sql`(rule_version IS NULL) OR (rule_version ~ '^prazo-v[0-9]{1,3}$'::text)`),
	check("deadlines_explanation_check", sql`(explanation IS NULL) OR ((jsonb_typeof(explanation) = 'object'::text) AND (octet_length((explanation)::text) <= 32000))`),
	check("deadlines_assumptions_check", sql`assumptions <@ ARRAY['calendar_unchecked'::text, 'comarca_unknown'::text, 'local_days_unchecked'::text, 'scope_unknown'::text, 'partial_start'::text, 'start_not_business'::text, 'djen_before_rule'::text, 'calendar_suspension'::text]`),
	check("deadlines_count_error_check", sql`(count_error IS NULL) OR (count_error ~ '^[a-z][a-z0-9_]{1,59}$'::text)`),
	check("deadlines_status_check", sql`status = ANY (ARRAY['proposed'::text, 'confirmed'::text, 'done'::text, 'dismissed'::text])`),
	check("deadlines_due_check", sql`(due_on IS NULL) OR (due_on >= trigger_on)`),
	check("deadlines_confirmed_check", sql`(status <> 'confirmed'::text) OR ((confirmed_at IS NOT NULL) AND (due_on IS NOT NULL))`),
	check("deadlines_done_check", sql`((status = 'done'::text) = (done_at IS NOT NULL)) AND (COALESCE(char_length(done_note), 0) <= 1000)`),
	check("deadlines_dismissed_check", sql`((status = 'dismissed'::text) = (dismissed_at IS NOT NULL)) AND ((status <> 'dismissed'::text) OR ((char_length(COALESCE(dismiss_reason, ''::text)) >= 8) AND (char_length(COALESCE(dismiss_reason, ''::text)) <= 1000)))`),
]);

export const publicationTriagePolicies = pgTable("publication_triage_policies", {
	category: text().primaryKey().notNull(),
	mode: text().default('shadow').notNull(),
	samplePercent: integer("sample_percent").default(20).notNull(),
	note: text(),
	changedBy: uuid("changed_by"),
	changedAt: timestamp("changed_at", { withTimezone: true, mode: 'string' }),
	demotedAt: timestamp("demoted_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.changedBy],
			foreignColumns: [profiles.id],
			name: "publication_triage_policies_changed_by_fkey"
		}).onDelete("set null"),
	pgPolicy("publication_triage_policies_select_all", { as: "permissive", for: "select", to: ["authenticated"], using: sql`true` }),
	check("publication_triage_policies_category_check", sql`category = ANY (ARRAY['prazo'::text, 'audiencia'::text, 'decisao'::text, 'pagamento'::text, 'ciencia'::text, 'outro'::text])`),
	check("publication_triage_policies_mode_check", sql`mode = ANY (ARRAY['shadow'::text, 'sampled'::text])`),
	check("publication_triage_policies_sample_check", sql`(sample_percent >= 1) AND (sample_percent <= 100)`),
	check("publication_triage_policies_note_check", sql`(note IS NULL) OR (char_length(note) <= 1000)`),
	check("publication_triage_policies_acting_check", sql`(mode = 'shadow'::text) OR (category <> ALL (ARRAY['prazo'::text, 'audiencia'::text, 'decisao'::text, 'pagamento'::text]))`),
]);

export const firmCalendars = pgTable("firm_calendars", {
	orgId: uuid("org_id").primaryKey().notNull(),
	connectionId: uuid("connection_id").notNull(),
	calendarId: text("calendar_id").notNull(),
	name: text().notNull(),
	status: text().default('active').notNull(),
	problem: text(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [profiles.id],
			name: "firm_calendars_created_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.connectionId],
			foreignColumns: [connections.id, connections.orgId],
			name: "firm_calendars_connection_id_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "firm_calendars_org_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("firm_calendars_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("firm_calendars_id_check", sql`(char_length(calendar_id) >= 3) AND (char_length(calendar_id) <= 300)`),
	check("firm_calendars_name_check", sql`(char_length(btrim(name)) >= 2) AND (char_length(btrim(name)) <= 120)`),
	check("firm_calendars_status_check", sql`status = ANY (ARRAY['active'::text, 'lost'::text, 'off'::text])`),
	check("firm_calendars_problem_check", sql`((status = 'lost'::text) = (problem IS NOT NULL)) AND ((problem IS NULL) OR (problem ~ '^[a-z][a-z0-9_]{1,59}$'::text))`),
]);

export const hearingEventRemovals = pgTable("hearing_event_removals", {
	hearingId: uuid("hearing_id").primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	calendarId: text("calendar_id").notNull(),
	claims: integer().default(0).notNull(),
	claimedAt: timestamp("claimed_at", { withTimezone: true, mode: 'string' }),
	attempts: integer().default(0).notNull(),
	retryAfter: timestamp("retry_after", { withTimezone: true, mode: 'string' }),
	error: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "hearing_event_removals_org_id_fkey"
		}).onDelete("cascade"),
	check("hearing_event_removals_calendar_check", sql`(char_length(calendar_id) >= 3) AND (char_length(calendar_id) <= 300)`),
	check("hearing_event_removals_error_check", sql`(error IS NULL) OR (error ~ '^[a-z][a-z0-9_]{1,59}$'::text)`),
]);

export const noticeKinds = pgTable("notice_kinds", {
	kind: text().primaryKey().notNull(),
	position: integer().notNull(),
	templateBase: text("template_base").notNull(),
	body: text().notNull(),
	footer: text().notNull(),
	params: text().array().notNull(),
	examples: text().array().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("notice_kinds_position_key").on(table.position),
	unique("notice_kinds_template_base_key").on(table.templateBase),
	pgPolicy("notice_kinds_select_all", { as: "permissive", for: "select", to: ["authenticated"], using: sql`true` }),
	check("notice_kinds_base_check", sql`template_base ~ '^one_[a-z][a-z0-9_]{2,60}$'::text`),
	check("notice_kinds_text_check", sql`((char_length(body) >= 20) AND (char_length(body) <= 1024)) AND ((char_length(footer) >= 1) AND (char_length(footer) <= 60))`),
	check("notice_kinds_kind_check", sql`kind = ANY (ARRAY['hearing_reminder'::text, 'hearing_change'::text, 'lawsuit_update'::text, 'payment_alert'::text, 'document_refused'::text, 'flight_problem'::text, 'case_received'::text, 'lawsuit_filed'::text])`),
	check("notice_kinds_params_check", sql`((cardinality(params) >= 1) AND (cardinality(params) <= 9)) AND (cardinality(examples) = cardinality(params)) AND (params <@ ARRAY['first_name'::text, 'firm'::text, 'hearing'::text, 'lawsuit'::text, 'moment'::text, 'how'::text, 'change'::text, 'status'::text, 'document'::text, 'reason'::text, 'flight'::text, 'what'::text, 'assistance'::text, 'next'::text, 'court'::text])`),
]);

export const noticeOptins = pgTable("notice_optins", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	personId: uuid("person_id").notNull(),
	orgId: uuid("org_id").notNull(),
	phone: text().notNull(),
	source: text().notNull(),
	wording: text().notNull(),
	note: text(),
	linkId: uuid("link_id"),
	evidence: jsonb(),
	recordedBy: uuid("recorded_by"),
	recordedAt: timestamp("recorded_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	endedAt: timestamp("ended_at", { withTimezone: true, mode: 'string' }),
	endedSource: text("ended_source"),
	endedBy: uuid("ended_by"),
	endedNote: text("ended_note"),
}, (table) => [
	uniqueIndex("notice_optins_current_idx").using("btree", table.personId.asc().nullsLast().op("uuid_ops")).where(sql`(ended_at IS NULL)`),
	index("notice_optins_org_idx").using("btree", table.orgId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.endedBy],
			foreignColumns: [profiles.id],
			name: "notice_optins_ended_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.personId, table.orgId],
			foreignColumns: [people.id, people.orgId],
			name: "notice_optins_person_id_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "notice_optins_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.linkId],
			foreignColumns: [clientLinks.id],
			name: "notice_optins_link_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.recordedBy],
			foreignColumns: [profiles.id],
			name: "notice_optins_recorded_by_fkey"
		}).onDelete("set null"),
	pgPolicy("notice_optins_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("notice_optins_end_check", sql`((ended_at IS NULL) = (ended_source IS NULL)) AND ((ended_source IS NULL) OR (ended_source = ANY (ARRAY['client'::text, 'firm'::text, 'replaced'::text]))) AND ((ended_source = 'firm'::text) = (ended_note IS NOT NULL)) AND ((ended_note IS NULL) OR ((char_length(ended_note) >= 8) AND (char_length(ended_note) <= 500)))`),
	check("notice_optins_phone_check", sql`phone ~ '^[0-9]{12,15}$'::text`),
	check("notice_optins_source_check", sql`source = ANY (ARRAY['client'::text, 'firm'::text])`),
	check("notice_optins_note_check", sql`((source = 'firm'::text) = (note IS NOT NULL)) AND ((note IS NULL) OR ((char_length(note) >= 8) AND (char_length(note) <= 500)))`),
	check("notice_optins_wording_check", sql`(char_length(wording) >= 20) AND (char_length(wording) <= 1000)`),
]);

export const caseAdvances = pgTable("case_advances", {
	caseId: uuid("case_id").primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	after: timestamp({ withTimezone: true, mode: 'string' }),
	claimedAt: timestamp("claimed_at", { withTimezone: true, mode: 'string' }),
	claims: integer().default(0).notNull(),
	attempts: integer().default(0).notNull(),
	waiting: text(),
	checkedAt: timestamp("checked_at", { withTimezone: true, mode: 'string' }),
	wokenAt: timestamp("woken_at", { withTimezone: true, mode: 'string' }),
	lawsuitsAt: timestamp("lawsuits_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	waitingSince: timestamp("waiting_since", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("case_advances_due_idx").using("btree", sql`COALESCE(after, created_at)`, sql`case_id`),
	index("case_advances_waiting_idx").using("btree", table.orgId.asc().nullsLast().op("text_ops"), table.waiting.asc().nullsLast().op("text_ops")).where(sql`(waiting IS NOT NULL)`),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "case_advances_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.caseId, table.orgId],
			foreignColumns: [cases.id, cases.orgId],
			name: "case_advances_case_id_org_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("case_advances_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("case_advances_waiting_check", sql`(waiting IS NULL) OR (waiting ~ '^[a-z][a-z_]{2,40}$'::text)`),
	check("case_advances_attempts_check", sql`attempts >= 0`),
]);

export const clientNotices = pgTable("client_notices", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	caseId: uuid("case_id").notNull(),
	personId: uuid("person_id").notNull(),
	phone: text().notNull(),
	proceedingId: uuid("proceeding_id"),
	hearingId: uuid("hearing_id"),
	publicationId: uuid("publication_id"),
	documentId: uuid("document_id"),
	kind: text().notNull(),
	occurrence: text().notNull(),
	aboutAt: timestamp("about_at", { withTimezone: true, mode: 'string' }),
	params: jsonb().notNull(),
	messageId: uuid("message_id").notNull(),
	attempts: integer().default(1).notNull(),
	reservedAt: timestamp("reserved_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("client_notices_case_idx").using("btree", table.caseId.asc().nullsLast().op("timestamptz_ops"), table.reservedAt.desc().nullsFirst().op("uuid_ops")),
	index("client_notices_document_idx").using("btree", table.documentId.asc().nullsLast().op("uuid_ops")).where(sql`(document_id IS NOT NULL)`),
	index("client_notices_firm_idx").using("btree", table.orgId.asc().nullsLast().op("timestamptz_ops"), table.reservedAt.desc().nullsFirst().op("timestamptz_ops")),
	index("client_notices_hearing_idx").using("btree", table.hearingId.asc().nullsLast().op("uuid_ops"), table.personId.asc().nullsLast().op("uuid_ops")).where(sql`(hearing_id IS NOT NULL)`),
	index("client_notices_lawsuit_idx").using("btree", table.proceedingId.asc().nullsLast().op("timestamptz_ops"), table.personId.asc().nullsLast().op("uuid_ops"), table.reservedAt.desc().nullsFirst().op("uuid_ops")).where(sql`(proceeding_id IS NOT NULL)`),
	index("client_notices_person_idx").using("btree", table.personId.asc().nullsLast().op("uuid_ops"), table.reservedAt.desc().nullsFirst().op("uuid_ops")),
	index("client_notices_phone_idx").using("btree", table.orgId.asc().nullsLast().op("timestamptz_ops"), table.phone.asc().nullsLast().op("timestamptz_ops"), table.reservedAt.desc().nullsFirst().op("uuid_ops")),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "client_notices_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.kind],
			foreignColumns: [noticeKinds.kind],
			name: "client_notices_kind_fkey"
		}),
	foreignKey({
			columns: [table.orgId, table.caseId],
			foreignColumns: [cases.id, cases.orgId],
			name: "client_notices_case_id_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId, table.personId],
			foreignColumns: [people.id, people.orgId],
			name: "client_notices_person_id_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId, table.proceedingId],
			foreignColumns: [proceedings.id, proceedings.orgId],
			name: "client_notices_proceeding_id_org_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.hearingId],
			foreignColumns: [hearings.id, hearings.orgId],
			name: "client_notices_hearing_id_org_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.publicationId],
			foreignColumns: [publications.id, publications.orgId],
			name: "client_notices_publication_id_org_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.documentId],
			foreignColumns: [caseDocuments.id, caseDocuments.orgId],
			name: "client_notices_document_id_org_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.messageId],
			foreignColumns: [waMessages.id, waMessages.orgId],
			name: "client_notices_message_id_org_id_fkey"
		}).onDelete("cascade"),
	unique("client_notices_id_org_id_key").on(table.id, table.orgId),
	unique("client_notices_org_id_person_id_kind_occurrence_key").on(table.orgId, table.personId, table.kind, table.occurrence),
	pgPolicy("client_notices_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("client_notices_phone_check", sql`phone ~ '^[0-9]{12,15}$'::text`),
	check("client_notices_occurrence_check", sql`(char_length(occurrence) >= 3) AND (char_length(occurrence) <= 200)`),
	check("client_notices_params_check", sql`jsonb_typeof(params) = 'array'::text`),
	check("client_notices_attempts_check", sql`attempts >= 1`),
]);

export const hearings = pgTable("hearings", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	caseId: uuid("case_id").notNull(),
	proceedingId: uuid("proceeding_id").notNull(),
	kind: text().notNull(),
	startsAt: timestamp("starts_at", { withTimezone: true, mode: 'string' }).notNull(),
	timeZone: text("time_zone").notNull(),
	mode: text().notNull(),
	place: text(),
	link: text(),
	attendeeUserId: uuid("attendee_user_id"),
	attendeeName: text("attendee_name"),
	notes: text(),
	source: text().default('person').notNull(),
	publicationId: uuid("publication_id"),
	status: text().default('scheduled').notNull(),
	outcome: text(),
	outcomeNote: text("outcome_note"),
	revision: integer().default(1).notNull(),
	syncedRevision: integer("synced_revision"),
	syncedCalendar: text("synced_calendar"),
	syncedAt: timestamp("synced_at", { withTimezone: true, mode: 'string' }),
	syncClaimedAt: timestamp("sync_claimed_at", { withTimezone: true, mode: 'string' }),
	syncClaims: integer("sync_claims").default(0).notNull(),
	syncAttempts: integer("sync_attempts").default(0).notNull(),
	syncRetryAfter: timestamp("sync_retry_after", { withTimezone: true, mode: 'string' }),
	syncError: text("sync_error"),
	createdBy: uuid("created_by"),
	createdAuto: boolean("created_auto").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedBy: uuid("updated_by"),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	changedAt: timestamp("changed_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("hearings_case_idx").using("btree", table.caseId.asc().nullsLast().op("timestamptz_ops"), table.startsAt.asc().nullsLast().op("timestamptz_ops")),
	index("hearings_claimed_idx").using("btree", table.syncClaimedAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(sync_claimed_at IS NOT NULL)`),
	index("hearings_firm_idx").using("btree", table.orgId.asc().nullsLast().op("timestamptz_ops"), table.startsAt.asc().nullsLast().op("timestamptz_ops")),
	uniqueIndex("hearings_moment_idx").using("btree", table.proceedingId.asc().nullsLast().op("timestamptz_ops"), table.startsAt.asc().nullsLast().op("uuid_ops")).where(sql`(status = 'scheduled'::text)`),
	index("hearings_publication_idx").using("btree", table.publicationId.asc().nullsLast().op("uuid_ops")).where(sql`(publication_id IS NOT NULL)`),
	index("hearings_sync_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")).where(sql`((synced_revision IS DISTINCT FROM revision) AND (sync_claimed_at IS NULL))`),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "hearings_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.attendeeUserId],
			foreignColumns: [profiles.id],
			name: "hearings_attendee_user_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [profiles.id],
			name: "hearings_created_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [profiles.id],
			name: "hearings_updated_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.caseId],
			foreignColumns: [cases.id, cases.orgId],
			name: "hearings_case_id_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId, table.proceedingId],
			foreignColumns: [proceedings.id, proceedings.orgId],
			name: "hearings_proceeding_id_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId, table.publicationId],
			foreignColumns: [publications.id, publications.orgId],
			name: "hearings_publication_id_org_id_fkey"
		}).onDelete("set null"),
	unique("hearings_id_org_id_key").on(table.id, table.orgId),
	pgPolicy("hearings_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("hearings_kind_check", sql`kind = ANY (ARRAY['conciliacao'::text, 'instrucao'::text, 'una'::text, 'outra'::text])`),
	check("hearings_zone_check", sql`time_zone ~ '^America/[A-Za-z_]{3,40}$'::text`),
	check("hearings_mode_check", sql`mode = ANY (ARRAY['presencial'::text, 'videoconferencia'::text, 'hibrida'::text])`),
	check("hearings_place_check", sql`(place IS NULL) OR ((place = btrim(place)) AND ((char_length(place) >= 2) AND (char_length(place) <= 300)))`),
	check("hearings_link_check", sql`(link IS NULL) OR ((link ~* '^https://[^[:space:]]+$'::text) AND (char_length(link) <= 500))`),
	check("hearings_attendee_check", sql`(attendee_name IS NULL) OR ((attendee_name = btrim(attendee_name)) AND ((char_length(attendee_name) >= 2) AND (char_length(attendee_name) <= 120)))`),
	check("hearings_notes_check", sql`(notes IS NULL) OR (char_length(notes) <= 1000)`),
	check("hearings_source_check", sql`source = ANY (ARRAY['person'::text, 'publication'::text])`),
	check("hearings_status_check", sql`status = ANY (ARRAY['scheduled'::text, 'held'::text, 'cancelled'::text])`),
	check("hearings_outcome_check", sql`((outcome IS NULL) OR ((status = 'held'::text) AND (outcome = ANY (ARRAY['acordo'::text, 'sem_acordo'::text, 'outro'::text])))) AND ((status <> 'cancelled'::text) OR ((char_length(COALESCE(outcome_note, ''::text)) >= 8) AND (char_length(COALESCE(outcome_note, ''::text)) <= 1000))) AND (COALESCE(char_length(outcome_note), 0) <= 1000)`),
	check("hearings_revision_check", sql`(revision >= 1) AND ((synced_revision IS NULL) OR ((synced_revision >= 1) AND (synced_revision <= revision)))`),
	check("hearings_sync_error_check", sql`(sync_error IS NULL) OR (sync_error ~ '^[a-z][a-z0-9_]{1,59}$'::text)`),
]);

export const proceedingSignersSeen = pgTable("proceeding_signers_seen", {
	proceedingId: uuid("proceeding_id").primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	seenAt: timestamp("seen_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "proceeding_signers_seen_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.proceedingId, table.orgId],
			foreignColumns: [proceedings.id, proceedings.orgId],
			name: "proceeding_signers_seen_proceeding_id_org_id_fkey"
		}).onDelete("cascade"),
]);

export const pscProviders = pgTable("psc_providers", {
	slug: text().primaryKey().notNull(),
	name: text().notNull(),
	baseUrl: text("base_url").notNull(),
	hashEncoding: text("hash_encoding").default('base64').notNull(),
	tokenBody: text("token_body").default('form').notNull(),
	maxHashes: integer("max_hashes").default(1).notNull(),
	active: boolean().default(true).notNull(),
	confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: 'string' }),
	source: text().notNull(),
	readOn: date("read_on").notNull(),
	updatedBy: uuid("updated_by"),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [profiles.id],
			name: "psc_providers_updated_by_fkey"
		}).onDelete("set null"),
	pgPolicy("psc_providers_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`true` }),
	check("psc_providers_slug_check", sql`slug ~ '^[a-z][a-z0-9]{1,23}$'::text`),
	check("psc_providers_name_check", sql`((char_length(btrim(name)) >= 2) AND (char_length(btrim(name)) <= 80)) AND (name !~ '[[:cntrl:]]'::text)`),
	check("psc_providers_url_check", sql`(char_length(base_url) <= 200) AND (base_url ~ '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?([.][a-z0-9]([a-z0-9-]*[a-z0-9])?)+(/[A-Za-z0-9._~-]+)*$'::text)`),
	check("psc_providers_hash_check", sql`hash_encoding = ANY (ARRAY['base64'::text, 'hex'::text])`),
	check("psc_providers_body_check", sql`token_body = ANY (ARRAY['form'::text, 'json'::text])`),
	check("psc_providers_max_check", sql`(max_hashes >= 1) AND (max_hashes <= 100)`),
	check("psc_providers_source_check", sql`((char_length(btrim(source)) >= 8) AND (char_length(btrim(source)) <= 400)) AND (source !~ '[[:cntrl:]]'::text)`),
]);

export const filingPackages = pgTable("filing_packages", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	caseId: uuid("case_id").notNull(),
	proceedingId: uuid("proceeding_id").notNull(),
	court: text().notNull(),
	system: text().notNull(),
	kind: text().notNull(),
	status: text().default('requested').notNull(),
	petitionDocumentId: uuid("petition_document_id").notNull(),
	documentIds: uuid("document_ids").array().default(sql`'{}'`).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	limitBytes: bigint("limit_bytes", { mode: "number" }),
	limitConfirmed: boolean("limit_confirmed").default(false).notNull(),
	problems: jsonb().default([]).notNull(),
	claimedAt: timestamp("claimed_at", { withTimezone: true, mode: 'string' }),
	attempts: integer().default(0).notNull(),
	retryAfter: timestamp("retry_after", { withTimezone: true, mode: 'string' }),
	error: text(),
	requestedBy: uuid("requested_by"),
	cancelledByPerson: boolean("cancelled_by_person").default(false).notNull(),
	requestedAt: timestamp("requested_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	builtAt: timestamp("built_at", { withTimezone: true, mode: 'string' }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	petitionLimitBytes: bigint("petition_limit_bytes", { mode: "number" }),
	signatureStatus: text("signature_status"),
	signatureClaim: integer("signature_claim").default(0).notNull(),
	signatureClaimedAt: timestamp("signature_claimed_at", { withTimezone: true, mode: 'string' }),
	signatureAttempts: integer("signature_attempts").default(0).notNull(),
	signatureRetryAfter: timestamp("signature_retry_after", { withTimezone: true, mode: 'string' }),
	signatureError: text("signature_error"),
	signerRequested: uuid("signer_requested"),
	signedBy: uuid("signed_by"),
	signedAt: timestamp("signed_at", { withTimezone: true, mode: 'string' }),
	signatureUse: uuid("signature_use"),
}, (table) => [
	index("filing_packages_case_idx").using("btree", table.caseId.asc().nullsLast().op("timestamptz_ops"), table.requestedAt.desc().nullsFirst().op("uuid_ops")),
	uniqueIndex("filing_packages_open_idx").using("btree", table.proceedingId.asc().nullsLast().op("uuid_ops")).where(sql`(status = ANY (ARRAY['requested'::text, 'ready'::text, 'failed'::text]))`),
	index("filing_packages_queue_idx").using("btree", table.orgId.asc().nullsLast().op("uuid_ops"), table.requestedAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(status = ANY (ARRAY['requested'::text, 'ready'::text, 'failed'::text]))`),
	index("filing_packages_signature_idx").using("btree", table.builtAt.asc().nullsLast().op("timestamptz_ops")).where(sql`((status = 'ready'::text) AND ((signature_status IS NULL) OR (signature_status = ANY (ARRAY['due'::text, 'waiting'::text]))))`),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "filing_packages_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.requestedBy],
			foreignColumns: [profiles.id],
			name: "filing_packages_requested_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.caseId],
			foreignColumns: [cases.id, cases.orgId],
			name: "filing_packages_case_id_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId, table.proceedingId],
			foreignColumns: [proceedings.id, proceedings.orgId],
			name: "filing_packages_proceeding_id_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId, table.petitionDocumentId],
			foreignColumns: [caseDocuments.id, caseDocuments.orgId],
			name: "filing_packages_petition_document_id_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.signatureUse],
			foreignColumns: [lawyerSignatureUses.id],
			name: "filing_packages_signature_use_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.signerRequested],
			foreignColumns: [profiles.id],
			name: "filing_packages_signer_requested_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.signedBy],
			foreignColumns: [profiles.id],
			name: "filing_packages_signed_by_fkey"
		}).onDelete("set null"),
	unique("filing_packages_id_org_id_key").on(table.id, table.orgId),
	pgPolicy("filing_packages_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("filing_packages_kind_check", sql`kind = ANY (ARRAY['juizado'::text, 'comum'::text])`),
	check("filing_packages_status_check", sql`status = ANY (ARRAY['requested'::text, 'ready'::text, 'failed'::text, 'filed'::text, 'cancelled'::text])`),
	check("filing_packages_system_check", sql`system = ANY (ARRAY['projudi'::text, 'eproc'::text, 'pje'::text, 'esaj'::text, 'outro'::text])`),
	check("filing_packages_error_check", sql`(error IS NULL) OR (error ~ '^[a-z][a-z0-9_]{1,59}$'::text)`),
	check("filing_packages_problems_check", sql`jsonb_typeof(problems) = 'array'::text`),
	check("filing_packages_signature_status_check", sql`(signature_status IS NULL) OR (signature_status = ANY (ARRAY['due'::text, 'waiting'::text, 'signed'::text, 'failed'::text]))`),
	check("filing_packages_signature_error_check", sql`(signature_error IS NULL) OR (signature_error ~ '^[a-z][a-z0-9_]{1,63}$'::text)`),
	check("filing_packages_signed_check", sql`(signature_status = 'signed'::text) = (signed_at IS NOT NULL)`),
]);

export const lawyerCpfs = pgTable("lawyer_cpfs", {
	userId: uuid("user_id").primaryKey().notNull(),
	cpf: text().notNull(),
	declaredAt: timestamp("declared_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	provenAt: timestamp("proven_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("lawyer_cpfs_cpf_idx").using("btree", table.cpf.asc().nullsLast().op("text_ops")),
	uniqueIndex("lawyer_cpfs_proven_idx").using("btree", table.cpf.asc().nullsLast().op("text_ops")).where(sql`(proven_at IS NOT NULL)`),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [profiles.id],
			name: "lawyer_cpfs_user_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("lawyer_cpfs_select_own", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(user_id = auth.uid())` }),
	check("lawyer_cpfs_cpf_check", sql`CHECK (cpf_is_valid(cpf`),
]);

export const filingPackageItems = pgTable("filing_package_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	packageId: uuid("package_id").notNull(),
	position: integer().notNull(),
	name: text().notNull(),
	fileId: uuid("file_id").notNull(),
	documentId: uuid("document_id"),
	part: integer().default(1).notNull(),
	parts: integer().default(1).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	bytes: bigint({ mode: "number" }).notNull(),
	pages: integer(),
	signedFileId: uuid("signed_file_id"),
}, (table) => [
	index("filing_package_items_file_idx").using("btree", table.fileId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("filing_package_items_signed_file_idx").using("btree", table.signedFileId.asc().nullsLast().op("uuid_ops")).where(sql`(signed_file_id IS NOT NULL)`),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "filing_package_items_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId, table.packageId],
			foreignColumns: [filingPackages.id, filingPackages.orgId],
			name: "filing_package_items_package_id_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId, table.fileId],
			foreignColumns: [files.id, files.orgId],
			name: "filing_package_items_file_id_org_id_fkey"
		}),
	foreignKey({
			columns: [table.orgId, table.documentId],
			foreignColumns: [caseDocuments.id, caseDocuments.orgId],
			name: "filing_package_items_document_id_org_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.signedFileId],
			foreignColumns: [files.id, files.orgId],
			name: "filing_package_items_signed_file_fkey"
		}),
	unique("filing_package_items_package_id_position_key").on(table.packageId, table.position),
	unique("filing_package_items_package_id_name_key").on(table.packageId, table.name),
	pgPolicy("filing_package_items_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("filing_package_items_position_check", sql`("position" > 0) AND ((part >= 1) AND (part <= parts))`),
	check("filing_package_items_name_check", sql`name ~ '^[a-z0-9][a-z0-9-]{0,118}\.pdf$'::text`),
	check("filing_package_items_bytes_check", sql`bytes > 0`),
]);

export const lawyerSignatureUses = pgTable("lawyer_signature_uses", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	personId: uuid("person_id"),
	connectionId: uuid("connection_id"),
	psc: text().notNull(),
	purpose: text().notNull(),
	subjectId: uuid("subject_id"),
	sealId: uuid("seal_id").notNull(),
	claim: integer(),
	caseId: uuid("case_id"),
	documentHashes: text("document_hashes").array().notNull(),
	status: text().default('opened').notNull(),
	errorCode: text("error_code"),
	signedCount: integer("signed_count"),
	openedAt: timestamp("opened_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	finishedAt: timestamp("finished_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("lawyer_signature_uses_case_idx").using("btree", table.caseId.asc().nullsLast().op("uuid_ops")).where(sql`(case_id IS NOT NULL)`),
	index("lawyer_signature_uses_connection_idx").using("btree", table.connectionId.asc().nullsLast().op("uuid_ops")).where(sql`(connection_id IS NOT NULL)`),
	index("lawyer_signature_uses_person_idx").using("btree", table.orgId.asc().nullsLast().op("uuid_ops"), table.personId.asc().nullsLast().op("uuid_ops"), table.openedAt.desc().nullsFirst().op("uuid_ops")),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "lawyer_signature_uses_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.personId],
			foreignColumns: [profiles.id],
			name: "lawyer_signature_uses_person_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.connectionId],
			foreignColumns: [connections.id],
			name: "lawyer_signature_uses_connection_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.caseId],
			foreignColumns: [cases.id],
			name: "lawyer_signature_uses_case_id_fkey"
		}).onDelete("set null"),
	pgPolicy("lawyer_signature_uses_select", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(is_org_member(org_id) AND ((person_id = auth.uid()) OR has_firm_function(org_id, ARRAY['socio'::firm_function]) OR has_org_role(org_id, ARRAY['owner'::org_role, 'admin'::org_role])))` }),
	check("lawyer_signature_uses_psc_check", sql`psc ~ '^[a-z][a-z0-9]{1,23}$'::text`),
	check("lawyer_signature_uses_purpose_check", sql`purpose = ANY (ARRAY['authorization.check'::text, 'filing.package'::text])`),
	check("lawyer_signature_uses_hashes_check", sql`((cardinality(document_hashes) >= 1) AND (cardinality(document_hashes) <= 200)) AND (array_position(document_hashes, NULL::text) IS NULL) AND (array_to_string(document_hashes, ','::text) ~ '^[0-9a-f]{64}(,[0-9a-f]{64})*$'::text)`),
	check("lawyer_signature_uses_status_check", sql`status = ANY (ARRAY['opened'::text, 'signed'::text, 'failed'::text])`),
	check("lawyer_signature_uses_claim_check", sql`(purpose = 'filing.package'::text) = (claim IS NOT NULL)`),
	check("lawyer_signature_uses_error_check", sql`(error_code IS NULL) OR (error_code ~ '^[a-z][a-z0-9_]{1,63}$'::text)`),
	check("lawyer_signature_uses_outcome_check", sql`((status = 'opened'::text) = (finished_at IS NULL)) AND ((status = 'failed'::text) = (error_code IS NOT NULL)) AND ((signed_count IS NULL) OR ((signed_count >= 0) AND (signed_count <= cardinality(document_hashes))))`),
]);

export const testChats = pgTable("test_chats", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	numberId: uuid("number_id").notNull(),
	token: text().notNull(),
	status: text().default('active').notNull(),
	startedBy: uuid("started_by"),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	endedAt: timestamp("ended_at", { withTimezone: true, mode: 'string' }),
	endedReason: text("ended_reason"),
}, (table) => [
	uniqueIndex("test_chats_active_idx").using("btree", table.orgId.asc().nullsLast().op("uuid_ops")).where(sql`(status = 'active'::text)`),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "test_chats_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.startedBy],
			foreignColumns: [profiles.id],
			name: "test_chats_started_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.numberId],
			foreignColumns: [waNumbers.id, waNumbers.orgId],
			name: "test_chats_number_id_org_id_fkey"
		}).onDelete("cascade"),
	unique("test_chats_id_org_id_key").on(table.id, table.orgId),
	unique("test_chats_token_key").on(table.token),
	pgPolicy("test_chats_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("test_chats_token_check", sql`token ~ '^[A-Za-z0-9_-]{32,64}$'::text`),
	check("test_chats_status_check", sql`status = ANY (ARRAY['active'::text, 'ended'::text])`),
	check("test_chats_ended_check", sql`(status = 'ended'::text) = (ended_at IS NOT NULL)`),
	check("test_chats_reason_check", sql`(ended_reason IS NULL) OR (ended_reason = ANY (ARRAY['turned_off'::text, 'replaced_by_real_number'::text]))`),
]);

export const trackedLegs = pgTable("tracked_legs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	tripId: uuid("trip_id").notNull(),
	position: integer().notNull(),
	flightNumber: text("flight_number").notNull(),
	originIata: text("origin_iata").notNull(),
	destinationIata: text("destination_iata").notNull(),
	scheduledDepartureLocal: timestamp("scheduled_departure_local", { mode: 'string' }).notNull(),
	scheduledArrivalLocal: timestamp("scheduled_arrival_local", { mode: 'string' }).notNull(),
	status: text().default('scheduled').notNull(),
	estimatedArrivalLocal: timestamp("estimated_arrival_local", { mode: 'string' }),
	statusSource: text("status_source"),
	statusAt: timestamp("status_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("tracked_legs_trip_idx").using("btree", table.tripId.asc().nullsLast().op("int4_ops"), table.position.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "tracked_legs_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId, table.tripId],
			foreignColumns: [trackedTrips.id, trackedTrips.orgId],
			name: "tracked_legs_trip_id_org_id_fkey"
		}).onDelete("cascade"),
	unique("tracked_legs_id_org_id_key").on(table.id, table.orgId),
	unique("tracked_legs_trip_id_position_key").on(table.tripId, table.position),
	pgPolicy("tracked_legs_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(is_org_member(org_id) AND (EXISTS ( SELECT 1
   FROM tracked_trips t
  WHERE ((t.id = tracked_legs.trip_id) AND ((t.consent_channel <> 'agency'::text) OR (t.status = 'case_opened'::text))))))` }),
	check("tracked_legs_position_check", sql`("position" >= 1) AND ("position" <= 6)`),
	check("tracked_legs_flight_check", sql`flight_number ~ '^[A-Z0-9]{2}[0-9]{1,4}[A-Z]?$'::text`),
	check("tracked_legs_airports_check", sql`(origin_iata ~ '^[A-Z]{3}$'::text) AND (destination_iata ~ '^[A-Z]{3}$'::text) AND (origin_iata <> destination_iata)`),
	check("tracked_legs_status_check", sql`status = ANY (ARRAY['scheduled'::text, 'delayed'::text, 'cancelled'::text, 'changed'::text, 'landed'::text])`),
	check("tracked_legs_source_check", sql`(status_source IS NULL) OR (status_source = ANY (ARRAY['simulated'::text, 'flightaware'::text]))`),
	check("tracked_legs_estimate_check", sql`(status <> 'delayed'::text) OR (estimated_arrival_local IS NOT NULL)`),
]);

export const trackedTrips = pgTable("tracked_trips", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	passengerName: text("passenger_name").notNull(),
	phone: text().notNull(),
	companions: jsonb().default([]).notNull(),
	airlineIata: text("airline_iata").notNull(),
	isTest: boolean("is_test").default(false).notNull(),
	label: text(),
	consentWording: text("consent_wording").notNull(),
	consentAt: timestamp("consent_at", { withTimezone: true, mode: 'string' }).notNull(),
	consentChannel: text("consent_channel").notNull(),
	status: text().default('watching').notNull(),
	caseId: uuid("case_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	watch: text().default('flightaware').notNull(),
	watchedAt: timestamp("watched_at", { withTimezone: true, mode: 'string' }),
	watchClaims: integer("watch_claims").default(0).notNull(),
	watchClaimedAt: timestamp("watch_claimed_at", { withTimezone: true, mode: 'string' }),
	watchError: text("watch_error"),
	watchDay: date("watch_day"),
	watchReads: integer("watch_reads").default(0).notNull(),
	paxTripId: uuid("pax_trip_id"),
}, (table) => [
	index("tracked_trips_phone_idx").using("btree", table.orgId.asc().nullsLast().op("text_ops"), table.phone.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("tracked_trips_test_label_idx").using("btree", table.orgId.asc().nullsLast().op("uuid_ops"), table.label.asc().nullsLast().op("uuid_ops")).where(sql`is_test`),
	index("tracked_trips_watch_idx").using("btree", table.watchedAt.asc().nullsFirst().op("timestamptz_ops")).where(sql`((watch = 'flightaware'::text) AND (status = ANY (ARRAY['watching'::text, 'alerted'::text])))`),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "tracked_trips_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId, table.caseId],
			foreignColumns: [cases.id, cases.orgId],
			name: "tracked_trips_case_id_org_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.paxTripId],
			foreignColumns: [paxTrips.id],
			name: "tracked_trips_pax_trip_id_fkey"
		}).onDelete("set null"),
	unique("tracked_trips_id_org_id_key").on(table.id, table.orgId),
	unique("tracked_trips_pax_trip_id_key").on(table.paxTripId),
	pgPolicy("tracked_trips_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(is_org_member(org_id) AND ((consent_channel <> 'agency'::text) OR (status = 'case_opened'::text)))` }),
	check("tracked_trips_test_check", sql`is_test = (label IS NOT NULL)`),
	check("tracked_trips_name_check", sql`(char_length(btrim(passenger_name)) >= 2) AND (char_length(btrim(passenger_name)) <= 200)`),
	check("tracked_trips_phone_check", sql`phone ~ '^[0-9]{12,15}$'::text`),
	check("tracked_trips_airline_check", sql`airline_iata ~ '^[A-Z0-9]{2}$'::text`),
	check("tracked_trips_companions_check", sql`(jsonb_typeof(companions) = 'array'::text) AND (jsonb_array_length(companions) <= 9)`),
	check("tracked_trips_label_check", sql`(label IS NULL) OR (label ~ '^[a-z][a-z_]{2,40}$'::text)`),
	check("tracked_trips_status_check", sql`status = ANY (ARRAY['watching'::text, 'alerted'::text, 'case_opened'::text, 'declined'::text, 'stopped'::text])`),
	check("tracked_trips_watch_check", sql`watch = ANY (ARRAY['simulated'::text, 'flightaware'::text])`),
	check("tracked_trips_watch_real_check", sql`is_test OR (watch = 'flightaware'::text)`),
	check("tracked_trips_watch_error_check", sql`(watch_error IS NULL) OR (watch_error ~ '^[a-z][a-z0-9_]{1,59}$'::text)`),
	check("tracked_trips_watch_reads_check", sql`watch_reads >= 0`),
	check("tracked_trips_consent_check", sql`((char_length(consent_wording) >= 20) AND (char_length(consent_wording) <= 4000)) AND (consent_channel = ANY (ARRAY['test'::text, 'page'::text, 'whatsapp'::text, 'firm'::text, 'agency'::text]))`),
	check("tracked_trips_agency_check", sql`(pax_trip_id IS NULL) OR (consent_channel = 'agency'::text)`),
]);

export const flightAlerts = pgTable("flight_alerts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	tripId: uuid("trip_id").notNull(),
	kind: text().notNull(),
	legPosition: integer("leg_position"),
	delayMinutes: integer("delay_minutes"),
	ruleVersion: text("rule_version").notNull(),
	status: text().default('due').notNull(),
	reason: text(),
	claims: integer().default(0).notNull(),
	claimedAt: timestamp("claimed_at", { withTimezone: true, mode: 'string' }),
	messageId: uuid("message_id"),
	sentAt: timestamp("sent_at", { withTimezone: true, mode: 'string' }),
	answer: text(),
	answeredAt: timestamp("answered_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("flight_alerts_due_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(status = 'due'::text)`),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "flight_alerts_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.messageId],
			foreignColumns: [waMessages.id],
			name: "flight_alerts_message_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.tripId],
			foreignColumns: [trackedTrips.id, trackedTrips.orgId],
			name: "flight_alerts_trip_id_org_id_fkey"
		}).onDelete("cascade"),
	unique("flight_alerts_id_org_id_key").on(table.id, table.orgId),
	unique("flight_alerts_trip_id_kind_key").on(table.tripId, table.kind),
	pgPolicy("flight_alerts_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(is_org_member(org_id) AND (EXISTS ( SELECT 1
   FROM tracked_trips t
  WHERE ((t.id = flight_alerts.trip_id) AND ((t.consent_channel <> 'agency'::text) OR (t.status = 'case_opened'::text))))))` }),
	check("flight_alerts_reason_check", sql`(status = 'skipped'::text) = (reason IS NOT NULL)`),
	check("flight_alerts_kind_check", sql`kind = ANY (ARRAY['cancelled'::text, 'changed'::text, 'delayed'::text])`),
	check("flight_alerts_status_check", sql`status = ANY (ARRAY['due'::text, 'sent'::text, 'skipped'::text])`),
	check("flight_alerts_sent_check", sql`(status = 'sent'::text) = ((message_id IS NOT NULL) OR (sent_at IS NOT NULL))`),
	check("flight_alerts_reason_shape_check", sql`(reason IS NULL) OR (reason ~ '^[a-z][a-z_]{2,40}$'::text)`),
	check("flight_alerts_delay_check", sql`(delay_minutes IS NULL) OR ((delay_minutes >= 0) AND (delay_minutes <= 20160))`),
	check("flight_alerts_answer_check", sql`(answer IS NULL) OR (answer = ANY (ARRAY['yes'::text, 'no'::text, 'stop'::text]))`),
	check("flight_alerts_rule_check", sql`rule_version ~ '^[a-z][a-z0-9-]{2,40}$'::text`),
]);

export const waConversationEvents = pgTable("wa_conversation_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	conversationId: uuid("conversation_id").notNull(),
	kind: text().notNull(),
	data: jsonb().default({}).notNull(),
	actorType: text("actor_type").notNull(),
	actorId: uuid("actor_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("wa_conversation_events_conversation_idx").using("btree", table.conversationId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "wa_conversation_events_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.actorId],
			foreignColumns: [profiles.id],
			name: "wa_conversation_events_actor_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.conversationId],
			foreignColumns: [waConversations.id, waConversations.orgId],
			name: "wa_conversation_events_conversation_id_org_id_fkey"
		}).onDelete("cascade"),
	unique("wa_conversation_events_id_org_id_key").on(table.id, table.orgId),
	pgPolicy("wa_conversation_events_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("wa_conversation_events_actor_check", sql`actor_type = ANY (ARRAY['system'::text, 'person'::text])`),
	check("wa_conversation_events_kind_check", sql`kind = ANY (ARRAY['case_opened'::text, 'link_sent'::text, 'person_called'::text, 'taken_over'::text, 'returned_to_one'::text, 'declined'::text, 'stopped'::text, 'document_joined'::text, 'statement_joined'::text])`),
]);

export const casePapers = pgTable("case_papers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	caseId: uuid("case_id").notNull(),
	personId: uuid("person_id").notNull(),
	kind: text().notNull(),
	templateId: uuid("template_id"),
	documentId: uuid("document_id").notNull(),
	envelopeId: uuid("envelope_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("case_papers_envelope_idx").using("btree", table.envelopeId.asc().nullsLast().op("uuid_ops")).where(sql`(envelope_id IS NOT NULL)`),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "case_papers_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.templateId],
			foreignColumns: [draftTemplates.id],
			name: "case_papers_template_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.caseId],
			foreignColumns: [cases.id, cases.orgId],
			name: "case_papers_case_id_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId, table.personId],
			foreignColumns: [people.id, people.orgId],
			name: "case_papers_person_id_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId, table.documentId],
			foreignColumns: [caseDocuments.id, caseDocuments.orgId],
			name: "case_papers_document_id_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId, table.envelopeId],
			foreignColumns: [signatureEnvelopes.id, signatureEnvelopes.orgId],
			name: "case_papers_envelope_id_org_id_fkey"
		}).onDelete("set null"),
	unique("case_papers_case_id_person_id_kind_key").on(table.caseId, table.personId, table.kind),
	pgPolicy("case_papers_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("case_papers_kind_check", sql`kind = ANY (ARRAY['procuracao'::text, 'contrato'::text])`),
]);

export const productModules = pgTable("product_modules", {
	key: text().primaryKey().notNull(),
	name: text().notNull(),
	isDefault: boolean("is_default").default(false).notNull(),
	retiredAt: timestamp("retired_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	pgPolicy("product_modules_select_all", { as: "permissive", for: "select", to: ["authenticated"], using: sql`true` }),
	check("product_modules_key_check", sql`key ~ '^[a-z][a-z0-9-]{2,40}$'::text`),
	check("product_modules_name_check", sql`((char_length(btrim(name)) >= 2) AND (char_length(btrim(name)) <= 80)) AND (name !~ '[[:cntrl:]]'::text)`),
]);

export const templateImports = pgTable("template_imports", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	requestedBy: uuid("requested_by"),
	fileId: uuid("file_id"),
	fileName: text("file_name").notNull(),
	source: text().notNull(),
	status: text().default('reading').notNull(),
	paragraphs: jsonb(),
	proposal: jsonb(),
	runId: uuid("run_id"),
	failure: text(),
	claims: integer().default(0).notNull(),
	claimedAt: timestamp("claimed_at", { withTimezone: true, mode: 'string' }),
	attempts: integer().default(0).notNull(),
	runRound: integer("run_round").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	readyAt: timestamp("ready_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("template_imports_due_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(status = ANY (ARRAY['reading'::text, 'marking'::text]))`),
	index("template_imports_file_idx").using("btree", table.fileId.asc().nullsLast().op("uuid_ops")).where(sql`(file_id IS NOT NULL)`),
	index("template_imports_org_idx").using("btree", table.orgId.asc().nullsLast().op("uuid_ops"), table.createdAt.desc().nullsFirst().op("uuid_ops")),
	foreignKey({
			columns: [table.orgId, table.fileId],
			foreignColumns: [files.id, files.orgId],
			name: "template_imports_file_id_org_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "template_imports_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.requestedBy],
			foreignColumns: [profiles.id],
			name: "template_imports_requested_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.runId],
			foreignColumns: [aiRuns.id],
			name: "template_imports_run_id_fkey"
		}).onDelete("set null"),
	unique("template_imports_id_org_id_key").on(table.id, table.orgId),
	pgPolicy("template_imports_select_writer", { as: "permissive", for: "select", to: ["authenticated"], using: sql`has_firm_function(org_id, ARRAY['socio'::firm_function, 'advogado'::firm_function])` }),
	check("template_imports_source_check", sql`source = ANY (ARRAY['docx'::text, 'pdf'::text])`),
	check("template_imports_status_check", sql`status = ANY (ARRAY['reading'::text, 'marking'::text, 'ready'::text, 'failed'::text])`),
	check("template_imports_name_check", sql`(char_length(btrim(file_name)) >= 1) AND (char_length(btrim(file_name)) <= 200)`),
	check("template_imports_read_check", sql`(status = ANY (ARRAY['marking'::text, 'ready'::text])) = (paragraphs IS NOT NULL)`),
	check("template_imports_ready_check", sql`(status = 'ready'::text) = ((proposal IS NOT NULL) AND (ready_at IS NOT NULL))`),
	check("template_imports_failed_check", sql`(status = 'failed'::text) = (failure IS NOT NULL)`),
]);

export const partnerInvitations = pgTable("partner_invitations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id"),
	moduleKey: text("module_key"),
	partnerName: text("partner_name"),
	partnerId: uuid("partner_id"),
	// TODO: failed to parse database type 'citext'
	email: citext("email").notNull(),
	role: text().notNull(),
	tokenHash: text("token_hash").notNull(),
	invitedBy: uuid("invited_by"),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: 'string' }),
	acceptedBy: uuid("accepted_by"),
	revokedAt: timestamp("revoked_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("partner_invitations_email_idx").using("btree", table.email.asc().nullsLast().op("citext_ops")).where(sql`((accepted_at IS NULL) AND (revoked_at IS NULL))`),
	uniqueIndex("partner_invitations_one_open_firm_idx").using("btree", table.orgId.asc().nullsLast().op("citext_ops"), table.email.asc().nullsLast().op("citext_ops")).where(sql`((org_id IS NOT NULL) AND (accepted_at IS NULL) AND (revoked_at IS NULL))`),
	uniqueIndex("partner_invitations_one_open_team_idx").using("btree", table.partnerId.asc().nullsLast().op("uuid_ops"), table.email.asc().nullsLast().op("uuid_ops")).where(sql`((partner_id IS NOT NULL) AND (accepted_at IS NULL) AND (revoked_at IS NULL))`),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "partner_invitations_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.moduleKey],
			foreignColumns: [productModules.key],
			name: "partner_invitations_module_key_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.partnerId],
			foreignColumns: [partners.id],
			name: "partner_invitations_partner_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.invitedBy],
			foreignColumns: [profiles.id],
			name: "partner_invitations_invited_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.acceptedBy],
			foreignColumns: [profiles.id],
			name: "partner_invitations_accepted_by_fkey"
		}).onDelete("set null"),
	unique("partner_invitations_token_hash_key").on(table.tokenHash),
	pgPolicy("partner_invitations_select_manager", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(((org_id IS NOT NULL) AND has_org_role(org_id, ARRAY['owner'::org_role, 'admin'::org_role])) OR ((partner_id IS NOT NULL) AND has_partner_role(partner_id, ARRAY['owner'::text, 'admin'::text])) OR is_superadmin())` }),
	check("partner_invitations_kind_check", sql`((org_id IS NOT NULL) AND (module_key IS NOT NULL) AND (partner_name IS NOT NULL) AND (partner_id IS NULL) AND (role = 'owner'::text)) OR ((org_id IS NULL) AND (module_key IS NULL) AND (partner_name IS NULL) AND (partner_id IS NOT NULL) AND (role = ANY (ARRAY['admin'::text, 'member'::text])))`),
	check("partner_invitations_name_check", sql`(partner_name IS NULL) OR (((char_length(btrim(partner_name)) >= 2) AND (char_length(btrim(partner_name)) <= 120)) AND (partner_name !~ '[[:cntrl:]]'::text))`),
	check("partner_invitations_email_check", sql`((email)::text ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'::text) AND (char_length((email)::text) <= 254)`),
	check("partner_invitations_token_hash_check", sql`token_hash ~ '^[0-9a-f]{64}$'::text`),
	check("partner_invitations_one_end", sql`(accepted_at IS NULL) OR (revoked_at IS NULL)`),
]);

export const partners = pgTable("partners", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	kind: text().default('agency').notNull(),
	name: text().notNull(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [profiles.id],
			name: "partners_created_by_fkey"
		}).onDelete("set null"),
	pgPolicy("partners_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(is_partner_member(id) OR is_superadmin())` }),
	check("partners_kind_check", sql`kind = 'agency'::text`),
	check("partners_name_check", sql`((char_length(btrim(name)) >= 2) AND (char_length(btrim(name)) <= 120)) AND (name !~ '[[:cntrl:]]'::text)`),
]);

export const partnerLinks = pgTable("partner_links", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	partnerId: uuid("partner_id").notNull(),
	orgId: uuid("org_id").notNull(),
	moduleKey: text("module_key").notNull(),
	status: text().default('active').notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	startedBy: uuid("started_by"),
	endedAt: timestamp("ended_at", { withTimezone: true, mode: 'string' }),
	endedBy: uuid("ended_by"),
	endReason: text("end_reason"),
}, (table) => [
	uniqueIndex("partner_links_one_active_idx").using("btree", table.partnerId.asc().nullsLast().op("text_ops"), table.moduleKey.asc().nullsLast().op("uuid_ops")).where(sql`(status = 'active'::text)`),
	index("partner_links_org_idx").using("btree", table.orgId.asc().nullsLast().op("text_ops"), table.status.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.partnerId],
			foreignColumns: [partners.id],
			name: "partner_links_partner_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "partner_links_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.moduleKey],
			foreignColumns: [productModules.key],
			name: "partner_links_module_key_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.startedBy],
			foreignColumns: [profiles.id],
			name: "partner_links_started_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.endedBy],
			foreignColumns: [profiles.id],
			name: "partner_links_ended_by_fkey"
		}).onDelete("set null"),
	unique("partner_links_id_org_id_key").on(table.id, table.orgId),
	pgPolicy("partner_links_select_party", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(is_partner_member(partner_id) OR is_org_member(org_id) OR is_superadmin())` }),
	check("partner_links_status_check", sql`status = ANY (ARRAY['active'::text, 'ended'::text])`),
	check("partner_links_ended_check", sql`(status = 'ended'::text) = (ended_at IS NOT NULL)`),
	check("partner_links_reason_check", sql`(end_reason IS NULL) OR ((char_length(end_reason) <= 500) AND (end_reason !~ '[[:cntrl:]]'::text))`),
]);

export const paxFileRemovals = pgTable("pax_file_removals", {
	storagePath: text("storage_path").primaryKey().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	check("pax_file_removals_path_check", sql`storage_path ~ '^org/[0-9a-f-]{36}/[a-z_]+/[0-9a-f-]{36}$'::text`),
]);

export const paxConfirmLinks = pgTable("pax_confirm_links", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	partnerId: uuid("partner_id").notNull(),
	partnershipId: uuid("partnership_id").notNull(),
	orgId: uuid("org_id").notNull(),
	holderId: uuid("holder_id").notNull(),
	tokenHash: text("token_hash").notNull(),
	uploads: integer().default(0).notNull(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	endedAt: timestamp("ended_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	uniqueIndex("pax_confirm_links_one_open_idx").using("btree", table.holderId.asc().nullsLast().op("uuid_ops")).where(sql`(ended_at IS NULL)`),
	foreignKey({
			columns: [table.partnerId],
			foreignColumns: [partners.id],
			name: "pax_confirm_links_partner_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.partnershipId],
			foreignColumns: [partnerLinks.id],
			name: "pax_confirm_links_partnership_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "pax_confirm_links_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.holderId],
			foreignColumns: [paxTravelers.id],
			name: "pax_confirm_links_holder_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [profiles.id],
			name: "pax_confirm_links_created_by_fkey"
		}).onDelete("set null"),
	unique("pax_confirm_links_id_org_id_key").on(table.id, table.orgId),
	unique("pax_confirm_links_token_hash_key").on(table.tokenHash),
	check("pax_confirm_links_token_check", sql`token_hash ~ '^[0-9a-f]{64}$'::text`),
	check("pax_confirm_links_uploads_check", sql`uploads >= 0`),
]);

export const paxConsentTerms = pgTable("pax_consent_terms", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	partnerId: uuid("partner_id").notNull(),
	version: integer().notNull(),
	body: text().notNull(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.partnerId],
			foreignColumns: [partners.id],
			name: "pax_consent_terms_partner_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [profiles.id],
			name: "pax_consent_terms_created_by_fkey"
		}).onDelete("set null"),
	unique("pax_consent_terms_partner_id_version_key").on(table.partnerId, table.version),
	pgPolicy("pax_consent_terms_select_partner", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_partner_member(partner_id)` }),
	check("pax_consent_terms_version_check", sql`version > 0`),
	check("pax_consent_terms_body_check", sql`((char_length(btrim(body)) >= 40) AND (char_length(btrim(body)) <= 1200)) AND (body !~ '[\x01-\x09\x0b-\x1f\x7f]'::text)`),
]);

export const paxTravelers = pgTable("pax_travelers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	partnerId: uuid("partner_id").notNull(),
	partnershipId: uuid("partnership_id").notNull(),
	orgId: uuid("org_id").notNull(),
	fullName: text("full_name").notNull(),
	cpf: text(),
	birthDate: date("birth_date"),
	phone: text(),
	email: text(),
	nationality: text(),
	postalCode: text("postal_code"),
	street: text(),
	addressNumber: text("address_number"),
	complement: text(),
	district: text(),
	city: text(),
	uf: text(),
	guardianId: uuid("guardian_id"),
	readFields: jsonb("read_fields").default({}).notNull(),
	updatedVia: text("updated_via").default('partner').notNull(),
	caseId: uuid("case_id"),
	handedOverAt: timestamp("handed_over_at", { withTimezone: true, mode: 'string' }),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("pax_travelers_cpf_idx").using("btree", table.partnershipId.asc().nullsLast().op("uuid_ops"), table.cpf.asc().nullsLast().op("uuid_ops")).where(sql`(cpf IS NOT NULL)`),
	index("pax_travelers_guardian_idx").using("btree", table.guardianId.asc().nullsLast().op("uuid_ops")).where(sql`(guardian_id IS NOT NULL)`),
	index("pax_travelers_partnership_idx").using("btree", table.partnershipId.asc().nullsLast().op("uuid_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.partnerId],
			foreignColumns: [partners.id],
			name: "pax_travelers_partner_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.partnershipId],
			foreignColumns: [partnerLinks.id],
			name: "pax_travelers_partnership_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "pax_travelers_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.guardianId],
			foreignColumns: [table.id],
			name: "pax_travelers_guardian_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [profiles.id],
			name: "pax_travelers_created_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.caseId],
			foreignColumns: [cases.id, cases.orgId],
			name: "pax_travelers_case_id_org_id_fkey"
		}).onDelete("set null"),
	unique("pax_travelers_id_org_id_key").on(table.id, table.orgId),
	pgPolicy("pax_travelers_select_partner", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_partner_member(partner_id)` }),
	check("pax_travelers_name_check", sql`((char_length(full_name) >= 3) AND (char_length(full_name) <= 200)) AND (full_name !~ '[[:cntrl:]]'::text) AND (full_name ~ '[[:alpha:]]'::text)`),
	check("pax_travelers_cpf_check", sql`(cpf IS NULL) OR ((cpf ~ '^[0-9]{11}$'::text) AND cpf_is_valid(cpf))`),
	check("pax_travelers_birth_check", sql`(birth_date IS NULL) OR ((birth_date >= '1900-01-01'::date) AND (birth_date <= '2100-01-01'::date))`),
	check("pax_travelers_phone_check", sql`(phone IS NULL) OR (phone ~ '^[0-9]{12,15}$'::text)`),
	check("pax_travelers_email_check", sql`(email IS NULL) OR ((char_length(email) <= 254) AND (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'::text))`),
	check("pax_travelers_postal_check", sql`(postal_code IS NULL) OR (postal_code ~ '^[0-9]{8}$'::text)`),
	check("pax_travelers_uf_check", sql`(uf IS NULL) OR (uf ~ '^[A-Z]{2}$'::text)`),
	check("pax_travelers_text_check", sql`(COALESCE(char_length(nationality), 0) <= 60) AND (COALESCE(char_length(street), 0) <= 200) AND (COALESCE(char_length(address_number), 0) <= 20) AND (COALESCE(char_length(complement), 0) <= 120) AND (COALESCE(char_length(district), 0) <= 120) AND (COALESCE(char_length(city), 0) <= 120)`),
	check("pax_travelers_read_check", sql`(jsonb_typeof(read_fields) = 'object'::text) AND (octet_length((read_fields)::text) <= 4000)`),
	check("pax_travelers_via_check", sql`updated_via = ANY (ARRAY['partner'::text, 'document'::text, 'passenger'::text])`),
	check("pax_travelers_guardian_check", sql`(guardian_id IS NULL) OR (guardian_id <> id)`),
]);

export const paxTrips = pgTable("pax_trips", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	partnerId: uuid("partner_id").notNull(),
	partnershipId: uuid("partnership_id").notNull(),
	orgId: uuid("org_id").notNull(),
	holderId: uuid("holder_id").notNull(),
	locator: text(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("pax_trips_holder_idx").using("btree", table.holderId.asc().nullsLast().op("uuid_ops")),
	index("pax_trips_partnership_idx").using("btree", table.partnershipId.asc().nullsLast().op("uuid_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.partnerId],
			foreignColumns: [partners.id],
			name: "pax_trips_partner_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.partnershipId],
			foreignColumns: [partnerLinks.id],
			name: "pax_trips_partnership_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "pax_trips_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.holderId],
			foreignColumns: [paxTravelers.id],
			name: "pax_trips_holder_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [profiles.id],
			name: "pax_trips_created_by_fkey"
		}).onDelete("set null"),
	unique("pax_trips_id_org_id_key").on(table.id, table.orgId),
	pgPolicy("pax_trips_select_partner", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_partner_member(partner_id)` }),
	check("pax_trips_locator_check", sql`(locator IS NULL) OR (locator ~ '^[A-Z0-9]{5,8}$'::text)`),
]);

export const paxDocuments = pgTable("pax_documents", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	partnerId: uuid("partner_id").notNull(),
	orgId: uuid("org_id").notNull(),
	travelerId: uuid("traveler_id").notNull(),
	tripId: uuid("trip_id"),
	kind: text().notNull(),
	fileId: uuid("file_id").notNull(),
	source: text().notNull(),
	reading: text().default('uploading').notNull(),
	readingClaims: integer("reading_claims").default(0).notNull(),
	readingClaimedAt: timestamp("reading_claimed_at", { withTimezone: true, mode: 'string' }),
	readingAttempts: integer("reading_attempts").default(0).notNull(),
	readingError: text("reading_error"),
	readOutput: jsonb("read_output"),
	readRunId: uuid("read_run_id"),
	readAt: timestamp("read_at", { withTimezone: true, mode: 'string' }),
	caseDocumentId: uuid("case_document_id"),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("pax_documents_reading_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(reading = 'pending'::text)`),
	index("pax_documents_traveler_idx").using("btree", table.travelerId.asc().nullsLast().op("uuid_ops"), table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.partnerId],
			foreignColumns: [partners.id],
			name: "pax_documents_partner_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "pax_documents_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.travelerId],
			foreignColumns: [paxTravelers.id],
			name: "pax_documents_traveler_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.tripId],
			foreignColumns: [paxTrips.id],
			name: "pax_documents_trip_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.readRunId],
			foreignColumns: [aiRuns.id],
			name: "pax_documents_read_run_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [profiles.id],
			name: "pax_documents_created_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.fileId],
			foreignColumns: [files.id, files.orgId],
			name: "pax_documents_file_id_org_id_fkey"
		}).onDelete("cascade"),
	unique("pax_documents_id_org_id_key").on(table.id, table.orgId),
	unique("pax_documents_file_id_key").on(table.fileId),
	pgPolicy("pax_documents_select_partner", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_partner_member(partner_id)` }),
	check("pax_documents_kind_check", sql`kind = ANY (ARRAY['identity'::text, 'address_proof'::text, 'ticket'::text, 'boarding_pass'::text])`),
	check("pax_documents_source_check", sql`source = ANY (ARRAY['partner'::text, 'passenger'::text])`),
	check("pax_documents_reading_check", sql`reading = ANY (ARRAY['uploading'::text, 'pending'::text, 'working'::text, 'done'::text, 'failed'::text])`),
	check("pax_documents_error_check", sql`(reading_error IS NULL) OR (reading_error ~ '^[a-z][a-z0-9_]{1,59}$'::text)`),
	check("pax_documents_output_check", sql`(read_output IS NULL) OR (jsonb_typeof(read_output) = 'object'::text)`),
]);

export const paxConsents = pgTable("pax_consents", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	partnerId: uuid("partner_id").notNull(),
	orgId: uuid("org_id").notNull(),
	travelerId: uuid("traveler_id").notNull(),
	givenBy: uuid("given_by"),
	termId: uuid("term_id"),
	wording: text().notNull(),
	answer: text().notNull(),
	channel: text().default('link').notNull(),
	confirmLinkId: uuid("confirm_link_id"),
	evidence: jsonb().default({}).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
}, (table) => [
	index("pax_consents_traveler_idx").using("btree", table.travelerId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.givenBy],
			foreignColumns: [paxTravelers.id],
			name: "pax_consents_given_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "pax_consents_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.travelerId],
			foreignColumns: [paxTravelers.id],
			name: "pax_consents_traveler_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.partnerId],
			foreignColumns: [partners.id],
			name: "pax_consents_partner_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.termId],
			foreignColumns: [paxConsentTerms.id],
			name: "pax_consents_term_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.confirmLinkId],
			foreignColumns: [paxConfirmLinks.id],
			name: "pax_consents_confirm_link_id_fkey"
		}).onDelete("set null"),
	unique("pax_consents_id_org_id_key").on(table.id, table.orgId),
	pgPolicy("pax_consents_select_partner", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_partner_member(partner_id)` }),
	check("pax_consents_answer_check", sql`answer = ANY (ARRAY['agreed'::text, 'declined'::text, 'withdrawn'::text])`),
	check("pax_consents_channel_check", sql`channel = 'link'::text`),
	check("pax_consents_wording_check", sql`(char_length(wording) >= 20) AND (char_length(wording) <= 4000)`),
	check("pax_consents_evidence_check", sql`(jsonb_typeof(evidence) = 'object'::text) AND (octet_length((evidence)::text) <= 2000)`),
]);

export const paxTripTravelers = pgTable("pax_trip_travelers", {
	tripId: uuid("trip_id").notNull(),
	travelerId: uuid("traveler_id").notNull(),
}, (table) => [
	index("pax_trip_travelers_traveler_idx").using("btree", table.travelerId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.tripId],
			foreignColumns: [paxTrips.id],
			name: "pax_trip_travelers_trip_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.travelerId],
			foreignColumns: [paxTravelers.id],
			name: "pax_trip_travelers_traveler_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.tripId, table.travelerId], name: "pax_trip_travelers_pkey"}),
	pgPolicy("pax_trip_travelers_select_partner", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(EXISTS ( SELECT 1
   FROM pax_trips t
  WHERE ((t.id = pax_trip_travelers.trip_id) AND is_partner_member(t.partner_id))))` }),
]);

export const announcementDismissals = pgTable("announcement_dismissals", {
	announcementId: uuid("announcement_id").notNull(),
	userId: uuid("user_id").notNull(),
	dismissedAt: timestamp("dismissed_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.announcementId],
			foreignColumns: [announcements.id],
			name: "announcement_dismissals_announcement_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [profiles.id],
			name: "announcement_dismissals_user_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.announcementId, table.userId], name: "announcement_dismissals_pkey"}),
	pgPolicy("announcement_dismissals_select_own", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(user_id = auth.uid())` }),
	pgPolicy("announcement_dismissals_insert_own", { as: "permissive", for: "insert", to: ["authenticated"] }),
]);

export const newsletterDeliveries = pgTable("newsletter_deliveries", {
	sendId: uuid("send_id").notNull(),
	leadId: uuid("lead_id").notNull(),
	claimedAt: timestamp("claimed_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("newsletter_deliveries_lead_idx").using("btree", table.leadId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.sendId],
			foreignColumns: [newsletterSends.id],
			name: "newsletter_deliveries_send_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.leadId],
			foreignColumns: [leads.id],
			name: "newsletter_deliveries_lead_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.sendId, table.leadId], name: "newsletter_deliveries_pkey"}),
]);

export const proceedingParties = pgTable("proceeding_parties", {
	proceedingId: uuid("proceeding_id").notNull(),
	partyId: uuid("party_id").notNull(),
	orgId: uuid("org_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "proceeding_parties_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.proceedingId, table.orgId],
			foreignColumns: [proceedings.id, proceedings.orgId],
			name: "proceeding_parties_proceeding_id_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.partyId, table.orgId],
			foreignColumns: [caseParties.id, caseParties.orgId],
			name: "proceeding_parties_party_id_org_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.proceedingId, table.partyId], name: "proceeding_parties_pkey"}),
	pgPolicy("proceeding_parties_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
]);

export const proceedingLawyers = pgTable("proceeding_lawyers", {
	proceedingId: uuid("proceeding_id").notNull(),
	userId: uuid("user_id").notNull(),
	orgId: uuid("org_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [profiles.id],
			name: "proceeding_lawyers_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "proceeding_lawyers_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.proceedingId, table.orgId],
			foreignColumns: [proceedings.id, proceedings.orgId],
			name: "proceeding_lawyers_proceeding_id_org_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.proceedingId, table.userId], name: "proceeding_lawyers_pkey"}),
	pgPolicy("proceeding_lawyers_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
]);

export const firmSigners = pgTable("firm_signers", {
	orgId: uuid("org_id").notNull(),
	userId: uuid("user_id").notNull(),
	addedBy: uuid("added_by"),
	addedAt: timestamp("added_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "firm_signers_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [profiles.id],
			name: "firm_signers_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.addedBy],
			foreignColumns: [profiles.id],
			name: "firm_signers_added_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.userId],
			foreignColumns: [memberships.orgId, memberships.userId],
			name: "firm_signers_org_id_user_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.orgId, table.userId], name: "firm_signers_pkey"}),
	pgPolicy("firm_signers_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
]);

export const firmModules = pgTable("firm_modules", {
	orgId: uuid("org_id").notNull(),
	moduleKey: text("module_key").notNull(),
	enabledAt: timestamp("enabled_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	enabledBy: uuid("enabled_by"),
}, (table) => [
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "firm_modules_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.moduleKey],
			foreignColumns: [productModules.key],
			name: "firm_modules_module_key_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.enabledBy],
			foreignColumns: [profiles.id],
			name: "firm_modules_enabled_by_fkey"
		}).onDelete("set null"),
	primaryKey({ columns: [table.orgId, table.moduleKey], name: "firm_modules_pkey"}),
	pgPolicy("firm_modules_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(is_org_member(org_id) OR is_superadmin())` }),
]);

export const partnerMembers = pgTable("partner_members", {
	partnerId: uuid("partner_id").notNull(),
	userId: uuid("user_id").notNull(),
	role: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("partner_members_one_owner_idx").using("btree", table.partnerId.asc().nullsLast().op("uuid_ops")).where(sql`(role = 'owner'::text)`),
	foreignKey({
			columns: [table.partnerId],
			foreignColumns: [partners.id],
			name: "partner_members_partner_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [profiles.id],
			name: "partner_members_user_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.partnerId, table.userId], name: "partner_members_pkey"}),
	unique("partner_members_user_id_key").on(table.userId),
	pgPolicy("partner_members_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(is_partner_member(partner_id) OR is_superadmin())` }),
	check("partner_members_role_check", sql`role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])`),
]);

export const productEventsDaily = pgTable("product_events_daily", {
	day: date().notNull(),
	eventName: text("event_name").notNull(),
	events: integer().default(0).notNull(),
	actors: integer().default(0).notNull(),
	firms: integer().default(0).notNull(),
}, (table) => [
	primaryKey({ columns: [table.day, table.eventName], name: "product_events_daily_pkey"}),
	pgPolicy("product_events_daily_select_superadmin", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_superadmin()` }),
]);

export const waContacts = pgTable("wa_contacts", {
	numberId: uuid("number_id").notNull(),
	orgId: uuid("org_id").notNull(),
	contactWaId: text("contact_wa_id").notNull(),
	savedName: text("saved_name").notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "wa_contacts_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.numberId, table.orgId],
			foreignColumns: [waNumbers.id, waNumbers.orgId],
			name: "wa_contacts_number_id_org_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.numberId, table.contactWaId], name: "wa_contacts_pkey"}),
	pgPolicy("wa_contacts_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("wa_contacts_wa_id_check", sql`contact_wa_id ~ '^[0-9]{8,15}$'::text`),
	check("wa_contacts_name_check", sql`(char_length(btrim(saved_name)) >= 1) AND (char_length(btrim(saved_name)) <= 200)`),
]);

export const firmClaimDefaults = pgTable("firm_claim_defaults", {
	orgId: uuid("org_id").notNull(),
	incident: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	cents: bigint({ mode: "number" }).notNull(),
	changedBy: uuid("changed_by"),
	changedAt: timestamp("changed_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "firm_claim_defaults_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.changedBy],
			foreignColumns: [profiles.id],
			name: "firm_claim_defaults_changed_by_fkey"
		}).onDelete("set null"),
	primaryKey({ columns: [table.orgId, table.incident], name: "firm_claim_defaults_pkey"}),
	pgPolicy("firm_claim_defaults_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("firm_claim_defaults_incident_check", sql`incident = ANY (ARRAY['delay'::text, 'cancellation'::text, 'overbooking'::text, 'missed_connection'::text, 'downgrade'::text, 'baggage_lost'::text, 'baggage_damaged'::text, 'baggage_delayed'::text, 'other'::text])`),
	check("firm_claim_defaults_cents_check", sql`(cents >= 1) AND (cents <= '100000000000'::bigint)`),
]);

export const firmAutonomy = pgTable("firm_autonomy", {
	orgId: uuid("org_id").notNull(),
	decision: text().notNull(),
	mode: text().notNull(),
	samplePercent: integer("sample_percent").default(20).notNull(),
	changedBy: uuid("changed_by"),
	changedAt: timestamp("changed_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "firm_autonomy_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.decision],
			foreignColumns: [autonomyDecisions.key],
			name: "firm_autonomy_decision_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.changedBy],
			foreignColumns: [profiles.id],
			name: "firm_autonomy_changed_by_fkey"
		}).onDelete("set null"),
	primaryKey({ columns: [table.orgId, table.decision], name: "firm_autonomy_pkey"}),
	pgPolicy("firm_autonomy_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("firm_autonomy_mode_check", sql`mode = ANY (ARRAY['auto'::text, 'sampled'::text, 'approval'::text])`),
	check("firm_autonomy_sample_check", sql`(sample_percent >= 1) AND (sample_percent <= 100)`),
]);

export const waOptouts = pgTable("wa_optouts", {
	orgId: uuid("org_id").notNull(),
	contactWaId: text("contact_wa_id").notNull(),
	source: text().notNull(),
	note: text(),
	recordedBy: uuid("recorded_by"),
	optedOutAt: timestamp("opted_out_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "wa_optouts_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.recordedBy],
			foreignColumns: [profiles.id],
			name: "wa_optouts_recorded_by_fkey"
		}).onDelete("set null"),
	primaryKey({ columns: [table.orgId, table.contactWaId], name: "wa_optouts_pkey"}),
	pgPolicy("wa_optouts_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("wa_optouts_wa_id_check", sql`contact_wa_id ~ '^[0-9]{8,15}$'::text`),
	check("wa_optouts_source_check", sql`source = ANY (ARRAY['keyword'::text, 'manual'::text])`),
	check("wa_optouts_note_check", sql`(note IS NULL) OR (char_length(note) <= 500)`),
]);

export const paxTripLegs = pgTable("pax_trip_legs", {
	tripId: uuid("trip_id").notNull(),
	position: integer().notNull(),
	flightNumber: text("flight_number").notNull(),
	originIata: text("origin_iata").notNull(),
	destinationIata: text("destination_iata").notNull(),
	scheduledDepartureLocal: timestamp("scheduled_departure_local", { mode: 'string' }).notNull(),
	scheduledArrivalLocal: timestamp("scheduled_arrival_local", { mode: 'string' }).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.tripId],
			foreignColumns: [paxTrips.id],
			name: "pax_trip_legs_trip_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.tripId, table.position], name: "pax_trip_legs_pkey"}),
	pgPolicy("pax_trip_legs_select_partner", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(EXISTS ( SELECT 1
   FROM pax_trips t
  WHERE ((t.id = pax_trip_legs.trip_id) AND is_partner_member(t.partner_id))))` }),
	check("pax_trip_legs_position_check", sql`("position" >= 1) AND ("position" <= 6)`),
	check("pax_trip_legs_flight_check", sql`flight_number ~ '^[A-Z0-9]{2}[0-9]{1,4}[A-Z]?$'::text`),
	check("pax_trip_legs_airports_check", sql`(origin_iata ~ '^[A-Z]{3}$'::text) AND (destination_iata ~ '^[A-Z]{3}$'::text) AND (origin_iata <> destination_iata)`),
	check("pax_trip_legs_times_check", sql`(scheduled_arrival_local > (scheduled_departure_local - '12:00:00'::interval)) AND ((scheduled_departure_local >= '2000-01-01 00:00:00'::timestamp without time zone) AND (scheduled_departure_local <= '2100-01-01 00:00:00'::timestamp without time zone))`),
]);

export const courtNotes = pgTable("court_notes", {
	court: text().notNull(),
	topic: text().notNull(),
	stance: text().notNull(),
	summary: text().notNull(),
	sources: jsonb().notNull(),
	readOn: date("read_on").notNull(),
	updatedBy: uuid("updated_by"),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.court],
			foreignColumns: [courts.acronym],
			name: "court_notes_court_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [profiles.id],
			name: "court_notes_updated_by_fkey"
		}).onDelete("set null"),
	primaryKey({ columns: [table.court, table.topic], name: "court_notes_pkey"}),
	pgPolicy("court_notes_select_all", { as: "permissive", for: "select", to: ["authenticated"], using: sql`true` }),
	check("court_notes_topic_check", sql`topic = 'family_split'::text`),
	check("court_notes_stance_check", sql`stance = ANY (ARRAY['against'::text, 'divided'::text])`),
	check("court_notes_summary_check", sql`(char_length(btrim(summary)) >= 40) AND (char_length(btrim(summary)) <= 2000)`),
	check("court_notes_sources_check", sql`CHECK (court_note_sources_ok(sources`),
	check("court_notes_read_check", sql`(read_on >= '2020-01-01'::date) AND (read_on <= '2100-01-01'::date)`),
]);

export const caseDraftCitations = pgTable("case_draft_citations", {
	orgId: uuid("org_id").notNull(),
	draftId: uuid("draft_id").notNull(),
	version: integer().notNull(),
	position: integer().notNull(),
	kind: text().notNull(),
	issuer: text().default('').notNull(),
	number: text().default('').notNull(),
	article: text(),
	key: text().notNull(),
	raw: text().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "case_draft_citations_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId, table.draftId],
			foreignColumns: [caseDrafts.id, caseDrafts.orgId],
			name: "case_draft_citations_draft_id_org_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.draftId, table.version, table.position], name: "case_draft_citations_pkey"}),
	pgPolicy("case_draft_citations_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("case_draft_citations_kind_check", sql`kind = ANY (ARRAY['lei'::text, 'lei_complementar'::text, 'constituicao'::text, 'decreto'::text, 'resolucao'::text, 'sumula'::text, 'sumula_vinculante'::text, 'tema'::text, 'precedente'::text, 'processo'::text, 'enunciado'::text, 'norma'::text, 'artigo'::text, 'ilegivel'::text])`),
	check("case_draft_citations_raw_check", sql`(char_length(raw) >= 1) AND (char_length(raw) <= 300)`),
	check("case_draft_citations_position_check", sql`"position" >= 0`),
]);

export const courtCalendarYears = pgTable("court_calendar_years", {
	court: text().notNull(),
	year: integer().notNull(),
	sourceUrl: text("source_url").notNull(),
	sourceTitle: text("source_title"),
	allComarcas: boolean("all_comarcas").default(false).notNull(),
	comarcas: text().array().default(sql`'{}'`).notNull(),
	checkedOn: date("checked_on").notNull(),
	note: text(),
	updatedBy: uuid("updated_by"),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.court],
			foreignColumns: [courts.acronym],
			name: "court_calendar_years_court_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [profiles.id],
			name: "court_calendar_years_updated_by_fkey"
		}).onDelete("set null"),
	primaryKey({ columns: [table.court, table.year], name: "court_calendar_years_pkey"}),
	pgPolicy("court_calendar_years_select_all", { as: "permissive", for: "select", to: ["authenticated"], using: sql`true` }),
	check("court_calendar_years_year_check", sql`(year >= 2019) AND (year <= 2100)`),
	check("court_calendar_years_source_check", sql`(source_url ~* '^https://'::text) AND (char_length(source_url) <= 500)`),
	check("court_calendar_years_title_check", sql`(source_title IS NULL) OR ((char_length(btrim(source_title)) >= 2) AND (char_length(btrim(source_title)) <= 200))`),
	check("court_calendar_years_comarcas_check", sql`CHECK (calendar_names_ok(comarcas`),
	check("court_calendar_years_note_check", sql`(note IS NULL) OR (char_length(note) <= 2000)`),
]);

export const firmNoticeKinds = pgTable("firm_notice_kinds", {
	orgId: uuid("org_id").notNull(),
	kind: text().notNull(),
	templateId: uuid("template_id"),
	body: text(),
	pendingTemplateId: uuid("pending_template_id"),
	pendingBody: text("pending_body"),
	enabled: boolean().default(false).notNull(),
	submittedBy: uuid("submitted_by"),
	submittedAt: timestamp("submitted_at", { withTimezone: true, mode: 'string' }),
	changedBy: uuid("changed_by"),
	changedAt: timestamp("changed_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "firm_notice_kinds_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.kind],
			foreignColumns: [noticeKinds.kind],
			name: "firm_notice_kinds_kind_fkey"
		}),
	foreignKey({
			columns: [table.submittedBy],
			foreignColumns: [profiles.id],
			name: "firm_notice_kinds_submitted_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.changedBy],
			foreignColumns: [profiles.id],
			name: "firm_notice_kinds_changed_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.templateId],
			foreignColumns: [waTemplates.id, waTemplates.orgId],
			name: "firm_notice_kinds_template_id_org_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orgId, table.pendingTemplateId],
			foreignColumns: [waTemplates.id, waTemplates.orgId],
			name: "firm_notice_kinds_pending_template_id_org_id_fkey"
		}).onDelete("set null"),
	primaryKey({ columns: [table.orgId, table.kind], name: "firm_notice_kinds_pkey"}),
	pgPolicy("firm_notice_kinds_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("firm_notice_kinds_enabled_check", sql`(NOT enabled) OR (template_id IS NOT NULL)`),
	check("firm_notice_kinds_body_check", sql`(body IS NULL) OR ((char_length(body) >= 20) AND (char_length(body) <= 1024))`),
	check("firm_notice_kinds_pending_check", sql`((pending_template_id IS NULL) OR (pending_body IS NOT NULL)) AND ((pending_body IS NULL) OR ((char_length(pending_body) >= 20) AND (char_length(pending_body) <= 1024)))`),
]);

export const publicationReadings = pgTable("publication_readings", {
	publicationId: uuid("publication_id").notNull(),
	orgId: uuid("org_id").notNull(),
	kind: text().notNull(),
	status: text().default('due').notNull(),
	reason: text(),
	runId: uuid("run_id"),
	deadlineId: uuid("deadline_id"),
	hearingId: uuid("hearing_id"),
	dueSince: timestamp("due_since", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	claimedAt: timestamp("claimed_at", { withTimezone: true, mode: 'string' }),
	claims: integer().default(0).notNull(),
	attempts: integer().default(0).notNull(),
	releases: integer().default(0).notNull(),
	retryAfter: timestamp("retry_after", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("publication_readings_deadline_idx").using("btree", table.deadlineId.asc().nullsLast().op("uuid_ops")).where(sql`(deadline_id IS NOT NULL)`),
	index("publication_readings_due_idx").using("btree", table.dueSince.asc().nullsLast().op("timestamptz_ops")).where(sql`(status = 'due'::text)`),
	index("publication_readings_hearing_idx").using("btree", table.hearingId.asc().nullsLast().op("uuid_ops")).where(sql`(hearing_id IS NOT NULL)`),
	index("publication_readings_org_idx").using("btree", table.orgId.asc().nullsLast().op("uuid_ops")),
	index("publication_readings_run_idx").using("btree", table.runId.asc().nullsLast().op("uuid_ops")).where(sql`(run_id IS NOT NULL)`),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "publication_readings_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.runId],
			foreignColumns: [aiRuns.id],
			name: "publication_readings_run_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.deadlineId],
			foreignColumns: [deadlines.id],
			name: "publication_readings_deadline_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.hearingId],
			foreignColumns: [hearings.id],
			name: "publication_readings_hearing_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.publicationId, table.orgId],
			foreignColumns: [publications.id, publications.orgId],
			name: "publication_readings_publication_id_org_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.publicationId, table.kind], name: "publication_readings_pkey"}),
	pgPolicy("publication_readings_select_member", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_org_member(org_id)` }),
	check("publication_readings_kind_check", sql`kind = ANY (ARRAY['deadline'::text, 'hearing'::text])`),
	check("publication_readings_status_check", sql`status = ANY (ARRAY['due'::text, 'done'::text, 'unread'::text, 'skipped'::text, 'failed'::text])`),
	check("publication_readings_reason_check", sql`(reason IS NULL) OR (reason ~ '^[a-z][a-z0-9_]{1,59}$'::text)`),
]);

export const courtSystems = pgTable("court_systems", {
	court: text().notNull(),
	proceedingKind: text("proceeding_kind").notNull(),
	system: text().notNull(),
	host: text(),
	since: date(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	maxFileBytes: bigint("max_file_bytes", { mode: "number" }),
	source: text().notNull(),
	sampleCount: integer("sample_count"),
	sampleTotal: integer("sample_total"),
	sampledOn: date("sampled_on"),
	confirmed: boolean().default(false).notNull(),
	notes: text(),
	updatedBy: uuid("updated_by"),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	maxPetitionBytes: bigint("max_petition_bytes", { mode: "number" }),
	fileTypes: jsonb("file_types").default({}).notNull(),
	signedFiles: text("signed_files"),
}, (table) => [
	foreignKey({
			columns: [table.court],
			foreignColumns: [courts.acronym],
			name: "court_systems_court_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [profiles.id],
			name: "court_systems_updated_by_fkey"
		}).onDelete("set null"),
	primaryKey({ columns: [table.court, table.proceedingKind], name: "court_systems_pkey"}),
	pgPolicy("court_systems_select_all", { as: "permissive", for: "select", to: ["authenticated"], using: sql`true` }),
	check("court_systems_kind_check", sql`proceeding_kind = ANY (ARRAY['juizado'::text, 'comum'::text])`),
	check("court_systems_system_check", sql`system = ANY (ARRAY['projudi'::text, 'eproc'::text, 'pje'::text, 'esaj'::text, 'outro'::text])`),
	check("court_systems_limits_check", sql`(max_file_bytes IS NULL) OR (max_file_bytes > 0)`),
	check("court_systems_text_check", sql`(char_length(source) <= 500) AND ((notes IS NULL) OR (char_length(notes) <= 2000))`),
	check("court_systems_file_types_check", sql`CHECK (filing_types_ok(file_types`),
	check("court_systems_petition_limit_check", sql`(max_petition_bytes IS NULL) OR ((max_petition_bytes > 0) AND ((max_file_bytes IS NULL) OR (max_petition_bytes <= max_file_bytes)))`),
	check("court_systems_signed_files_check", sql`(signed_files IS NULL) OR (signed_files = 'p7s'::text)`),
]);
