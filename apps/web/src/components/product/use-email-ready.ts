"use client";

import { useEffect, useState } from "react";

import { emailReady } from "@/lib/email-ready";

/**
 * Whether ONE can send an e-mail where it runs, asked once by a dialog that offers one (an invitation): null while
 * it is asked, and false when the answer could not be read, so a dialog never offers what would not leave.
 */
export function useEmailReady(): boolean | null {
  const [ready, setReady] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    emailReady().then(
      (answer) => live && setReady(answer === true),
      () => live && setReady(false),
    );
    return () => {
      live = false;
    };
  }, []);
  return ready;
}
