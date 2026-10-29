"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";

import { Button, type ButtonProps } from "@mui/material";

/** What a document of the agency's area may be: a photo or a PDF (the purpose `pax_document`, migration 0070). */
export const DOCUMENT_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf";

export type FileButtonHandle = { open: () => void };

/**
 * A button that chooses one file: the hidden input it opens is cleared after each choice, so the same file may be
 * chosen again after a failure. `open` lets another control of the screen (an empty state's action) open it too;
 * `bare` leaves the button out, for a choice only that other control offers.
 */
const FileButton = forwardRef<
  FileButtonHandle,
  Omit<ButtonProps, "onChange" | "onClick"> & { label: string; onFile: (file: File) => void; bare?: boolean }
>(function FileButton({ label, onFile, disabled, bare, ...button }, handle) {
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(handle, () => ({ open: () => input.current?.click() }), []);
  return (
    <>
      {!bare && (
        <Button {...button} disabled={disabled} onClick={() => input.current?.click()}>
          {label}
        </Button>
      )}
      <input
        ref={input}
        type="file"
        accept={DOCUMENT_ACCEPT}
        hidden
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onFile(file);
        }}
      />
    </>
  );
});

export default FileButton;
