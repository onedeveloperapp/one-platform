/**
 * The anchor every "join the waitlist" button on the page points at. In its
 * own module because the form is a client component: a constant exported from
 * a "use client" file reaches a server component as a reference, not a value.
 */
export const WAITLIST_FORM_ID = "waitlist-form";
