# X Cleaner

Minimal Chrome extension (MV3) that targets only X/Twitter.

## Features

- Hides promoted posts from the timeline
- Optional toggles for "Who to follow" and trends/sidebar modules
- Minimal permissions: only `storage` plus `x.com` / `twitter.com`

## Load unpacked

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder

## Notes

- Detection is heuristic-based, so X UI changes may require updates
- The extension uses DOM filtering, not network-wide ad blocking
- The current detector is layered: semantic text, contextual tweet signals, sidebar scoping, SPA navigation hooks, and mutation rescans
