import type { EffectInstance } from "../effects";
import { createEffectHistory } from "./history.svelte";
import { generateMosh, type MoshOptions } from "./mosh";

export interface MoshSessionOptions {
  getEffects: () => EffectInstance[];
  setEffects: (effects: EffectInstance[]) => void;
  getMoshOptions: () => MoshOptions;
  /** Drop a pending panel-edit burst when a mosh replaces the chain under it. */
  cancelBurst: () => void;
  /** Close and record a pending burst before walking the edit history. */
  endBurst: () => void;
}

/**
 * Two independent undo stacks over one effect chain, so the two gestures never
 * fight: ←/→ walk the moshes, Ctrl+Z/Y walk hand-edits. Rolling a mosh rebases
 * the edit history onto the new chain, so an edit undo lands on the mosh you
 * were tweaking rather than on some chain from before it.
 */
export function createMoshSession(opts: MoshSessionOptions) {
  const { getEffects, setEffects, getMoshOptions, cancelBurst, endBurst } =
    opts;
  const history = createEffectHistory();
  const moshHistory = createEffectHistory();

  /** Roll a fresh mosh onto the current chain. */
  function roll() {
    cancelBurst();
    const effects = getEffects();
    // Record what the chain looked like before the very first roll, so ←
    // comes back to the user's own work rather than the startup chain.
    if (!moshHistory.canUndo && !moshHistory.canRedo) moshHistory.reset(effects);
    generateMosh(effects, getMoshOptions());
    moshHistory.push(effects);
    history.reset(effects);
  }

  /** → : forward through the mosh history, rolling a new mosh at its top. */
  function forward() {
    const next = moshHistory.redo();
    if (!next) {
      roll();
      return;
    }
    cancelBurst();
    setEffects(next);
    history.reset(next);
  }

  /** ← : back through the mosh history. Never touches the edit history. */
  function back() {
    const prev = moshHistory.undo();
    if (!prev) return;
    cancelBurst();
    setEffects(prev);
    history.reset(prev);
  }

  /**
   * Ctrl+Z: hand-edits only. An edit still inside its coalescing window is a
   * real edit — it's committed first, so undoing lands on the state before it
   * rather than skipping past it to whatever was recorded last.
   */
  function undoEdit() {
    endBurst();
    const prev = history.undo();
    if (prev) setEffects(prev);
  }

  function redoEdit() {
    endBurst();
    const next = history.redo();
    if (next) setEffects(next);
  }

  return {
    get canUndoMosh() {
      return moshHistory.canUndo;
    },
    /** Where the hand-edit stack sits on the shared edit clock, for the
     * Ctrl+Z router. The mosh stack has its own keys and stays out of it. */
    get undoSeq() {
      return history.undoSeq;
    },
    get redoSeq() {
      return history.redoSeq;
    },
    /** Anything to undo on either stack — i.e. the chain has been worked on. */
    get touched() {
      return history.canUndo || moshHistory.canUndo;
    },
    /** Record an in-place edit to the current chain. */
    pushEdit(effects: EffectInstance[]) {
      history.push(effects);
    },
    /** Rebase the edit history onto a chain replaced from outside. */
    resetEdits(effects: EffectInstance[]) {
      history.reset(effects);
    },
    roll,
    forward,
    back,
    undoEdit,
    redoEdit,
  };
}

export type MoshSession = ReturnType<typeof createMoshSession>;
