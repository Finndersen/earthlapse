/**
 * The "Controls & shortcuts" section content: pointer/touch interactions with no on-screen
 * label of their own, then the keyboard shortcuts `timeline/keyboard.ts` maps. Pure and
 * data-driven off `controlsData.ts` — see that module's doc comment for how the keyboard list
 * is kept in sync with the code. Rendered by `CreditsList`, so it shows on both surfaces that
 * component does (the About & credits panel, `/credits`).
 */

import { formatShortcutKeys, KEYBOARD_SHORTCUTS, POINTER_CONTROLS } from './controlsData'
import styles from './ControlsShortcuts.module.css'

export function ControlsShortcuts() {
  return (
    <>
      <h4 className={styles.groupLabel}>Pointer &amp; touch</h4>
      <ul className={styles.pointerList}>
        {POINTER_CONTROLS.map((control) => (
          <li key={control.label} className={styles.pointerItem}>
            <span className={styles.pointerLabel}>{control.label}</span>
            <span className={styles.pointerDescription}>{control.description}</span>
          </li>
        ))}
      </ul>

      <h4 className={styles.groupLabel}>Keyboard</h4>
      <ul className={styles.keyList}>
        {KEYBOARD_SHORTCUTS.map((shortcut) => (
          <li key={shortcut.description} className={styles.keyRow}>
            <span className={styles.keyCaps}>
              {formatShortcutKeys(shortcut.keys).map((label, i) => (
                <span key={label} className={styles.keyAlt}>
                  {i > 0 && <span className={styles.keyOr}>or</span>}
                  <kbd className={styles.keyCap}>{label}</kbd>
                </span>
              ))}
            </span>
            <span className={styles.keyDescription}>{shortcut.description}</span>
          </li>
        ))}
      </ul>
    </>
  )
}
