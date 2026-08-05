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
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
   }

   .title {
      font-size: 0.85rem;
      font-weight: 600;
      color: #ddd;
      letter-spacing: 0.04em;
   }

   .message {
      margin: 0;
      font-size: 0.75rem;
      line-height: 1.5;
      color: #999;
   }

   .actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      margin-top: 0.4rem;
   }

   .btn {
      padding: 0.35rem 0.8rem;
      font-family: inherit;
      font-size: 0.72rem;
      border-radius: 5px;
      border: 1px solid #3a3a3a;
      background: #242424;
      color: #bbb;
      cursor: pointer;
   }

   .btn:hover {
      background: #2c2c2c;
      color: #eee;
   }

   .btn:focus-visible {
      outline: 1px solid #666;
      outline-offset: 2px;
   }

   .confirm-btn {
      border-color: #4a4a4a;
      background: #333;
      color: #ddd;
   }

   .confirm-btn.danger {
      border-color: #5c2a2a;
      background: #3a2020;
      color: #e08080;
   }

   .confirm-btn.danger:hover {
      background: #4a2626;
      color: #f0a0a0;
   }
</style>
