# Changelog

## Unreleased

## 1.3.0 - 2026-02-09
### Features
- Add keep-scroll-on-send behavior and expose its toggle in the popup
- Add a shortcut to copy the last user message (`Cmd/Ctrl + Shift + Y`)

### Documentation
- Document the keep-scroll-on-send feature in README and changelog

### Styles
- Simplify popup shortcut labels and highlight the new copy shortcut

## 1.2.0 - 2026-01-21
### Features
- Add Branch Chat shortcut (Cmd/Ctrl + B) to branch from the last assistant message
- Add a Review call-to-action in the popup footer (prompt + link)

### Fixes
- Preserve scroll position when triggering the Branch Chat shortcut

### Documentation
- Update README for the Branch Chat feature

## 1.1.1 - 2026-01-04
### Fixes
- Use platform-specific default for Instant mode shortcut (Fixes shared logic)

### Documentation
- Update shortcut examples for Windows Instant mode

### Styles
- Fix line length formatting in Popup

## 1.1.0 - 2025-12-20
### Features
- Add Pin/Unpin chat shortcut (Cmd/Ctrl + Shift + P) with toast feedback
- Add footer links (GitHub repo, etc.) in Popup

### Fixes
- Handle localization via runtime script

### Improvements
- Adjust thread bottom container spacing
- Refine header actions layout in wide mode
- Robustify model mode switching
- Fix wide mode header and button visibility

## 1.0.0 - 2025-12-08
- Initial release
