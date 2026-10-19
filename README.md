# Quick Translator

A lightweight Chrome extension (Manifest V3) that translates selected text in place as you browse, including long selections, using Google Translate.

## Features

- Translate a selection from a pop-up bubble, the toolbar popup, or the right-click context menu
- Translate the whole page with one click
- Long selections are split into chunks and translated seamlessly
- Text-to-speech for translations (offscreen document, with Web Speech API fallback)
- Configurable primary language and pop-up behaviour on the options page
- UI localized into 12 languages (`_locales/`)
- Optional, opt-out, privacy-friendly usage analytics (GA4 Measurement Protocol); disabled unless configured

## Install (developer mode)

1. Clone this repository.
2. Copy `lib/analytics-config.example.js` to `lib/analytics-config.js`.
   Leave the placeholders as they are to keep analytics fully disabled, or enter your own GA4 Measurement ID and API secret.
3. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked** and select the project folder.

## Project structure

| Path | Purpose |
|---|---|
| `manifest.json` | Extension manifest (MV3) |
| `background.js` | Service worker: translation requests, context menus, TTS orchestration |
| `content.js` | In-page selection bubble and inline translations |
| `popup.*` | Toolbar popup UI |
| `options.*` | Options page |
| `offscreen.*` | Offscreen document for audio playback |
| `lib/` | Shared helpers (chunking, languages, analytics) |
| `_locales/` | Translated UI strings |

## Permissions

`activeTab`, `contextMenus`, `storage`, `offscreen`, `scripting`, plus host access to `translate.googleapis.com` (translation and speech) and `www.google-analytics.com` (optional analytics).

## Tech stack

Plain JavaScript, HTML and CSS; Chrome Extensions Manifest V3. No build step.