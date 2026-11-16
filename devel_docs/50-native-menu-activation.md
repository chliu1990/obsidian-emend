# Stage 50: Native menu item activation

## Status

Implemented on `fix/2.10-native-menu-activation` at runtime commit `c04356d`. This patch addresses composer **Writing and web search** and **Provider, model, and reasoning** items that displayed but did nothing when clicked in Obsidian's macOS native menu popup. The bundled host source confirms separate hide and click callback paths; the macOS ordering is inferred from the reported symptom rather than a captured macOS trace. Linux/Electron loopback verification is green, and the actual macOS native popup click remains a human verification item.

## Reported behavior

On macOS, both composer menus opened and showed the expected checked choices, but selecting a Writing/Web item or a model/reasoning item changed nothing. The failure predated the Selection Focus PR and affected both menus because they share the same callback lifecycle.

## Root cause

Obsidian 1.15.0's bundled native menu path builds an Electron menu and registers:

```js
u.on('menu-will-close', () => this.hide())
```

Menu item activation separately dispatches its normal click:

```js
click: (w, k, x) => b.handleEvent(new MouseEvent('click', x))
```

That means a selected native item can deliver `hide`/`onHide` before the item click. Emend previously used `onHide` to clear its `activeMenu` reference, and each item callback required that exact reference to still be active. By the time the native click arrived, the guard saw no active menu and returned silently.

The existing test menu mock already called `onHide` synchronously from `hide()`, so a regression could reproduce the same ordering without macOS.

## Regression evidence

Two tests were added before the production change:

- `tests/chat-composer-controls.test.ts`: open the Writing/Web menu, call `menu.hide()`, then activate `Edit · Selection`.
- `tests/chat-model-control.test.ts`: open the model menu, call `menu.hide()`, then activate `deepseek-v4-pro`.

RED command:

```bash
npx vitest run tests/chat-composer-controls.test.ts tests/chat-model-control.test.ts
```

RED result: **2 failed / 46 passed**. Both new tests reported zero callback calls, exactly matching the macOS symptom.

## Fix

- Both controls now keep the current menu reference through a native `onHide` callback and only update `aria-expanded="false"`.
- A subsequent selected-item click from that current menu is accepted by the existing item handler; the host closes and removes the menu after activation. The reference is not cleared inside the item handler itself.
- Opening another menu replaces the reference, so the older menu's items remain stale and rejected.
- `ChatModelControl.refresh()` explicitly clears the closed menu reference after hiding it, preserving settings-refresh invalidation.
- Both `destroy()` paths still hide and clear the menu reference, preserving view-close invalidation.
- Pending/disabled and per-item disabled guards are unchanged.

No provider request, note read, settings write, note write, persistence change, or visual change is introduced. The fix applies only to native menu callback lifetime.

GREEN focused result: **2 files / 48 tests passed**.

## Local gate

At committed runtime `c04356d`:

- `npm test`: **53 files / 1,752 tests passed**.
- `npm run build`: passed.
- `npm run lint`: passed.
- `git diff --check`: passed.
- Runtime bundle SHA-256: `8c3b693961bb434efe457a87f0824a372b37f67a318a407ed86654f1566dd568`.

## Real-Obsidian regression evidence

Official Obsidian 1.15.0 under Linux/Xvfb with synthetic notes, loopback mocks, and dummy credentials. Each summary records runtime HEAD `c04356d`, the same bundle hash, and `loadedBundleMatchedRoot: true`.

| Matrix | Result |
| --- | --- |
| Compact composer lifecycle/popout | **1 scenario / 28 assertions** |
| Selection Focus | **10 scenarios / 143 assertions** |
| Composer model controls | **11 scenarios / 149 assertions** |

Inspected final-run menu/control screenshots confirmed that the Writing/Web summary, model/reasoning menu structure, pending states, popouts, and 240 px layouts remained unchanged. The native item callback itself is covered by the focused unit regressions that mirror Obsidian's hide-before-click ordering.

## Limits

- The failing native popup was reported on macOS, but this environment is Linux/Xvfb and cannot display Electron's macOS native menu. Actual macOS item activation still requires the user's manual confirmation.
- Windows, physical OS-level pointer/keyboard input, screen readers, other Obsidian versions, and real providers were not exercised.
- No new screenshot surface is needed because the bug is activation-only; existing menu visuals are unchanged.
