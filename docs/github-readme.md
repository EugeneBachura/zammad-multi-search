# Search Tabs for Zammad

Keep multiple searches open as tabs inside Zammad's classic desktop interface. Switch between queries on the same page and build search filters visually.

Source version: **{{version}}**. Author: **Eugene Bachura**.

![Search tabs in a demonstration workspace](store/images/screenshot-en-tabs.png)

## Features

- New global searches automatically become separate tabs.
- Edit the selected search from the results field or the visual filter builder.
- Give search tabs custom names and drag them beside other searches or tickets.
- Restore saved queries, names and tab positions after reloading the page.
- Combine conditions with AND, OR, nested groups, NOT and date or number ranges.
- Use English or Polish controls that follow the Zammad theme.
- Use separate temporary searches in private windows, or explicitly choose shared saved searches.

## Install from source

1. Download this repository as a ZIP and extract it, or clone it with Git.
2. Open `chrome://extensions` and enable Developer mode.
3. Choose **Load unpacked** and select the repository's `extension` folder.
4. Sign in to your Zammad classic workspace and open the extension's toolbar panel.
5. Choose **Allow access and enable**, then approve access to that site. If access is already allowed, choose **Enable on this site**.

The extension requests access only to the site you choose. Node.js and a build step are not required to run the unpacked extension.

Requires Chrome 111 or later and an existing Zammad account with access to the classic desktop workspace. The mobile interface is not supported. Search results are refreshed by the Zammad server; the extension saves queries and does not preserve result pages, sorting or selected tickets.

## Search tabs

The global search field opens another search tab. The field inside the results area and the filter builder edit the selected search.

Hover over a search tab and click the pencil to name it. Enter saves, Escape cancels, and an empty name restores the query label. A custom name stays when its query changes.

Drag a search tab to change its position. A focused tab can also be moved with Alt + Up or Alt + Down.

## Private windows

Turn on **Allow in incognito** in the browser's extension details, then sign in to Zammad and enable the site in the private window.

By default, private queries, names and positions stay in memory and are removed after the last private window closes. The **Use shared saved searches in private windows** setting makes private windows use the regular profile's saved searches for the same Zammad address, application path and account. Changes in that mode remain after private windows close. Zammad sign-in stays separate.

## Privacy

Queries are stored locally and executed through the Zammad page you opened. The extension sends no queries or telemetry to its publisher and has no ads, analytics, cloud synchronization or remote executable code. Settings can disable the integration and remove saved data.

Read the [privacy policy](store/privacy-policy.md) for storage, private-window retention and removal details.

## Development

Node.js 20 or later is required for the development tools.

```sh
npm ci
npx playwright install chromium
npm test
npm run check:release
npm run build
```

`npm run build` copies the runtime files to `dist/chrome`. JavaScript and CSS remain readable; there is no transpilation, minification or bundler.

On Windows with PowerShell, create the store ZIP with:

```powershell
npm run package:chrome
```

The command writes `dist/search-tabs-for-zammad-{{version}}-chrome.zip` and its SHA-256 checksum. The ZIP contains only the files from `extension`, with `manifest.json` at its root.

For a local demonstration:

```sh
npm run demo
```

Open `http://127.0.0.1:8090` and enable the extension there. This is a labelled test workspace with sample data. It does not include a Zammad server or real tickets.

## Project layout

- `extension/`: packaged extension source, translations and icons.
- `scripts/`: build, validation, packaging and demonstration tools.
- `tests/`: browser integration tests and query-builder checks.
- `store/`: public descriptions, privacy policy and demonstration images.
- `assets/`: source artwork used to export icons and promotional images.

## License and support

Licensed under the [MIT License](LICENSE). Copyright (c) 2026 Eugene Bachura.

Report problems through [GitHub Issues](https://github.com/EugeneBachura/zammad-multi-search/issues) or contact [eugene.bachura@gmail.com](mailto:eugene.bachura@gmail.com).

This is an independent extension. It is not affiliated with or endorsed by Zammad GmbH or the Zammad Foundation. Zammad is a trademark of its respective owner. The repository does not include the Zammad server or its application source.
