<script lang="ts">
   interface Props {
      title: string;
      message: string;
      confirmLabel?: string;
      cancelLabel?: string;
      /** Tints the confirm button red for destructive actions. */
      danger?: boolean;
      onConfirm: () => void;
      onCancel: () => void;
   }

   let {
      title,
      message,
      confirmLabel = "Confirm",
      cancelLabel = "Cancel",
      danger = false,
      onConfirm,
      onCancel,
   }: Props = $props();

   let confirmBtnEl = $state<HTMLButtonElement | undefined>(undefined);
   let dialogEl = $state<HTMLDivElement | undefined>(undefined);

   $effect(() => {
      confirmBtnEl?.focus();
   });

   function onKeydown(e: KeyboardEvent) {
      if (e.key === "Escape") {
         e.preventDefault();
         onCancel();
         return;
      }
      // Two focusable buttons, so a manual wrap is cheaper than a trap helper.
      if (e.key === "Tab" && dialogEl) {
         const btns = [...dialogEl.querySelectorAll("button")];
         if (btns.length === 0) return;
         const first = btns[0];
         const last = btns[btns.length - 1];
         if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
         } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
         }
      }
   }
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="confirm-overlay" onclick={onCancel}>
   <div
      class="confirm-dialog"
      bind:this={dialogEl}
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
   >
      <span class="title">{title}</span>
      <p class="message">{message}</p>
      <div class="actions">
         <button class="btn cancel-btn" onclick={onCancel}>{cancelLabel}</button
         >
         <button
            bind:this={confirmBtnEl}
            class="btn confirm-btn"
            class:danger
            onclick={onConfirm}
         >
            {confirmLabel}
         </button>
      </div>
   </div>
</div>

<style>
   .confirm-overlay {
      position: fixed;
      inset: 0;
      z-index: 300;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.7);
   }

   .confirm-dialog {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
      width: 360px;
      max-width: calc(100vw - 2rem);
      padding: 1.25rem;
      background: var(--surface);
      border: 1px solid var(--line-strong);
      border-radius: var(--r-3);
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.7);
   }

   .title {
      font-family: var(--font-mono);
      font-size: 0.7rem;
      font-weight: 600;
      color: var(--text);
      letter-spacing: 0.16em;
      text-transform: uppercase;
   }

   .message {
      margin: 0;
      font-size: 0.75rem;
      line-height: 1.5;
      color: var(--text-2);
   }

   .actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      margin-top: 0.4rem;
   }

   .btn {
      padding: 0.35rem 0.8rem;
      font-family: var(--font-mono);
      font-size: 0.62rem;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      border-radius: var(--r-2);
      border: 1px solid var(--line-strong);
      background: rgba(255, 255, 255, 0.04);
      color: var(--text-2);
      cursor: pointer;
      transition:
         background var(--t-fast),
         color var(--t-fast);
   }

   .btn:hover {
      background: rgba(255, 255, 255, 0.09);
      color: var(--text);
   }

   .btn:focus-visible {
      outline: 1px solid var(--text-4);
      outline-offset: 2px;
   }

   .confirm-btn {
      border-color: var(--line-strong);
      background: rgba(255, 255, 255, 0.07);
      color: var(--text);
   }

   .confirm-btn.danger {
      border-color: var(--rec-dim);
      background: rgba(255, 95, 86, 0.12);
      color: var(--rec);
   }

   .confirm-btn.danger:hover {
      background: rgba(255, 95, 86, 0.22);
      color: #ffa8a2;
   }
</style>
