import { useEffect, useRef, useState } from "react";
import { isSafeExternalUrl } from "../utils/linkOpener.ts";

export type LinkDialogModalProps = {
  isOpen: boolean;
  initialValue: string;
  onConfirm: (href: string) => void;
  onCancel: () => void;
};

export function LinkDialogModal({ isOpen, initialValue, onConfirm, onCancel }: LinkDialogModalProps) {
  const [value, setValue] = useState(initialValue);
  const [invalid, setInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    setValue(initialValue);
    setInvalid(false);
    inputRef.current?.focus();
    inputRef.current?.select();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [initialValue, isOpen, onCancel]);

  if (!isOpen) return null;

  const confirm = () => {
    // Empty hrefs retain the existing Writing command's unlink behavior. The
    // safety predicate rejects dangerous schemes without rewriting the input.
    if (value.trim() && !isSafeExternalUrl(value)) {
      setInvalid(true);
      return;
    }
    onConfirm(value);
  };

  return (
    <div
      className="modal-backdrop link-dialog-backdrop"
      onClick={(event) => { if (event.target === event.currentTarget) onCancel(); }}
      role="presentation"
    >
      <div className="link-dialog" role="dialog" aria-modal="true" aria-labelledby="link-dialog-title">
        <div className="link-dialog-header">
          <h2 id="link-dialog-title">Insert link</h2>
          <button type="button" className="close-btn" onClick={onCancel} aria-label="Cancel link">✕</button>
        </div>
        <div className="link-dialog-body">
          <label htmlFor="link-dialog-url">Link URL</label>
          <input
            ref={inputRef}
            id="link-dialog-url"
            className="link-dialog-input"
            type="url"
            value={value}
            onChange={(event) => { setValue(event.target.value); setInvalid(false); }}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); confirm(); } }}
            enterKeyHint="done"
            aria-invalid={invalid}
            aria-describedby={invalid ? "link-dialog-error" : undefined}
            autoComplete="url"
          />
          {invalid ? <p id="link-dialog-error" className="link-dialog-error" role="alert">Enter a safe link URL.</p> : null}
        </div>
        <div className="link-dialog-actions">
          <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn-primary" onClick={confirm}>Done</button>
        </div>
      </div>
    </div>
  );
}
