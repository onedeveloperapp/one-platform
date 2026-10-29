// GENERATED from packages/db/migrations by `npm run db:schema:pull`.
// Regenerate after every migration instead of editing by hand.
import { relations } from "drizzle-orm/relations";
import { profiles, organizations, usersInAuth, memberships, auditEvents, consentTerms, consentAcceptances, accessEvents, platformSettings, notifications, announcements, onboardingState, oabRegistrations, firmInvitations, subscriptions, plans, coupons, billingOperations, subscriptionModules, modules, invoices, entitlementGrants, signupAttribution, metaAttribution, purchaseAttributions, productEvents, helpCategories, helpArticles, leads, blogPosts, blogComments, impersonationSessions, newsletterSends, aiSpend, aiTasks, promptVersions, autonomyDecisions, aiRuns, approvals, connections, connectionSecrets, waNumbers, files, partners, issuedDocuments, waTemplates, waConversations, waMessages, people, caseParties, cases, airports, flightSegments, proceedings, courts, clientLinks, caseEvents, signatureEnvelopes, caseDocuments, clientConsents, airlines, productModules, partnerLinks, caseWeather, civilCourtAnswers, caseStatements, adminComplaints, certificateInventory, filingReceipts, filingPackages, djenCaptures, draftTemplates, legalSources, publications, caseDrafts, caseDraftVersions, dossiers, flightChecks, proceedingTracking, movements, importBatches, importRows, courtCalendarDays, deadlineActs, deadlines, publicationTriagePolicies, firmCalendars, hearingEventRemovals, noticeOptins, caseAdvances, clientNotices, noticeKinds, hearings, proceedingSignersSeen, pscProviders, lawyerSignatureUses, lawyerCpfs, filingPackageItems, testChats, trackedLegs, trackedTrips, paxTrips, flightAlerts, waConversationEvents, casePapers, templateImports, partnerInvitations, paxConfirmLinks, paxTravelers, paxConsentTerms, paxDocuments, paxConsents, partnerApiKeys, paxTripTravelers, announcementDismissals, newsletterDeliveries, proceedingParties, proceedingLawyers, firmSigners, firmModules, partnerMembers, waContacts, firmClaimDefaults, firmAutonomy, waOptouts, paxTripLegs, courtNotes, caseDraftCitations, courtCalendarYears, firmNoticeKinds, publicationReadings, courtSystems } from "./schema";

export const organizationsRelations = relations(organizations, ({one, many}) => ({
	profile: one(profiles, {
		fields: [organizations.createdBy],
		references: [profiles.id]
	}),
	memberships: many(memberships),
	auditEvents: many(auditEvents),
	consentAcceptances: many(consentAcceptances),
	onboardingStates: many(onboardingState),
	firmInvitations: many(firmInvitations),
	subscriptions: many(subscriptions),
	invoices: many(invoices),
	entitlementGrants: many(entitlementGrants),
	billingOperations: many(billingOperations),
	signupAttributions: many(signupAttribution),
	metaAttributions: many(metaAttribution),
	purchaseAttributions: many(purchaseAttributions),
	productEvents: many(productEvents),
	impersonationSessions: many(impersonationSessions),
	aiSpends: many(aiSpend),
	aiRuns: many(aiRuns),
	approvals: many(approvals),
	connections: many(connections),
	connectionSecrets: many(connectionSecrets),
	waNumbers: many(waNumbers),
	files: many(files),
	issuedDocuments: many(issuedDocuments),
	waTemplates: many(waTemplates),
	waConversations: many(waConversations),
	waMessages: many(waMessages),
	people: many(people),
	caseParties: many(caseParties),
	flightSegments: many(flightSegments),
	proceedings: many(proceedings),
	clientLinks: many(clientLinks),
	caseEvents: many(caseEvents),
	signatureEnvelopes: many(signatureEnvelopes),
	clientConsents: many(clientConsents),
	caseDocuments: many(caseDocuments),
	cases: many(cases),
	caseWeathers: many(caseWeather),
	civilCourtAnswers: many(civilCourtAnswers),
	caseStatements: many(caseStatements),
	adminComplaints: many(adminComplaints),
	certificateInventories: many(certificateInventory),
	filingReceipts: many(filingReceipts),
	djenCaptures: many(djenCaptures),
	draftTemplates: many(draftTemplates),
	legalSources: many(legalSources),
	publications: many(publications),
	caseDrafts: many(caseDrafts),
	caseDraftVersions: many(caseDraftVersions),
	dossiers: many(dossiers),
	flightChecks: many(flightChecks),
	proceedingTrackings: many(proceedingTracking),
	movements: many(movements),
	importBatches: many(importBatches),
	importRows: many(importRows),
	deadlines: many(deadlines),
	firmCalendars: many(firmCalendars),
	hearingEventRemovals: many(hearingEventRemovals),
	noticeOptins: many(noticeOptins),
	caseAdvances: many(caseAdvances),
	clientNotices: many(clientNotices),
	hearings: many(hearings),
	proceedingSignersSeens: many(proceedingSignersSeen),
	filingPackages: many(filingPackages),
	filingPackageItems: many(filingPackageItems),
	lawyerSignatureUses: many(lawyerSignatureUses),
	testChats: many(testChats),
	trackedLegs: many(trackedLegs),
	trackedTrips: many(trackedTrips),
	flightAlerts: many(flightAlerts),
	waConversationEvents: many(waConversationEvents),
	casePapers: many(casePapers),
	templateImports: many(templateImports),
	partnerInvitations: many(partnerInvitations),
	partnerLinks: many(partnerLinks),
	paxConfirmLinks: many(paxConfirmLinks),
	paxTravelers: many(paxTravelers),
	paxTrips: many(paxTrips),
	paxDocuments: many(paxDocuments),
	paxConsents: many(paxConsents),
	proceedingParties: many(proceedingParties),
	proceedingLawyers: many(proceedingLawyers),
	firmSigners: many(firmSigners),
	firmModules: many(firmModules),
	waContacts: many(waContacts),
	firmClaimDefaults: many(firmClaimDefaults),
	firmAutonomies: many(firmAutonomy),
	waOptouts: many(waOptouts),
	caseDraftCitations: many(caseDraftCitations),
	firmNoticeKinds: many(firmNoticeKinds),
	publicationReadings: many(publicationReadings),
}));

export const profilesRelations = relations(profiles, ({one, many}) => ({
	organizations: many(organizations),
	usersInAuth: one(usersInAuth, {
		fields: [profiles.id],
		references: [usersInAuth.id]
	}),
	memberships: many(memberships),
	auditEvents: many(auditEvents),
	consentAcceptances: many(consentAcceptances),
	accessEvents_userId: many(accessEvents, {
		relationName: "accessEvents_userId_profiles_id"
	}),
	accessEvents_impersonatedBy: many(accessEvents, {
		relationName: "accessEvents_impersonatedBy_profiles_id"
	}),
	platformSettings: many(platformSettings),
	notifications: many(notifications),
	announcements: many(announcements),
	onboardingStates: many(onboardingState),
	oabRegistrations: many(oabRegistrations),
	firmInvitations_invitedBy: many(firmInvitations, {
		relationName: "firmInvitations_invitedBy_profiles_id"
	}),
	firmInvitations_acceptedBy: many(firmInvitations, {
		relationName: "firmInvitations_acceptedBy_profiles_id"
	}),
	entitlementGrants: many(entitlementGrants),
	billingOperations: many(billingOperations),
	productEvents: many(productEvents),
	blogComments: many(blogComments),
	impersonationSessions_actorId: many(impersonationSessions, {
		relationName: "impersonationSessions_actorId_profiles_id"
	}),
	impersonationSessions_targetUserId: many(impersonationSessions, {
		relationName: "impersonationSessions_targetUserId_profiles_id"
	}),
	newsletterSends: many(newsletterSends),
	promptVersions: many(promptVersions),
	autonomyDecisions: many(autonomyDecisions),
	aiRuns: many(aiRuns),
	approvals: many(approvals),
	connections_connectedBy: many(connections, {
		relationName: "connections_connectedBy_profiles_id"
	}),
	connections_disconnectedBy: many(connections, {
		relationName: "connections_disconnectedBy_profiles_id"
	}),
	connections_personId: many(connections, {
		relationName: "connections_personId_profiles_id"
	}),
	files: many(files),
	issuedDocuments_requestedBy: many(issuedDocuments, {
		relationName: "issuedDocuments_requestedBy_profiles_id"
	}),
	issuedDocuments_revokedBy: many(issuedDocuments, {
		relationName: "issuedDocuments_revokedBy_profiles_id"
	}),
	waConversations_assignedTo: many(waConversations, {
		relationName: "waConversations_assignedTo_profiles_id"
	}),
	waConversations_agentChangedBy: many(waConversations, {
		relationName: "waConversations_agentChangedBy_profiles_id"
	}),
	waMessages: many(waMessages),
	people: many(people),
	proceedings_createdBy: many(proceedings, {
		relationName: "proceedings_createdBy_profiles_id"
	}),
	proceedings_systemApprovedBy: many(proceedings, {
		relationName: "proceedings_systemApprovedBy_profiles_id"
	}),
	proceedings_systemRefusedBy: many(proceedings, {
		relationName: "proceedings_systemRefusedBy_profiles_id"
	}),
	clientLinks_revokedBy: many(clientLinks, {
		relationName: "clientLinks_revokedBy_profiles_id"
	}),
	clientLinks_createdBy: many(clientLinks, {
		relationName: "clientLinks_createdBy_profiles_id"
	}),
	caseEvents: many(caseEvents),
	signatureEnvelopes_decidedBy: many(signatureEnvelopes, {
		relationName: "signatureEnvelopes_decidedBy_profiles_id"
	}),
	signatureEnvelopes_createdBy: many(signatureEnvelopes, {
		relationName: "signatureEnvelopes_createdBy_profiles_id"
	}),
	caseDocuments: many(caseDocuments),
	cases_responsibleId: many(cases, {
		relationName: "cases_responsibleId_profiles_id"
	}),
	cases_createdBy: many(cases, {
		relationName: "cases_createdBy_profiles_id"
	}),
	cases_suspensionDecidedBy: many(cases, {
		relationName: "cases_suspensionDecidedBy_profiles_id"
	}),
	cases_familyChoiceBy: many(cases, {
		relationName: "cases_familyChoiceBy_profiles_id"
	}),
	civilCourtAnswers: many(civilCourtAnswers),
	caseStatements: many(caseStatements),
	adminComplaints: many(adminComplaints),
	certificateInventories: many(certificateInventory),
	filingReceipts: many(filingReceipts),
	djenCaptures: many(djenCaptures),
	draftTemplates_createdBy: many(draftTemplates, {
		relationName: "draftTemplates_createdBy_profiles_id"
	}),
	draftTemplates_updatedBy: many(draftTemplates, {
		relationName: "draftTemplates_updatedBy_profiles_id"
	}),
	legalSources_verifiedBy: many(legalSources, {
		relationName: "legalSources_verifiedBy_profiles_id"
	}),
	legalSources_retiredBy: many(legalSources, {
		relationName: "legalSources_retiredBy_profiles_id"
	}),
	publications_cancelSeenBy: many(publications, {
		relationName: "publications_cancelSeenBy_profiles_id"
	}),
	publications_triagedBy: many(publications, {
		relationName: "publications_triagedBy_profiles_id"
	}),
	publications_reviewedBy: many(publications, {
		relationName: "publications_reviewedBy_profiles_id"
	}),
	publications_hearingSettledBy: many(publications, {
		relationName: "publications_hearingSettledBy_profiles_id"
	}),
	caseDrafts_revisionBy: many(caseDrafts, {
		relationName: "caseDrafts_revisionBy_profiles_id"
	}),
	caseDrafts_approvedBy: many(caseDrafts, {
		relationName: "caseDrafts_approvedBy_profiles_id"
	}),
	caseDrafts_requestedBy: many(caseDrafts, {
		relationName: "caseDrafts_requestedBy_profiles_id"
	}),
	caseDraftVersions_authorId: many(caseDraftVersions, {
		relationName: "caseDraftVersions_authorId_profiles_id"
	}),
	caseDraftVersions_askedBy: many(caseDraftVersions, {
		relationName: "caseDraftVersions_askedBy_profiles_id"
	}),
	dossiers: many(dossiers),
	flightChecks: many(flightChecks),
	proceedingTrackings: many(proceedingTracking),
	importBatches: many(importBatches),
	courtCalendarDays: many(courtCalendarDays),
	deadlineActs: many(deadlineActs),
	deadlines_confirmedBy: many(deadlines, {
		relationName: "deadlines_confirmedBy_profiles_id"
	}),
	deadlines_doneBy: many(deadlines, {
		relationName: "deadlines_doneBy_profiles_id"
	}),
	deadlines_dismissedBy: many(deadlines, {
		relationName: "deadlines_dismissedBy_profiles_id"
	}),
	deadlines_createdBy: many(deadlines, {
		relationName: "deadlines_createdBy_profiles_id"
	}),
	publicationTriagePolicies: many(publicationTriagePolicies),
	firmCalendars: many(firmCalendars),
	noticeOptins_endedBy: many(noticeOptins, {
		relationName: "noticeOptins_endedBy_profiles_id"
	}),
	noticeOptins_recordedBy: many(noticeOptins, {
		relationName: "noticeOptins_recordedBy_profiles_id"
	}),
	hearings_attendeeUserId: many(hearings, {
		relationName: "hearings_attendeeUserId_profiles_id"
	}),
	hearings_createdBy: many(hearings, {
		relationName: "hearings_createdBy_profiles_id"
	}),
	hearings_updatedBy: many(hearings, {
		relationName: "hearings_updatedBy_profiles_id"
	}),
	pscProviders: many(pscProviders),
	filingPackages_requestedBy: many(filingPackages, {
		relationName: "filingPackages_requestedBy_profiles_id"
	}),
	filingPackages_signerRequested: many(filingPackages, {
		relationName: "filingPackages_signerRequested_profiles_id"
	}),
	filingPackages_signedBy: many(filingPackages, {
		relationName: "filingPackages_signedBy_profiles_id"
	}),
	lawyerCpfs: many(lawyerCpfs),
	lawyerSignatureUses: many(lawyerSignatureUses),
	testChats: many(testChats),
	waConversationEvents: many(waConversationEvents),
	templateImports: many(templateImports),
	partnerInvitations_invitedBy: many(partnerInvitations, {
		relationName: "partnerInvitations_invitedBy_profiles_id"
	}),
	partnerInvitations_acceptedBy: many(partnerInvitations, {
		relationName: "partnerInvitations_acceptedBy_profiles_id"
	}),
	partners: many(partners),
	partnerLinks_startedBy: many(partnerLinks, {
		relationName: "partnerLinks_startedBy_profiles_id"
	}),
	partnerLinks_endedBy: many(partnerLinks, {
		relationName: "partnerLinks_endedBy_profiles_id"
	}),
	paxConfirmLinks: many(paxConfirmLinks),
	paxConsentTerms: many(paxConsentTerms),
	paxTravelers: many(paxTravelers),
	paxTrips: many(paxTrips),
	paxDocuments: many(paxDocuments),
	partnerApiKeys_createdBy: many(partnerApiKeys, {
		relationName: "partnerApiKeys_createdBy_profiles_id"
	}),
	partnerApiKeys_revokedBy: many(partnerApiKeys, {
		relationName: "partnerApiKeys_revokedBy_profiles_id"
	}),
	announcementDismissals: many(announcementDismissals),
	proceedingLawyers: many(proceedingLawyers),
	firmSigners_userId: many(firmSigners, {
		relationName: "firmSigners_userId_profiles_id"
	}),
	firmSigners_addedBy: many(firmSigners, {
		relationName: "firmSigners_addedBy_profiles_id"
	}),
	firmModules: many(firmModules),
	partnerMembers: many(partnerMembers),
	firmClaimDefaults: many(firmClaimDefaults),
	firmAutonomies: many(firmAutonomy),
	waOptouts: many(waOptouts),
	courtNotes: many(courtNotes),
	courtCalendarYears: many(courtCalendarYears),
	firmNoticeKinds_submittedBy: many(firmNoticeKinds, {
		relationName: "firmNoticeKinds_submittedBy_profiles_id"
	}),
	firmNoticeKinds_changedBy: many(firmNoticeKinds, {
		relationName: "firmNoticeKinds_changedBy_profiles_id"
	}),
	courtSystems: many(courtSystems),
}));

export const usersInAuthRelations = relations(usersInAuth, ({many}) => ({
	profiles: many(profiles),
	aiSpends: many(aiSpend),
}));

export const membershipsRelations = relations(memberships, ({one, many}) => ({
	organization: one(organizations, {
		fields: [memberships.orgId],
		references: [organizations.id]
	}),
	profile: one(profiles, {
		fields: [memberships.userId],
		references: [profiles.id]
	}),
	firmSigners: many(firmSigners),
}));

export const auditEventsRelations = relations(auditEvents, ({one}) => ({
	organization: one(organizations, {
		fields: [auditEvents.orgId],
		references: [organizations.id]
	}),
	profile: one(profiles, {
		fields: [auditEvents.actorId],
		references: [profiles.id]
	}),
}));

export const consentAcceptancesRelations = relations(consentAcceptances, ({one}) => ({
	consentTerm: one(consentTerms, {
		fields: [consentAcceptances.termId],
		references: [consentTerms.id]
	}),
	organization: one(organizations, {
		fields: [consentAcceptances.orgId],
		references: [organizations.id]
	}),
	profile: one(profiles, {
		fields: [consentAcceptances.userId],
		references: [profiles.id]
	}),
}));

export const consentTermsRelations = relations(consentTerms, ({many}) => ({
	consentAcceptances: many(consentAcceptances),
	leads: many(leads),
	clientConsents: many(clientConsents),
}));

export const accessEventsRelations = relations(accessEvents, ({one}) => ({
	profile_userId: one(profiles, {
		fields: [accessEvents.userId],
		references: [profiles.id],
		relationName: "accessEvents_userId_profiles_id"
	}),
	profile_impersonatedBy: one(profiles, {
		fields: [accessEvents.impersonatedBy],
		references: [profiles.id],
		relationName: "accessEvents_impersonatedBy_profiles_id"
	}),
}));

export const platformSettingsRelations = relations(platformSettings, ({one}) => ({
	profile: one(profiles, {
		fields: [platformSettings.updatedBy],
		references: [profiles.id]
	}),
}));

export const notificationsRelations = relations(notifications, ({one}) => ({
	profile: one(profiles, {
		fields: [notifications.userId],
		references: [profiles.id]
	}),
}));

export const announcementsRelations = relations(announcements, ({one, many}) => ({
	profile: one(profiles, {
		fields: [announcements.createdBy],
		references: [profiles.id]
	}),
	announcementDismissals: many(announcementDismissals),
}));

export const onboardingStateRelations = relations(onboardingState, ({one}) => ({
	profile: one(profiles, {
		fields: [onboardingState.userId],
		references: [profiles.id]
	}),
	organization: one(organizations, {
		fields: [onboardingState.orgId],
		references: [organizations.id]
	}),
}));

export const oabRegistrationsRelations = relations(oabRegistrations, ({one, many}) => ({
	profile: one(profiles, {
		fields: [oabRegistrations.userId],
		references: [profiles.id]
	}),
	djenCaptures: many(djenCaptures),
}));

export const firmInvitationsRelations = relations(firmInvitations, ({one}) => ({
	organization: one(organizations, {
		fields: [firmInvitations.orgId],
		references: [organizations.id]
	}),
	profile_invitedBy: one(profiles, {
		fields: [firmInvitations.invitedBy],
		references: [profiles.id],
		relationName: "firmInvitations_invitedBy_profiles_id"
	}),
	profile_acceptedBy: one(profiles, {
		fields: [firmInvitations.acceptedBy],
		references: [profiles.id],
		relationName: "firmInvitations_acceptedBy_profiles_id"
	}),
}));

export const subscriptionsRelations = relations(subscriptions, ({one, many}) => ({
	organization: one(organizations, {
		fields: [subscriptions.orgId],
		references: [organizations.id]
	}),
	plan: one(plans, {
		fields: [subscriptions.planId],
		references: [plans.id]
	}),
	coupon: one(coupons, {
		fields: [subscriptions.couponId],
		references: [coupons.id]
	}),
	billingOperation: one(billingOperations, {
		fields: [subscriptions.billingOperationId],
		references: [billingOperations.id],
		relationName: "subscriptions_billingOperationId_billingOperations_id"
	}),
	subscriptionModules: many(subscriptionModules),
	invoices: many(invoices),
	billingOperations: many(billingOperations, {
		relationName: "billingOperations_subscriptionId_subscriptions_id"
	}),
}));

export const plansRelations = relations(plans, ({many}) => ({
	subscriptions: many(subscriptions),
	invoices: many(invoices),
	entitlementGrants: many(entitlementGrants),
	billingOperations: many(billingOperations),
}));

export const couponsRelations = relations(coupons, ({many}) => ({
	subscriptions: many(subscriptions),
}));

export const billingOperationsRelations = relations(billingOperations, ({one, many}) => ({
	subscriptions: many(subscriptions, {
		relationName: "subscriptions_billingOperationId_billingOperations_id"
	}),
	organization: one(organizations, {
		fields: [billingOperations.orgId],
		references: [organizations.id]
	}),
	profile: one(profiles, {
		fields: [billingOperations.actorId],
		references: [profiles.id]
	}),
	plan: one(plans, {
		fields: [billingOperations.planId],
		references: [plans.id]
	}),
	subscription: one(subscriptions, {
		fields: [billingOperations.subscriptionId],
		references: [subscriptions.id],
		relationName: "billingOperations_subscriptionId_subscriptions_id"
	}),
}));

export const subscriptionModulesRelations = relations(subscriptionModules, ({one}) => ({
	subscription: one(subscriptions, {
		fields: [subscriptionModules.subscriptionId],
		references: [subscriptions.id]
	}),
	module: one(modules, {
		fields: [subscriptionModules.moduleId],
		references: [modules.id]
	}),
}));

export const modulesRelations = relations(modules, ({many}) => ({
	subscriptionModules: many(subscriptionModules),
}));

export const invoicesRelations = relations(invoices, ({one}) => ({
	organization: one(organizations, {
		fields: [invoices.orgId],
		references: [organizations.id]
	}),
	subscription: one(subscriptions, {
		fields: [invoices.subscriptionId],
		references: [subscriptions.id]
	}),
	plan: one(plans, {
		fields: [invoices.planId],
		references: [plans.id]
	}),
}));

export const entitlementGrantsRelations = relations(entitlementGrants, ({one}) => ({
	organization: one(organizations, {
		fields: [entitlementGrants.orgId],
		references: [organizations.id]
	}),
	plan: one(plans, {
		fields: [entitlementGrants.planId],
		references: [plans.id]
	}),
	profile: one(profiles, {
		fields: [entitlementGrants.grantedBy],
		references: [profiles.id]
	}),
}));

export const signupAttributionRelations = relations(signupAttribution, ({one}) => ({
	organization: one(organizations, {
		fields: [signupAttribution.orgId],
		references: [organizations.id]
	}),
}));

export const metaAttributionRelations = relations(metaAttribution, ({one}) => ({
	organization: one(organizations, {
		fields: [metaAttribution.orgId],
		references: [organizations.id]
	}),
}));

export const purchaseAttributionsRelations = relations(purchaseAttributions, ({one}) => ({
	organization: one(organizations, {
		fields: [purchaseAttributions.orgId],
		references: [organizations.id]
	}),
}));

export const productEventsRelations = relations(productEvents, ({one}) => ({
	organization: one(organizations, {
		fields: [productEvents.orgId],
		references: [organizations.id]
	}),
	profile: one(profiles, {
		fields: [productEvents.actorId],
		references: [profiles.id]
	}),
}));

export const helpArticlesRelations = relations(helpArticles, ({one}) => ({
	helpCategory: one(helpCategories, {
		fields: [helpArticles.categoryId],
		references: [helpCategories.id]
	}),
}));

export const helpCategoriesRelations = relations(helpCategories, ({many}) => ({
	helpArticles: many(helpArticles),
}));

export const leadsRelations = relations(leads, ({one, many}) => ({
	consentTerm: one(consentTerms, {
		fields: [leads.consentTermId],
		references: [consentTerms.id]
	}),
	newsletterDeliveries: many(newsletterDeliveries),
}));

export const blogCommentsRelations = relations(blogComments, ({one}) => ({
	blogPost: one(blogPosts, {
		fields: [blogComments.postId],
		references: [blogPosts.id]
	}),
	profile: one(profiles, {
		fields: [blogComments.userId],
		references: [profiles.id]
	}),
}));

export const blogPostsRelations = relations(blogPosts, ({many}) => ({
	blogComments: many(blogComments),
}));

export const impersonationSessionsRelations = relations(impersonationSessions, ({one}) => ({
	profile_actorId: one(profiles, {
		fields: [impersonationSessions.actorId],
		references: [profiles.id],
		relationName: "impersonationSessions_actorId_profiles_id"
	}),
	profile_targetUserId: one(profiles, {
		fields: [impersonationSessions.targetUserId],
		references: [profiles.id],
		relationName: "impersonationSessions_targetUserId_profiles_id"
	}),
	organization: one(organizations, {
		fields: [impersonationSessions.targetOrgId],
		references: [organizations.id]
	}),
}));

export const newsletterSendsRelations = relations(newsletterSends, ({one, many}) => ({
	profile: one(profiles, {
		fields: [newsletterSends.createdBy],
		references: [profiles.id]
	}),
	newsletterDeliveries: many(newsletterDeliveries),
}));

export const aiSpendRelations = relations(aiSpend, ({one, many}) => ({
	organization: one(organizations, {
		fields: [aiSpend.orgId],
		references: [organizations.id]
	}),
	usersInAuth: one(usersInAuth, {
		fields: [aiSpend.createdBy],
		references: [usersInAuth.id]
	}),
	aiRuns: many(aiRuns),
}));

export const promptVersionsRelations = relations(promptVersions, ({one, many}) => ({
	aiTask: one(aiTasks, {
		fields: [promptVersions.task],
		references: [aiTasks.slug]
	}),
	profile: one(profiles, {
		fields: [promptVersions.createdBy],
		references: [profiles.id]
	}),
	aiRuns: many(aiRuns),
}));

export const aiTasksRelations = relations(aiTasks, ({many}) => ({
	promptVersions: many(promptVersions),
	autonomyDecisions: many(autonomyDecisions),
	aiRuns: many(aiRuns),
	approvals: many(approvals),
}));

export const autonomyDecisionsRelations = relations(autonomyDecisions, ({one, many}) => ({
	aiTask: one(aiTasks, {
		fields: [autonomyDecisions.task],
		references: [aiTasks.slug]
	}),
	profile: one(profiles, {
		fields: [autonomyDecisions.heldBy],
		references: [profiles.id]
	}),
	firmAutonomies: many(firmAutonomy),
}));

export const aiRunsRelations = relations(aiRuns, ({one, many}) => ({
	organization: one(organizations, {
		fields: [aiRuns.orgId],
		references: [organizations.id]
	}),
	aiTask: one(aiTasks, {
		fields: [aiRuns.task],
		references: [aiTasks.slug]
	}),
	promptVersion: one(promptVersions, {
		fields: [aiRuns.promptVersionId],
		references: [promptVersions.id]
	}),
	profile: one(profiles, {
		fields: [aiRuns.requestedBy],
		references: [profiles.id]
	}),
	aiSpend: one(aiSpend, {
		fields: [aiRuns.spendId],
		references: [aiSpend.id]
	}),
	approvals: many(approvals),
	waMessages: many(waMessages),
	caseDocuments: many(caseDocuments),
	caseStatements_transcriptRunId: many(caseStatements, {
		relationName: "caseStatements_transcriptRunId_aiRuns_id"
	}),
	caseStatements_chronologyRunId: many(caseStatements, {
		relationName: "caseStatements_chronologyRunId_aiRuns_id"
	}),
	caseStatements_returnedRunId: many(caseStatements, {
		relationName: "caseStatements_returnedRunId_aiRuns_id"
	}),
	publications: many(publications),
	caseDrafts: many(caseDrafts),
	caseDraftVersions: many(caseDraftVersions),
	templateImports: many(templateImports),
	paxDocuments: many(paxDocuments),
	publicationReadings: many(publicationReadings),
}));

export const approvalsRelations = relations(approvals, ({one}) => ({
	organization: one(organizations, {
		fields: [approvals.orgId],
		references: [organizations.id]
	}),
	aiRun: one(aiRuns, {
		fields: [approvals.runId],
		references: [aiRuns.id]
	}),
	aiTask: one(aiTasks, {
		fields: [approvals.task],
		references: [aiTasks.slug]
	}),
	profile: one(profiles, {
		fields: [approvals.decidedBy],
		references: [profiles.id]
	}),
}));

export const connectionsRelations = relations(connections, ({one, many}) => ({
	organization: one(organizations, {
		fields: [connections.orgId],
		references: [organizations.id]
	}),
	profile_connectedBy: one(profiles, {
		fields: [connections.connectedBy],
		references: [profiles.id],
		relationName: "connections_connectedBy_profiles_id"
	}),
	profile_disconnectedBy: one(profiles, {
		fields: [connections.disconnectedBy],
		references: [profiles.id],
		relationName: "connections_disconnectedBy_profiles_id"
	}),
	profile_personId: one(profiles, {
		fields: [connections.personId],
		references: [profiles.id],
		relationName: "connections_personId_profiles_id"
	}),
	connectionSecrets: many(connectionSecrets),
	waNumbers: many(waNumbers),
	signatureEnvelopes: many(signatureEnvelopes),
	firmCalendars: many(firmCalendars),
	lawyerSignatureUses: many(lawyerSignatureUses),
}));

export const connectionSecretsRelations = relations(connectionSecrets, ({one}) => ({
	organization: one(organizations, {
		fields: [connectionSecrets.orgId],
		references: [organizations.id]
	}),
	connection: one(connections, {
		fields: [connectionSecrets.connectionId],
		references: [connections.id]
	}),
}));

export const waNumbersRelations = relations(waNumbers, ({one, many}) => ({
	organization: one(organizations, {
		fields: [waNumbers.orgId],
		references: [organizations.id]
	}),
	connection: one(connections, {
		fields: [waNumbers.orgId],
		references: [connections.id]
	}),
	waConversations: many(waConversations),
	waMessages: many(waMessages),
	testChats: many(testChats),
	waContacts: many(waContacts),
}));

export const filesRelations = relations(files, ({one, many}) => ({
	organization: one(organizations, {
		fields: [files.orgId],
		references: [organizations.id]
	}),
	profile: one(profiles, {
		fields: [files.uploadedBy],
		references: [profiles.id]
	}),
	partner: one(partners, {
		fields: [files.partnerId],
		references: [partners.id]
	}),
	issuedDocuments: many(issuedDocuments),
	waMessages: many(waMessages),
	caseDocuments_orgId: many(caseDocuments, {
		relationName: "caseDocuments_orgId_files_id"
	}),
	caseDocuments_orgId: many(caseDocuments, {
		relationName: "caseDocuments_orgId_files_id"
	}),
	caseStatements: many(caseStatements),
	filingReceipts: many(filingReceipts),
	filingPackageItems_orgId: many(filingPackageItems, {
		relationName: "filingPackageItems_orgId_files_id"
	}),
	filingPackageItems_orgId: many(filingPackageItems, {
		relationName: "filingPackageItems_orgId_files_id"
	}),
	templateImports: many(templateImports),
	paxDocuments: many(paxDocuments),
}));

export const partnersRelations = relations(partners, ({one, many}) => ({
	files: many(files),
	partnerInvitations: many(partnerInvitations),
	profile: one(profiles, {
		fields: [partners.createdBy],
		references: [profiles.id]
	}),
	partnerLinks: many(partnerLinks),
	paxConfirmLinks: many(paxConfirmLinks),
	paxConsentTerms: many(paxConsentTerms),
	paxTravelers: many(paxTravelers),
	paxTrips: many(paxTrips),
	paxDocuments: many(paxDocuments),
	paxConsents: many(paxConsents),
	partnerApiKeys: many(partnerApiKeys),
	partnerMembers: many(partnerMembers),
}));

export const issuedDocumentsRelations = relations(issuedDocuments, ({one, many}) => ({
	organization: one(organizations, {
		fields: [issuedDocuments.orgId],
		references: [organizations.id]
	}),
	profile_requestedBy: one(profiles, {
		fields: [issuedDocuments.requestedBy],
		references: [profiles.id],
		relationName: "issuedDocuments_requestedBy_profiles_id"
	}),
	profile_revokedBy: one(profiles, {
		fields: [issuedDocuments.revokedBy],
		references: [profiles.id],
		relationName: "issuedDocuments_revokedBy_profiles_id"
	}),
	issuedDocument: one(issuedDocuments, {
		fields: [issuedDocuments.orgId],
		references: [issuedDocuments.id],
		relationName: "issuedDocuments_orgId_issuedDocuments_id"
	}),
	issuedDocuments: many(issuedDocuments, {
		relationName: "issuedDocuments_orgId_issuedDocuments_id"
	}),
	file: one(files, {
		fields: [issuedDocuments.orgId],
		references: [files.id]
	}),
	dossiers: many(dossiers),
}));

export const waTemplatesRelations = relations(waTemplates, ({one, many}) => ({
	organization: one(organizations, {
		fields: [waTemplates.orgId],
		references: [organizations.id]
	}),
	waMessages: many(waMessages),
	firmNoticeKinds_orgId: many(firmNoticeKinds, {
		relationName: "firmNoticeKinds_orgId_waTemplates_id"
	}),
	firmNoticeKinds_orgId: many(firmNoticeKinds, {
		relationName: "firmNoticeKinds_orgId_waTemplates_id"
	}),
}));

export const waConversationsRelations = relations(waConversations, ({one, many}) => ({
	organization: one(organizations, {
		fields: [waConversations.orgId],
		references: [organizations.id]
	}),
	profile_assignedTo: one(profiles, {
		fields: [waConversations.assignedTo],
		references: [profiles.id],
		relationName: "waConversations_assignedTo_profiles_id"
	}),
	waNumber: one(waNumbers, {
		fields: [waConversations.orgId],
		references: [waNumbers.id]
	}),
	profile_agentChangedBy: one(profiles, {
		fields: [waConversations.agentChangedBy],
		references: [profiles.id],
		relationName: "waConversations_agentChangedBy_profiles_id"
	}),
	waMessages: many(waMessages),
	waConversationEvents: many(waConversationEvents),
}));

export const waMessagesRelations = relations(waMessages, ({one, many}) => ({
	organization: one(organizations, {
		fields: [waMessages.orgId],
		references: [organizations.id]
	}),
	profile: one(profiles, {
		fields: [waMessages.sentBy],
		references: [profiles.id]
	}),
	waConversation: one(waConversations, {
		fields: [waMessages.orgId],
		references: [waConversations.id]
	}),
	waNumber: one(waNumbers, {
		fields: [waMessages.orgId],
		references: [waNumbers.id]
	}),
	waTemplate: one(waTemplates, {
		fields: [waMessages.orgId],
		references: [waTemplates.id]
	}),
	file: one(files, {
		fields: [waMessages.orgId],
		references: [files.id]
	}),
	aiRun: one(aiRuns, {
		fields: [waMessages.aiRunId],
		references: [aiRuns.id]
	}),
	clientNotices: many(clientNotices),
	flightAlerts: many(flightAlerts),
}));

export const peopleRelations = relations(people, ({one, many}) => ({
	organization: one(organizations, {
		fields: [people.orgId],
		references: [organizations.id]
	}),
	profile: one(profiles, {
		fields: [people.createdBy],
		references: [profiles.id]
	}),
	caseParties: many(caseParties),
	clientLinks: many(clientLinks),
	clientConsents: many(clientConsents),
	civilCourtAnswers: many(civilCourtAnswers),
	importRows: many(importRows),
	noticeOptins: many(noticeOptins),
	clientNotices: many(clientNotices),
	casePapers: many(casePapers),
}));

export const casePartiesRelations = relations(caseParties, ({one, many}) => ({
	organization: one(organizations, {
		fields: [caseParties.orgId],
		references: [organizations.id]
	}),
	case: one(cases, {
		fields: [caseParties.orgId],
		references: [cases.id]
	}),
	person: one(people, {
		fields: [caseParties.orgId],
		references: [people.id]
	}),
	caseParty: one(caseParties, {
		fields: [caseParties.orgId],
		references: [caseParties.id],
		relationName: "caseParties_orgId_caseParties_id"
	}),
	caseParties: many(caseParties, {
		relationName: "caseParties_orgId_caseParties_id"
	}),
	caseDocuments: many(caseDocuments),
	civilCourtAnswers: many(civilCourtAnswers),
	caseStatements: many(caseStatements),
	proceedingParties: many(proceedingParties),
}));

export const casesRelations = relations(cases, ({one, many}) => ({
	caseParties: many(caseParties),
	flightSegments: many(flightSegments),
	proceedings: many(proceedings),
	clientLinks: many(clientLinks),
	caseEvents: many(caseEvents),
	signatureEnvelopes: many(signatureEnvelopes),
	clientConsents: many(clientConsents),
	caseDocuments: many(caseDocuments),
	organization: one(organizations, {
		fields: [cases.orgId],
		references: [organizations.id]
	}),
	airline: one(airlines, {
		fields: [cases.airlineIata],
		references: [airlines.iata]
	}),
	profile_responsibleId: one(profiles, {
		fields: [cases.responsibleId],
		references: [profiles.id],
		relationName: "cases_responsibleId_profiles_id"
	}),
	profile_createdBy: one(profiles, {
		fields: [cases.createdBy],
		references: [profiles.id],
		relationName: "cases_createdBy_profiles_id"
	}),
	profile_suspensionDecidedBy: one(profiles, {
		fields: [cases.suspensionDecidedBy],
		references: [profiles.id],
		relationName: "cases_suspensionDecidedBy_profiles_id"
	}),
	profile_familyChoiceBy: one(profiles, {
		fields: [cases.familyChoiceBy],
		references: [profiles.id],
		relationName: "cases_familyChoiceBy_profiles_id"
	}),
	productModule: one(productModules, {
		fields: [cases.module],
		references: [productModules.key]
	}),
	partnerLink: one(partnerLinks, {
		fields: [cases.partnershipId],
		references: [partnerLinks.id]
	}),
	caseWeathers: many(caseWeather),
	civilCourtAnswers: many(civilCourtAnswers),
	caseStatements: many(caseStatements),
	adminComplaints: many(adminComplaints),
	publications: many(publications),
	caseDrafts: many(caseDrafts),
	dossiers: many(dossiers),
	flightChecks: many(flightChecks),
	proceedingTrackings: many(proceedingTracking),
	movements: many(movements),
	importRows: many(importRows),
	deadlines: many(deadlines),
	caseAdvances: many(caseAdvances),
	clientNotices: many(clientNotices),
	hearings: many(hearings),
	filingPackages: many(filingPackages),
	lawyerSignatureUses: many(lawyerSignatureUses),
	trackedTrips: many(trackedTrips),
	casePapers: many(casePapers),
	paxTravelers: many(paxTravelers),
}));

export const flightSegmentsRelations = relations(flightSegments, ({one, many}) => ({
	airport_originIata: one(airports, {
		fields: [flightSegments.originIata],
		references: [airports.iata],
		relationName: "flightSegments_originIata_airports_iata"
	}),
	airport_destinationIata: one(airports, {
		fields: [flightSegments.destinationIata],
		references: [airports.iata],
		relationName: "flightSegments_destinationIata_airports_iata"
	}),
	case: one(cases, {
		fields: [flightSegments.orgId],
		references: [cases.id]
	}),
	organization: one(organizations, {
		fields: [flightSegments.orgId],
		references: [organizations.id]
	}),
	flightChecks: many(flightChecks),
}));

export const airportsRelations = relations(airports, ({many}) => ({
	flightSegments_originIata: many(flightSegments, {
		relationName: "flightSegments_originIata_airports_iata"
	}),
	flightSegments_destinationIata: many(flightSegments, {
		relationName: "flightSegments_destinationIata_airports_iata"
	}),
}));

export const proceedingsRelations = relations(proceedings, ({one, many}) => ({
	organization: one(organizations, {
		fields: [proceedings.orgId],
		references: [organizations.id]
	}),
	court: one(courts, {
		fields: [proceedings.court],
		references: [courts.acronym]
	}),
	profile_createdBy: one(profiles, {
		fields: [proceedings.createdBy],
		references: [profiles.id],
		relationName: "proceedings_createdBy_profiles_id"
	}),
	case: one(cases, {
		fields: [proceedings.orgId],
		references: [cases.id]
	}),
	profile_systemApprovedBy: one(profiles, {
		fields: [proceedings.systemApprovedBy],
		references: [profiles.id],
		relationName: "proceedings_systemApprovedBy_profiles_id"
	}),
	profile_systemRefusedBy: one(profiles, {
		fields: [proceedings.systemRefusedBy],
		references: [profiles.id],
		relationName: "proceedings_systemRefusedBy_profiles_id"
	}),
	filingReceipts: many(filingReceipts),
	publications: many(publications),
	caseDrafts: many(caseDrafts),
	proceedingTrackings: many(proceedingTracking),
	movements: many(movements),
	importRows: many(importRows),
	deadlines: many(deadlines),
	clientNotices: many(clientNotices),
	hearings: many(hearings),
	proceedingSignersSeens: many(proceedingSignersSeen),
	filingPackages: many(filingPackages),
	proceedingParties: many(proceedingParties),
	proceedingLawyers: many(proceedingLawyers),
}));

export const courtsRelations = relations(courts, ({many}) => ({
	proceedings: many(proceedings),
	courtCalendarDays: many(courtCalendarDays),
	courtNotes: many(courtNotes),
	courtCalendarYears: many(courtCalendarYears),
	courtSystems: many(courtSystems),
}));

export const clientLinksRelations = relations(clientLinks, ({one, many}) => ({
	organization: one(organizations, {
		fields: [clientLinks.orgId],
		references: [organizations.id]
	}),
	profile_revokedBy: one(profiles, {
		fields: [clientLinks.revokedBy],
		references: [profiles.id],
		relationName: "clientLinks_revokedBy_profiles_id"
	}),
	profile_createdBy: one(profiles, {
		fields: [clientLinks.createdBy],
		references: [profiles.id],
		relationName: "clientLinks_createdBy_profiles_id"
	}),
	case: one(cases, {
		fields: [clientLinks.orgId],
		references: [cases.id]
	}),
	person: one(people, {
		fields: [clientLinks.orgId],
		references: [people.id]
	}),
	clientConsents: many(clientConsents),
	caseDocuments: many(caseDocuments),
	civilCourtAnswers: many(civilCourtAnswers),
	caseStatements: many(caseStatements),
	noticeOptins: many(noticeOptins),
}));

export const caseEventsRelations = relations(caseEvents, ({one}) => ({
	organization: one(organizations, {
		fields: [caseEvents.orgId],
		references: [organizations.id]
	}),
	profile: one(profiles, {
		fields: [caseEvents.actorId],
		references: [profiles.id]
	}),
	case: one(cases, {
		fields: [caseEvents.orgId],
		references: [cases.id]
	}),
}));

export const signatureEnvelopesRelations = relations(signatureEnvelopes, ({one, many}) => ({
	profile_decidedBy: one(profiles, {
		fields: [signatureEnvelopes.decidedBy],
		references: [profiles.id],
		relationName: "signatureEnvelopes_decidedBy_profiles_id"
	}),
	case: one(cases, {
		fields: [signatureEnvelopes.orgId],
		references: [cases.id]
	}),
	caseDocument_orgId: one(caseDocuments, {
		fields: [signatureEnvelopes.orgId],
		references: [caseDocuments.id],
		relationName: "signatureEnvelopes_orgId_caseDocuments_id"
	}),
	connection: one(connections, {
		fields: [signatureEnvelopes.orgId],
		references: [connections.id]
	}),
	caseDocument_orgId: one(caseDocuments, {
		fields: [signatureEnvelopes.orgId],
		references: [caseDocuments.id],
		relationName: "signatureEnvelopes_orgId_caseDocuments_id"
	}),
	organization: one(organizations, {
		fields: [signatureEnvelopes.orgId],
		references: [organizations.id]
	}),
	profile_createdBy: one(profiles, {
		fields: [signatureEnvelopes.createdBy],
		references: [profiles.id],
		relationName: "signatureEnvelopes_createdBy_profiles_id"
	}),
	caseDocuments: many(caseDocuments, {
		relationName: "caseDocuments_orgId_signatureEnvelopes_id"
	}),
	casePapers: many(casePapers),
}));

export const caseDocumentsRelations = relations(caseDocuments, ({one, many}) => ({
	signatureEnvelopes_orgId: many(signatureEnvelopes, {
		relationName: "signatureEnvelopes_orgId_caseDocuments_id"
	}),
	signatureEnvelopes_orgId: many(signatureEnvelopes, {
		relationName: "signatureEnvelopes_orgId_caseDocuments_id"
	}),
	signatureEnvelope: one(signatureEnvelopes, {
		fields: [caseDocuments.orgId],
		references: [signatureEnvelopes.id],
		relationName: "caseDocuments_orgId_signatureEnvelopes_id"
	}),
	organization: one(organizations, {
		fields: [caseDocuments.orgId],
		references: [organizations.id]
	}),
	profile: one(profiles, {
		fields: [caseDocuments.decidedBy],
		references: [profiles.id]
	}),
	case: one(cases, {
		fields: [caseDocuments.orgId],
		references: [cases.id]
	}),
	caseParty: one(caseParties, {
		fields: [caseDocuments.orgId],
		references: [caseParties.id]
	}),
	file_orgId: one(files, {
		fields: [caseDocuments.orgId],
		references: [files.id],
		relationName: "caseDocuments_orgId_files_id"
	}),
	clientLink: one(clientLinks, {
		fields: [caseDocuments.orgId],
		references: [clientLinks.id]
	}),
	aiRun: one(aiRuns, {
		fields: [caseDocuments.checkRunId],
		references: [aiRuns.id]
	}),
	file_orgId: one(files, {
		fields: [caseDocuments.orgId],
		references: [files.id],
		relationName: "caseDocuments_orgId_files_id"
	}),
	caseDrafts: many(caseDrafts),
	clientNotices: many(clientNotices),
	filingPackages: many(filingPackages),
	filingPackageItems: many(filingPackageItems),
	casePapers: many(casePapers),
}));

export const clientConsentsRelations = relations(clientConsents, ({one}) => ({
	organization: one(organizations, {
		fields: [clientConsents.orgId],
		references: [organizations.id]
	}),
	consentTerm: one(consentTerms, {
		fields: [clientConsents.termId],
		references: [consentTerms.id]
	}),
	case: one(cases, {
		fields: [clientConsents.orgId],
		references: [cases.id]
	}),
	person: one(people, {
		fields: [clientConsents.orgId],
		references: [people.id]
	}),
	clientLink: one(clientLinks, {
		fields: [clientConsents.orgId],
		references: [clientLinks.id]
	}),
}));

export const airlinesRelations = relations(airlines, ({many}) => ({
	cases: many(cases),
}));

export const productModulesRelations = relations(productModules, ({many}) => ({
	cases: many(cases),
	partnerInvitations: many(partnerInvitations),
	partnerLinks: many(partnerLinks),
	firmModules: many(firmModules),
}));

export const partnerLinksRelations = relations(partnerLinks, ({one, many}) => ({
	cases: many(cases),
	partner: one(partners, {
		fields: [partnerLinks.partnerId],
		references: [partners.id]
	}),
	organization: one(organizations, {
		fields: [partnerLinks.orgId],
		references: [organizations.id]
	}),
	productModule: one(productModules, {
		fields: [partnerLinks.moduleKey],
		references: [productModules.key]
	}),
	profile_startedBy: one(profiles, {
		fields: [partnerLinks.startedBy],
		references: [profiles.id],
		relationName: "partnerLinks_startedBy_profiles_id"
	}),
	profile_endedBy: one(profiles, {
		fields: [partnerLinks.endedBy],
		references: [profiles.id],
		relationName: "partnerLinks_endedBy_profiles_id"
	}),
	paxConfirmLinks: many(paxConfirmLinks),
	paxTravelers: many(paxTravelers),
	paxTrips: many(paxTrips),
	partnerApiKeys: many(partnerApiKeys),
}));

export const caseWeatherRelations = relations(caseWeather, ({one}) => ({
	organization: one(organizations, {
		fields: [caseWeather.orgId],
		references: [organizations.id]
	}),
	case: one(cases, {
		fields: [caseWeather.orgId],
		references: [cases.id]
	}),
}));

export const civilCourtAnswersRelations = relations(civilCourtAnswers, ({one}) => ({
	organization: one(organizations, {
		fields: [civilCourtAnswers.orgId],
		references: [organizations.id]
	}),
	clientLink: one(clientLinks, {
		fields: [civilCourtAnswers.linkId],
		references: [clientLinks.id]
	}),
	profile: one(profiles, {
		fields: [civilCourtAnswers.recordedBy],
		references: [profiles.id]
	}),
	case: one(cases, {
		fields: [civilCourtAnswers.orgId],
		references: [cases.id]
	}),
	caseParty: one(caseParties, {
		fields: [civilCourtAnswers.orgId],
		references: [caseParties.id]
	}),
	person: one(people, {
		fields: [civilCourtAnswers.orgId],
		references: [people.id]
	}),
}));

export const caseStatementsRelations = relations(caseStatements, ({one}) => ({
	organization: one(organizations, {
		fields: [caseStatements.orgId],
		references: [organizations.id]
	}),
	aiRun_transcriptRunId: one(aiRuns, {
		fields: [caseStatements.transcriptRunId],
		references: [aiRuns.id],
		relationName: "caseStatements_transcriptRunId_aiRuns_id"
	}),
	aiRun_chronologyRunId: one(aiRuns, {
		fields: [caseStatements.chronologyRunId],
		references: [aiRuns.id],
		relationName: "caseStatements_chronologyRunId_aiRuns_id"
	}),
	aiRun_returnedRunId: one(aiRuns, {
		fields: [caseStatements.returnedRunId],
		references: [aiRuns.id],
		relationName: "caseStatements_returnedRunId_aiRuns_id"
	}),
	profile: one(profiles, {
		fields: [caseStatements.createdBy],
		references: [profiles.id]
	}),
	case: one(cases, {
		fields: [caseStatements.orgId],
		references: [cases.id]
	}),
	caseParty: one(caseParties, {
		fields: [caseStatements.orgId],
		references: [caseParties.id]
	}),
	clientLink: one(clientLinks, {
		fields: [caseStatements.orgId],
		references: [clientLinks.id]
	}),
	file: one(files, {
		fields: [caseStatements.orgId],
		references: [files.id]
	}),
}));

export const adminComplaintsRelations = relations(adminComplaints, ({one}) => ({
	organization: one(organizations, {
		fields: [adminComplaints.orgId],
		references: [organizations.id]
	}),
	profile: one(profiles, {
		fields: [adminComplaints.createdBy],
		references: [profiles.id]
	}),
	case: one(cases, {
		fields: [adminComplaints.orgId],
		references: [cases.id]
	}),
}));

export const certificateInventoryRelations = relations(certificateInventory, ({one}) => ({
	organization: one(organizations, {
		fields: [certificateInventory.orgId],
		references: [organizations.id]
	}),
	profile: one(profiles, {
		fields: [certificateInventory.userId],
		references: [profiles.id]
	}),
}));

export const filingReceiptsRelations = relations(filingReceipts, ({one}) => ({
	organization: one(organizations, {
		fields: [filingReceipts.orgId],
		references: [organizations.id]
	}),
	profile: one(profiles, {
		fields: [filingReceipts.recordedBy],
		references: [profiles.id]
	}),
	filingPackage: one(filingPackages, {
		fields: [filingReceipts.orgId],
		references: [filingPackages.id]
	}),
	proceeding: one(proceedings, {
		fields: [filingReceipts.orgId],
		references: [proceedings.id]
	}),
	file: one(files, {
		fields: [filingReceipts.orgId],
		references: [files.id]
	}),
}));

export const filingPackagesRelations = relations(filingPackages, ({one, many}) => ({
	filingReceipts: many(filingReceipts),
	organization: one(organizations, {
		fields: [filingPackages.orgId],
		references: [organizations.id]
	}),
	profile_requestedBy: one(profiles, {
		fields: [filingPackages.requestedBy],
		references: [profiles.id],
		relationName: "filingPackages_requestedBy_profiles_id"
	}),
	case: one(cases, {
		fields: [filingPackages.orgId],
		references: [cases.id]
	}),
	proceeding: one(proceedings, {
		fields: [filingPackages.orgId],
		references: [proceedings.id]
	}),
	caseDocument: one(caseDocuments, {
		fields: [filingPackages.orgId],
		references: [caseDocuments.id]
	}),
	lawyerSignatureus: one(lawyerSignatureUses, {
		fields: [filingPackages.signatureUse],
		references: [lawyerSignatureUses.id]
	}),
	profile_signerRequested: one(profiles, {
		fields: [filingPackages.signerRequested],
		references: [profiles.id],
		relationName: "filingPackages_signerRequested_profiles_id"
	}),
	profile_signedBy: one(profiles, {
		fields: [filingPackages.signedBy],
		references: [profiles.id],
		relationName: "filingPackages_signedBy_profiles_id"
	}),
	filingPackageItems: many(filingPackageItems),
}));

export const djenCapturesRelations = relations(djenCaptures, ({one}) => ({
	organization: one(organizations, {
		fields: [djenCaptures.orgId],
		references: [organizations.id]
	}),
	profile: one(profiles, {
		fields: [djenCaptures.userId],
		references: [profiles.id]
	}),
	oabRegistration: one(oabRegistrations, {
		fields: [djenCaptures.registrationId],
		references: [oabRegistrations.id]
	}),
}));

export const draftTemplatesRelations = relations(draftTemplates, ({one, many}) => ({
	organization: one(organizations, {
		fields: [draftTemplates.orgId],
		references: [organizations.id]
	}),
	profile_createdBy: one(profiles, {
		fields: [draftTemplates.createdBy],
		references: [profiles.id],
		relationName: "draftTemplates_createdBy_profiles_id"
	}),
	profile_updatedBy: one(profiles, {
		fields: [draftTemplates.updatedBy],
		references: [profiles.id],
		relationName: "draftTemplates_updatedBy_profiles_id"
	}),
	caseDrafts: many(caseDrafts),
	casePapers: many(casePapers),
}));

export const legalSourcesRelations = relations(legalSources, ({one}) => ({
	organization: one(organizations, {
		fields: [legalSources.orgId],
		references: [organizations.id]
	}),
	profile_verifiedBy: one(profiles, {
		fields: [legalSources.verifiedBy],
		references: [profiles.id],
		relationName: "legalSources_verifiedBy_profiles_id"
	}),
	profile_retiredBy: one(profiles, {
		fields: [legalSources.retiredBy],
		references: [profiles.id],
		relationName: "legalSources_retiredBy_profiles_id"
	}),
}));

export const publicationsRelations = relations(publications, ({one, many}) => ({
	organization: one(organizations, {
		fields: [publications.orgId],
		references: [organizations.id]
	}),
	profile_cancelSeenBy: one(profiles, {
		fields: [publications.cancelSeenBy],
		references: [profiles.id],
		relationName: "publications_cancelSeenBy_profiles_id"
	}),
	profile_triagedBy: one(profiles, {
		fields: [publications.triagedBy],
		references: [profiles.id],
		relationName: "publications_triagedBy_profiles_id"
	}),
	aiRun: one(aiRuns, {
		fields: [publications.aiRunId],
		references: [aiRuns.id]
	}),
	proceeding: one(proceedings, {
		fields: [publications.orgId],
		references: [proceedings.id]
	}),
	case: one(cases, {
		fields: [publications.orgId],
		references: [cases.id]
	}),
	profile_reviewedBy: one(profiles, {
		fields: [publications.reviewedBy],
		references: [profiles.id],
		relationName: "publications_reviewedBy_profiles_id"
	}),
	profile_hearingSettledBy: one(profiles, {
		fields: [publications.hearingSettledBy],
		references: [profiles.id],
		relationName: "publications_hearingSettledBy_profiles_id"
	}),
	deadlines: many(deadlines),
	clientNotices: many(clientNotices),
	hearings: many(hearings),
	publicationReadings: many(publicationReadings),
}));

export const caseDraftsRelations = relations(caseDrafts, ({one, many}) => ({
	organization: one(organizations, {
		fields: [caseDrafts.orgId],
		references: [organizations.id]
	}),
	aiRun: one(aiRuns, {
		fields: [caseDrafts.runId],
		references: [aiRuns.id]
	}),
	profile_revisionBy: one(profiles, {
		fields: [caseDrafts.revisionBy],
		references: [profiles.id],
		relationName: "caseDrafts_revisionBy_profiles_id"
	}),
	profile_approvedBy: one(profiles, {
		fields: [caseDrafts.approvedBy],
		references: [profiles.id],
		relationName: "caseDrafts_approvedBy_profiles_id"
	}),
	profile_requestedBy: one(profiles, {
		fields: [caseDrafts.requestedBy],
		references: [profiles.id],
		relationName: "caseDrafts_requestedBy_profiles_id"
	}),
	case: one(cases, {
		fields: [caseDrafts.orgId],
		references: [cases.id]
	}),
	proceeding: one(proceedings, {
		fields: [caseDrafts.orgId],
		references: [proceedings.id]
	}),
	caseDocument: one(caseDocuments, {
		fields: [caseDrafts.orgId],
		references: [caseDocuments.id]
	}),
	draftTemplate: one(draftTemplates, {
		fields: [caseDrafts.templateId],
		references: [draftTemplates.id]
	}),
	caseDraftVersions: many(caseDraftVersions),
	caseDraftCitations: many(caseDraftCitations),
}));

export const caseDraftVersionsRelations = relations(caseDraftVersions, ({one}) => ({
	organization: one(organizations, {
		fields: [caseDraftVersions.orgId],
		references: [organizations.id]
	}),
	profile_authorId: one(profiles, {
		fields: [caseDraftVersions.authorId],
		references: [profiles.id],
		relationName: "caseDraftVersions_authorId_profiles_id"
	}),
	profile_askedBy: one(profiles, {
		fields: [caseDraftVersions.askedBy],
		references: [profiles.id],
		relationName: "caseDraftVersions_askedBy_profiles_id"
	}),
	aiRun: one(aiRuns, {
		fields: [caseDraftVersions.runId],
		references: [aiRuns.id]
	}),
	caseDraft: one(caseDrafts, {
		fields: [caseDraftVersions.orgId],
		references: [caseDrafts.id]
	}),
}));

export const dossiersRelations = relations(dossiers, ({one}) => ({
	issuedDocument: one(issuedDocuments, {
		fields: [dossiers.orgId],
		references: [issuedDocuments.id]
	}),
	organization: one(organizations, {
		fields: [dossiers.orgId],
		references: [organizations.id]
	}),
	profile: one(profiles, {
		fields: [dossiers.requestedBy],
		references: [profiles.id]
	}),
	case: one(cases, {
		fields: [dossiers.orgId],
		references: [cases.id]
	}),
}));

export const flightChecksRelations = relations(flightChecks, ({one}) => ({
	organization: one(organizations, {
		fields: [flightChecks.orgId],
		references: [organizations.id]
	}),
	profile: one(profiles, {
		fields: [flightChecks.requestedBy],
		references: [profiles.id]
	}),
	case: one(cases, {
		fields: [flightChecks.orgId],
		references: [cases.id]
	}),
	flightSegment: one(flightSegments, {
		fields: [flightChecks.orgId],
		references: [flightSegments.id]
	}),
}));

export const proceedingTrackingRelations = relations(proceedingTracking, ({one}) => ({
	organization: one(organizations, {
		fields: [proceedingTracking.orgId],
		references: [organizations.id]
	}),
	profile: one(profiles, {
		fields: [proceedingTracking.requestedBy],
		references: [profiles.id]
	}),
	case: one(cases, {
		fields: [proceedingTracking.orgId],
		references: [cases.id]
	}),
	proceeding: one(proceedings, {
		fields: [proceedingTracking.orgId],
		references: [proceedings.id]
	}),
}));

export const movementsRelations = relations(movements, ({one}) => ({
	organization: one(organizations, {
		fields: [movements.orgId],
		references: [organizations.id]
	}),
	case: one(cases, {
		fields: [movements.orgId],
		references: [cases.id]
	}),
	proceeding: one(proceedings, {
		fields: [movements.orgId],
		references: [proceedings.id]
	}),
}));

export const importBatchesRelations = relations(importBatches, ({one, many}) => ({
	organization: one(organizations, {
		fields: [importBatches.orgId],
		references: [organizations.id]
	}),
	profile: one(profiles, {
		fields: [importBatches.createdBy],
		references: [profiles.id]
	}),
	importRows: many(importRows),
}));

export const importRowsRelations = relations(importRows, ({one}) => ({
	organization: one(organizations, {
		fields: [importRows.orgId],
		references: [organizations.id]
	}),
	case: one(cases, {
		fields: [importRows.caseId],
		references: [cases.id]
	}),
	proceeding: one(proceedings, {
		fields: [importRows.proceedingId],
		references: [proceedings.id]
	}),
	person: one(people, {
		fields: [importRows.personId],
		references: [people.id]
	}),
	importBatch: one(importBatches, {
		fields: [importRows.orgId],
		references: [importBatches.id]
	}),
}));

export const courtCalendarDaysRelations = relations(courtCalendarDays, ({one}) => ({
	court: one(courts, {
		fields: [courtCalendarDays.court],
		references: [courts.acronym]
	}),
	profile: one(profiles, {
		fields: [courtCalendarDays.createdBy],
		references: [profiles.id]
	}),
}));

export const deadlineActsRelations = relations(deadlineActs, ({one, many}) => ({
	profile: one(profiles, {
		fields: [deadlineActs.updatedBy],
		references: [profiles.id]
	}),
	deadlines: many(deadlines),
}));

export const deadlinesRelations = relations(deadlines, ({one, many}) => ({
	organization: one(organizations, {
		fields: [deadlines.orgId],
		references: [organizations.id]
	}),
	deadlineAct: one(deadlineActs, {
		fields: [deadlines.act],
		references: [deadlineActs.slug]
	}),
	profile_confirmedBy: one(profiles, {
		fields: [deadlines.confirmedBy],
		references: [profiles.id],
		relationName: "deadlines_confirmedBy_profiles_id"
	}),
	profile_doneBy: one(profiles, {
		fields: [deadlines.doneBy],
		references: [profiles.id],
		relationName: "deadlines_doneBy_profiles_id"
	}),
	profile_dismissedBy: one(profiles, {
		fields: [deadlines.dismissedBy],
		references: [profiles.id],
		relationName: "deadlines_dismissedBy_profiles_id"
	}),
	profile_createdBy: one(profiles, {
		fields: [deadlines.createdBy],
		references: [profiles.id],
		relationName: "deadlines_createdBy_profiles_id"
	}),
	case: one(cases, {
		fields: [deadlines.orgId],
		references: [cases.id]
	}),
	proceeding: one(proceedings, {
		fields: [deadlines.orgId],
		references: [proceedings.id]
	}),
	publication: one(publications, {
		fields: [deadlines.orgId],
		references: [publications.id]
	}),
	publicationReadings: many(publicationReadings),
}));

export const publicationTriagePoliciesRelations = relations(publicationTriagePolicies, ({one}) => ({
	profile: one(profiles, {
		fields: [publicationTriagePolicies.changedBy],
		references: [profiles.id]
	}),
}));

export const firmCalendarsRelations = relations(firmCalendars, ({one}) => ({
	profile: one(profiles, {
		fields: [firmCalendars.createdBy],
		references: [profiles.id]
	}),
	connection: one(connections, {
		fields: [firmCalendars.orgId],
		references: [connections.id]
	}),
	organization: one(organizations, {
		fields: [firmCalendars.orgId],
		references: [organizations.id]
	}),
}));

export const hearingEventRemovalsRelations = relations(hearingEventRemovals, ({one}) => ({
	organization: one(organizations, {
		fields: [hearingEventRemovals.orgId],
		references: [organizations.id]
	}),
}));

export const noticeOptinsRelations = relations(noticeOptins, ({one}) => ({
	profile_endedBy: one(profiles, {
		fields: [noticeOptins.endedBy],
		references: [profiles.id],
		relationName: "noticeOptins_endedBy_profiles_id"
	}),
	person: one(people, {
		fields: [noticeOptins.personId],
		references: [people.id]
	}),
	organization: one(organizations, {
		fields: [noticeOptins.orgId],
		references: [organizations.id]
	}),
	clientLink: one(clientLinks, {
		fields: [noticeOptins.linkId],
		references: [clientLinks.id]
	}),
	profile_recordedBy: one(profiles, {
		fields: [noticeOptins.recordedBy],
		references: [profiles.id],
		relationName: "noticeOptins_recordedBy_profiles_id"
	}),
}));

export const caseAdvancesRelations = relations(caseAdvances, ({one}) => ({
	organization: one(organizations, {
		fields: [caseAdvances.orgId],
		references: [organizations.id]
	}),
	case: one(cases, {
		fields: [caseAdvances.caseId],
		references: [cases.id]
	}),
}));

export const clientNoticesRelations = relations(clientNotices, ({one}) => ({
	organization: one(organizations, {
		fields: [clientNotices.orgId],
		references: [organizations.id]
	}),
	noticeKind: one(noticeKinds, {
		fields: [clientNotices.kind],
		references: [noticeKinds.kind]
	}),
	case: one(cases, {
		fields: [clientNotices.orgId],
		references: [cases.id]
	}),
	person: one(people, {
		fields: [clientNotices.orgId],
		references: [people.id]
	}),
	proceeding: one(proceedings, {
		fields: [clientNotices.orgId],
		references: [proceedings.id]
	}),
	hearing: one(hearings, {
		fields: [clientNotices.orgId],
		references: [hearings.id]
	}),
	publication: one(publications, {
		fields: [clientNotices.orgId],
		references: [publications.id]
	}),
	caseDocument: one(caseDocuments, {
		fields: [clientNotices.orgId],
		references: [caseDocuments.id]
	}),
	waMessage: one(waMessages, {
		fields: [clientNotices.orgId],
		references: [waMessages.id]
	}),
}));

export const noticeKindsRelations = relations(noticeKinds, ({many}) => ({
	clientNotices: many(clientNotices),
	firmNoticeKinds: many(firmNoticeKinds),
}));

export const hearingsRelations = relations(hearings, ({one, many}) => ({
	clientNotices: many(clientNotices),
	organization: one(organizations, {
		fields: [hearings.orgId],
		references: [organizations.id]
	}),
	profile_attendeeUserId: one(profiles, {
		fields: [hearings.attendeeUserId],
		references: [profiles.id],
		relationName: "hearings_attendeeUserId_profiles_id"
	}),
	profile_createdBy: one(profiles, {
		fields: [hearings.createdBy],
		references: [profiles.id],
		relationName: "hearings_createdBy_profiles_id"
	}),
	profile_updatedBy: one(profiles, {
		fields: [hearings.updatedBy],
		references: [profiles.id],
		relationName: "hearings_updatedBy_profiles_id"
	}),
	case: one(cases, {
		fields: [hearings.orgId],
		references: [cases.id]
	}),
	proceeding: one(proceedings, {
		fields: [hearings.orgId],
		references: [proceedings.id]
	}),
	publication: one(publications, {
		fields: [hearings.orgId],
		references: [publications.id]
	}),
	publicationReadings: many(publicationReadings),
}));

export const proceedingSignersSeenRelations = relations(proceedingSignersSeen, ({one}) => ({
	organization: one(organizations, {
		fields: [proceedingSignersSeen.orgId],
		references: [organizations.id]
	}),
	proceeding: one(proceedings, {
		fields: [proceedingSignersSeen.proceedingId],
		references: [proceedings.id]
	}),
}));

export const pscProvidersRelations = relations(pscProviders, ({one}) => ({
	profile: one(profiles, {
		fields: [pscProviders.updatedBy],
		references: [profiles.id]
	}),
}));

export const lawyerSignatureUsesRelations = relations(lawyerSignatureUses, ({one, many}) => ({
	filingPackages: many(filingPackages),
	organization: one(organizations, {
		fields: [lawyerSignatureUses.orgId],
		references: [organizations.id]
	}),
	profile: one(profiles, {
		fields: [lawyerSignatureUses.personId],
		references: [profiles.id]
	}),
	connection: one(connections, {
		fields: [lawyerSignatureUses.connectionId],
		references: [connections.id]
	}),
	case: one(cases, {
		fields: [lawyerSignatureUses.caseId],
		references: [cases.id]
	}),
}));

export const lawyerCpfsRelations = relations(lawyerCpfs, ({one}) => ({
	profile: one(profiles, {
		fields: [lawyerCpfs.userId],
		references: [profiles.id]
	}),
}));

export const filingPackageItemsRelations = relations(filingPackageItems, ({one}) => ({
	organization: one(organizations, {
		fields: [filingPackageItems.orgId],
		references: [organizations.id]
	}),
	filingPackage: one(filingPackages, {
		fields: [filingPackageItems.orgId],
		references: [filingPackages.id]
	}),
	file_orgId: one(files, {
		fields: [filingPackageItems.orgId],
		references: [files.id],
		relationName: "filingPackageItems_orgId_files_id"
	}),
	caseDocument: one(caseDocuments, {
		fields: [filingPackageItems.orgId],
		references: [caseDocuments.id]
	}),
	file_orgId: one(files, {
		fields: [filingPackageItems.orgId],
		references: [files.id],
		relationName: "filingPackageItems_orgId_files_id"
	}),
}));

export const testChatsRelations = relations(testChats, ({one}) => ({
	organization: one(organizations, {
		fields: [testChats.orgId],
		references: [organizations.id]
	}),
	profile: one(profiles, {
		fields: [testChats.startedBy],
		references: [profiles.id]
	}),
	waNumber: one(waNumbers, {
		fields: [testChats.orgId],
		references: [waNumbers.id]
	}),
}));

export const trackedLegsRelations = relations(trackedLegs, ({one}) => ({
	organization: one(organizations, {
		fields: [trackedLegs.orgId],
		references: [organizations.id]
	}),
	trackedTrip: one(trackedTrips, {
		fields: [trackedLegs.orgId],
		references: [trackedTrips.id]
	}),
}));

export const trackedTripsRelations = relations(trackedTrips, ({one, many}) => ({
	trackedLegs: many(trackedLegs),
	organization: one(organizations, {
		fields: [trackedTrips.orgId],
		references: [organizations.id]
	}),
	case: one(cases, {
		fields: [trackedTrips.orgId],
		references: [cases.id]
	}),
	paxTrip: one(paxTrips, {
		fields: [trackedTrips.paxTripId],
		references: [paxTrips.id]
	}),
	flightAlerts: many(flightAlerts),
}));

export const paxTripsRelations = relations(paxTrips, ({one, many}) => ({
	trackedTrips: many(trackedTrips),
	partner: one(partners, {
		fields: [paxTrips.partnerId],
		references: [partners.id]
	}),
	partnerLink: one(partnerLinks, {
		fields: [paxTrips.partnershipId],
		references: [partnerLinks.id]
	}),
	organization: one(organizations, {
		fields: [paxTrips.orgId],
		references: [organizations.id]
	}),
	paxTraveler: one(paxTravelers, {
		fields: [paxTrips.holderId],
		references: [paxTravelers.id]
	}),
	profile: one(profiles, {
		fields: [paxTrips.createdBy],
		references: [profiles.id]
	}),
	paxDocuments: many(paxDocuments),
	paxTripTravelers: many(paxTripTravelers),
	paxTripLegs: many(paxTripLegs),
}));

export const flightAlertsRelations = relations(flightAlerts, ({one}) => ({
	organization: one(organizations, {
		fields: [flightAlerts.orgId],
		references: [organizations.id]
	}),
	waMessage: one(waMessages, {
		fields: [flightAlerts.messageId],
		references: [waMessages.id]
	}),
	trackedTrip: one(trackedTrips, {
		fields: [flightAlerts.orgId],
		references: [trackedTrips.id]
	}),
}));

export const waConversationEventsRelations = relations(waConversationEvents, ({one}) => ({
	organization: one(organizations, {
		fields: [waConversationEvents.orgId],
		references: [organizations.id]
	}),
	profile: one(profiles, {
		fields: [waConversationEvents.actorId],
		references: [profiles.id]
	}),
	waConversation: one(waConversations, {
		fields: [waConversationEvents.orgId],
		references: [waConversations.id]
	}),
}));

export const casePapersRelations = relations(casePapers, ({one}) => ({
	organization: one(organizations, {
		fields: [casePapers.orgId],
		references: [organizations.id]
	}),
	draftTemplate: one(draftTemplates, {
		fields: [casePapers.templateId],
		references: [draftTemplates.id]
	}),
	case: one(cases, {
		fields: [casePapers.orgId],
		references: [cases.id]
	}),
	person: one(people, {
		fields: [casePapers.orgId],
		references: [people.id]
	}),
	caseDocument: one(caseDocuments, {
		fields: [casePapers.orgId],
		references: [caseDocuments.id]
	}),
	signatureEnvelope: one(signatureEnvelopes, {
		fields: [casePapers.orgId],
		references: [signatureEnvelopes.id]
	}),
}));

export const templateImportsRelations = relations(templateImports, ({one}) => ({
	file: one(files, {
		fields: [templateImports.orgId],
		references: [files.id]
	}),
	organization: one(organizations, {
		fields: [templateImports.orgId],
		references: [organizations.id]
	}),
	profile: one(profiles, {
		fields: [templateImports.requestedBy],
		references: [profiles.id]
	}),
	aiRun: one(aiRuns, {
		fields: [templateImports.runId],
		references: [aiRuns.id]
	}),
}));

export const partnerInvitationsRelations = relations(partnerInvitations, ({one}) => ({
	organization: one(organizations, {
		fields: [partnerInvitations.orgId],
		references: [organizations.id]
	}),
	productModule: one(productModules, {
		fields: [partnerInvitations.moduleKey],
		references: [productModules.key]
	}),
	partner: one(partners, {
		fields: [partnerInvitations.partnerId],
		references: [partners.id]
	}),
	profile_invitedBy: one(profiles, {
		fields: [partnerInvitations.invitedBy],
		references: [profiles.id],
		relationName: "partnerInvitations_invitedBy_profiles_id"
	}),
	profile_acceptedBy: one(profiles, {
		fields: [partnerInvitations.acceptedBy],
		references: [profiles.id],
		relationName: "partnerInvitations_acceptedBy_profiles_id"
	}),
}));

export const paxConfirmLinksRelations = relations(paxConfirmLinks, ({one, many}) => ({
	partner: one(partners, {
		fields: [paxConfirmLinks.partnerId],
		references: [partners.id]
	}),
	partnerLink: one(partnerLinks, {
		fields: [paxConfirmLinks.partnershipId],
		references: [partnerLinks.id]
	}),
	organization: one(organizations, {
		fields: [paxConfirmLinks.orgId],
		references: [organizations.id]
	}),
	paxTraveler: one(paxTravelers, {
		fields: [paxConfirmLinks.holderId],
		references: [paxTravelers.id]
	}),
	profile: one(profiles, {
		fields: [paxConfirmLinks.createdBy],
		references: [profiles.id]
	}),
	paxConsents: many(paxConsents),
}));

export const paxTravelersRelations = relations(paxTravelers, ({one, many}) => ({
	paxConfirmLinks: many(paxConfirmLinks),
	partner: one(partners, {
		fields: [paxTravelers.partnerId],
		references: [partners.id]
	}),
	partnerLink: one(partnerLinks, {
		fields: [paxTravelers.partnershipId],
		references: [partnerLinks.id]
	}),
	organization: one(organizations, {
		fields: [paxTravelers.orgId],
		references: [organizations.id]
	}),
	paxTraveler: one(paxTravelers, {
		fields: [paxTravelers.guardianId],
		references: [paxTravelers.id],
		relationName: "paxTravelers_guardianId_paxTravelers_id"
	}),
	paxTravelers: many(paxTravelers, {
		relationName: "paxTravelers_guardianId_paxTravelers_id"
	}),
	profile: one(profiles, {
		fields: [paxTravelers.createdBy],
		references: [profiles.id]
	}),
	case: one(cases, {
		fields: [paxTravelers.orgId],
		references: [cases.id]
	}),
	paxTrips: many(paxTrips),
	paxDocuments: many(paxDocuments),
	paxConsents_givenBy: many(paxConsents, {
		relationName: "paxConsents_givenBy_paxTravelers_id"
	}),
	paxConsents_travelerId: many(paxConsents, {
		relationName: "paxConsents_travelerId_paxTravelers_id"
	}),
	paxTripTravelers: many(paxTripTravelers),
}));

export const paxConsentTermsRelations = relations(paxConsentTerms, ({one, many}) => ({
	partner: one(partners, {
		fields: [paxConsentTerms.partnerId],
		references: [partners.id]
	}),
	profile: one(profiles, {
		fields: [paxConsentTerms.createdBy],
		references: [profiles.id]
	}),
	paxConsents: many(paxConsents),
}));

export const paxDocumentsRelations = relations(paxDocuments, ({one}) => ({
	partner: one(partners, {
		fields: [paxDocuments.partnerId],
		references: [partners.id]
	}),
	organization: one(organizations, {
		fields: [paxDocuments.orgId],
		references: [organizations.id]
	}),
	paxTraveler: one(paxTravelers, {
		fields: [paxDocuments.travelerId],
		references: [paxTravelers.id]
	}),
	paxTrip: one(paxTrips, {
		fields: [paxDocuments.tripId],
		references: [paxTrips.id]
	}),
	aiRun: one(aiRuns, {
		fields: [paxDocuments.readRunId],
		references: [aiRuns.id]
	}),
	profile: one(profiles, {
		fields: [paxDocuments.createdBy],
		references: [profiles.id]
	}),
	file: one(files, {
		fields: [paxDocuments.orgId],
		references: [files.id]
	}),
}));

export const paxConsentsRelations = relations(paxConsents, ({one}) => ({
	paxTraveler_givenBy: one(paxTravelers, {
		fields: [paxConsents.givenBy],
		references: [paxTravelers.id],
		relationName: "paxConsents_givenBy_paxTravelers_id"
	}),
	organization: one(organizations, {
		fields: [paxConsents.orgId],
		references: [organizations.id]
	}),
	paxTraveler_travelerId: one(paxTravelers, {
		fields: [paxConsents.travelerId],
		references: [paxTravelers.id],
		relationName: "paxConsents_travelerId_paxTravelers_id"
	}),
	partner: one(partners, {
		fields: [paxConsents.partnerId],
		references: [partners.id]
	}),
	paxConsentTerm: one(paxConsentTerms, {
		fields: [paxConsents.termId],
		references: [paxConsentTerms.id]
	}),
	paxConfirmLink: one(paxConfirmLinks, {
		fields: [paxConsents.confirmLinkId],
		references: [paxConfirmLinks.id]
	}),
}));

export const partnerApiKeysRelations = relations(partnerApiKeys, ({one}) => ({
	partner: one(partners, {
		fields: [partnerApiKeys.partnerId],
		references: [partners.id]
	}),
	partnerLink: one(partnerLinks, {
		fields: [partnerApiKeys.partnershipId],
		references: [partnerLinks.id]
	}),
	profile_createdBy: one(profiles, {
		fields: [partnerApiKeys.createdBy],
		references: [profiles.id],
		relationName: "partnerApiKeys_createdBy_profiles_id"
	}),
	profile_revokedBy: one(profiles, {
		fields: [partnerApiKeys.revokedBy],
		references: [profiles.id],
		relationName: "partnerApiKeys_revokedBy_profiles_id"
	}),
}));

export const paxTripTravelersRelations = relations(paxTripTravelers, ({one}) => ({
	paxTrip: one(paxTrips, {
		fields: [paxTripTravelers.tripId],
		references: [paxTrips.id]
	}),
	paxTraveler: one(paxTravelers, {
		fields: [paxTripTravelers.travelerId],
		references: [paxTravelers.id]
	}),
}));

export const announcementDismissalsRelations = relations(announcementDismissals, ({one}) => ({
	announcement: one(announcements, {
		fields: [announcementDismissals.announcementId],
		references: [announcements.id]
	}),
	profile: one(profiles, {
		fields: [announcementDismissals.userId],
		references: [profiles.id]
	}),
}));

export const newsletterDeliveriesRelations = relations(newsletterDeliveries, ({one}) => ({
	newsletterSend: one(newsletterSends, {
		fields: [newsletterDeliveries.sendId],
		references: [newsletterSends.id]
	}),
	lead: one(leads, {
		fields: [newsletterDeliveries.leadId],
		references: [leads.id]
	}),
}));

export const proceedingPartiesRelations = relations(proceedingParties, ({one}) => ({
	organization: one(organizations, {
		fields: [proceedingParties.orgId],
		references: [organizations.id]
	}),
	proceeding: one(proceedings, {
		fields: [proceedingParties.proceedingId],
		references: [proceedings.id]
	}),
	caseParty: one(caseParties, {
		fields: [proceedingParties.partyId],
		references: [caseParties.id]
	}),
}));

export const proceedingLawyersRelations = relations(proceedingLawyers, ({one}) => ({
	profile: one(profiles, {
		fields: [proceedingLawyers.userId],
		references: [profiles.id]
	}),
	organization: one(organizations, {
		fields: [proceedingLawyers.orgId],
		references: [organizations.id]
	}),
	proceeding: one(proceedings, {
		fields: [proceedingLawyers.proceedingId],
		references: [proceedings.id]
	}),
}));

export const firmSignersRelations = relations(firmSigners, ({one}) => ({
	organization: one(organizations, {
		fields: [firmSigners.orgId],
		references: [organizations.id]
	}),
	profile_userId: one(profiles, {
		fields: [firmSigners.userId],
		references: [profiles.id],
		relationName: "firmSigners_userId_profiles_id"
	}),
	profile_addedBy: one(profiles, {
		fields: [firmSigners.addedBy],
		references: [profiles.id],
		relationName: "firmSigners_addedBy_profiles_id"
	}),
	membership: one(memberships, {
		fields: [firmSigners.orgId],
		references: [memberships.orgId]
	}),
}));

export const firmModulesRelations = relations(firmModules, ({one}) => ({
	organization: one(organizations, {
		fields: [firmModules.orgId],
		references: [organizations.id]
	}),
	productModule: one(productModules, {
		fields: [firmModules.moduleKey],
		references: [productModules.key]
	}),
	profile: one(profiles, {
		fields: [firmModules.enabledBy],
		references: [profiles.id]
	}),
}));

export const partnerMembersRelations = relations(partnerMembers, ({one}) => ({
	partner: one(partners, {
		fields: [partnerMembers.partnerId],
		references: [partners.id]
	}),
	profile: one(profiles, {
		fields: [partnerMembers.userId],
		references: [profiles.id]
	}),
}));

export const waContactsRelations = relations(waContacts, ({one}) => ({
	organization: one(organizations, {
		fields: [waContacts.orgId],
		references: [organizations.id]
	}),
	waNumber: one(waNumbers, {
		fields: [waContacts.numberId],
		references: [waNumbers.id]
	}),
}));

export const firmClaimDefaultsRelations = relations(firmClaimDefaults, ({one}) => ({
	organization: one(organizations, {
		fields: [firmClaimDefaults.orgId],
		references: [organizations.id]
	}),
	profile: one(profiles, {
		fields: [firmClaimDefaults.changedBy],
		references: [profiles.id]
	}),
}));

export const firmAutonomyRelations = relations(firmAutonomy, ({one}) => ({
	organization: one(organizations, {
		fields: [firmAutonomy.orgId],
		references: [organizations.id]
	}),
	autonomyDecision: one(autonomyDecisions, {
		fields: [firmAutonomy.decision],
		references: [autonomyDecisions.key]
	}),
	profile: one(profiles, {
		fields: [firmAutonomy.changedBy],
		references: [profiles.id]
	}),
}));

export const waOptoutsRelations = relations(waOptouts, ({one}) => ({
	organization: one(organizations, {
		fields: [waOptouts.orgId],
		references: [organizations.id]
	}),
	profile: one(profiles, {
		fields: [waOptouts.recordedBy],
		references: [profiles.id]
	}),
}));

export const paxTripLegsRelations = relations(paxTripLegs, ({one}) => ({
	paxTrip: one(paxTrips, {
		fields: [paxTripLegs.tripId],
		references: [paxTrips.id]
	}),
}));

export const courtNotesRelations = relations(courtNotes, ({one}) => ({
	court: one(courts, {
		fields: [courtNotes.court],
		references: [courts.acronym]
	}),
	profile: one(profiles, {
		fields: [courtNotes.updatedBy],
		references: [profiles.id]
	}),
}));

export const caseDraftCitationsRelations = relations(caseDraftCitations, ({one}) => ({
	organization: one(organizations, {
		fields: [caseDraftCitations.orgId],
		references: [organizations.id]
	}),
	caseDraft: one(caseDrafts, {
		fields: [caseDraftCitations.orgId],
		references: [caseDrafts.id]
	}),
}));

export const courtCalendarYearsRelations = relations(courtCalendarYears, ({one}) => ({
	court: one(courts, {
		fields: [courtCalendarYears.court],
		references: [courts.acronym]
	}),
	profile: one(profiles, {
		fields: [courtCalendarYears.updatedBy],
		references: [profiles.id]
	}),
}));

export const firmNoticeKindsRelations = relations(firmNoticeKinds, ({one}) => ({
	organization: one(organizations, {
		fields: [firmNoticeKinds.orgId],
		references: [organizations.id]
	}),
	noticeKind: one(noticeKinds, {
		fields: [firmNoticeKinds.kind],
		references: [noticeKinds.kind]
	}),
	profile_submittedBy: one(profiles, {
		fields: [firmNoticeKinds.submittedBy],
		references: [profiles.id],
		relationName: "firmNoticeKinds_submittedBy_profiles_id"
	}),
	profile_changedBy: one(profiles, {
		fields: [firmNoticeKinds.changedBy],
		references: [profiles.id],
		relationName: "firmNoticeKinds_changedBy_profiles_id"
	}),
	waTemplate_orgId: one(waTemplates, {
		fields: [firmNoticeKinds.orgId],
		references: [waTemplates.id],
		relationName: "firmNoticeKinds_orgId_waTemplates_id"
	}),
	waTemplate_orgId: one(waTemplates, {
		fields: [firmNoticeKinds.orgId],
		references: [waTemplates.id],
		relationName: "firmNoticeKinds_orgId_waTemplates_id"
	}),
}));

export const publicationReadingsRelations = relations(publicationReadings, ({one}) => ({
	organization: one(organizations, {
		fields: [publicationReadings.orgId],
		references: [organizations.id]
	}),
	aiRun: one(aiRuns, {
		fields: [publicationReadings.runId],
		references: [aiRuns.id]
	}),
	deadline: one(deadlines, {
		fields: [publicationReadings.deadlineId],
		references: [deadlines.id]
	}),
	hearing: one(hearings, {
		fields: [publicationReadings.hearingId],
		references: [hearings.id]
	}),
	publication: one(publications, {
		fields: [publicationReadings.publicationId],
		references: [publications.id]
	}),
}));

export const courtSystemsRelations = relations(courtSystems, ({one}) => ({
	court: one(courts, {
		fields: [courtSystems.court],
		references: [courts.acronym]
	}),
	profile: one(profiles, {
		fields: [courtSystems.updatedBy],
		references: [profiles.id]
	}),
}));