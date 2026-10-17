/** The editor owns permission to leave; the router adapter cannot mutate its editing state. */
export type UnsavedChangesGuardModel = {
  readonly dirty: boolean;
  /** Read synchronously so saving and navigating in the same operation stays safe. */
  readonly isNavigationAllowed: () => boolean;
  readonly onDiscard: () => void | Promise<void>;
  /** Return true only after the current input has been saved for recovery. */
  readonly saveBeforeLeave?: () => boolean;
};
