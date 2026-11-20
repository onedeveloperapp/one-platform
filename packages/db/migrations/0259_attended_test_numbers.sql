-- ============================================================
-- 0259_attended_test_numbers: a firm that tested ONE on a number of the test provider also goes on being attended
-- (the owner's decision 2 of 2026-11-20: the firms already using ONE keep it, and find the setup's new steps as
-- something to do).
--
-- 0256 marked as attended before its operation only a firm with a number of its own; a firm whose only number was
-- the test provider's (the test chat, and the firms that rehearse on it) went silent to new contacts until it says its
-- areas, which the decision kept for a new firm alone. Any number active when the setup began to ask the operation
-- now counts.
-- ============================================================

update public.organizations o set attended_before_operation = true
where not o.attended_before_operation
  and o.operation_answered_at is null
  and exists (select 1 from public.wa_numbers n where n.org_id = o.id and n.status = 'active');
